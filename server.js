require('dotenv').config({ quiet: true });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const querystring = require('querystring');

const port = Number(process.env.PORT) || 3000;

// Vobiz WebRTC demo backend. One process, one port:
//
//   GET  /                 the softphone UI (client/)
//   POST /token            short-lived access token (JWT) for the browser
//   POST /answer           Answer URL: returns Vobiz XML for every call
//   POST /dial-status      <Dial action> callback: logged, nothing returned
//   POST /hangup           Hangup URL: logged, nothing returned
//   GET  /health           liveness probe
//   WS   /stream           optional proxy to a local vobiz-call-guard
//
// Call types Vobiz sends to the Answer URL:
//
//   SDK outbound (browser -> PSTN):
//     From=sip:user@registrar.vobiz.ai  RouteType=sip  To=15550003333
//
//   PSTN inbound (phone -> your Vobiz number):
//     From=5550003333  RouteType=(empty)  To=15550003333  Direction=inbound

const xmlEscape = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Public origin of this server as Vobiz reaches it, for absolute callback URLs.
function publicOrigin(req) {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${String(proto).split(',')[0]}://${host}`;
}

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
    // The app claim picks the Application whose Answer URL handles this user's outbound calls.
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
function guardStreamXml(protectLeg) {
    const url = process.env.GUARD_WSS_URL;
    if (!url) return '';
    const headers = [`protect=${protectLeg}`];
    if (process.env.GUARD_SHARED_SECRET) headers.push(`secret=${process.env.GUARD_SHARED_SECRET}`);
    const cb = process.env.GUARD_STATUS_CALLBACK_URL
        ? `\n        statusCallbackUrl="${xmlEscape(process.env.GUARD_STATUS_CALLBACK_URL)}" statusCallbackMethod="POST"`
        : '';
    return `
    <Stream audioTrack="both" bidirectional="false"
        contentType="audio/x-l16;rate=8000"
        extraHeaders="${xmlEscape(headers.join(','))}"${cb}>${xmlEscape(url)}</Stream>`;
}

// ── Answer URL ─────────────────────────────────────────────────────────────
function sendXml(res, xml) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/xml');
    res.end(xml);
}

const EMPTY_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function answer(req, res, params) {
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

    // Without an action URL Vobiz re-fetches the Answer URL when <Dial> ends and runs the
    // same XML again. redirect="false" reports the result to /dial-status and stops.
    const action = ` action="${xmlEscape(`${publicOrigin(req)}/dial-status`)}" method="POST" redirect="false"`;

    if (isSdkCall) {
        // ── SDK Outbound: browser -> PSTN ──
        let destination = params.To || params.to || '';

        // Strip SIP URI if To is also a SIP URI
        if (destination.startsWith('sip:')) {
            const match = destination.match(/^sip:(.*?)@/);
            if (match && match[1]) destination = match[1];
        }

        // Ensure E.164 format and refuse anything that is not a phone number
        if (destination && !destination.startsWith('+')) destination = `+${destination}`;
        if (!/^\+\d{6,15}$/.test(destination)) {
            console.log(`-> SDK outbound call to "${destination}" rejected: not an E.164 number`);
            sendXml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak>Please dial a phone number in international format.</Speak>
    <Hangup/>
</Response>`);
            return;
        }

        console.log(`-> SDK outbound call from ${rawFrom}, bridging to: ${destination}`);

        sendXml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>${guardStreamXml('aleg')}
    <Dial callerId="${xmlEscape(callerId)}" timeout="45"${action}>
        <Number>${xmlEscape(destination)}</Number>
    </Dial>
</Response>`);
        return;
    }

    // ── PSTN Inbound: phone -> your Vobiz number -> ring browser ──
    // Ring every identity the browser may be logged in as: the SIP endpoint (password login)
    // and the JWT identity (access-token login). Vobiz dials sibling <User>s simultaneously
    // and bridges the first one that answers.
    const jwtId = jwtIdentity();
    const targets = [];
    if (process.env.SIP_ENDPOINT) targets.push(process.env.SIP_ENDPOINT);
    if (jwtId) targets.push(`sip:${jwtId.sipUsername}@registrar.vobiz.ai`);
    if (!targets.length) {
        console.error('Neither SIP_ENDPOINT nor VOBIZ_AUTH_ID is set in .env. Cannot route inbound calls.');
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Server misconfigured: set SIP_ENDPOINT (password login) or VOBIZ_AUTH_ID (token login).');
        return;
    }

    // Normalize caller ID: add + prefix if it's a plain number
    const from = rawFrom && !rawFrom.startsWith('+') && !rawFrom.startsWith('sip:')
        ? `+${rawFrom}`
        : rawFrom || 'Unknown';

    console.log(`-> PSTN inbound from ${from}, ringing: ${targets.join(', ')}`);

    // If nobody answers within the timeout (or the browser is busy), Vobiz moves on to the
    // <Speak> + <Hangup> below, so the caller hears a message instead of silence.
    sendXml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>${guardStreamXml('bleg')}
    <Dial callerId="${xmlEscape(callerId)}" timeout="30"${action}>
${targets.map((t) => `        <User>${xmlEscape(t)}</User>`).join('\n')}
    </Dial>
    <Speak>The user is not available right now. Please try again later. Goodbye.</Speak>
    <Hangup/>
</Response>`);
}

// ── Static client ──────────────────────────────────────────────────────────
const CLIENT_DIR = path.join(__dirname, 'client');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.join(CLIENT_DIR, path.normalize(rel));
    if (!file.startsWith(CLIENT_DIR + path.sep) || !MIME[path.extname(file)]) return false;
    let data;
    try { data = fs.readFileSync(file); } catch { return false; }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file)]);
    res.end(data);
    return true;
}

// ── Router ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url, `http://localhost:${port}`);

    if (pathname === '/token') { handleTokenRequest(req, res); return; }
    if (pathname === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    if (req.method === 'GET' && pathname !== '/answer') {
        if (!serveStatic(pathname, res)) { res.statusCode = 404; res.end('Not found'); }
        return;
    }

    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        const params = { ...Object.fromEntries(searchParams.entries()), ...(body ? querystring.parse(body) : {}) };
        const event = params.Event || params.event || '';

        if (pathname === '/dial-status') {
            console.log(`   dial ${params.CallUUID || ''}: ${params.DialStatus || '?'} (${params.DialHangupCause || 'no cause'})`);
            sendXml(res, EMPTY_RESPONSE);
            return;
        }
        if (pathname === '/hangup' || event === 'Hangup') {
            console.log(`   hangup ${params.CallUUID || ''}: ${params.HangupCauseName || params.HangupCause || '?'}, ${params.Duration || 0}s`);
            sendXml(res, EMPTY_RESPONSE);
            return;
        }

        console.log(`[params] ${JSON.stringify(params)}`);
        answer(req, res, params);
    });
});

// ── Guard WebSocket proxy ─────────────────────────────────────────────────
// Forward wss://<this-host>/stream upgrades to the local vobiz-call-guard so a single
// public tunnel serves both the Answer URL and the <Stream> target.
const net = require('net');
const GUARD_LOCAL_ADDR = process.env.GUARD_LOCAL_ADDR || '127.0.0.1:8090';
server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, `http://localhost:${port}`).pathname;
    if (pathname !== '/stream') { socket.destroy(); return; }
    const [host, upstreamPort] = GUARD_LOCAL_ADDR.split(':');
    const upstream = net.connect(Number(upstreamPort), host, () => {
        const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', (e) => { console.error(`[guard-proxy] ${e.message}`); socket.destroy(); });
    socket.on('error', () => upstream.destroy());
    console.log(`[${new Date().toISOString()}] [guard-proxy] ${pathname} -> ${GUARD_LOCAL_ADDR}`);
});

server.listen(port, () => {
    const pub = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : '<your public URL>';
    console.log(`
-------------------------------------------------------
  Vobiz WebRTC demo running on http://localhost:${port}
-------------------------------------------------------
  Softphone      http://localhost:${port}
  Answer URL     ${pub}/answer      (POST)
  Hangup URL     ${pub}/hangup      (POST)
  Token endpoint http://localhost:${port}/token

  First run: expose this port (ngrok http ${port}), set PUBLIC_URL
  in .env, then run "npm run setup" to create the Vobiz application.
-------------------------------------------------------
    `);
});
