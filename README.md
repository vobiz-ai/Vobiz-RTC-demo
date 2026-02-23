# 📞 Vobiz WebRTC SDK Example

[![Vobiz](https://img.shields.io/badge/Vobiz-WebRTC_SDK-blue?style=for-the-badge)](https://vobiz.ai)
[![Demo](https://img.shields.io/badge/Live_Demo-rtc--demo.vobiz.ai-green?style=for-the-badge)](https://rtc-demo.vobiz.ai/)

A comprehensive example implementation of the **Vobiz WebRTC Browser SDK**. This repository provides a full-stack starter kit to build browser-based voice applications, featuring a modern UI and a dynamic XML backend.

---

## 🌟 Overview

This project demonstrates the core capabilities of the Vobiz WebRTC SDK:
- **Registration**: Seamlessly register browser endpoints with the Vobiz infrastructure.
- **Outbound Calling**: Dial any phone number or SIP URI directly from your web application.
- **Inbound Calling**: Receive and answer calls in the browser with real-time notifications.
- **Dynamic Routing**: Use a Node.js backend to programmatically bridge calls using Vobiz XML.
- **Media Controls**: Integrated Mute, Dual-Tone Multi-Frequency (DTMF) keypad, and status tracking.

---

## 🏗️ System Architecture

The application follows a decoupled architecture for maximum flexibility:

### 1. Frontend Client (`/client`)
- **Engine**: Powered by `vobiz-webrtc-sdk`.
- **UI**: Clean, responsive interface built with HTML5, CSS3 (Inter Typography), and Vanilla JS.
- **Logic**: Handles the WebRTC session lifecycle, media permissions, and UI state management.

### 2. Backend Server (`server.js`)
- **Role**: Serves as the **Dynamic Answer URL** provider.
- **Function**: When a call is initiated via the SDK, Vobiz queries this server for instructions.
- **Response**: Returns Vobiz XML (`<Dial>`) to bridge the browser call to the destination phone network.

---

## 🏁 Getting Started

### 1. Prerequisites
- **Node.js**: v14.0.0 or higher.
- **Vobiz Account**: An active account at [Vobiz Console](https://console.vobiz.ai).
- **Verified Caller ID**: A phone number verified in your Vobiz account to use as the outbound CLI.
- **ngrok**: Recommended for local development to expose your backend to the internet.

### 2. Obtain Vobiz Credentials
To use the SDK, you need **Endpoint Credentials** (distinct from your main login):
1.  Log in to the [Vobiz Dashboard](https://console.vobiz.ai).
2.  Navigate to **Voice > Endpoints**.
3.  Create a new endpoint or use an existing one.
4.  Copy the **Username** (e.g., `user123456789`) and **Password**.

### 3. Setup Your Answer URL
Vobiz needs a public URL to fetch call instructions:
1.  Go to **Voice > Applications** in the Dashboard.
2.  Create a new Application.
3.  Set the **Answer URL** (e.g., `https://your-server.com/answer`).
4.  Link your **Phone Number** or **Endpoint** to this Application.

---

## 🛠️ Installation & Execution

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy the `.env.example` file and set your credentials:
```bash
cp .env.example .env
```
Edit `.env` and set `CALLER_ID` to the phone number you purchased from the Vobiz console.

### Step 3: Launch the Backend
The backend parses dialed numbers and provides the XML instructions.
```bash
npm start
```
*Runs on `http://localhost:3000`*

### Step 3: Expose to Internet (Local Dev)
If you are developing locally, use ngrok to provide Vobiz with a public endpoint:
```bash
ngrok http 3000
```
> [!IMPORTANT]
> Copy the generated `https://...` URL and paste it into the **Answer URL** field of your Vobiz Application in the dashboard.

### Step 4: Launch the Frontend
```bash
npm run client
```
*Runs on `http://localhost:8080`*

---

## � Project Structure

```text
vobiz-sdk-example/
├── server.js          # Node.js Backend (Answer URL Logic)
├── .env               # Environment Variables (Private)
├── .env.example       # Template for Environment Variables
├── package.json       # Scripts & Dependencies
├── client/            # Frontend Assets
│   ├── index.html     # Dialer UI
│   ├── app.js         # SDK Implementation Logic
│   └── style.css      # Modern UI Styling
└── README.md          # Documentation
```

---

## 🧪 Testing Your Integration

1.  Open `http://localhost:8080`.
2.  Enter your **Endpoint Username** and **Password** obtained in the setup step.
3.  Click **Connect & Register**. Wait for the status dot to turn green (**Registered**).
4.  Enter a phone number in E.164 format (e.g., `+1234567890`) and click **Call**.
5.  Check your `server.js` logs to see the incoming XML request from Vobiz.

---

## 🔗 Resources
- 📚 **Official SDK Docs**: [Vobiz Documentation](https://docs.vobiz.ai)
- 🌐 **Live Demo**: [rtc-demo.vobiz.ai](https://rtc-demo.vobiz.ai/)
- � **NPM Package**: [vobiz-webrtc-sdk](https://www.npmjs.com/package/vobiz-webrtc-sdk)

---

Developed with ❤️ by the **Vobiz Team**.
