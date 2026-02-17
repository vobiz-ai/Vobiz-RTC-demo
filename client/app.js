/* ========================================
   Vobiz SDK Console — Application Logic
   ======================================== */

let vobiz = null;
let isMuted = false;

// ===== Logging =====
function log(msg, type = 'info') {
    const container = document.getElementById('logContainer');
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${time}</span>${msg}`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}

function clearLog() {
    document.getElementById('logContainer').innerHTML = '';
    log('Log cleared');
}

// ===== Status =====
function setStatus(text, statusClass) {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.querySelector('.status-dot').className = `status-dot ${statusClass}`;
    statusEl.querySelector('.status-text').textContent = text;
}

// ===== Login =====
function doLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        log('Please enter both username and password', 'error');
        return;
    }

    // Show loader
    const btn = document.getElementById('loginBtn');
    btn.querySelector('.btn-text').style.display = 'none';
    btn.querySelector('.btn-loader').style.display = 'inline-block';
    btn.disabled = true;

    setStatus('Connecting...', 'connecting');
    log(`Connecting as ${username}...`, 'event');

    try {
        // Initialize the Vobiz SDK
        vobiz = new Vobiz({
            debug: 'ALL',
            permOnClick: true,
            enableTracking: true,
            closeProtection: false,
            maxAverageBitrate: 48000,
        });

        // Register event handlers
        vobiz.client.on('onWebrtcNotSupported', () => {
            log('WebRTC is not supported in this browser', 'error');
            resetLoginUI();
        });

        vobiz.client.on('onLogin', () => {
            log('✅ Successfully registered with Vobiz!', 'success');
            setStatus('Registered', 'online');
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('logoutBtn').style.display = 'block';
            resetLoginUI();
        });

        vobiz.client.on('onLoginFailed', (reason) => {
            log(`❌ Login failed: ${reason || 'Unknown error'}`, 'error');
            setStatus('Login Failed', 'offline');
            resetLoginUI();
        });

        vobiz.client.on('onLogout', () => {
            log('Logged out from Vobiz', 'warning');
            setStatus('Disconnected', 'offline');
            document.getElementById('loginBtn').style.display = 'block';
            document.getElementById('logoutBtn').style.display = 'none';
            hideCallUI();
        });

        vobiz.client.on('onCallRemoteRinging', (callInfo) => {
            log(`📞 Ringing... (${callInfo?.callUUID || ''})`, 'event');
            setStatus('Ringing', 'in-call');
        });

        vobiz.client.on('onCallAnswered', (callInfo) => {
            log(`✅ Call answered! (${callInfo?.callUUID || ''})`, 'success');
            setStatus('In Call', 'in-call');
            showInCallUI();

            // Workaround: Manually attach remote stream
            setTimeout(() => {
                const remoteAudio = document.getElementById('remoteAudio');

                // Try getting stream from the SDK's remote view
                let stream = null;
                if (vobiz && vobiz.client && vobiz.client.remoteView) {
                    stream = vobiz.client.remoteView.srcObject;
                }

                // Fallback: check peer connection receivers
                if (!stream && vobiz && vobiz.client) {
                    const pc = vobiz.client.getPeerConnection().pc;
                    if (pc) {
                        const receivers = pc.getReceivers();
                        const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
                        if (audioReceiver && audioReceiver.track) {
                            stream = new MediaStream([audioReceiver.track]);
                            log('🔊 Found audio track from PC receivers', 'info');
                        }
                    }
                }

                if (stream && remoteAudio) {
                    remoteAudio.srcObject = stream;
                    remoteAudio.play().catch(e => log('Error playing audio: ' + e.message, 'error'));
                    log('🔊 SDK has remote stream, attaching to backup audio element...', 'info');
                } else {
                    log('⚠️ Could not find remote stream to attach', 'warning');
                }
            }, 1500);
        });

        vobiz.client.on('onCallTerminated', (callInfo) => {
            log(`📴 Call ended: ${callInfo?.reason || 'Terminated'}`, 'warning');
            setStatus('Registered', 'online');
            hideCallUI();
        });

        vobiz.client.on('onCallFailed', (callInfo) => {
            log(`❌ Call failed: ${callInfo?.reason || 'Unknown'}`, 'error');
            setStatus('Registered', 'online');
            hideCallUI();
        });

        vobiz.client.on('onIncomingCall', (callerName, extraHeaders) => {
            log(`📲 Incoming call from: ${callerName}`, 'event');
            setStatus('Incoming Call', 'in-call');
            showIncomingUI(callerName);
        });

        vobiz.client.on('onIncomingCallCanceled', () => {
            log('📴 Incoming call cancelled by caller', 'warning');
            setStatus('Registered', 'online');
            hideIncomingUI();
        });

        vobiz.client.on('onMediaPermission', (granted) => {
            if (granted) {
                log('🎤 Microphone permission granted', 'success');
            } else {
                log('🎤 Microphone permission denied', 'error');
            }
        });

        vobiz.client.on('onConnectionChange', (event) => {
            log(`🔌 Connection change: ${JSON.stringify(event)}`, 'event');
        });

        // Perform login
        vobiz.client.login(username, password);

    } catch (err) {
        log(`Error initializing SDK: ${err.message}`, 'error');
        resetLoginUI();
        setStatus('Error', 'offline');
    }
}

function resetLoginUI() {
    const btn = document.getElementById('loginBtn');
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loader').style.display = 'none';
    btn.disabled = false;
}

function doLogout() {
    if (vobiz) {
        vobiz.client.logout();
        log('Logging out...', 'info');
    }
}

// ===== Calling =====
function doCall() {
    const dest = document.getElementById('destination').value.trim();
    if (!dest) {
        log('Please enter a destination number or SIP URI', 'error');
        return;
    }
    if (!vobiz) {
        log('You must login first', 'error');
        return;
    }

    log(`📞 Calling ${dest}...`, 'event');
    setStatus('Calling...', 'in-call');

    const extraHeaders = {};
    vobiz.client.call(dest, extraHeaders);

    document.getElementById('callBtn').style.display = 'none';
    document.getElementById('hangupBtn').style.display = 'flex';
}

function doAnswer() {
    if (vobiz) {
        vobiz.client.answer();
        log('Answering call...', 'success');
        hideIncomingUI();
        showInCallUI();
    }
}

function doReject() {
    if (vobiz) {
        vobiz.client.reject();
        log('Call rejected', 'warning');
        hideIncomingUI();
    }
}

function doHangup() {
    if (vobiz) {
        vobiz.client.hangup();
        log('Hanging up...', 'info');
    }
}

// ===== DTMF =====
function pressKey(key) {
    const dest = document.getElementById('destination');
    dest.value += key;

    // Send DTMF if in call
    if (vobiz && vobiz.client.callSession) {
        vobiz.client.sendDtmf(key);
        log(`🔢 DTMF: ${key}`, 'info');
    }
}

// ===== Mute =====
function toggleMute() {
    if (!vobiz) return;

    const btn = document.getElementById('muteBtn');
    if (isMuted) {
        vobiz.client.unmute();
        btn.classList.remove('active');
        btn.querySelector('span').textContent = 'Mute';
        log('🔊 Unmuted', 'info');
    } else {
        vobiz.client.mute();
        btn.classList.add('active');
        btn.querySelector('span').textContent = 'Unmute';
        log('🔇 Muted', 'warning');
    }
    isMuted = !isMuted;
}

// ===== UI Helpers =====
function showInCallUI() {
    document.getElementById('callBtn').style.display = 'none';
    document.getElementById('answerBtn').style.display = 'none';
    document.getElementById('hangupBtn').style.display = 'flex';
    document.getElementById('mediaControls').style.display = 'flex';
}

function hideCallUI() {
    if (document.getElementById('callBtn')) document.getElementById('callBtn').style.display = 'flex';
    if (document.getElementById('answerBtn')) document.getElementById('answerBtn').style.display = 'none';
    if (document.getElementById('hangupBtn')) document.getElementById('hangupBtn').style.display = 'none';
    if (document.getElementById('rejectBtn')) document.getElementById('rejectBtn').style.display = 'none';
    if (document.getElementById('mediaControls')) document.getElementById('mediaControls').style.display = 'none';

    isMuted = false;
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.classList.remove('active');
        const span = muteBtn.querySelector('span');
        if (span) span.textContent = 'Mute';
    }
}

function showIncomingUI(callerName) {
    document.getElementById('answerBtn').style.display = 'flex';
    document.getElementById('rejectBtn').style.display = 'flex';
    document.getElementById('callBtn').style.display = 'none';
}

function hideIncomingUI() {
    document.getElementById('answerBtn').style.display = 'none';
    document.getElementById('rejectBtn').style.display = 'none';
    document.getElementById('callBtn').style.display = 'flex';
}

// ===== Init =====
log('Vobiz Browser SDK Console loaded', 'info');
log('Enter your endpoint credentials and click "Connect & Register"', 'info');
