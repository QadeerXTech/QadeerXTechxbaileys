<h1 align="center">
  <img alt="QadeerXTech Baileys logo" src="https://raw.githubusercontent.com/WhiskeySockets/Baileys/refs/heads/master/Media/logo.png" height="75"/>
</h1>

<div align="center">

# QadeerXTech Baileys — v7.0.0-rc16

**Fork of [@WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) — patched for WhatsApp November 2026 compatibility.**

Maintained by **QadeerXTech**

</div>

---

## What is QadeerXTech Baileys?

QadeerXTech Baileys is a patched fork of the Baileys WebSocket library for WhatsApp Web.  
It fixes all breaking issues introduced by WhatsApp's **November 2026** protocol update, so your bots and automations keep working without modification.

---

## ✅ Fixes in v7.0.0-rc16

### 1. `Platform.WEB` → `Platform.MACOS` (Critical)
**File:** `src/Utils/validate-connection.ts`

WhatsApp's November 2026 update began rejecting connections that identify as `Platform.WEB`. Non-Android companions now must use `Platform.MACOS`.

- `platform` field: `WEB` → `MACOS`
- `osVersion`: `'0.1'` → `'14.4.1'` (realistic macOS version)
- `device`: `'Desktop'` → `'Mac'`
- `osBuildNumber`: `'0.1'` → `'23E224'` (realistic macOS build)

---

### 2. Default Browser Changed to `androidPhone` (View-Once Fix)
**File:** `src/Defaults/index.ts`

Default browser changed from `Browsers.macOS('Chrome')` to `Browsers.androidPhone('Chrome')`.

WhatsApp only fanouts view-once messages to Android companions. Using `androidPhone` as default means view-once messages are received properly out of the box — no config needed.

---

### 3. New `Browsers.androidPhone` Added
**File:** `src/Utils/browser-utils.ts`  
**File:** `src/Types/index.ts`

Added a new `androidPhone` browser variant:
```ts
Browsers.androidPhone('Chrome') // → ['Chrome', 'Android', '15']
```
Registers as Android 15 companion. Use this explicitly if you override the browser config and still need view-once support.

---

### 4. `view_once_unavailable_fanout` Handled Gracefully
**File:** `src/Socket/messages-recv.ts`

Previously, `view_once_unavailable_fanout` messages were silently dropped with no event emitted. Now:
- A stub message is emitted with `messageStubParameters` containing `'view_once_unavailable'`
- Your app can display a "View once: unavailable" placeholder to the user
- Message is properly ACK'd to WhatsApp

---

### 5. `fetchLatestBaileysVersion` Now Uses Live WA Version
**File:** `src/Utils/generics.ts`

`fetchLatestBaileysVersion` previously fetched from GitHub (slow, often stale by days).  
Now delegates directly to `fetchLatestWaWebVersion`, which queries the live WhatsApp Web service worker (`sw.js`) for the real current version.

- Faster connection startup
- Always gets the actual current WA version
- Chrome user-agent updated to **136** to bypass WA anti-bot detection

---

### 6. Package Name Fixed for npm GitHub Install
**File:** `package.json`

Package name set to `@whiskeysockets/baileys` so existing bots that `require('@whiskeysockets/baileys')` work without changing any import statements.

---

## Install

### From GitHub (recommended)
```bash
npm install github:QadeerXTech/QadeerXTechxbaileys
```

No import changes needed — drop-in replacement for `@whiskeysockets/baileys`.

### In your `package.json`
```json
"qadeerxtechxbaileys": "github:QadeerXTech/QadeerXTechxbaileys"
```

---

## Quick Start

```ts
import makeWASocket, { Browsers, useMultiFileAuthState } from '@whiskeysockets/baileys'

const { state, saveCreds } = await useMultiFileAuthState('auth')

const sock = makeWASocket({
    auth: state,
    // androidPhone is the default — view-once works out of the box
    // override only if needed:
    // browser: Browsers.androidPhone('Chrome')
})

sock.ev.on('creds.update', saveCreds)
```

---

## Disclaimer

This project is not affiliated with, associated with, authorized by, or endorsed by WhatsApp or Meta.  
"WhatsApp" and related marks are registered trademarks of their respective owners.  
Use responsibly and in accordance with WhatsApp's Terms of Service.

---

<div align="center">

**QadeerXTech Baileys v7.0.0-rc16** — Maintained by QadeerXTech  
Based on [RedxBaileys](https://github.com/AbdulRehman19721986/RedxBaileys) by Abdul Rehman Rajpoot  
Based on [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)

</div>
