// Google Drive: Anmeldung (Google Identity Services) und Dateizugriff.
// Scope drive.file: Die App sieht NUR die Dateien, die sie selbst angelegt hat.
import { CONFIG } from '../config.js';
import { loadScript, ls } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const K = {
  token: 'fv.gtoken', folder: 'fv.gfolder', file: 'fv.gfile', email: 'fv.gemail',
  connected: 'fv.gconnected', backup: 'fv.gbackup', clientId: 'fv.clientId',
};

export class AuthError extends Error {}

export const clientId = () => ls.get(K.clientId) || CONFIG.googleClientId || '';
export const setClientId = (v) => (v ? ls.set(K.clientId, v.trim()) : ls.del(K.clientId));
export const isConfigured = () => !!clientId();
export const wasConnected = () => ls.get(K.connected) === '1';
export const email = () => ls.get(K.email) || '';
export const folderLink = () => (ls.get(K.folder) ? `https://drive.google.com/drive/folders/${ls.get(K.folder)}` : null);

const tokenObj = () => ls.json(K.token, null);
export const hasToken = () => { const t = tokenObj(); return !!t && t.exp > Date.now(); };

export function preload() {
  if (isConfigured() && navigator.onLine) loadScript(GIS).catch(() => {});
}

export async function connect() {
  if (!isConfigured()) throw new Error('Google-Client-ID fehlt (Einstellungen → Synchronisierung).');
  await loadScript(GIS);
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      login_hint: email() || undefined,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new Error('Zugriff auf Google Drive wurde nicht erlaubt.'));
        ls.setJSON(K.token, { access_token: r.access_token, exp: Date.now() + (Number(r.expires_in || 3600) - 120) * 1000 });
        ls.set(K.connected, '1');
        resolve();
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Anmeldefenster geschlossen.' : e?.type === 'popup_failed_to_open' ? 'Pop-up wurde blockiert – bitte Pop-ups für diese Seite erlauben.' : (e?.message || 'Anmeldung fehlgeschlagen.'))),
    });
    client.requestAccessToken({ prompt: wasConnected() ? '' : 'consent' });
  });
}

export function disconnect() {
  const t = tokenObj()?.access_token;
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  Object.values(K).filter((k) => k !== K.clientId).forEach((k) => ls.del(k));
}

async function api(url, opts = {}) {
  const t = tokenObj();
  if (!t || t.exp <= Date.now()) throw new AuthError('Anmeldung abgelaufen');
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + t.access_token, ...(opts.headers || {}) },
  });
  if (r.status === 401) { ls.del(K.token); throw new AuthError('Anmeldung abgelaufen'); }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const e = new Error(`Google Drive meldet Fehler ${r.status}${txt ? ': ' + txt.slice(0, 160) : ''}`);
    e.status = r.status;
    throw e;
  }
  return r;
}
const q = (s) => encodeURIComponent(s);
const json = { 'Content-Type': 'application/json; charset=UTF-8' };

async function findOne(query) {
  const r = await api(`files?q=${q(query)}&spaces=drive&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`);
  return (await r.json()).files?.[0] || null;
}
async function createFolder(name, parent) {
  const r = await api('files?fields=id', { method: 'POST', headers: json, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }) });
  return (await r.json()).id;
}
async function alive(id) {
  try {
    const r = await api(`files/${id}?fields=id,trashed,modifiedTime`);
    const j = await r.json();
    return j.trashed ? null : j;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return null;
  }
}

export async function ensureFolder() {
  const known = ls.get(K.folder);
  if (known && (await alive(known))) return known;
  const f = await findOne(`name='${CONFIG.driveFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const id = f ? f.id : await createFolder(CONFIG.driveFolderName);
  ls.set(K.folder, id);
  return id;
}

export async function findDataFile(folderId) {
  const known = ls.get(K.file);
  if (known) { const j = await alive(known); if (j) return j; }
  const f = await findOne(`name='${CONFIG.driveFileName}' and '${folderId}' in parents and trashed=false`);
  if (f) ls.set(K.file, f.id); else ls.del(K.file);
  return f;
}

export async function downloadText(id) {
  return (await api(`files/${id}?alt=media`)).text();
}

export async function uploadText(id, folderId, text) {
  if (id) {
    const r = await api(`${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
    return r.json();
  }
  const boundary = 'fv' + Math.random().toString(36).slice(2);
  const meta = { name: CONFIG.driveFileName, parents: [folderId], mimeType: 'application/json' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const r = await api(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const j = await r.json();
  ls.set(K.file, j.id);
  return j;
}

// Einmal pro Tag eine Kopie in „Backups“, die ältesten über 30 wandern in den Papierkorb
export async function dailyBackup(fileId, folderId) {
  const today = new Date().toISOString().slice(0, 10);
  if (ls.get(K.backup) === today) return;
  const bf = (await findOne(`name='Backups' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`))?.id
    || (await createFolder('Backups', folderId));
  await api(`files/${fileId}/copy?fields=id`, { method: 'POST', headers: json, body: JSON.stringify({ name: `finanzdaten-${today}.json`, parents: [bf] }) });
  const r = await api(`files?q=${q(`'${bf}' in parents and trashed=false`)}&fields=files(id,name)&orderBy=name desc&pageSize=100`);
  const files = (await r.json()).files || [];
  for (const f of files.slice(30)) {
    await api(`files/${f.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ trashed: true }) });
  }
  ls.set(K.backup, today);
}

export async function fetchUser() {
  const r = await api('about?fields=user(emailAddress,displayName)');
  const u = (await r.json()).user || {};
  if (u.emailAddress) ls.set(K.email, u.emailAddress);
  return u;
}
