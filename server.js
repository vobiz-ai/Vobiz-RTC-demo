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
//     From=sip:user@registrar.vobiz.ai  RouteType=sip  To=919148227303
//
//   PSTN inbound (phone -> your Vobiz number):
//     From=9148227303  RouteType=(empty)  To=07971543187  Direction=inbound

// Strip non-digit characters for loose number comparison
const digitsOnly = (s) => (s || '').replace(/\D/g, '');

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url}`);

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
<Response>
    <Dial callerId="${callerId}">
        <Number>${destination}</Number>
    </Dial>
</Response>`;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/xml');
            res.end(xmlResponse);

        } else {
            // ── PSTN Inbound: phone -> your Vobiz number -> ring browser ──
            const sipEndpoint = process.env.SIP_ENDPOINT;
            if (!sipEndpoint) {
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

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${callerId}" timeout="30">
        <User>${sipEndpoint}</User>
    </Dial>
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
-------------------------------------------------------
    `);
});
