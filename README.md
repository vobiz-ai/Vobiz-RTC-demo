# Vobiz WebRTC Browser SDK — Softphone Starter Kit

A full-stack starter kit for placing and receiving PSTN calls straight from a browser tab with the Vobiz WebRTC Browser SDK: a Node.js answer-URL backend plus a working softphone UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-14%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?logo=javascript&logoColor=black)](client/app.js)
[![Docs](https://img.shields.io/badge/Docs-docs.vobiz.ai-111111)](https://docs.vobiz.ai)
[![Live demo](https://img.shields.io/badge/Live_demo-rtc--demo.vobiz.ai-success)](https://rtc-demo.vobiz.ai/)

> [!TIP]
> **Try it before you clone anything: [rtc-demo.vobiz.ai](https://rtc-demo.vobiz.ai/)**
>
> This repository's client is deployed and running there. Create a SIP endpoint in the
> [Vobiz console](https://console.vobiz.ai/app/voice/endpoints), enter its username and password on
> that page, click **Connect & Register**, and you have a working softphone in the browser —
> no local install, no tunnel. Clone this repo when you want to own the call routing logic
> in `server.js` and change the UI.

---

## Overview

Browser-based calling normally means running a SIP stack, a media server, and a signalling
path of your own before the first call connects. This starter kit replaces all of that with two
small pieces you can read in one sitting: a browser client that registers a SIP endpoint over
WebRTC using the Vobiz WebRTC Browser SDK, and a ~140-line Node.js HTTP server that answers
Vobiz's answer-URL request with the XML describing what should happen to each call.

Everything in the repo is plain JavaScript. The backend is `node:http` with `dotenv` — no
framework, no build step. The frontend is one HTML file, one stylesheet, and one script that
loads the SDK from a CDN. That is deliberate: the interesting part of a WebRTC softphone is
the call-control logic, and here it is all visible rather than hidden inside a framework.

Both directions work and both are exercised by the live demo. **Outbound**, the browser dials a
number, Vobiz hits your answer URL, and `server.js` replies with `<Dial><Number>` to bridge the
call to the PSTN. **Inbound**, someone calls your Vobiz number, Vobiz hits the same answer URL,
and `server.js` replies with `<Dial><User>` pointing at your SIP endpoint so the browser rings.
One endpoint distinguishes the two by inspecting the parameters Vobiz posts.

At the end you have a softphone that registers, dials E.164 destinations, shows an incoming
call banner with Answer/Decline, handles a second call arriving mid-call with a call-waiting
banner, sends DTMF, mutes, and streams a live event log — plus the backend routing logic in a
single file you can extend into whatever your product actually needs.

---

## What you can build with it

- **Browser-based agent desktop / call centre client** — agents log in with their own SIP
  endpoint credentials and take PSTN calls in a tab, with no desk phone and no installed softphone.
- **Click-to-call on a web app** — a support or sales button that dials a customer's number from
  the browser and presents your Vobiz number as the caller ID.
- **Web callback and helpdesk widget** — a visitor's browser is the far end of the call, so
  inbound PSTN calls to your published number ring inside your own product UI.
- **Internal extension dialling and hot-desking** — staff register the same endpoint from any
  machine; `<Dial><User>` routes calls to whoever is currently registered.
- **IVR and voice-flow test harness** — dial your own IVR from the browser and use the keypad
  to send DTMF while watching the SDK event log in real time.
- **WebRTC diagnostics tooling** — the client exposes the underlying `RTCPeerConnection`, so it
  makes a convenient base for a call-quality or ICE-troubleshooting console.

---

## How it works

Vobiz drives the call; your server only answers a question. When a call needs instructions,
Vobiz sends an HTTP request to the **answer URL** configured on your Voice Application, and your
server returns Vobiz XML telling it what to do. `server.js` implements exactly one answer URL
that serves both call directions, and picks the right XML by looking at who the call is *from*.

**Outbound (Browser → PSTN)**

```
Browser (client/)              Vobiz Platform          Backend (server.js)
     |                              |                          |
     |--- SDK registers ----------->|                          |
     |--- user dials +15550003333 ->|                          |
     |                              |--- POST / -------------->|
     |                              |    From=sip:user@...     |
     |                              |    To=15550003333        |
     |                              |<-- <Dial><Number> -------|
     |                              |--- bridges to PSTN ----->|
```

**Inbound (PSTN → Browser)**

```
PSTN caller                    Vobiz Platform          Backend (server.js)
     |                              |                          |
     |--- calls +15550003333 ------>|                          |
     |                              |--- POST / -------------->|
     |                              |    From=5550003333       |
     |                              |    RouteType=(empty)     |
     |                              |<-- <Dial><User> ---------|
     |                              |--- SIP INVITE ---------->| (browser endpoint)
     |                              |       Browser shows incoming banner
     |                              |--- call bridged -------->|
```

**How direction is detected:** The backend checks the `From` field and `RouteType` param Vobiz sends:
- `From=sip:user@registrar.vobiz.ai` or `RouteType=sip` → **SDK outbound** → `<Dial><Number>`
- `From=5550003333` (plain number), `RouteType` empty → **PSTN inbound** → `<Dial><User>`

Two more details worth knowing before you read the code:

- **Parameters are read from both the query string and the form body.** `server.js` merges
  `URL.searchParams` with the `querystring`-parsed request body, body last, so it works whether
  your application is configured for GET or POST.
- **Hangup notifications are acknowledged, not routed.** If the request carries `Event=Hangup`,
  the server returns an empty `<Response></Response>` and stops. This is why the Hangup URL must
  be left blank in the console — pointing it at this same server would otherwise return `<Dial>`
  XML after the call ended.

On the browser side the SDK is a SIP-over-WebRTC user agent. `new Vobiz({...})` builds it,
`vobiz.client.login(username, password)` registers the endpoint against `registrar.vobiz.ai`,
and from then on everything is events: `onLogin`, `onIncomingCall`, `onCallAnswered`,
`onCallTerminated`. See [Browser SDK reference](#browser-sdk-reference) for the full surface.

---

## Architecture

| File | Responsibility |
|---|---|
| `server.js` | The whole backend. Creates a `node:http` server on port 3000, merges query and body params, short-circuits `Event=Hangup`, detects call direction from `From`/`RouteType`, and emits the `<Dial>` XML for each direction. Fails loudly with HTTP 500 when `CALLER_ID` or `SIP_ENDPOINT` is missing. |
| `client/index.html` | Softphone markup: login panel, dialer with keypad, incoming-call banner, call-waiting banner, media controls, event log, and the hidden `<audio id="remoteAudio">` element the remote stream is attached to. Loads the SDK from unpkg. |
| `client/app.js` | All SDK integration. Constructs `Vobiz`, registers twelve event handlers, and implements `doLogin`, `doLogout`, `doCall`, `doAnswer`, `doReject`, `doSwitchCall`, `doHangup`, `toggleMute`, `pressKey` (DTMF), and `attachRemoteAudio`. |
| `client/style.css` | Presentation for the console UI, including the banner and status-dot states. |
| `.env.example` | Template for the two backend environment variables. Copy to `.env`. |
| `package.json` | `npm start` runs the backend; `npm run client` serves `client/` on port 8080 via `npx http-server`. Dependencies: `dotenv`, `vobiz-webrtc-sdk`. |
| `docs.md` | Condensed console walkthrough — creating the application, attaching a number, creating the endpoint. |
| `LICENSE` | MIT. |

The browser never talks to `server.js`. The client is static and can be served from anywhere;
Vobiz is the only party that calls the answer URL.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 14+** | The backend uses only `node:http`, `node:url`, and `node:querystring`. `npm` ships with it. |
| **A Vobiz account** | Sign up at [vobiz.ai](https://vobiz.ai); console at [console.vobiz.ai](https://console.vobiz.ai). |
| **A Vobiz phone number** | Purchased under **Voice > Numbers**. It becomes your `CALLER_ID` and is the number people dial to reach the browser. |
| **A SIP endpoint** | Created under **Voice > Endpoints**. Its username and password are what you type into the softphone; its SIP URI becomes `SIP_ENDPOINT`. |
| **A Voice Application** | Created under **Voice > Applications**, holding the answer URL and linked to both the endpoint and the number. |
| **ngrok** (or any tunnel) | Only for local development — Vobiz needs a publicly reachable HTTPS URL to POST to. |
| **A Chromium-based browser** | Chrome is recommended for WebRTC. The page must be served over `localhost` or HTTPS for microphone access. |

---

## Setup

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set both variables:

```env
# Your Vobiz phone number (E.164 format).
# Appears as caller ID on outbound calls. Must be active in your Vobiz account.
CALLER_ID=+15550003333

# Your SIP Endpoint URI for inbound calls (PSTN -> browser).
# Copy this from: Vobiz Dashboard > Voice > Endpoints > your endpoint > SIP Configuration > SIP URI
# Format: sip:<username>@registrar.vobiz.ai
SIP_ENDPOINT=sip:myusername@registrar.vobiz.ai
```

### Step 3: Start the backend

```bash
npm start
```

The server runs on `http://localhost:3000`.

### Step 4: Expose the backend to the internet

Vobiz needs a publicly reachable URL to POST call instructions to. For local development, use ngrok:

```bash
ngrok http 3000
```

Copy the generated HTTPS URL — for example:
```
https://abc123.ngrok.io
```

> [!IMPORTANT]
> Use only the root URL — **no path suffix**. Your Answer URL is `https://abc123.ngrok.io`, not `https://abc123.ngrok.io/answer`.
> ngrok URLs change every time you restart it (unless you have a paid plan), so update the Answer URL in the dashboard whenever you restart ngrok.
> If ngrok fails with "endpoint already online", kill the existing process first: `pkill -f ngrok`

### Step 5: Create a SIP Endpoint on Vobiz

Go to **[Voice > Endpoints](https://console.vobiz.ai/app/voice/endpoints)** and click **Create Endpoint**.

| Field | What to enter |
|---|---|
| **Alias** | A friendly name, e.g. `My Browser Phone` |
| **Username** | Alphanumeric only, e.g. `myuser123` — **save this, you'll need it to log in** |
| **Password** | A strong password — **save this too** |
| **Application** | Leave as `None` for now |

After creating, go to **SIP Configuration** on the endpoint details page and copy the **SIP URI** — it looks like `sip:myuser123@registrar.vobiz.ai`. Put this in your `.env` as `SIP_ENDPOINT`.

Click **Create Endpoint**.

### Step 6: Create an XML Application on Vobiz

Go to **[Voice > Applications](https://console.vobiz.ai/app/voice/applications)** and click **Create Application**.

| Field | What to enter |
|---|---|
| **Application Name** | A friendly name, e.g. `My WebRTC App` |
| **Answer URL** | Your ngrok URL, e.g. `https://abc123.ngrok.io` — method must be **POST** |
| **Hangup URL** | Leave blank |
| **Fallback Answer URL** | Leave blank |
| **Default Endpoint App** | Toggle **ON** — links the application to your endpoint |

Click **Create Application**.

> [!IMPORTANT]
> Leave the **Hangup URL** blank. If set to the same Answer URL, Vobiz will re-fetch call instructions after the call ends and immediately disconnect.

### Step 7: Link your phone number

Go to **Voice > Numbers**, click your number, and assign it to the Application you created in Step 6. This is required for inbound calls to reach the browser.

### Step 8: Start the frontend

```bash
npm run client
```

The frontend runs at `http://localhost:8080`.

---

## Configuration

`server.js` calls `require('dotenv').config()` at startup, so anything in `.env` is available as
`process.env`. These are every variable the code actually reads:

| Variable | Required | Default | Description |
|---|---|---|---|
| `CALLER_ID` | Yes | none | Your Vobiz number in E.164 format, e.g. `+15550003333`. Used as the `callerId` attribute on `<Dial>` in **both** directions. If it is unset, every answer-URL request is answered with HTTP 500 and `Server misconfigured: CALLER_ID environment variable is not set.` |
| `SIP_ENDPOINT` | Yes, for inbound calls | none | The SIP URI of the endpoint the browser registers as, in the form `sip:<username>@registrar.vobiz.ai`. Emitted inside `<Dial><User>` to ring the browser. Only read on the inbound branch; if it is unset, inbound requests get HTTP 500 and `Server misconfigured: SIP_ENDPOINT environment variable is not set.` Outbound calls still work without it. |

Values that are **not** environment variables and are set in code, in case you need to change them:

| Setting | Where | Value |
|---|---|---|
| Backend port | `server.js`, `const port = 3000` | `3000` |
| Frontend port | `package.json`, the `client` script | `8080` |
| Inbound ring timeout | `server.js`, `<Dial timeout="30">` | 30 seconds before the busy message plays |
| SDK build served to the browser | `client/index.html` `<script src>` | `vobiz-webrtc-sdk@1.0.3` from unpkg |
| SDK dependency for tooling | `package.json` | `vobiz-webrtc-sdk` `^1.0.3` |

`.env` is git-ignored (along with `node_modules/`, `.DS_Store`, and `llms.txt`). Commit
`.env.example` only.

---

## Running it

Two processes, two terminals, plus the tunnel:

```bash
npm start        # terminal 1 — backend on :3000
ngrok http 3000  # terminal 2 — public HTTPS URL for the answer URL
npm run client   # terminal 3 — softphone UI on :8080
```

On `npm start` the backend prints a banner confirming the port and reminding you to paste the
public URL into **Voice Applications > Answer URL**. Every answer-URL hit then logs two lines —
the request line and the full parameter set:

```
[2026-01-01T00:00:00.000Z] Request: POST /
[params] {"From":"sip:myuser123@registrar.vobiz.ai","To":"15550003333","RouteType":"sip"}
```

### Making outbound calls

1. Open `http://localhost:8080`
2. Enter your **Endpoint Username** and **Password** from Step 5
3. Click **Connect & Register** — wait for `Successfully registered with Vobiz!` in the logs and
   the status dot to turn to **Registered**
4. Type a phone number in E.164 format (e.g. `+15550003333`) and click **Call**

Backend logs will show:
```
-> SDK outbound call, bridging to: +15550003333
```

Browser logs will show:
```
Calling +15550003333...
Ringing... (call-id)
Call answered! (call-id)
```

### Receiving inbound calls

1. Open `http://localhost:8080` and log in — wait for **Registered** status
2. Call your Vobiz number (`CALLER_ID`) from any phone
3. A **green incoming call banner** appears at the top of the browser with the caller's number
4. Click **Answer** to connect, **Decline** to reject

Backend logs will show:
```
-> PSTN inbound from +15550003333, ringing endpoint: sip:myuser123@registrar.vobiz.ai
```

> [!IMPORTANT]
> The browser must be **open and registered** before the call arrives. Vobiz does not queue calls for offline endpoints.

If a second call arrives while you are already on one, the client shows a **call-waiting**
banner instead: **Switch** hangs up the current call and answers the waiting one after a short
delay, **Decline** rejects it. If the endpoint does not pick up within the 30-second `<Dial>`
timeout, the caller hears *"The user is currently on another call. Please try again later.
Goodbye."* and the call is hung up.

---

## Browser SDK reference

Everything below is what `client/app.js` actually uses. The SDK is loaded from
`https://unpkg.com/vobiz-webrtc-sdk@1.0.3/dist/vobiz-webrtc-sdk.min.js`, which puts a global
`Vobiz` constructor on `window`; the call-control surface lives on `vobiz.client`. The same
build is published on npm as [`vobiz-webrtc-sdk`](https://www.npmjs.com/package/vobiz-webrtc-sdk)
and is listed as a dependency in `package.json` if you would rather bundle it than use the CDN.
The full SDK documentation lives at [docs.vobiz.ai](https://docs.vobiz.ai).

### Constructing the client

```js
const vobiz = new Vobiz({
    debug: 'ALL',
    permOnClick: true,
    enableTracking: true,
    closeProtection: false,
    maxAverageBitrate: 48000,
});
```

| Option | Value in this example |
|---|---|
| `debug` | `'ALL'` — maximum SDK log verbosity in the browser console. |
| `permOnClick` | `true` — microphone permission is requested from a user gesture rather than on page load. |
| `enableTracking` | `true` |
| `closeProtection` | `false` — the page is not guarded against being closed mid-call. |
| `maxAverageBitrate` | `48000` |

### Registration and call control

| Call | What it does in this example |
|---|---|
| `vobiz.client.login(username, password)` | Registers the SIP endpoint against `registrar.vobiz.ai` using the credentials typed into the login panel. Success fires `onLogin`; failure fires `onLoginFailed`. |
| `vobiz.client.logout()` | Unregisters; fires `onLogout`, which resets the UI and hides any banner. |
| `vobiz.client.call(destination, extraHeaders)` | Places an outbound call. `destination` is whatever is in the dialer field — an E.164 number or a SIP URI. `extraHeaders` is passed as `{}` here. |
| `vobiz.client.answer()` | Accepts the ringing inbound call. Bound to **Answer** on the incoming banner. |
| `vobiz.client.reject()` | Rejects the ringing inbound call. Bound to **Decline** on both banners. |
| `vobiz.client.hangup()` | Ends the active call. Bound to **Hangup**, and used by the call-waiting **Switch** flow before answering the second call. |
| `vobiz.client.mute()` / `vobiz.client.unmute()` | Toggles the local microphone; the UI tracks the state in `isMuted`. |
| `vobiz.client.sendDtmf(key)` | Sends a DTMF digit. `pressKey()` only calls it when `vobiz.client.callSession` is set. |
| `vobiz.client.callSession` | Truthy while a call session exists; used as the in-call guard for DTMF. |
| `vobiz.client.remoteView` | Media element carrying the remote stream; `attachRemoteAudio()` reads its `.srcObject`. |
| `vobiz.client.getPeerConnection().pc` | The underlying `RTCPeerConnection`. Used as the fallback path to find the remote audio track via `pc.getReceivers()`. |

### Events

Register handlers with `vobiz.client.on(name, handler)` before calling `login()`.

| Event | Handler argument | Used for |
|---|---|---|
| `onWebrtcNotSupported` | — | Browser cannot do WebRTC; the login UI is reset. |
| `onLogin` | — | Registration succeeded; status becomes **Registered** and the Disconnect button appears. |
| `onLoginFailed` | `reason` | Registration rejected; logged and status becomes **Login Failed**. |
| `onLogout` | — | Unregistered; UI reset, banners hidden. |
| `onIncomingCall` | `callerName`, `extraHeaders` | Shows the incoming banner, or the call-waiting banner when `isInCall` is already true. |
| `onIncomingCallCanceled` | — | Caller gave up before answer; the relevant banner is hidden. |
| `onCallRemoteRinging` | `callInfo` (`callInfo.callUUID`) | Far end is ringing; status becomes **Ringing**. |
| `onCallAnswered` | `callInfo` (`callInfo.callUUID`) | Media is up. Guarded by `audioAttached` against duplicate delivery; shows the in-call UI and runs `attachRemoteAudio()`. |
| `onCallTerminated` | `callInfo` (`callInfo.reason`) | Call ended normally; all call state and banners are cleared. |
| `onCallFailed` | `callInfo` (`callInfo.reason`) | Call could not be set up; same cleanup as termination. |
| `onMediaPermission` | `granted` (boolean) | Logs whether microphone access was granted. |
| `onConnectionChange` | `event` | Transport-level connection changes, logged as JSON. |

### Attaching remote audio

The SDK does not render audio for you — `client/index.html` carries a hidden
`<audio id="remoteAudio" autoplay playsinline>` and `attachRemoteAudio()` fills it in. It waits
1500 ms after `onCallAnswered`, then tries `vobiz.client.remoteView.srcObject`; if that is empty
it falls back to `getPeerConnection().pc.getReceivers()`, picks the receiver whose
`track.kind === 'audio'`, wraps it in a `new MediaStream([track])`, assigns it to the element,
and calls `.play()`. If neither path yields a stream it logs
`Could not find remote stream to attach`. Keep this element if you rebuild the UI.

### Answer URL contract

Parameters `server.js` reads from the request (each accepted in either capitalisation, from the
query string or the form body):

| Parameter | Used for |
|---|---|
| `From` / `from` | Direction detection. A `sip:` prefix means the call came from the browser SDK; a plain number means PSTN inbound. Also normalised to `+`-prefixed form for the log line. |
| `To` / `to` | The outbound destination. A `sip:user@host` value is reduced to the user part, and a missing `+` is added. |
| `RouteType` / `routeType` | Secondary direction signal — `sip` also means SDK outbound. |
| `Event` / `event` | `Hangup` short-circuits to an empty response. |

XML the server can return:

| Situation | Response |
|---|---|
| SDK outbound | `<Response><Dial callerId="$CALLER_ID"><Number>$destination</Number></Dial></Response>` |
| PSTN inbound | `<Response><Dial callerId="$CALLER_ID" timeout="30"><User>$SIP_ENDPOINT</User></Dial><Speak>The user is currently on another call. Please try again later. Goodbye.</Speak><Hangup/></Response>` |
| `Event=Hangup` | `<Response></Response>` |
| Missing config | HTTP 500, `text/plain` |

The `<Speak>` and `<Hangup/>` after the inbound `<Dial>` are the fallthrough: if the endpoint is
busy or does not answer within `timeout`, Vobiz continues to the next verb and the caller hears
a message instead of silence.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Answer URL is never hit; no `[params]` line in the backend log | The tunnel is down, or the console still holds a stale ngrok URL | Confirm `ngrok http 3000` is running and that the Application's Answer URL matches the current HTTPS URL exactly, with no path suffix. If ngrok reports "endpoint already online", run `pkill -f ngrok` and restart it. |
| Backend replies `Server misconfigured: CALLER_ID environment variable is not set.` (HTTP 500) | `.env` missing, or `CALLER_ID` unset | `cp .env.example .env`, set `CALLER_ID` to your Vobiz number in E.164 form, restart `npm start` — `dotenv` only reads the file at startup. |
| Backend replies `Server misconfigured: SIP_ENDPOINT environment variable is not set.` on an inbound call | Only the outbound path was configured | Set `SIP_ENDPOINT` to the SIP URI copied from **Voice > Endpoints > SIP Configuration**, then restart the backend. |
| `Call failed: Unknown` in the browser log | The answer URL returned an error or unusable XML | Check the `npm start` terminal for the stack trace, and confirm `CALLER_ID` is E.164 (e.g. `+15550003333`). |
| Stuck on "Connecting…", never reaches **Registered** | Wrong endpoint username or password | Usernames are alphanumeric only. Re-check the endpoint at [console.vobiz.ai/app/voice/endpoints](https://console.vobiz.ai/app/voice/endpoints); `onLoginFailed` logs the reason returned by the registrar. |
| Inbound call never rings the browser | Number not linked to the Application, endpoint not registered, or wrong `SIP_ENDPOINT` | Link the number under **Voice > Numbers**, make sure the tab is open and shows **Registered** before dialling, and confirm `SIP_ENDPOINT` matches the endpoint's SIP URI character for character. |
| Call drops immediately after being answered (inbound) | **Hangup URL** points at the same server | Clear the Hangup URL in the Application. Otherwise Vobiz fetches it after the call ends and receives `<Dial>` XML back, causing an immediate disconnect. |
| Connected, but there is no audio | Microphone permission denied, or the remote stream was never attached | Allow microphone access when prompted (`onMediaPermission` logs the outcome) and use Chrome. The page must be on `localhost` or HTTPS for `getUserMedia` to be offered at all. |
| Browser log shows `Could not find remote stream to attach` | Neither `remoteView.srcObject` nor a peer-connection audio receiver was ready in time | Confirm the `<audio id="remoteAudio">` element still exists if you edited the HTML; on slow networks the 1500 ms delay in `attachRemoteAudio()` may need raising. |
| Pressing keypad digits during a call appends them to the destination field | `pressKey()` always appends to the input as well as sending DTMF | Cosmetic; clear the field after the call, or edit `pressKey()` to skip the append when `vobiz.client.callSession` is set. |
| Caller hears "The user is currently on another call" | The `<Dial><User>` leg completed without connecting — endpoint busy, unregistered, or past the 30 s timeout | Register the browser before calling, or raise the `timeout` attribute on the inbound `<Dial>` in `server.js`. |

---

## Security notes

This example is written for clarity on a development machine. Read this section before putting
anything like it in front of real users.

- **SIP credentials are entered in the browser.** The login panel takes the endpoint password in
  a DOM `<input type="password">` and hands it to `vobiz.client.login()`, so it lives in page
  memory for the session. Serve the client over HTTPS, never hard-code credentials into
  `app.js`, and treat an endpoint password exactly like a phone line credential: one endpoint
  per user, rotated when someone leaves. For a real deployment, fetch short-lived per-user
  credentials from your own authenticated backend rather than typing permanent ones into a form.
- **The answer URL is an unauthenticated public webhook.** `server.js` responds to any request
  that reaches it, and while it is exposed through ngrok, anyone who learns the URL can make it
  emit `<Dial>` XML. Before production, put the handler behind a hard-to-guess path, verify a
  shared secret you add to the configured answer URL, restrict inbound traffic to Vobiz's
  addresses, or all three.
- **`To` is interpolated into XML without escaping.** The destination arrives from the request
  and goes straight into `<Number>`. Validate it against a strict E.164 pattern and XML-escape
  it before echoing anything caller-controlled into a response.
- **Caller data is logged in full.** Every request logs `[params] {...}`, which includes caller
  and called numbers. Those are personal data in most jurisdictions — redact them, or shorten
  log retention, before running this anywhere real.
- **Keep `.env` out of version control.** It is git-ignored already; commit `.env.example` only,
  and never paste a live `CALLER_ID`/`SIP_ENDPOINT` pair into an issue or pull request.
- **Shut the tunnel down when you finish testing.** ngrok publishes your local port to the
  internet for as long as it runs.
- **The SDK is loaded from a public CDN.** `client/index.html` pins an exact version, which is
  the right instinct; for production, self-host the bundle or add subresource integrity.

---

## Roadmap

> Planned improvements to this example. Ideas and pull requests are welcome —
> open an issue to discuss anything here.

- [ ] Ship TypeScript type definitions and a small typed wrapper around `vobiz.client`, so editors
      can complete the event names and method signatures used in `client/app.js`.
- [ ] Handle network changes: reconnect and ICE restart when the transport drops, driven by the
      `onConnectionChange` event, which is currently only logged.
- [ ] Add a call-quality panel reading `getStats()` from the exposed `RTCPeerConnection` — jitter,
      packet loss, round-trip time, and codec, surfaced next to the event log.
- [ ] Finish the media controls: real hold/resume alongside the existing mute, and a transfer
      action, filling out the `mediaControls` area that today holds only the Mute button.
- [ ] Add an automated test suite — unit tests for the direction-detection and XML-building logic
      in `server.js`, plus a headless smoke test for registration.
- [ ] Make the backend deployment-ready: read the port from the environment, add a health-check
      route, and verify a shared secret on the answer URL.
- [ ] Persist call history and registration state, which are in-memory globals today, so a page
      refresh does not lose the session log.

---

## Contributing

Issues and pull requests are welcome — bug reports, clearer docs, and small focused features
especially.

```bash
npm install       # install dependencies
npm start         # run the backend on :3000
npm run client    # serve the softphone on :8080
node --check server.js
node --check client/app.js
```

There is no test suite or linter configured yet (adding one is on the roadmap), so before
opening a pull request please syntax-check the files you touched with `node --check`, run both
processes, and confirm at least one outbound and one inbound call still completes end to end.
Keep `.env` and any real numbers or credentials out of your commits, and match the existing
plain-JavaScript, no-build-step style.

---

## License

Released under the [MIT License](./LICENSE) © Vobiz.

MIT is permissive: you may use, modify, and redistribute this code, including in
closed-source commercial products, provided the copyright notice and licence text
are retained. There is no warranty. If your organisation needs a different
licensing arrangement, contact [piyush@vobiz.ai](mailto:piyush@vobiz.ai).

---

## Built by Team Vobiz

[Vobiz](https://vobiz.ai) is a programmable voice and SIP-trunking platform for
voice APIs, SIP trunking, and AI voice agents. This repository is built and
maintained by the Vobiz team.

**Maintainer:** Piyush Sahoo — [piyush@vobiz.ai](mailto:piyush@vobiz.ai) · [LinkedIn](https://www.linkedin.com/in/piyush-s713/)

Questions, or want to talk through an integration? Open an issue on this repo,
or reach out directly at [piyush@vobiz.ai](mailto:piyush@vobiz.ai).

**Useful links:** [Docs](https://docs.vobiz.ai) · [API reference](https://docs.vobiz.ai/api-reference) · [Sign up](https://vobiz.ai)
