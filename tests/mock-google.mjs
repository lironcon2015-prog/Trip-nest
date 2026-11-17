// In-memory stand-ins for what the server and the app talk to: the Apps Script
// bridges (Drive + Gmail of one account each, sharing one Drive folder) and the
// Gemini API. Used by tests/server.mjs and tests/sync.mjs.
import { Buffer } from 'node:buffer';

export const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
export const unb64 = (s) => Buffer.from(s, 'base64').toString('utf-8');

// the shared Drive folder both accounts can open
export function createDrive() {
  return { folders: { 'folder-shared-0001': { name: 'TripNest — Navigo', parent: null } }, files: {}, next: 1 };
}

export function createBridge({ url, token, email, drive, messages = {} }) {
  const S = { url, token, email, drive, messages, calls: [], down: false, forwardTo: null };
  const nid = (p) => `${p}-${String(drive.next++).padStart(8, '0')}`;
  const named = (folderId, name) => Object.entries(drive.files).find(([, f]) => f.parent === folderId && f.name === name);

  function act(req) {
    if (req.token !== token) return { ok: false, error: 'bad token' };
    switch (req.action) {
      case 'ping': return { ok: true, email, version: '1.5.0' };
      case 'findShared': return { ok: true, folderId: 'folder-shared-0001', folderName: drive.folders['folder-shared-0001'].name };
      case 'dbGet': { const f = named(req.folderId, 'tripnest-db.json'); return { ok: true, db: f ? JSON.parse(unb64(f[1].data)) : null }; }
      case 'dbPut': {
        const f = named(req.folderId, 'tripnest-db.json');
        const rec = f ? f[1] : (drive.files[nid('file')] = { name: 'tripnest-db.json', parent: req.folderId, mimeType: 'application/json' });
        rec.data = b64(JSON.stringify(req.db));
        return { ok: true };
      }
      case 'fileGet': { const f = named(req.folderId, req.name); return { ok: true, content: f ? JSON.parse(unb64(f[1].data)) : null }; }
      case 'filePut': {
        if (!req.name) return { ok: false, error: 'filePut: missing name' };
        if (req.name === 'tripnest-db.json') return { ok: false, error: 'filePut: use dbPut' };
        const f = named(req.folderId, req.name);
        const rec = f ? f[1] : (drive.files[nid('file')] = { name: req.name, parent: req.folderId, mimeType: 'application/json' });
        rec.data = b64(JSON.stringify(req.content));
        return { ok: true };
      }
      case 'upload': {
        if (!drive.folders[req.folderId]) return { ok: false, error: 'folder not found' };
        const marker = 'tripnest-trip:' + req.tripId;
        let sub = Object.entries(drive.folders).find(([, f]) => f.parent === req.folderId && f.marker === marker);
        if (!sub) { const id = nid('folder'); drive.folders[id] = { name: req.tripName, parent: req.folderId, marker }; sub = [id]; }
        const id = nid('file');
        drive.files[id] = { name: req.fileName, mimeType: req.mimeType, data: req.data, parent: sub[0], by: email };
        return { ok: true, fileId: id };
      }
      case 'download': {
        const f = drive.files[req.fileId];
        if (!f) return { ok: false, error: 'file not found' };
        return { ok: true, fileName: f.name, mimeType: f.mimeType, data: f.data };
      }
      case 'gmailSearch': {
        const wanted = req.label ? String(req.label).toLowerCase() : null;
        const out = Object.entries(messages)
          .filter(([, m]) => (wanted ? (m.labels || []).some((l) => l.toLowerCase().includes(wanted)) : !m.labelOnly))
          .map(([id, m]) => ({ id, from: m.from, subject: m.subject, date: m.date, snippet: m.text.slice(0, 140), attachments: m.attachments.length }));
        return { ok: true, messages: out };
      }
      case 'gmailGet': {
        const m = messages[req.id];
        if (!m) return { ok: false, error: 'message not found' };
        return { ok: true, text: m.text, html: m.html, attachments: m.attachments.map((a, i) => ({ attachmentId: i, filename: a.filename, mimeType: a.mimeType, size: a.bytes.length })) };
      }
      case 'gmailAttachment': {
        const a = messages[req.id] && messages[req.id].attachments[req.index];
        if (!a) return { ok: false, error: 'attachment not found' };
        return { ok: true, filename: a.filename, mimeType: a.mimeType, data: b64(a.bytes) };
      }
      default: return { ok: false, error: 'unknown action: ' + req.action };
    }
  }

  // body text in → response text out, like a deployed web app (always HTTP 200)
  async function handle(text) {
    if (S.down) throw new TypeError('fetch failed');
    let req;
    try { req = JSON.parse(text); } catch { return JSON.stringify({ ok: false, error: 'bad request body' }); }
    S.calls.push(req);
    // v1.5.0: the way around a network that blocks the server
    if (req.forward != null) {
      if (!S.forwardTo) return JSON.stringify({ ok: false, error: 'bad token' }); // an older bridge
      return S.forwardTo(String(req.forward));
    }
    return JSON.stringify(act(req));
  }
  return { S, handle };
}

// Gemini: per-key / per-model scripted answers, and a call log
export function createGemini() {
  const G = { behavior: {}, byKey: {}, calls: [] };
  async function handle(url, headers, bodyText) {
    const model = String(url).match(/models\/([^:]+):generateContent/)[1];
    const key = headers['x-goog-api-key'];
    G.calls.push({ model, key, url: String(url), body: bodyText });
    const b = G.byKey[key] || G.behavior[model] || { status: 200 };
    if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
    if (b.status === 200) {
      return { status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: b.reply || `ok:${model}:${key}` }] } }] }) };
    }
    if (b.nonJson) return { status: b.status, text: '<html>busy</html>' };
    return { status: b.status, text: JSON.stringify({ error: { code: b.status, message: b.message || 'err', status: b.apiStatus || '' } }) };
  }
  return { G, handle };
}
