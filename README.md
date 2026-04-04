# Vobiz WebRTC SDK Example

[![Vobiz](https://img.shields.io/badge/Vobiz-WebRTC_SDK-blue?style=for-the-badge)](https://vobiz.ai)
[![Demo](https://img.shields.io/badge/Live_Demo-rtc--demo.vobiz.ai-green?style=for-the-badge)](https://rtc-demo.vobiz.ai/)

A full-stack starter kit for building browser-based voice applications with the **Vobiz WebRTC Browser SDK**. Includes a Node.js backend (Answer URL handler) and a browser-based softphone UI.

---

## Overview

- **Outbound Calling**: Dial any phone number from the browser.
- **Inbound Calling**: Receive and answer calls in the browser.
- **Dynamic Routing**: Node.js backend reads the dialed number from the Vobiz webhook and returns XML to bridge the call.
- **Media Controls**: Mute, DTMF keypad, and call status tracking.

---

## Architecture

```
Browser (client/)          Vobiz Platform          Backend (server.js)
     |                          |                          |
     |--- SDK registers ------->|                          |
     |--- user dials number --->|                          |
     |                          |--- POST / (To=number) -->|
     |                          |<-- XML <Dial> response --|
     |                          |--- bridges call -------->| (PSTN)
```

1. The browser SDK registers with Vobiz using SIP Endpoint credentials.
2. When a call is placed, Vobiz sends a `POST` request to your **Answer URL** with the destination number in the `To` parameter.
3. Your backend (`server.js`) reads `To` and returns a `<Dial>` XML response instructing Vobiz to bridge the call.

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

Edit `.env` and set `CALLER_ID` to your Vobiz phone number in E.164 format. This is the number that will appear as the caller ID on the recipient's phone. It must be an active number in your Vobiz account.

```env
CALLER_ID=+1234567890
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

---

### Step 5: Create a SIP Endpoint on Vobiz

Go to **[Voice > Endpoints](https://console.vobiz.ai/app/voice/endpoints)** and click **Create Endpoint**.

Fill in the form:

| Field | What to enter |
|---|---|
| **Alias** | A friendly name, e.g. `My Browser Phone` |
| **Username** | Alphanumeric only, e.g. `myuser123` — **save this, you'll need it to log in** |
| **Password** | A strong password — **save this too** |
| **Application** | Leave as `None` for now (you'll link it after creating the Application) |

Click **Create Endpoint**.

---

### Step 6: Create an XML Application on Vobiz

Go to **[Voice > Applications](https://console.vobiz.ai/app/voice/applications)** and click **Create Application**.

Fill in the form:

| Field | What to enter |
|---|---|
| **Application Name** | A friendly name, e.g. `My WebRTC App` |
| **Answer URL** | Your ngrok URL, e.g. `https://abc123.ngrok.io` — method must be **POST** |
| **Hangup URL** | Leave blank (optional) |
| **Fallback Answer URL** | Leave blank (optional) |
| **Default Endpoint App** | Toggle **ON** — this links the application to your endpoint automatically |

Click **Create Application**.

> [!TIP]
> Alternatively, go back to your Endpoint and edit it to set the **Application** field to the application you just created.

---

### Step 7: Start the frontend

```bash
npm run client
```

The frontend runs at `http://localhost:8080`.

---

## Making a Call

Open `http://localhost:8080` in your browser. You'll see three panels:

**Authentication panel (left)**
1. Enter the **Endpoint Username** you created in Step 5 (e.g. `myuser123`).
2. Enter the **Endpoint Password**.
3. Click **Connect & Register**.
4. Wait until the logs panel (right) shows: `Successfully registered with Vobiz!`

**Dialer panel (center)**
1. Type the destination phone number in E.164 format in the **Destination Number** field (e.g. `+916002935745`).
2. You can also use the keypad to enter the number.
3. Click **Call**.

**Logs panel (right)**

Watch the logs to confirm the call flow:
```
Connecting as myuser123...
Connection change: {"state":"connected","reason":"registered"}
Successfully registered with Vobiz!
Calling +916002935745...
Ringing... (call-id-here)
Call answered! (call-id-here)
```

On your backend terminal you should also see:
```
[params] {"To":"+916002935745"}
-> Returned XML bridging to: +916002935745
```

---

## Project Structure

```text
vobiz-sdk-example/
├── server.js          # Backend: Answer URL handler (reads To, returns XML)
├── .env               # Environment variables (git-ignored)
├── .env.example       # Template for .env
├── package.json       # Scripts and dependencies
├── client/
│   ├── index.html     # Dialer UI
│   ├── app.js         # SDK integration logic
│   └── style.css      # Styling
└── README.md
```

---

## Troubleshooting

**`No "To" parameter found. Returning 400`**
- Vobiz is reaching your server but without a destination. Make sure your Endpoint is linked to the Application (Step 6) and the Endpoint is in a registered state in the browser UI.

**Answer URL not being hit at all**
- Verify ngrok is still running (`ngrok http 3000`).
- Check that the URL in your Vobiz Application matches the current ngrok URL exactly — ngrok generates a new URL on every restart.

**`Call failed: Unknown` in the logs**
- This usually means the Answer URL returned an error or wasn't reachable. Check your `server.js` terminal for errors.
- Make sure `CALLER_ID` in `.env` is the exact E.164 phone number registered in your Vobiz account.

**Stuck on "Connecting..." / never registers**
- Double-check the Endpoint username and password — usernames are alphanumeric only.
- Make sure the Endpoint exists at [console.vobiz.ai/app/voice/endpoints](https://console.vobiz.ai/app/voice/endpoints).

**No audio on the call**
- Allow microphone access when the browser prompts.
- Try a different browser (Chrome is recommended for WebRTC).

---

## Resources

- **Official SDK Docs**: [docs.vobiz.ai](https://docs.vobiz.ai)
- **Live Demo**: [rtc-demo.vobiz.ai](https://rtc-demo.vobiz.ai/)
- **NPM Package**: [vobiz-webrtc-sdk](https://www.npmjs.com/package/vobiz-webrtc-sdk)

---

Developed by the **Vobiz Team**.
