#!/usr/bin/env node
// Create (or update) the Vobiz XML Application this demo needs, pointing its Answer and
// Hangup URLs at PUBLIC_URL, and save its id to .env as JWT_APP_ID.
//
//   npm run setup                       uses PUBLIC_URL from .env
//   npm run setup -- https://x.ngrok.app
//
// Safe to re-run whenever your tunnel URL changes: the app is found by name and updated.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');
const APP_NAME = process.env.VOBIZ_APP_NAME || 'Vobiz WebRTC Demo';

function setEnv(key, value) {
    let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    const line = `${key}=${value}`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
    fs.writeFileSync(ENV_FILE, text);
}

async function main() {
    const authId = process.env.VOBIZ_AUTH_ID;
    const authToken = process.env.VOBIZ_AUTH_TOKEN;
    const publicUrl = (process.argv[2] || process.env.PUBLIC_URL || '').replace(/\/$/, '');
    if (!authId || !authToken) throw new Error('Set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN in .env first.');
    if (!/^https:\/\//.test(publicUrl)) throw new Error('Pass your public https URL, or set PUBLIC_URL in .env (e.g. from "ngrok http 3000").');

    const base = `${(process.env.VOBIZ_API_BASE || 'https://api.vobiz.ai/api/v1').replace(/\/$/, '')}/Account/${authId}/Application/`;
    const headers = { 'Content-Type': 'application/json', 'X-Auth-ID': authId, 'X-Auth-Token': authToken };
    const api = async (url, init) => {
        const r = await fetch(url, { headers, ...init });
        const text = await r.text();
        if (!r.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${r.status}: ${text.slice(0, 200)}`);
        return text ? JSON.parse(text) : {};
    };

    const config = {
        app_name: APP_NAME,
        answer_url: `${publicUrl}/answer`,
        answer_method: 'POST',
        hangup_url: `${publicUrl}/hangup`,
        hangup_method: 'POST',
    };

    // The list is paginated (20 per page), so walk it until the app turns up.
    let existing;
    for (let offset = 0; !existing; offset += 20) {
        const page = await api(`${base}?limit=20&offset=${offset}`);
        const apps = page.objects || [];
        existing = apps.find((a) => a.app_name === APP_NAME);
        if (!page.meta?.next || !apps.length) break;
    }

    let appId;
    if (existing) {
        appId = existing.app_id;
        await api(`${base}${appId}/`, { method: 'POST', body: JSON.stringify(config) });
        console.log(`Updated application "${APP_NAME}" (${appId})`);
    } else {
        const created = await api(base, { method: 'POST', body: JSON.stringify(config) });
        appId = created.app_id;
        if (!appId) throw new Error(`Create returned no app_id: ${JSON.stringify(created).slice(0, 200)}`);
        console.log(`Created application "${APP_NAME}" (${appId})`);
    }

    const got = await api(`${base}${appId}/`);
    const app = got.data || got;
    console.log(`  answer_url  ${app.answer_url} (${app.answer_method})`);
    console.log(`  hangup_url  ${app.hangup_url} (${app.hangup_method})`);

    setEnv('PUBLIC_URL', publicUrl);
    setEnv('JWT_APP_ID', appId);
    console.log(`\nSaved PUBLIC_URL and JWT_APP_ID=${appId} to .env. Restart "npm start" so new tokens carry this app.`);
    console.log('For inbound calls, assign your Vobiz number to this application in the console (Voice > Numbers).');
}

main().catch((err) => { console.error(`setup failed: ${err.message}`); process.exit(1); });
