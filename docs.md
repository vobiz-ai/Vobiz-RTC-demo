# WebRTC Application Setup

This guide walks you through setting up a browser-based voice application using the Vobiz WebRTC SDK.

**Reference Respository**: [vobiz-ai/Vobiz-RTC-demo](https://github.com/vobiz-ai/Vobiz-RTC-demo)

---

## 1. Create a Voice Application
Your browser app needs a backend to tell Vobiz how to handle calls.

1.  Log in to the **[Vobiz Console](https://console.vobiz.ai)**.
2.  Navigate to **Voice > Applications**.
3.  Click **Create New Application**.
4.  Enter a Name (e.g., "WebRTC Demo").
5.  **Answer URL**: This is the most critical part. It points to your backend server that returns Vobiz XML.
    *   If running the demo server locally, this would be your public server URL.
    *   Example logic for the Answer URL:
    ```javascript
    // The server receives a request with a 'To' parameter
    // and returns XML to bridge the call.

    vobiz_xml = `
    <Response>
        <Dial callerId="${YOUR_VERIFIED_NUMBER}">
            <Number>${destination_number}</Number>
        </Dial>
    </Response>
    `;
    ```
6.  **Event URL** (Optional): URL to receive call status updates (ringing, answered, hung up).
7.  Click **Save**.

---

## 2. Attach a Phone Number
You must link a phone number to your application so it can receive calls.

1.  Stay on the **Application** page (or edit your application).
2.  Look for the **"Phone Numbers"** section or dropdown.
3.  Select a purchased phone number to link it to this application.
4.  Click **Save**.
    *   *Now, any call to this number will be handled by your Answer URL.*

---

## 3. Configure Your Endpoint (User Agent)
An Endpoint acts as the user (the "phone") in the browser.

1.  Go to **Voice > Endpoints**.
2.  Click **Create Endpoint**.
3.  **Username**: Create a unique username (e.g., `agent001`).
4.  **Password**: strict password.
5.  **Assign Application**: Select the "WebRTC Demo" application you created in Step 1.
    *   *This links your browser user to the specific backend logic.*
6.  Click **Create**.
7.  **Note down the Username and Password**. You will use these to login from the browser SDK.

---

## 4. Run the Client
You can either use our hosted demo or run the code locally.

### Option A: Use Live Demo (Quickest)
1.  Visit **[https://rtc-demo.vobiz.ai/](https://rtc-demo.vobiz.ai/)**.
2.  Enter the **Endpoint Username** and **Password** created in Step 3.
3.  Click **Connect**.

### Option B: Run Locally (For Developers)
Clone the reference repository and configure it with your credentials.

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/vobiz-ai/Vobiz-RTC-demo.git
    cd Vobiz-RTC-demo
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Start the Backend**:
    This server handles the Answer URL requests.
    ```bash
    npm start
    ```
    *   Ensure this server is accessible from the internet.
    *   Update your Vobiz Application's Answer URL to point to this server.

4.  **Start the Frontend**:
    ```bash
    npm run client
    ```
    *   Open `http://localhost:8080`.
    *   Enter credentials and connect.

---

## Key Concepts

### Answer URL Logic
The backend server (provided in the demo repo) listens for incoming call requests. Vobiz sends an HTTP request with parameters like `From`, `To`, and `CallSid`.

Your server MUST return valid XML.

**Example: Bridging a Call**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="+15550001234">
        <Number>+15559998888</Number>
    </Dial>
</Response>
```
*   `callerId`: Must be a number you own/verified on Vobiz.
*   `Number`: The destination number to connect to.
