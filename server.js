require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const querystring = require('querystring');

const port = 3000;

// Dynamic Answer URL Server for Vobiz
// Handles both outbound (browser -> PSTN) and inbound (PSTN -> browser) calls.
//
// Outbound: SDK sends a call with a To= phone number -> we Dial that number
// Inbound:  Someone calls your Vobiz number -> Direction=inbound -> ring the SIP endpoint

// Strip non-digit characters for loose number comparison
const digitsOnly = (s) => (s || '').replace(/\D/g, '');

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url}`);

    // Collect POST body (Vobiz sends params as application/x-www-form-urlencoded)
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        // Parse both query string and POST body params
        const parsedUrl = new URL(req.url, `http://localhost:${port}`);
        const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
        const bodyParams = body ? querystring.parse(body) : {};
        const params = { ...queryParams, ...bodyParams };

        console.log(`[params] ${JSON.stringify(params)}`);

        const callerId = process.env.CALLER_ID;
        if (!callerId) {
            console.error('CALLER_ID is not set in .env.');
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Server misconfigured: CALLER_ID environment variable is not set.');
            return;
        }

        // Extract destination from To/Destination param
        let destination = params.To || params.to || params.Destination || params.destination || '';

        // Strip SIP URI prefix if present (e.g. sip:+91xxx@domain.com -> +91xxx)
        if (destination.startsWith('sip:')) {
            const match = destination.match(/^sip:(.*?)@/);
            if (match && match[1]) destination = match[1];
        }

        // Determine call direction.
        // Primary signal: Vobiz sends Direction=inbound for PSTN -> your number calls.
        // Fallback: compare trailing digits of To against CALLER_ID to handle format
        // variations like 07971543187 vs +917971543187 vs 917971543187.
        const direction = (params.Direction || params.direction || '').toLowerCase();
        const callerIdDigits = digitsOnly(callerId);
        const destinationDigits = digitsOnly(destination);

        const isInbound = direction === 'inbound' ||
            (!direction && (
                !destination ||
                callerIdDigits.endsWith(destinationDigits) ||
                destinationDigits.endsWith(callerIdDigits)
            ));

        if (isInbound) {
            // ── Inbound: PSTN caller -> ring the browser endpoint ──
            const sipEndpoint = process.env.SIP_ENDPOINT;
            if (!sipEndpoint) {
                console.error('SIP_ENDPOINT is not set in .env. Cannot route inbound calls.');
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Server misconfigured: SIP_ENDPOINT environment variable is not set.');
                return;
            }

            const from = params.From || params.from || 'Unknown';
            console.log(`-> Inbound call from ${from}, ringing endpoint: ${sipEndpoint}`);

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${from}">
        <Sip>${sipEndpoint}</Sip>
    </Dial>
</Response>`;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/xml');
            res.end(xmlResponse);

        } else {
            // ── Outbound: browser -> PSTN number ──
            console.log(`-> Outbound call, bridging to: ${destination}`);

            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${callerId}">
        <Number>${destination}</Number>
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
