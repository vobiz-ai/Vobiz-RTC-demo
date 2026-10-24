#!/usr/bin/env node
// Headless end-to-end check of access-token (JWT) outbound calling, no browser needed.
// It does what the browser SDK does: fetch a token from this demo's backend (POST /token),
// REGISTER over WSS with X-Vobiz-Jwt, INVITE the number, and hang up after a few seconds.
//
//   npm start                                  (in another terminal)
//   npm run call-test -- +919876543210         # rings the phone, hangs up 30 s after connect
//   HOLD_SECONDS=20 npm run call-test -- +9198...
//
// The test sends no audio: whoever answers hears silence. Use the softphone for a real call.
// Requires Node 22+ (built-in WebSocket).
require('dotenv').config({ quiet: true });
const crypto = require('crypto');

const dest = (process.argv[2] || '').replace(/^\+/, '');
if (!/^\d{6,15}$/.test(dest)) { console.error('usage: npm run call-test -- +<E.164 number>'); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.error('Node 22+ is required (built-in WebSocket).'); process.exit(1); }

const BACKEND = (process.env.TOKEN_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const HOLD_MS = Number(process.env.HOLD_SECONDS || 30) * 1000;
const DOMAIN = 'registrar.vobiz.ai';

const rnd = () => crypto.randomBytes(6).toString('hex');
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(2).padStart(6)}s`, ...a);
const hdr = (m, n) => (m.match(new RegExp(`\\r\\n${n}:\\s*([^\\r]*)`, 'i')) || [])[1];
const hdrAll = (m, n) => [...m.matchAll(new RegExp(`\\r\\n${n}:\\s*([^\\r]*)`, 'gi'))].map((x) => x[1]);

async function main() {
    const r = await fetch(`${BACKEND}/token`, { method: 'POST' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.token) throw new Error(`token request to ${BACKEND}/token failed: ${r.status} ${body.error || ''}`);
    const claims = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    log(`token for ${body.sip_username}, app ${claims.app || '(account default)'}, expires ${new Date(claims.exp * 1000).toISOString()}`);

    const { token, sip_username: user } = body;
    const host = `${rnd()}.invalid`;
    const contact = `<sip:${user}@${host};transport=ws>`;
    const via = () => `Via: SIP/2.0/WSS ${host};branch=z9hG4bK${rnd()}`;
    const fromTag = rnd();
    const callId = `c${rnd()}`;
    let cseq = 1;
    let inviteCseq;
    let dialog = null; // { remoteTarget, routes, toTag }
    let done = false;

    const ws = new WebSocket(`wss://${DOMAIN}:5063`, 'sip');
    const send = (m) => ws.send(m);
    const finish = (code) => { if (done) return; done = true; setTimeout(() => { ws.close(); process.exit(code); }, 300); };

    const register = () => send([
        `REGISTER sip:${DOMAIN} SIP/2.0`, via(), 'Max-Forwards: 69',
        `To: <sip:${user}@${DOMAIN}>`, `From: <sip:${user}@${DOMAIN}>;tag=${rnd()}`,
        `Call-ID: r${callId}`, `CSeq: ${cseq++} REGISTER`, `X-Vobiz-Jwt: ${token}`,
        `Contact: ${contact};expires=120`, 'Expires: 120', 'User-Agent: vobiz-rtc-demo-call-test',
        'Content-Length: 0', '', ''].join('\r\n'));

    const sdp = [
        'v=0', `o=- ${Date.now()} 1 IN IP4 127.0.0.1`, 's=-', 't=0 0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 0', 'c=IN IP4 0.0.0.0', 'a=rtpmap:0 PCMU/8000', 'a=sendrecv', ''].join('\r\n');
    const invite = () => {
        inviteCseq = cseq++;
        send([
            `INVITE sip:${dest}@${DOMAIN} SIP/2.0`, via(), 'Max-Forwards: 69',
            `To: <sip:${dest}@${DOMAIN}>`, `From: <sip:${user}@${DOMAIN}>;tag=${fromTag}`,
            `Call-ID: ${callId}`, `CSeq: ${inviteCseq} INVITE`, `X-Vobiz-Jwt: ${token}`,
            `Contact: ${contact}`, 'Content-Type: application/sdp', 'User-Agent: vobiz-rtc-demo-call-test',
            `Content-Length: ${Buffer.byteLength(sdp)}`, '', sdp].join('\r\n'));
        log(`INVITE +${dest} (Call-ID ${callId})`);
    };

    // In-dialog request following the route set learned from the 200 OK.
    const inDialog = (method, seq) => send([
        `${method} ${dialog.remoteTarget} SIP/2.0`, via(), 'Max-Forwards: 69',
        ...dialog.routes.map((r) => `Route: ${r}`),
        `To: <sip:${dest}@${DOMAIN}>;tag=${dialog.toTag}`, `From: <sip:${user}@${DOMAIN}>;tag=${fromTag}`,
        `Call-ID: ${callId}`, `CSeq: ${seq} ${method}`, 'Content-Length: 0', '', ''].join('\r\n'));

    const replyTo = (m, status) => send([
        `SIP/2.0 ${status}`, ...hdrAll(m, 'Via').map((v) => `Via: ${v}`),
        `From: ${hdr(m, 'From')}`, `To: ${hdr(m, 'To')}`, `Call-ID: ${hdr(m, 'Call-ID')}`,
        `CSeq: ${hdr(m, 'CSeq')}`, 'Content-Length: 0', '', ''].join('\r\n'));

    ws.onopen = () => { log(`connected to wss://${DOMAIN}:5063 as ${user}`); register(); };
    ws.onerror = (e) => { log('websocket error', e.message || e.type); finish(1); };
    ws.onmessage = (e) => {
        const m = String(e.data);
        const first = m.split('\r\n')[0];
        const [, seq, method] = (m.match(/\r\nCSeq:\s*(\d+)\s+(\w+)/i) || []);

        if (!first.startsWith('SIP/2.0')) {           // a request from the network
            log(`<- ${first.split(' ')[0]}`);
            replyTo(m, '200 OK');
            if (/^BYE /.test(first)) { log('far end hung up'); finish(0); }
            return;
        }

        const status = Number(first.split(' ')[1]);
        const callUuid = hdr(m, 'X-CallUUID');
        log(`<- ${first}  [${method}]${callUuid ? `  CallUUID ${callUuid}` : ''}`);

        if (method === 'REGISTER') {
            if (status === 200) invite();
            else if (status >= 300) { log('registration rejected: check the token and account'); finish(1); }
            return;
        }
        if (method === 'INVITE' && Number(seq) === inviteCseq) {
            if (status >= 200 && status < 300) {
                if (dialog) return;                    // retransmitted 200 OK
                dialog = {
                    remoteTarget: (hdr(m, 'Contact') || '').replace(/^.*<([^>]+)>.*$/, '$1'),
                    routes: hdrAll(m, 'Record-Route').flatMap((r) => r.split(/,\s*(?=<)/)).reverse(),
                    toTag: (hdr(m, 'To').match(/;tag=([^;>\s]+)/) || [])[1],
                };
                inDialog('ACK', inviteCseq);
                // With a <Stream> in the answer XML (GUARD_WSS_URL) the media server answers the browser
                // leg first and only then dials, so this 200 can come before the phone rings.
                log(`CONNECTED to the media server. Holding ${HOLD_MS / 1000}s, then hanging up (the backend log shows the dial result).`);
                setTimeout(() => { if (!done) { inDialog('BYE', cseq++); log('-> BYE'); } }, HOLD_MS);
            } else if (status >= 300) {
                // Non-2xx final responses are ACKed hop-by-hop with the INVITE's branch-less form.
                send([
                    `ACK sip:${dest}@${DOMAIN} SIP/2.0`, hdrAll(m, 'Via')[0] ? `Via: ${hdrAll(m, 'Via')[0]}` : via(),
                    'Max-Forwards: 69', `To: ${hdr(m, 'To')}`, `From: <sip:${user}@${DOMAIN}>;tag=${fromTag}`,
                    `Call-ID: ${callId}`, `CSeq: ${inviteCseq} ACK`, 'Content-Length: 0', '', ''].join('\r\n'));
                log(`call failed with ${status}. Look up the CallUUID in your Vobiz call logs for the reason.`);
                finish(2);
            }
            return;
        }
        if (method === 'BYE' && status === 200) { log('call ended cleanly'); finish(0); }
    };

    setTimeout(() => { log('timed out'); finish(3); }, 90_000 + HOLD_MS);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
