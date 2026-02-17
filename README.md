# Vobiz WebRTC SDK Example Project

This project allows you to build a complete voice application using the **Vobiz WebRTC SDK**. It demonstrates how to:
1.  **Register** a browser endpoint (User Agent) with Vobiz.
2.  **Make Outbound Calls** from the browser to any phone number or SIP URI.
3.  **Receive Inbound Calls** in the browser.
4.  **Handle Dynamic Call Logic** using a Node.js backend.

---

## 🏗️ Architecture

This example consists of two parts:

### 1. Backend (`server.js`)
*   **Role**: Acts as the "Brain" of your Vobiz Application.
*   **Function**: When you make a call from the SDK, Vobiz asks this server "What should I do with this call?".
*   **Logic**: This server looks at the `To` parameter (the number you dialed) and returns an XML instruction (`<Dial>`) to connect you to that number.
*   **Technology**: Node.js (Standard `http` module).

### 2. Frontend (`client/`)
*   **Role**: The user interface for the phone.
*   **Function**: Handles Login, Dialing, Microphone access, and Audio playback.
*   **Technology**: HTML, CSS, Vanilla JavaScript, and `vobiz-webrtc-sdk`.

---

## 🚀 Prerequisites

Before you begin, ensure you have:
*   [Node.js](https://nodejs.org/) installed (v14 or higher).
*   A **Vobiz Account** with:
    *   An **Endpoint Username** & **Password** (for the frontend login).
    *   A **Verified Caller ID** number (used in `server.js`).
*   [ngrok](https://ngrok.com/) installed (to expose your local backend to Vobiz).

---

## 🛠️ Installation

1.  **Clone/Download** this repository.
2.  Open your terminal in the project folder.
3.  Install the dependencies:
    ```bash
    npm install
    ```

---

## 🏁 Running the Project

You need to run **three** separate processes in **three** separate terminal windows.

### Terminal 1: Backend Server
This runs the logic to handle the call.
```bash
npm start
```
*   Running on: `http://localhost:3000`

### Terminal 2: Expose Backend (ngrok)
This makes your local backend accessible to the internet so Vobiz can reach it.
```bash
ngrok http 3000
```
*   **Copy the HTTPS URL** (e.g., `https://a1b2-c3d4.ngrok-free.app`).
*   **Configure Vobiz**:
    1.  Log in to the Vobiz Dashboard.
    2.  Go to **Voice Applications**.
    3.  Create or Edit an existing application.
    4.  Set the **Answer URL** to your ngrok URL (e.g., `https://a1b2-c3d4.ngrok-free.app`).
    5.  **Save** the application.

### Terminal 3: Frontend Client
This runs the web interface.
```bash
npm run client
```
*   Running on: `http://localhost:8080`

---

## 📱 How to Use

1.  Open **[http://localhost:8080](http://localhost:8080)** in your browser.
2.  **Login**: Enter your Vobiz Endpoint Username and Password.
    *   *Status should change to "Registered".*
3.  **Make a Call**:
    *   Enter a phone number (e.g., `+919876543210`) or a SIP URI.
    *   Click **Call**.
    *   *Allow Microphone access if prompted.*
4.  **Receive a Call**:
    *   Call your Vobiz DID (Phone Number) mapped to this application/endpoint.
    *   You will see an "Incoming Call" alert. Click **Answer**.

---

## ❓ Troubleshooting

### Connection Issues ("Offline" or "Login Failed")
*   Check your internet connection.
*   Verify your Username and Password are correct.
*   Check the browser console (`F12`) for specific error messages (e.g., WebSocket connection failed).

### Call Failed / "Busy"
*   **Check ngrok**: Is `ngrok` running? Did the URL change? (It changes every time you restart ngrok unless you have a paid plan).
*   **Check Answer URL**: Did you paste the *new* ngrok URL into your Vobiz Dashboard?
*   **Check `server.js` logs**: When you make a call, do you see "Received request" in Terminal 1? If not, Vobiz isn't reaching your server.

### No Audio
*   Ensure the `<audio id="remoteAudio">` element exists in your HTML (it is hidden but essential).
*   Check if the browser muted the tab (Auto-play policy).

### "EADDRINUSE" Error
*   This means the port is busy. Stop any running node processes or use a different port.
    *   **Fix**: `npm run client -- -p 8081` currently runs on 8081.

---

## 📂 Project Structure

```text
vobiz-sdk-example/
├── server.js          # Backend logic (Dynamic Answer URL)
├── package.json       # Project configuration & scripts
├── README.md          # Documentation
└── client/            # Frontend code
    ├── index.html     # UI Structure
    ├── style.css      # Styling
    ├── app.js         # Vobiz SDK Implementation
    └── logo.png
```
