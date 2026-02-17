const http = require('http');
const url = require('url');

const port = 3000;

// Dynamic Answer URL Server for Vobiz
// This server responds to Vobiz Answer URL requests.
// It parses the 'To' header/parameter to dynamically bridge the call.

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url}`);

    // Parse query parameters
    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query;

    // 1. Identify where to call (Destination)
    // Vobiz sends the destination in 'To' or 'Destination' query params
    let destination = query.To || query.to || query.Destination || query.destination;

    // Handle SIP URIs (e.g., sip:1234567890@domain.com) -> Extract 1234567890
    if (destination && destination.startsWith('sip:')) {
        try {
            const match = destination.match(/^sip:(.*?)@/);
            if (match && match[1]) {
                destination = match[1];
            }
        } catch (e) {
            console.error('Error parsing SIP URI:', e);
        }
    }

    // Default fallback (e.g. if testing from browser directly)
    if (!destination) {
        console.log('No "To" parameter found, defaulting to test number.');
        destination = '+919148227303';
    }

    // 2. Generate XML Response
    // <Dial> bridges the incoming call (from the SDK) to the destination number.
    // callerId: The number that will show up on the destination's phone.
    //           MUST be a verified number in your Vobiz account.
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="+918044784759">
        <Number>${destination}</Number>
    </Dial>
</Response>`;

    // 3. Send Response
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/xml');
    res.end(xmlResponse);
    console.log(`-> Returned XML bridging to: ${destination}`);
});

server.listen(port, () => {
    console.log(`
-------------------------------------------------------
  Vobiz Example Backend running on port ${port}
-------------------------------------------------------
  1. Expose this server to the internet (e.g., using ngrok):
     ngrok http ${port}
     
  2. Copy the public URL (https://...)
  
  3. Paste it into your Vobiz Dashboard > Voice Applications > Answer URL
  
  This will allow your browser calls to connect to any number.
-------------------------------------------------------
    `);
});
