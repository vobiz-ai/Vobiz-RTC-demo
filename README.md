# Vobiz WebRTC SDK Example

[![Vobiz](https://img.shields.io/badge/Vobiz-WebRTC_SDK-blue?style=for-the-badge)](https://vobiz.ai)
[![Demo](https://img.shields.io/badge/Live_Demo-rtc--demo.vobiz.ai-green?style=for-the-badge)](https://rtc-demo.vobiz.ai/)

A full-stack starter kit for building browser-based voice applications with the **Vobiz WebRTC Browser SDK**. Includes a Node.js backend (Answer URL handler) and a browser-based softphone UI.

Both **outbound** (browser → PSTN) and **inbound** (PSTN → browser) calls are fully supported and tested.

---

## Overview

- **Outbound Calling**: Dial any phone number from the browser to PSTN.
- **Inbound Calling**: Someone calls your Vobiz number — it rings in the browser with an Answer/Decline banner.
- **Dynamic Routing**: Node.js backend automatically detects call direction and routes accordingly.
- **Media Controls**: Mute, DTMF keypad, and call status tracking.

---

## Architecture

**Outbound (Browser → PSTN)**
```
Browser (client/)              Vobiz Platform          Backend (server.js)
     |                              |                          |
     |--- SDK registers ----------->|                          |
     |--- user dials +91xxx ------->|                          |
     |                              |--- POST / -------------->|
     |                              |    From=sip:user@...     |
     |                              |    To=+91xxx             |
     |                              |<-- <Dial><Number> -------|
     |                              |--- bridges to PSTN ----->|
```

**Inbound (PSTN → Browser)**
```
PSTN caller                    Vobiz Platform          Backend (server.js)
     |                              |                          |
     |--- calls +917971543187 ----->|                          |
     |                              |--- POST / -------------->|
     |                              |    From=9148227303       |
     |                              |    RouteType=(empty)     |
     |                              |<-- <Dial><User> ---------|
     |                              |--- SIP INVITE ---------->| (browser endpoint)
     |                              |       Browser shows incoming banner
     |                              |--- call bridged -------->|
```

**How direction is detected:** The backend checks the `From` field and `RouteType` param Vobiz sends:
- `From=sip:user@registrar.vobiz.ai` or `RouteType=sip` → **SDK outbound** → `<Dial><Number>`
- `From=9148227303` (plain number), `RouteType` empty → **PSTN inbound** → `<Dial><User>`

---

## Prerequisites

- **Node.js** v14+
- **Vobiz Account** — [console.vobiz.ai](https://console.vobiz.ai)
- **A Vobiz Phone Number** — purchased in your Vobiz account (used as `CALLER_ID`)
- **ngrok** (or equivalent) — to expose your local backend for development

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
CALLER_ID=+1234567890

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

---

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

---

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

---

### Step 7: Link your phone number

Go to **Voice > Numbers**, click your number, and assign it to the Application you created in Step 6. This is required for inbound calls to reach the browser.

---

### Step 8: Start the frontend

```bash
npm run client
```

The frontend runs at `http://localhost:8080`.

---

## Making Outbound Calls

1. Open `http://localhost:8080`
2. Enter your **Endpoint Username** and **Password** from Step 5
3. Click **Connect & Register** — wait for `Successfully registered with Vobiz!` in the logs
4. Type a phone number in E.164 format (e.g. `+919148227303`) and click **Call**

Backend logs will show:
```
-> SDK outbound call, bridging to: +919148227303
```

Browser logs will show:
```
Calling +919148227303...
Ringing... (call-id)
Call answered! (call-id)
```

---

## Receiving Inbound Calls

1. Open `http://localhost:8080` and log in — wait for **Registered** status
2. Call your Vobiz number (`CALLER_ID`) from any phone
3. A **green incoming call banner** appears at the top of the browser with the caller's number
4. Click **Answer** to connect, **Decline** to reject

Backend logs will show:
```
-> PSTN inbound from +919148227303, ringing endpoint: sip:myuser123@registrar.vobiz.ai
```

> [!IMPORTANT]
> The browser must be **open and registered** before the call arrives. Vobiz does not queue calls for offline endpoints.

---

## Project Structure

```text
vobiz-sdk-example/
├── server.js          # Backend: Answer URL handler (detects direction, returns XML)
├── .env               # Environment variables (git-ignored)
├── .env.example       # Template for .env
├── package.json       # Scripts and dependencies
├── client/
│   ├── index.html     # Dialer UI with incoming call banner
│   ├── app.js         # SDK integration logic
│   └── style.css      # Styling
└── README.md
```

---

## Troubleshooting

**Answer URL not being hit**
- Verify ngrok is running: `ngrok http 3000`
- Check the URL in your Vobiz Application matches the current ngrok URL exactly.
- If ngrok says "endpoint already online": `pkill -f ngrok` then restart.

**`Call failed: Unknown` in browser logs**
- The Answer URL returned an error. Check your `npm start` terminal for errors.
- Make sure `CALLER_ID` in `.env` is E.164 format (e.g. `+917971543187`).

**Stuck on "Connecting..." / never registers**
- Double-check Endpoint username and password — usernames are alphanumeric only.
- Verify the Endpoint exists at [console.vobiz.ai/app/voice/endpoints](https://console.vobiz.ai/app/voice/endpoints).

**Inbound call doesn't ring in the browser**
- Make sure `SIP_ENDPOINT` in `.env` is copied exactly from **Voice > Endpoints > your endpoint > SIP Configuration > SIP URI**.
- Make sure your Vobiz phone number is linked to the Application (**Voice > Numbers**).
- The browser must be registered before the call arrives.
- Make sure **Hangup URL** in the Application is blank.

**Call drops immediately after answering (inbound)**
- Check that the **Hangup URL** field in your Vobiz Application is empty. If it points to your server, Vobiz fetches it after the call ends and gets `<Dial>` XML back, causing an immediate disconnect.

**No audio on the call**
- Allow microphone access when the browser prompts.
- Chrome is recommended for WebRTC.

---

## Resources

- **Official SDK Docs**: [docs.vobiz.ai](https://docs.vobiz.ai)
- **Live Demo**: [rtc-demo.vobiz.ai](https://rtc-demo.vobiz.ai/)
- **NPM Package**: [vobiz-webrtc-sdk](https://www.npmjs.com/package/vobiz-webrtc-sdk)

---

Developed by the **Vobiz Team**.
