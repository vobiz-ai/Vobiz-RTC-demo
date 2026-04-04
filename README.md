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

1. The browser SDK registers with Vobiz using Endpoint credentials.
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

Edit `.env` and set `CALLER_ID` to your Vobiz phone number (E.164 format). This is the number that will appear as the caller ID on the recipient's phone. It must be an active number in your Vobiz account.

```env
CALLER_ID=+1234567890
```

### Step 3: Start the backend

```bash
npm start
```

The server runs on `http://localhost:3000`.

### Step 4: Expose the backend to the internet

Vobiz needs to reach your server — use ngrok for local development:

```bash
ngrok http 3000
```

Copy the generated URL, for example:
```
https://abc123.ngrok.io
```

> [!IMPORTANT]
> This URL (just the root — **no path suffix**) is your **Answer URL**. Set it in the Vobiz Dashboard in the next step.

### Step 5: Configure the Vobiz Dashboard

**A. Create an Endpoint** (this gives you SDK login credentials):
1. Go to **Voice > Endpoints**.
2. Create a new endpoint.
3. Note the **Username** and **Password** — you'll use these to log in from the browser.

**B. Create an Application and set the Answer URL**:
1. Go to **Voice > Applications**.
2. Create a new Application.
3. Set the **Answer URL** to your ngrok root URL:
   ```
   https://abc123.ngrok.io
   ```
   No path, no trailing slash needed — requests go to `/`.
4. Link your **Endpoint** to this Application.

### Step 6: Start the frontend

```bash
npm run client
```

The frontend runs on `http://localhost:8080`.

---

## Making a Call

1. Open `http://localhost:8080`.
2. Enter your **Endpoint Username** and **Password** from Step 5A.
3. Click **Connect & Register** and wait for the status to show **Registered**.
4. Enter a phone number in E.164 format (e.g., `+1234567890`) and click **Call**.
5. Vobiz will POST to your Answer URL. Check the `server.js` terminal — you should see:
   ```
   [params] {"To":"+1234567890"}
   -> Returned XML bridging to: +1234567890
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
- Vobiz is reaching your server but the destination is missing. Check that your Application in the Vobiz Dashboard has an Endpoint linked to it, and that the Endpoint is registered (status: Registered in the browser UI).

**Answer URL not being hit**
- Make sure ngrok is running and the URL in your Vobiz Application matches exactly what ngrok shows (copy it fresh — ngrok URLs change on restart unless you have a paid plan).

**Call connects but no audio**
- Check browser microphone permissions.
- Make sure `CALLER_ID` in `.env` is the exact phone number (E.164) registered in your Vobiz account.

---

## Resources

- **Official SDK Docs**: [docs.vobiz.ai](https://docs.vobiz.ai)
- **Live Demo**: [rtc-demo.vobiz.ai](https://rtc-demo.vobiz.ai/)
- **NPM Package**: [vobiz-webrtc-sdk](https://www.npmjs.com/package/vobiz-webrtc-sdk)

---

Developed by the **Vobiz Team**.
