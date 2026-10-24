/* ========================================
   Vobiz SDK Console — Application Logic
   ======================================== */

let vobiz = null;
let isMuted = false;
let audioAttached = false;
let isInCall = false; // tracks whether a call is currently active

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
// Two ways in: endpoint username/password (SIP digest) or a short-lived access
// token (JWT) fetched from the demo backend. The SDK and event wiring are shared.
function createClient() {
    vobiz = new Vobiz({
        debug: 'ALL',
        permOnClick: true,
        enableTracking: true,
        closeProtection: false,
        maxAverageBitrate: 48000,
    });

    vobiz.client.on('onWebrtcNotSupported', () => {
        log('WebRTC is not supported in this browser', 'error');
        resetLoginUI();
    });

    vobiz.client.on('onLogin', () => {
        log('✅ Successfully registered with Vobiz!', 'success');
        setStatus('Registered', 'online');
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('tokenLoginBtn').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';
        resetLoginUI();
        showTokenInfo();
    });

    vobiz.client.on('onLoginFailed', (reason) => {
        // JWT failures arrive as numeric codes (10001-10010); translate them.
        const text = typeof reason === 'number'
            ? `${reason} ${vobiz.client.getErrorStringByErrorCodes(reason)}`
            : (reason || 'Unknown error');
        log(`❌ Login failed: ${text}`, 'error');
        setStatus('Login Failed', 'offline');
        resetLoginUI();
    });

    vobiz.client.on('onLogout', () => {
        log('Logged out from Vobiz', 'warning');
        setStatus('Disconnected', 'offline');
        document.getElementById('loginBtn').style.display = '';
        document.getElementById('tokenLoginBtn').style.display = '';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('tokenInfo').style.display = 'none';
        hideCallUI();
        hideIncomingBanner();
    });

    vobiz.client.on('onCallRemoteRinging', (callInfo) => {
        log(`📞 Ringing... (${callInfo?.callUUID || ''})`, 'event');
        setStatus('Ringing', 'in-call');
    });

    vobiz.client.on('onCallAnswered', (callInfo) => {
        if (audioAttached) return; // guard against duplicate event
        audioAttached = true;
        isInCall = true;
        log(`✅ Call answered! (${callInfo?.callUUID || ''})`, 'success');
        setStatus('In Call', 'in-call');
        hideIncomingBanner();
        hideCallWaitingBanner();
        showInCallUI();
        attachRemoteAudio();
    });

    vobiz.client.on('onCallTerminated', (callInfo) => {
        log(`📴 Call ended: ${callInfo?.reason || 'Terminated'}`, 'warning');
        setStatus('Registered', 'online');
        audioAttached = false;
        isInCall = false;
        hideCallUI();
        hideIncomingBanner();
        hideCallWaitingBanner();
    });

    vobiz.client.on('onCallFailed', (callInfo) => {
        log(`❌ Call failed: ${callInfo?.reason || 'Unknown'}`, 'error');
        setStatus('Registered', 'online');
        audioAttached = false;
        isInCall = false;
        hideCallUI();
        hideIncomingBanner();
        hideCallWaitingBanner();
    });

    vobiz.client.on('onIncomingCall', (callerName, extraHeaders) => {
        log(`📲 Incoming call from: ${callerName}`, 'event');
        if (isInCall) {
            // Already in a call — show call waiting notification instead
            setStatus('Call Waiting', 'in-call');
            showCallWaitingBanner(callerName);
        } else {
            setStatus('Incoming Call', 'in-call');
            showIncomingBanner(callerName);
        }
    });

    vobiz.client.on('onIncomingCallCanceled', () => {
        log('📴 Incoming call cancelled by caller', 'warning');
        if (isInCall) {
            setStatus('In Call', 'in-call');
            hideCallWaitingBanner();
        } else {
            setStatus('Registered', 'online');
            hideIncomingBanner();
        }
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
}

function setAuthMode(mode) {
    document.getElementById('passwordAuth').style.display = mode === 'password' ? '' : 'none';
    document.getElementById('tokenAuth').style.display = mode === 'token' ? '' : 'none';
    document.querySelectorAll('.auth-tab').forEach((el) => el.classList.toggle('active', el.dataset.mode === mode));
}

function showLoader(btnId) {
    const btn = document.getElementById(btnId);
    btn.querySelector('.btn-text').style.display = 'none';
    btn.querySelector('.btn-loader').style.display = 'inline-block';
    btn.disabled = true;
}

// --- Password login (SIP digest) ---
function doLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        log('Please enter both username and password', 'error');
        return;
    }

    showLoader('loginBtn');
    setStatus('Connecting...', 'connecting');
    log(`Connecting as ${username}...`, 'event');

    try {
        createClient();
        vobiz.client.login(username, password);
    } catch (err) {
        log(`Error initializing SDK: ${err.message}`, 'error');
        resetLoginUI();
        setStatus('Error', 'offline');
    }
}

// --- Access-token login (JWT) ---
let lastToken = null;

function decodeJwt(token) {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(b64));
    } catch (e) {
        return null;
    }
}

// Empty field: the page is served by the demo backend, so /token is on this origin.
async function fetchAccessToken() {
    const base = (document.getElementById('tokenServer').value.trim() || location.origin).replace(/\/$/, '');
    const res = await fetch(`${base}/token`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok || !body.token) throw new Error(body.error || `token server returned ${res.status}`);
    lastToken = body;
    const claims = decodeJwt(body.token) || {};
    const grants = claims.per?.voice || {};
    log(`🔑 Token received (${body.mode}) for ${body.sip_username}; expires ${new Date(claims.exp * 1000).toLocaleTimeString()}; in=${grants.incoming_allow} out=${grants.outgoing_allow}`, 'event');
    return body.token;
}

function doTokenLogin() {
    showLoader('tokenLoginBtn');
    setStatus('Fetching token...', 'connecting');
    log('Requesting access token from backend...', 'event');

    try {
        createClient();
        // The SDK calls getAccessToken() again ~60 s before the token expires and
        // re-registers with the fresh token, so the session never lapses.
        vobiz.client.loginWithAccessTokenGenerator({ getAccessToken: fetchAccessToken });
    } catch (err) {
        log(`Error initializing SDK: ${err.message}`, 'error');
        resetLoginUI();
        setStatus('Error', 'offline');
    }
}

function showTokenInfo() {
    const box = document.getElementById('tokenInfo');
    if (!lastToken) { box.style.display = 'none'; return; }
    const claims = decodeJwt(lastToken.token) || {};
    document.getElementById('tokenIdentity').textContent = lastToken.sip_username;
    document.getElementById('tokenExpiry').textContent = new Date(claims.exp * 1000).toLocaleTimeString();
    box.style.display = '';
}

function resetLoginUI() {
    ['loginBtn', 'tokenLoginBtn'].forEach((id) => {
        const btn = document.getElementById(id);
        btn.querySelector('.btn-text').style.display = 'inline';
        btn.querySelector('.btn-loader').style.display = 'none';
        btn.disabled = false;
    });
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
        hideIncomingBanner();
        hideCallWaitingBanner();
        showInCallUI();
    }
}

function doReject() {
    if (vobiz) {
        vobiz.client.reject();
        log('Call rejected', 'warning');
        hideIncomingBanner();
        hideCallWaitingBanner();
        if (!isInCall) setStatus('Registered', 'online');
    }
}

// Switch to waiting call: hang up current, answer the new one
function doSwitchCall() {
    if (vobiz) {
        log('Switching to waiting call...', 'event');
        vobiz.client.hangup();
        // Small delay to let hangup complete before answering
        setTimeout(() => {
            vobiz.client.answer();
            log('Answering waiting call...', 'success');
            hideCallWaitingBanner();
            showInCallUI();
        }, 500);
    }
}

function doHangup() {
    if (vobiz) {
        vobiz.client.hangup();
        log('Hanging up...', 'info');
    }
}

// ===== Remote Audio =====
function attachRemoteAudio() {
    setTimeout(() => {
        const remoteAudio = document.getElementById('remoteAudio');
        let stream = null;

        // Try getting stream from the SDK's remote view
        if (vobiz && vobiz.client && vobiz.client.remoteView) {
            stream = vobiz.client.remoteView.srcObject;
        }

        // Fallback: check peer connection receivers
        if (!stream && vobiz && vobiz.client) {
            try {
                const pc = vobiz.client.getPeerConnection().pc;
                if (pc) {
                    const receivers = pc.getReceivers();
                    const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
                    if (audioReceiver && audioReceiver.track) {
                        stream = new MediaStream([audioReceiver.track]);
                        log('🔊 Found audio track from PC receivers', 'info');
                    }
                }
            } catch (e) {
                log('Could not get peer connection: ' + e.message, 'warning');
            }
        }

        if (stream && remoteAudio) {
            remoteAudio.srcObject = stream;
            remoteAudio.play().catch(e => log('Error playing audio: ' + e.message, 'error'));
            log('🔊 Remote audio stream attached', 'info');
        } else {
            log('⚠️ Could not find remote stream to attach', 'warning');
        }
    }, 1500);
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

// ===== Call Waiting Banner =====
function showCallWaitingBanner(callerName) {
    const banner = document.getElementById('callWaitingBanner');
    document.getElementById('waitingCaller').textContent = callerName || 'Unknown';
    banner.style.display = 'flex';
}

function hideCallWaitingBanner() {
    document.getElementById('callWaitingBanner').style.display = 'none';
}

// ===== Incoming Banner =====
function showIncomingBanner(callerName) {
    const banner = document.getElementById('incomingBanner');
    const callerEl = document.getElementById('incomingCaller');
    callerEl.textContent = callerName || 'Unknown';
    banner.style.display = 'flex';
    document.getElementById('dialerDesc').textContent = 'Incoming call...';
}

function hideIncomingBanner() {
    document.getElementById('incomingBanner').style.display = 'none';
    document.getElementById('dialerDesc').textContent = 'Make outbound calls';
}

// ===== UI Helpers =====
function showInCallUI() {
    document.getElementById('callBtn').style.display = 'none';
    document.getElementById('hangupBtn').style.display = 'flex';
    document.getElementById('mediaControls').style.display = 'flex';
}

function hideCallUI() {
    if (document.getElementById('callBtn')) document.getElementById('callBtn').style.display = 'flex';
    if (document.getElementById('hangupBtn')) document.getElementById('hangupBtn').style.display = 'none';
    if (document.getElementById('mediaControls')) document.getElementById('mediaControls').style.display = 'none';

    isMuted = false;
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.classList.remove('active');
        const span = muteBtn.querySelector('span');
        if (span) span.textContent = 'Mute';
    }
}

// ===== Init =====
log('Vobiz Browser SDK Console loaded', 'info');
log('Choose Password (endpoint credentials) or Access token (JWT from your backend), then connect', 'info');

// ===== Fraud guard: live feed from vobiz-call-guard (GET /events, Server-Sent Events) =====
let guardSource = null;
const GUARD_LABELS = {
    otp_request: 'OTP request', bank_impersonation: 'Bank impersonation', urgency_payment: 'Urgency / payment pressure',
    account_impersonation: 'Account impersonation', vishing: 'Vishing', coercion_manipulation: 'Coercion',
    bargaining_manipulation: 'Bargaining manipulation', feigned_ignorance: 'Feigned ignorance',
};
const guardLabel = (c) => GUARD_LABELS[c] || c.replace(/_/g, ' ');

function guardEntry(msg, type = 'info') {
    const list = document.getElementById('guardList');
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${time}</span>${msg}`;
    list.appendChild(entry);
    list.scrollTop = list.scrollHeight;
}

function setGuardBadge(text, cls) {
    const b = document.getElementById('guardBadge');
    b.textContent = text; b.className = `guard-badge ${cls}`;
}

function resetGuardCall() {
    document.getElementById('guardChips').innerHTML = '';
    const df = document.getElementById('guardDeepfake');
    df.textContent = 'Voice: no verdict yet'; df.className = 'guard-chip muted';
}

function addGuardChip(category) {
    const chips = document.getElementById('guardChips');
    if ([...chips.children].some((c) => c.dataset.cat === category)) return;
    const chip = document.createElement('span');
    chip.className = 'guard-chip'; chip.dataset.cat = category; chip.textContent = guardLabel(category);
    chips.appendChild(chip);
}

function handleGuardEvent(ev) {
    const esc = (t) => String(t ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    switch (ev.type) {
        case 'stream_started':
            resetGuardCall();
            setGuardBadge('Monitoring call', 'live');
            guardEntry(`🎧 Guard attached — protecting <b>${esc(ev.protect_leg)}</b>, screening the <b>${esc(ev.suspect_track)}</b> voice`, 'event');
            break;
        case 'transcript':
            guardEntry(`“${esc(ev.text)}”`, 'transcript');
            break;
        case 'synthetic_voice': {
            const df = document.getElementById('guardDeepfake');
            df.textContent = `Voice: SYNTHETIC (${Math.round(ev.deepfake_score * 100)}% of speech, conf ${Number(ev.confidence).toFixed(2)})`;
            df.className = 'guard-chip synthetic';
            guardEntry(`🤖 Synthetic voice detected after ${(ev.speech_ms / 1000).toFixed(1)}s of speech (confidence ${Number(ev.confidence).toFixed(2)})`, 'warning');
            break;
        }
        case 'scam_intent':
            addGuardChip(ev.category);
            guardEntry(`🚩 <b>${esc(guardLabel(ev.category))}</b> <span class="log-time">via ${esc(ev.source)}, ${Math.round(ev.confidence * 100)}%</span><br>${esc(ev.evidence)}`, 'warning');
            break;
        case 'fraud_detection_result':
            if (ev.action_taken === 'warned') {
                setGuardBadge('⚠ SCAM — WARNING PLAYED', 'alert');
                guardEntry(`🔊 Safety warning spoken into the <b>${esc(ev.protect_leg)}</b> at ${(ev.t_offset_ms / 1000).toFixed(1)}s. Risk ${ev.risk}. Categories: ${ev.categories.map(guardLabel).map(esc).join(', ')}`, 'alert');
            } else if (ev.action_taken === 'notified') {
                guardEntry(`ℹ️ Synthetic voice only — notified, no warning (risk ${ev.risk})`, 'warning');
            } else {
                guardEntry(`Result: ${esc(ev.action_taken)} (risk ${ev.risk})`, 'warning');
            }
            break;
        case 'risk_update':
            break; // chips already cover it
        case 'hung_up':
            guardEntry('⛔ Guard hung up the call (block mode)', 'alert');
            break;
        case 'vendor_error':
            guardEntry(`Vendor error (${esc(ev.vendor)}): ${esc(ev.error)}`, 'error');
            break;
        case 'stream_ended': {
            const df = document.getElementById('guardDeepfake');
            if (df.classList.contains('muted')) { df.textContent = ev.deepfake_flagged ? 'Voice: synthetic' : 'Voice: real (no synthetic verdict)'; df.className = `guard-chip ${ev.deepfake_flagged ? 'synthetic' : 'real'}`; }
            else if (!ev.deepfake_flagged) { df.textContent = 'Voice: real'; df.className = 'guard-chip real'; }
            setGuardBadge(ev.warned ? 'Call ended — scam warned' : (ev.categories.length ? 'Call ended — intent seen' : 'Call ended — clean'), ev.warned ? 'alert' : 'done');
            guardEntry(`📴 Call ended after ${(ev.duration_ms / 1000).toFixed(0)}s — ${ev.categories.length ? ev.categories.map(guardLabel).map(esc).join(', ') : 'no scam intent'}; voice ${ev.deepfake_flagged ? 'synthetic' : 'real'}`, ev.warned ? 'alert' : 'success');
            break;
        }
        default:
            break;
    }
}

function connectGuard() {
    const input = document.getElementById('guardUrl');
    const url = (input.value.trim() || input.placeholder).replace(/\/$/, '');
    try { localStorage.setItem('guardEventsUrl', url); } catch {}
    if (guardSource) { guardSource.close(); guardSource = null; }
    setGuardBadge('Connecting…', 'idle');
    guardSource = new EventSource(url);
    guardSource.onopen = () => { setGuardBadge('Connected — idle', 'live'); guardEntry(`Connected to guard at ${url}`, 'success'); };
    guardSource.onmessage = (m) => { try { handleGuardEvent(JSON.parse(m.data)); } catch (e) { console.warn('guard event parse', e); } };
    guardSource.onerror = () => { setGuardBadge('Disconnected — retrying', 'idle'); };
}

function clearGuard() {
    document.getElementById('guardList').innerHTML = '';
    resetGuardCall();
    guardEntry('Cleared');
}

(function initGuard() {
    const input = document.getElementById('guardUrl');
    if (!input) return;
    let saved = '';
    try { saved = localStorage.getItem('guardEventsUrl') || ''; } catch {}
    input.value = saved;
    connectGuard();
})();
