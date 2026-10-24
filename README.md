# Vobiz WebRTC Browser SDK — Softphone Starter Kit

A full-stack starter kit for placing and receiving phone calls from a browser tab with the
[Vobiz WebRTC Browser SDK](https://www.npmjs.com/package/vobiz-webrtc-sdk). One small Node.js
server serves the softphone, mints short-lived access tokens, and answers Vobiz's call webhooks.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?logo=javascript&logoColor=black)](client/app.js)
[![Docs](https://img.shields.io/badge/Docs-docs.vobiz.ai-111111)](https://docs.vobiz.ai)
[![Live demo](https://img.shields.io/badge/Live_demo-rtc--demo.vobiz.ai-success)](https://rtc-demo.vobiz.ai/)

> [!TIP]
> **Try it before you clone anything: [rtc-demo.vobiz.ai](https://rtc-demo.vobiz.ai/)**
> Create a SIP endpoint in the [Vobiz console](https://console.vobiz.ai/app/voice/endpoints), enter
> its username and password, click **Connect & Register**, and you have a softphone in the browser.
> Clone this repo when you want your own call routing and access-token login.

---

## Contents

- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Password vs access-token login](#password-vs-access-token-login)
- [Setup in detail](#setup-in-detail)
- [Testing without a browser](#testing-without-a-browser)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [HTTP routes and the Answer URL contract](#http-routes-and-the-answer-url-contract)
- [Browser SDK reference](#browser-sdk-reference)
- [Optional: call guard (fraud and deepfake detection)](#optional-call-guard-fraud-and-deepfake-detection)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [Roadmap](#roadmap) · [Contributing](#contributing) · [License](#license)

---

## Quick start

You need Node.js 18+ (22+ for `npm run call-test`), a Vobiz account with a phone number, and
[ngrok](https://ngrok.com) or any tunnel that gives you a public HTTPS URL.

```bash
git clone https://github.com/vobiz-ai/Vobiz-RTC-demo.git
cd Vobiz-RTC-demo
npm install
cp .env.example .env          # fill in VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, CALLER_ID

npm start                     # terminal 1: backend + softphone on http://localhost:3000
ngrok http 3000               # terminal 2: public URL for Vobiz webhooks

npm run setup -- https://<your-subdomain>.ngrok-free.app
# creates the "Vobiz WebRTC Demo" application, points it at <url>/answer and <url>/hangup,
# and saves PUBLIC_URL and JWT_APP_ID to .env

# restart terminal 1 (Ctrl-C, npm start) so new tokens carry JWT_APP_ID
```

Open **http://localhost:3000**, choose **Access token**, click **Fetch token & Register**, type a
number in E.164 form (`+919876543210`) and press **Call**.

To receive calls, assign your Vobiz number to the **Vobiz WebRTC Demo** application under
**Voice > Numbers** in the console, keep the tab open and registered, and dial the number.

---

## What you get

- **Two ways to log in**: endpoint username and password, or a short-lived access token (JWT)
  minted by your backend so no long-lived secret ever reaches the browser.
- **Outbound calls** from the browser to any phone number, with your Vobiz number as caller ID.
- **Inbound calls** to your Vobiz number ring the browser, with an incoming-call banner,
  call waiting, and a spoken fallback when nobody answers.
- **In-call controls**: mute, DTMF keypad, hang up, and a live SDK event log.
- **One-command provisioning**: `npm run setup` creates or updates the Vobiz application.
- **A headless end-to-end test**: `npm run call-test` exercises token, registration and an
  outbound call from the command line.
- **Optional fraud guard**: fork every call's audio to a detection service with `<Stream>`.

Everything is plain JavaScript: `node:http` plus `dotenv` on the server, one HTML file, one
stylesheet and one script in the browser, no framework and no build step.

---

## How it works

Vobiz drives the call; your server answers questions. When a call needs instructions, Vobiz
POSTs to the **Answer URL** of the application the call belongs to, and `server.js` replies with
Vobiz XML. The same route serves both directions and tells them apart by who the call is from.

### Outbound with an access token (browser → phone)

```
Browser (SDK)            server.js              Vobiz registrar         Vobiz media server
     |                        |                        |                        |
     |-- POST /token -------->|                        |                        |
     |                        |-- mint JWT (Vobiz API) |                        |
     |<-- { token } ----------|                        |                        |
     |-- REGISTER + X-Vobiz-Jwt over WSS ------------->| validates the token    |
     |<-- 200 OK --------------------------------------|                        |
     |-- INVITE +9198... + X-Vobiz-Jwt --------------->|-- INVITE, tagged with  |
     |                        |                        |   auth ID and app ID ->|
     |                        |<-- POST /answer (From=sip:<sub>_<authid>@...) --|
     |                        |-- <Dial><Number>+9198...</Number></Dial> ------>|
     |                        |                        |      dials the phone --|--> PSTN
     |<====================== audio (SRTP) ===========================>|        |
     |                        |<-- POST /dial-status, POST /hangup -------------|
```

The token's `app` claim (`JWT_APP_ID`) decides **which application's Answer URL** handles the
call. If it is missing, the account's default application is used, which is usually not this
server. That is why `npm run setup` writes `JWT_APP_ID` for you.

### Inbound (phone → browser)

```
Phone                    Vobiz media server        server.js              Browser (SDK)
  |-- dials your number -->|                          |                        |
  |                        |-- POST /answer --------->|                        |
  |                        |   From=9198..., no sip:  |                        |
  |                        |<-- <Dial><User>sip:<user>@registrar.vobiz.ai -----|
  |                        |-- INVITE via the registrar ---------------------->| banner rings
  |                        |<----------------------------------- 200 OK -------| Answer
  |<======================= audio =========================================== >|
```

For inbound, the server rings **every identity the browser might be logged in as** at once: the
SIP endpoint from `SIP_ENDPOINT` (password login) and `sip:<JWT_SUB>_<VOBIZ_AUTH_ID>@registrar.vobiz.ai`
(token login). The first one to answer gets the call.

**How direction is detected**

| Request from Vobiz | Meaning | Reply |
|---|---|---|
| `From=sip:user@registrar.vobiz.ai` or `RouteType=sip` | The browser placed a call | `<Dial><Number>` to the dialled number |
| `From=9198...` (a plain number) | Someone called your Vobiz number | `<Dial><User>` to the browser identities |

---

## Password vs access-token login

The Authentication panel has a tab for each.

| | Password | Access token (JWT) |
|---|---|---|
| What the browser holds | The endpoint's long-lived SIP password | A token that expires (default 1 hour) |
| Where the secret lives | Typed into the page | `VOBIZ_AUTH_TOKEN` stays in `.env` on the server |
| SDK call | `client.login(username, password)` | `client.loginWithAccessTokenGenerator({ getAccessToken })` |
| Identity on the registrar | `<endpoint username>` | `<JWT_SUB>_<VOBIZ_AUTH_ID>`, e.g. `webrtc-demo_MA_XXXXXXXX` |
| Needs a console endpoint | Yes, created under **Voice > Endpoints** | No: the identity is created by the token |
| Which app handles outbound | The endpoint's application | The token's `app` claim (`JWT_APP_ID`) |
| Permissions | All | `per.voice.incoming_allow` / `outgoing_allow` |
| Renewal | Not needed | The SDK fetches a new token about 60 s before expiry and re-registers |
| Revocation | Change the endpoint password | Stop issuing tokens; the current one dies at `exp` |

### The token flow in this repo

1. The browser calls `POST /token` on `server.js`.
2. The server builds the claims and asks `POST https://api.vobiz.ai/api/v1/Account/{auth_id}/JWT/Token/`
   to sign them:

   ```json
   { "iss": "MA_XXXXXXXX", "sub": "webrtc-demo", "nbf": 1790000000, "exp": 1790003600,
     "app": "12345678901234567",
     "per": { "voice": { "incoming_allow": true, "outgoing_allow": true } } }
   ```

3. The SDK registers over WSS to `registrar.vobiz.ai:5063` with the header `X-Vobiz-Jwt: <token>`.
   The registrar checks the signature, `nbf`/`exp` and grants, and replies `200 OK`.
4. Outbound INVITEs carry the same header. The registrar validates it again and tells the media
   server which account and application the call belongs to.
5. Before the token expires, the SDK calls `getAccessToken()` again and re-registers.

> [!WARNING]
> `POST /token` is open in this demo. In a real app, issue a token only after your own user has
> signed in, and put that user's id in `sub` so each person gets their own identity.

---

## Setup in detail

### 1. Get your account credentials and a number

- **Auth ID and Auth Token**: on the [Vobiz console](https://console.vobiz.ai) dashboard. Put them
  in `.env` as `VOBIZ_AUTH_ID` and `VOBIZ_AUTH_TOKEN`.
- **A phone number**: under **Voice > Numbers**. Put it in `.env` as `CALLER_ID` in E.164 form
  (`+918071234567`). It is the caller ID on outbound calls and the number that rings the browser.

### 2. Start the server and a tunnel

```bash
npm start            # http://localhost:3000 (set PORT in .env to change it)
ngrok http 3000      # copy the https://... forwarding URL
```

Vobiz must reach `/answer`, `/dial-status` and `/hangup` from the internet. The softphone and
`/token` are used from your own browser and work on `localhost`.

### 3. Create the application

```bash
npm run setup -- https://<your-subdomain>.ngrok-free.app
```

This finds the application named **Vobiz WebRTC Demo** (set `VOBIZ_APP_NAME` to change the name)
or creates it, and sets:

| Field | Value |
|---|---|
| Answer URL | `<PUBLIC_URL>/answer`, POST |
| Hangup URL | `<PUBLIC_URL>/hangup`, POST |

It then saves `PUBLIC_URL` and `JWT_APP_ID` to `.env`. Re-run it whenever your tunnel URL changes;
it updates the same application. **Restart `npm start` afterwards** so the server picks up the new
values.

Prefer the console? Create an XML application under **Voice > Applications** with the two URLs
above, copy its id into `JWT_APP_ID`, and set `PUBLIC_URL`.

### 4. Inbound calls

Assign your number to the application under **Voice > Numbers**. For password login, also create
an endpoint under **Voice > Endpoints**, link it to the application, and set `SIP_ENDPOINT` to its
SIP URI (`sip:<username>@registrar.vobiz.ai`).

### 5. Make calls

Open `http://localhost:3000`:

- **Access token**: leave *Token server* empty (the page uses its own origin), click
  **Fetch token & Register**, wait for **Registered**, dial.
- **Password**: enter the endpoint username and password, click **Connect & Register**, dial.

The server log shows each step:

```
[token] issued (api) for webrtc-demo_MA_XXXXXXXX, exp 2026-10-24T12:44:23.000Z
[2026-10-24T11:44:25.406Z] POST /answer
-> SDK outbound call from sip:webrtc-demo_MA_XXXXXXXX@registrar.vobiz.ai, bridging to: +919876543210
[2026-10-24T11:45:30.906Z] POST /dial-status
   dial 4920de41-...: completed (NORMAL_CLEARING)
[2026-10-24T11:45:30.700Z] POST /hangup
   hangup 4920de41-...: Normal Hangup, 25s
```

> [!NOTE]
> You can still serve the client separately with `npm run client` (port 8080). In that case,
> enter `http://localhost:3000` in the *Token server* field.

---

## Testing without a browser

`npm run call-test` does what the SDK does, from the terminal: it fetches a token from the running
server, registers over WSS with `X-Vobiz-Jwt`, places an outbound call and hangs up.

```bash
npm start                                   # in another terminal
npm run call-test -- +919876543210          # hangs up 30 s after the call connects
HOLD_SECONDS=10 npm run call-test -- +91... # shorter hold
```

```
  0.13s token for webrtc-demo_MA_XXXXXXXX, app 12345678901234567, expires 2026-10-24T12:45:04.000Z
  0.63s connected to wss://registrar.vobiz.ai:5063 as webrtc-demo_MA_XXXXXXXX
  0.74s <- SIP/2.0 200 OK  [REGISTER]
  0.74s INVITE +919876543210 (Call-ID c775abbafe080)
  0.85s <- SIP/2.0 100 trying -- your call is important to us  [INVITE]
  9.14s <- SIP/2.0 200 OK  [INVITE]  CallUUID 4920de41-5cee-4eab-8761-110db7072a76
  9.14s CONNECTED to the media server. Holding 30s, then hanging up (the backend log shows the dial result).
 39.14s -> BYE
 39.18s <- SIP/2.0 200 OK  [BYE]
 39.18s call ended cleanly
```

The test sends no audio, so whoever answers hears silence. The **CallUUID** it prints is the id to
look up in your Vobiz call logs. Exit codes: `0` connected, `1` setup or registration error,
`2` call rejected, `3` timed out.

---

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)). The server reads it once at start.

| Variable | Required | Description |
|---|---|---|
| `VOBIZ_AUTH_ID` | Token login, setup | Account Auth ID (`MA_...`). |
| `VOBIZ_AUTH_TOKEN` | Token login, setup | Account Auth Token. Never sent to the browser. |
| `CALLER_ID` | Yes | Your Vobiz number in E.164. Caller ID on every `<Dial>`. |
| `PUBLIC_URL` | Yes | Public `https://` URL of this server. Written by `npm run setup`, used for the `<Dial action>` callback. |
| `JWT_APP_ID` | Token login | Application whose Answer URL handles token calls. Written by `npm run setup`. |
| `PORT` | No | Server port, default `3000`. |
| `JWT_SUB` | No | Identity in the token, default `webrtc-demo`. The browser registers as `<JWT_SUB>_<VOBIZ_AUTH_ID>`. |
| `JWT_TTL_SECONDS` | No | Token lifetime, 180 to 86400, default 3600. |
| `SIP_ENDPOINT` | Password login | SIP URI of your endpoint, rung on inbound calls. |
| `VOBIZ_APP_NAME` | No | Application name `npm run setup` looks for, default `Vobiz WebRTC Demo`. |
| `GUARD_WSS_URL`, `GUARD_LOCAL_ADDR`, `GUARD_SHARED_SECRET`, `GUARD_STATUS_CALLBACK_URL` | No | See [call guard](#optional-call-guard-fraud-and-deepfake-detection). |
| `JWT_LOCAL_SIGN` | No | `1` signs tokens locally if the Vobiz token API is unreachable. Leave at `0`. |
| `VOBIZ_API_BASE` | No | API base, default `https://api.vobiz.ai/api/v1`. |

Set in code rather than `.env`: outbound ring timeout `45` s and inbound `30` s (`timeout` on
`<Dial>` in `server.js`), SDK version `vobiz-webrtc-sdk@1.0.3` (`client/index.html`).

---

## Project layout

| Path | What it does |
|---|---|
| `server.js` | The backend: static client, `/token`, `/answer`, `/dial-status`, `/hangup`, `/health`, and the optional `/stream` proxy. |
| `scripts/setup.js` | `npm run setup`: creates or updates the Vobiz application and writes `PUBLIC_URL` / `JWT_APP_ID` to `.env`. |
| `scripts/call-test.js` | `npm run call-test`: headless token login and outbound call. |
| `client/index.html` | Softphone markup: login tabs, dialer and keypad, incoming and call-waiting banners, event log, guard panel, hidden `<audio id="remoteAudio">`. Loads the SDK from unpkg. |
| `client/app.js` | All SDK integration: login (both modes), call, answer, reject, hang up, mute, DTMF, remote audio, guard event feed. |
| `client/style.css` | Styles. |
| `.env.example` | Template for `.env`. |
| `docs.md` | Short console walkthrough. |

---

## HTTP routes and the Answer URL contract

| Route | Caller | Purpose |
|---|---|---|
| `GET /` and client files | Your browser | The softphone. |
| `POST /token` | Your browser | Returns `{ token, mode, sub, exp, sip_username }`. |
| `POST /answer` | Vobiz | Call instructions (XML). Any other unmatched POST path is treated the same, for older setups that used the root URL. |
| `POST /dial-status` | Vobiz | `<Dial action>` result: logged, empty `<Response>` returned. |
| `POST /hangup` | Vobiz | Hangup URL: logged, empty `<Response>` returned. |
| `GET /health` | Monitoring | `{"ok":true}`. |
| `WS /stream` | Vobiz | Optional proxy to a local call guard. |

Parameters `/answer` reads (query string or form body):

| Parameter | Used for |
|---|---|
| `From` | `sip:...` means the browser placed the call; a plain number means inbound. |
| `To` | Outbound destination. Reduced to digits, `+` added, rejected unless it is E.164. |
| `RouteType` | `sip` also means the browser placed the call. |

XML it returns:

| Situation | Response |
|---|---|
| Browser → phone | `<Dial callerId="$CALLER_ID" timeout="45" action=".../dial-status" redirect="false"><Number>+...</Number></Dial>` |
| Phone → browser | `<Dial callerId="$CALLER_ID" timeout="30" action=...><User>...</User>…</Dial><Speak>…not available…</Speak><Hangup/>` |
| Destination is not E.164 | `<Speak>Please dial a phone number in international format.</Speak><Hangup/>` |
| Missing `CALLER_ID` | HTTP 500, `text/plain` |

`action` with `redirect="false"` matters: without it, Vobiz fetches the Answer URL again when the
`<Dial>` ends and the call would dial a second time.

---

## Browser SDK reference

Everything `client/app.js` uses. The SDK is loaded from
`https://unpkg.com/vobiz-webrtc-sdk@1.0.3/dist/vobiz-webrtc-sdk.min.js`, which defines a global
`Vobiz`. The same build is on npm as [`vobiz-webrtc-sdk`](https://www.npmjs.com/package/vobiz-webrtc-sdk).
Full documentation: [docs.vobiz.ai](https://docs.vobiz.ai).

### Constructing the client

```js
const vobiz = new Vobiz({
    debug: 'ALL',            // SDK log level in the browser console
    permOnClick: true,       // ask for the microphone on a user gesture
    enableTracking: true,
    closeProtection: false,  // don't block closing the tab mid-call
    maxAverageBitrate: 48000,
});
```

### Login, calls and controls

| Call | What it does |
|---|---|
| `vobiz.client.login(username, password)` | Password login: registers the endpoint. Fires `onLogin` or `onLoginFailed`. |
| `vobiz.client.loginWithAccessTokenGenerator({ getAccessToken })` | Token login. `getAccessToken()` returns a JWT string (here: `POST /token`); the SDK calls it again before expiry. |
| `vobiz.client.logout()` | Unregisters. Fires `onLogout`. |
| `vobiz.client.call(destination, extraHeaders)` | Outbound call to an E.164 number or SIP URI. `extraHeaders` keys starting with `X-VH-` reach your Answer URL as parameters. |
| `vobiz.client.answer()` / `reject()` / `hangup()` | Answer or decline the ringing call; end the active one. |
| `vobiz.client.mute()` / `unmute()` | Microphone on or off. |
| `vobiz.client.sendDtmf(key)` | Send a DTMF digit during a call. |
| `vobiz.client.remoteView`, `getPeerConnection().pc` | The remote media element and the underlying `RTCPeerConnection`. |

### Events

Register with `vobiz.client.on(name, handler)` before logging in.

| Event | Argument | Used for |
|---|---|---|
| `onLogin` / `onLoginFailed` / `onLogout` | — / `reason` / — | Registration state. |
| `onIncomingCall` | `callerName`, `extraHeaders` | Incoming banner, or call-waiting banner if already on a call. |
| `onIncomingCallCanceled` | — | Caller gave up before answer. |
| `onCallRemoteRinging` | `callInfo` | The far end is ringing. |
| `onCallAnswered` | `callInfo` | Media is up: show in-call UI, attach remote audio. |
| `onCallTerminated` / `onCallFailed` | `callInfo` (`reason`) | Clean up call state. |
| `onMediaPermission` | `granted` | Microphone permission result. |
| `onConnectionChange` | `event` | Transport changes. |
| `onWebrtcNotSupported` | — | The browser can't do WebRTC. |

### Remote audio

The SDK does not play audio for you. `client/index.html` has a hidden
`<audio id="remoteAudio" autoplay playsinline>`, and `attachRemoteAudio()` fills it 1.5 s after
`onCallAnswered`: from `remoteView.srcObject`, or else from the peer connection's audio receiver.
Keep that element if you rebuild the UI.

---

## Optional: call guard (fraud and deepfake detection)

Set `GUARD_WSS_URL` and every call is forked to a
[vobiz-call-guard](https://github.com/vobiz-ai/modulate-poc) service with a one-way `<Stream>`
placed before the `<Dial>`. The guard listens for scam patterns and synthetic voices and can
speak a warning to the protected party. The softphone's **Fraud guard** panel shows its live
events when you point it at the guard's `/events` URL.

To run the guard behind the same tunnel, set `GUARD_WSS_URL=wss://<PUBLIC_URL host>/stream`; the
server proxies `/stream` to `GUARD_LOCAL_ADDR` (default `127.0.0.1:8090`).

> [!NOTE]
> `<Stream>` makes Vobiz answer the browser's leg straight away, before the phone is dialled. The
> browser shows the call as connected and hears ringback until the far end picks up. Without the
> guard, the browser's call connects when the far end answers.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Token login: `token server returned 500` | `VOBIZ_AUTH_ID` / `VOBIZ_AUTH_TOKEN` missing or wrong | Check `.env`, restart `npm start`. The server log prints the API's error. |
| Token registers, but outbound fails at once with **486 Busy** | The call reached an application whose Answer URL is broken or isn't this server | Run `npm run setup` and restart the server, so the token's `app` is this server's application. Check the call's log in the console for the Answer URL that was fetched. |
| Server log never shows `POST /answer` | Tunnel down, or the application still holds an old tunnel URL | Restart the tunnel and run `npm run setup -- <new url>`. |
| `Server misconfigured: CALLER_ID environment variable is not set.` | `CALLER_ID` missing | Set it in `.env`, restart. |
| Outbound rings, then **busy** or **no answer** | The far end declined, was busy, or the carrier rejected the caller ID | Try another number; make sure `CALLER_ID` is a number on your account. |
| A call dials twice | No `action` on `<Dial>` (custom XML) | Keep `action=".../dial-status" redirect="false"` on every `<Dial>`. |
| Password login stuck on *Connecting…* | Wrong endpoint username or password | Usernames are alphanumeric. `onLoginFailed` logs the registrar's reason. |
| Inbound never rings the browser | Number not assigned to the application, or the tab isn't registered | Assign the number under **Voice > Numbers**; keep the tab open and **Registered** before you call. |
| Caller hears "The user is not available right now" | Nobody answered within 30 s, or the browser was busy | Register first; raise `timeout` on the inbound `<Dial>` if needed. |
| Connected, no audio | Microphone blocked, or remote stream not attached | Allow the microphone; use Chrome; the page must be on `localhost` or HTTPS. |
| `npm run call-test`: `Node 22+ is required` | Older Node | Use Node 22, or test with the browser. |

---

## Security notes

This example is written for clarity. Read this before putting anything like it in front of users.

- **Protect `/token`.** It hands a working calling credential to anyone who can reach it. Put it
  behind your own login and issue one identity (`sub`) per user.
- **Keep `.env` private.** It holds the account Auth Token. It is git-ignored; commit
  `.env.example` only.
- **The Answer URL is a public webhook.** Anyone who learns the URL can request XML from it. Use a
  hard-to-guess path or a shared secret in the URL before production.
- **Destinations are validated and XML-escaped**, but call logs include phone numbers, which are
  personal data in most places. Redact or shorten retention for real use.
- **Close the tunnel when you're done.** It exposes your local port to the internet.
- **The SDK comes from a CDN.** The version is pinned; for production, self-host it or add
  subresource integrity.

---

## Roadmap

- [ ] TypeScript types and a small typed wrapper around `vobiz.client`.
- [ ] Reconnect and ICE restart on network changes (`onConnectionChange` is only logged today).
- [ ] Call-quality panel from `getStats()`: jitter, loss, RTT, codec.
- [ ] Hold, resume and transfer.
- [ ] Unit tests for the routing and XML in `server.js`.
- [ ] Shared-secret check on the Answer URL.

---

## Contributing

Issues and pull requests are welcome.

```bash
npm install
npm run check        # syntax-check every file
npm start
npm run call-test -- +<your number>
```

Before opening a pull request, run `npm run check`, make one outbound and one inbound call, and
keep `.env`, real numbers and credentials out of your commits.

---

## License

Released under the [MIT License](./LICENSE) © Vobiz. You may use, modify and redistribute this
code, including in closed-source commercial products, provided the copyright notice and licence
text are kept. There is no warranty.

---

## Built by Team Vobiz

[Vobiz](https://vobiz.ai) is a programmable voice and SIP-trunking platform for voice APIs, SIP
trunking and AI voice agents.

**Maintainer:** Piyush Sahoo — [piyush@vobiz.ai](mailto:piyush@vobiz.ai) · [LinkedIn](https://www.linkedin.com/in/piyush-s713/)

**Useful links:** [Docs](https://docs.vobiz.ai) · [API reference](https://docs.vobiz.ai/api-reference) · [Sign up](https://vobiz.ai)
