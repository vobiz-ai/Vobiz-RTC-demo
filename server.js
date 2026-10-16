require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const querystring = require('querystring');

const port = 3000;

// Dynamic Answer URL Server for Vobiz
// Handles both outbound (browser -> PSTN) and inbound (PSTN -> browser) calls.
//
// Call types Vobiz sends to this Answer URL:
//
//   SDK outbound (browser -> PSTN):
//     From=sip:user@registrar.vobiz.ai  RouteType=sip  To=15550003333
//
//   PSTN inbound (phone -> your Vobiz number):
//     From=5550003333  RouteType=(empty)  To=15550003333  Direction=inbound

// Strip non-digit characters for loose number comparison
const digitsOnly = (s) => (s || '').replace(/\D/g, '');


// ── Access-token (JWT) minting for the browser client ──────────────────────
// The browser never sees VOBIZ_AUTH_TOKEN. It asks this server for a short-lived
// token and logs in with vobiz.client.loginWithAccessTokenGenerator(). Gate this
// route behind your own user session before using it outside a demo.
const crypto = require('crypto');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// Same shape backend-apis produces: HS256, cty "auris;v=1", signed with the Auth Token.
function signLocalToken(claims, authToken) {
    const header = { alg: 'HS256', typ: 'JWT', cty: 'auris;v=1' };
    const input = `${b64url(header)}.${b64url(claims)}`;
    const sig = crypto.createHmac('sha256', authToken).update(input).digest('base64url');
    return `${input}.${sig}`;
}

function jwtIdentity() {
    const authId = process.env.VOBIZ_AUTH_ID;
    const sub = process.env.JWT_SUB || 'webrtc-demo';
    return authId ? { sub, sipUsername: `${sub}_${authId}` } : null;
}

async function mintToken() {
    const authId = process.env.VOBIZ_AUTH_ID;
    const authToken = process.env.VOBIZ_AUTH_TOKEN;
    if (!authId || !authToken) throw new Error('VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN must be set in .env');

    const { sub, sipUsername } = jwtIdentity();
    const ttl = Number(process.env.JWT_TTL_SECONDS || 3600);          // 3 min ≤ ttl ≤ 24 h
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        iss: authId,
        sub,
        nbf: now,
        exp: now + ttl,
        per: { voice: { incoming_allow: true, outgoing_allow: true } },
    };
    if (process.env.JWT_APP_ID) claims.app = process.env.JWT_APP_ID;

    const base = (process.env.VOBIZ_API_BASE || 'https://api.vobiz.ai/api/v1').replace(/\/$/, '');
    let token;
    let mode = 'api';
    try {
        const r = await fetch(`${base}/Account/${authId}/JWT/Token/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from(`${authId}:${authToken}`).toString('base64')}`,
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken,
            },
            body: JSON.stringify(claims),
        });
        const text = await r.text();
        if (!r.ok) throw new Error(`Vobiz API ${r.status}: ${text.slice(0, 160)}`);
        token = JSON.parse(text).token;
    } catch (err) {
        if (process.env.JWT_LOCAL_SIGN !== '1') throw err;
        console.warn(`[token] API mint failed (${err.message}). Signing locally because JWT_LOCAL_SIGN=1.`);
        token = signLocalToken(claims, authToken);
        mode = 'local';
    }
    return { token, mode, sub, exp: claims.exp, sip_username: sipUsername };
}

function handleTokenRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    mintToken()
        .then((body) => {
            console.log(`[token] issued (${body.mode}) for ${body.sip_username}, exp ${new Date(body.exp * 1000).toISOString()}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
        })
        .catch((err) => {
            console.error(`[token] ${err.message}`);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
        });
}

// ── Call guard (fraud / deepfake detection) ────────────────────────────────
// When GUARD_WSS_URL is set, every bridged call is forked to the guard service with a
// one-way <Stream>. The element is non-blocking: Vobiz opens the WebSocket and moves on
// to <Dial>, so the bridge itself is unchanged. The guard warns the protected leg via the
// Speak REST API. protect=aleg means "the party that hit this Answer URL" (SDK outbound),
// protect=bleg means "the party we dial" (PSTN inbound ringing our SIP user).
const xmlAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function guardStreamXml(protectLeg) {
    const url = process.env.GUARD_WSS_URL;
    if (!url) return '';
    const headers = [`protect=${protectLeg}`];
    if (process.env.GUARD_SHARED_SECRET) headers.push(`secret=${process.env.GUARD_SHARED_SECRET}`);
    const cb = process.env.GUARD_STATUS_CALLBACK_URL
        ? `\n        statusCallbackUrl="${xmlAttr(process.env.GUARD_STATUS_CALLBACK_URL)}" statusCallbackMethod="POST"`
        : '';
    return `
    <Stream audioTrack="both" bidirectional="false"
        contentType="audio/x-l16;rate=8000"
        extraHeaders="${xmlAttr(headers.join(','))}"${cb}>${xmlAttr(url)}</Stream>`;
}

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url}`);

    if (new URL(req.url, `http://localhost:${port}`).pathname === '/token') {
        handleTokenRequest(req, res);
        return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        const parsedUrl = new URL(req.url, `http://localhost:${port}`);
        const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
        const bodyParams = body ? querystring.parse(body) : {};
        const params = { ...queryParams, ...bodyParams };

        console.log(`[params] ${JSON.stringify(params)}`);

        // Hangup event — Vobiz is notifying us the call ended, just acknowledge
        const event = params.Event || params.event || '';
        if (event === 'Hangup') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/xml');
            res.end(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
            return;
        }

        const callerId = process.env.CALLER_ID;
        if (!callerId) {
            console.error('CALLER_ID is not set in .env.');
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Server misconfigured: CALLER_ID environment variable is not set.');
            return;
        }

        const rawFrom = params.From || params.from || '';
        const routeType = (params.RouteType || params.routeType || '').toLowerCase();

        // SDK outbound call: From is a SIP URI (sip:user@domain) or RouteType=sip
        // PSTN inbound call: From is a plain phone number, RouteType is empty
        const isSdkCall = rawFrom.startsWith('sip:') || routeType === 'sip';

        if (isSdkCall) {
            // ── SDK Outbound: browser -> PSTN ──
            // To is the destination phone number the user dialed
            let destination = params.To || params.to || '';

            // Strip SIP URI if To is also a SIP URI
            if (destination.startsWith('sip:')) {
                const match = destination.match(/^sip:(.*?)@/);
                if (match && match[1]) destination = match[1];
            }

            // Ensure E.164 format — add + if missing
            if (destination && !destination.startsWith('+')) {
                destination = `+${destination}`;
            }

            console.log(`-> SDK outbound call, bridging to: ${destination}`);

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>${guardStreamXml('aleg')}
    <Dial callerId="${callerId}">
        <Number>${destination}</Number>
    </Dial>
</Response>`;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/xml');
            res.end(xmlResponse);

        } else {
            // ── PSTN Inbound: phone -> your Vobiz number -> ring browser ──
            // With JWT login the browser registers as <JWT_SUB>_<VOBIZ_AUTH_ID>; fall back to that.
            // Ring every identity the browser may be logged in as: the SIP endpoint (password login)
            // and the JWT identity (access-token login). Vobiz dials sibling <User>s simultaneously
            // and bridges the first one that answers.
            const jwtId = jwtIdentity();
            const targets = [];
            if (process.env.SIP_ENDPOINT) targets.push(process.env.SIP_ENDPOINT);
            if (jwtId) targets.push(`sip:${jwtId.sipUsername}@registrar.vobiz.ai`);
            const sipEndpoint = targets.join(', ');
            if (!targets.length) {
                console.error('SIP_ENDPOINT is not set in .env. Cannot route inbound calls.');
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Server misconfigured: SIP_ENDPOINT environment variable is not set.');
                return;
            }

            // Normalize caller ID: add + prefix if it's a plain number
            const from = rawFrom && !rawFrom.startsWith('+') && !rawFrom.startsWith('sip:')
                ? `+${rawFrom}`
                : rawFrom || 'Unknown';

            console.log(`-> PSTN inbound from ${from}, ringing endpoint: ${sipEndpoint}`);

            // If the endpoint is busy (already in a call), Vobiz will complete the <Dial>
            // immediately and fall through to the <Speak> + <Hangup> below, playing a
            // friendly message to the caller instead of a silent busy tone.
            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>${guardStreamXml('bleg')}
    <Dial callerId="${callerId}" timeout="30">
${targets.map((t) => `        <User>${t}</User>`).join('\n')}
    </Dial>
    <Speak>The user is currently on another call. Please try again later. Goodbye.</Speak>
    <Hangup/>
</Response>`;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/xml');
            res.end(xmlResponse);
        }
    });
});

server.listen(port, () => {
    console.log(`
-------------------------------------------------------
  Vobiz Example Backend running on port ${port}
-------------------------------------------------------
  1. Expose this server to the internet (e.g., using ngrok):
     ngrok http ${port}
     
  2. Copy the public URL (https://...) and paste it into
     your Vobiz Dashboard > Voice Applications > Answer URL

  3. For inbound calls, set SIP_ENDPOINT in .env to your
     endpoint's SIP URI (e.g. sip:myuser@registrar.vobiz.ai)

  4. For JWT login, set VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN in .env.
     The browser fetches short-lived tokens from POST /token.
-------------------------------------------------------
    `);
});
