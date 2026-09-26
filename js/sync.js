// Abgleich lokal ⇄ Google Drive. Offline-Änderungen werden gesammelt und beim
// nächsten Online-Sync datensatzweise zusammengeführt (neuere Änderung gewinnt).
import * as drive from './drive.js';
import { store, mergeStates, digest, getCrypto, setCrypto, kvDel } from './store.js';
import { encryptJSON, decryptJSON, deriveKey } from './crypto.js';
import { ls } from './util.js';

let status = { state: 'idle', message: '' };
const listeners = new Set();
let running = null;
let again = false;

export const hooks = { askPassphrase: async () => null };
export const getStatus = () => status;
export const lastSync = () => ls.get('fv.lastSync');
export const isDirty = () => ls.get('fv.dirty') === '1';
export function onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }

function set(state, message = '') {
  status = { state, message };
  listeners.forEach((f) => f(status));
}

export function refreshIdle() {
  if (running) return;
  if (!drive.isConfigured()) return set('unconfigured');
  if (!drive.wasConnected()) return set('disconnected');
  if (!navigator.onLine) return set('offline');
  if (!drive.hasToken()) return set('needs-auth');
  set(isDirty() ? 'pending' : 'synced');
}

async function seal(s) {
  const c = getCrypto();
  if (s.settings.encrypted && c) return { app: 'finanzverwaltung', savedAt: new Date().toISOString(), ...(await encryptJSON(s, c.key, c.salt)) };
  return { app: 'finanzverwaltung', v: 1, enc: false, savedAt: new Date().toISOString(), data: s };
}

async function open(env) {
  if (!env.enc) return env.data || env;
  const c = getCrypto();
  if (c && c.salt === env.salt) { try { return await decryptJSON(env, c.key); } catch { /* Passwort geändert */ } }
  for (let i = 0; i < 3; i++) {
    const pass = await hooks.askPassphrase(i ? 'Falsches Passwort – bitte erneut versuchen.' : 'Deine Daten in Google Drive sind verschlüsselt. Bitte Passwort eingeben.');
    if (!pass) return undefined;
    try {
      const key = await deriveKey(pass, env.salt);
      const data = await decryptJSON(env, key);
      setCrypto({ key, salt: env.salt });
      return data;
    } catch { /* nochmal */ }
  }
  return undefined;
}

export function syncNow({ interactive = false } = {}) {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      if (!drive.isConfigured()) return set('unconfigured');
      if (!navigator.onLine) return set('offline');
      if (!drive.hasToken()) {
        if (!interactive) return set(drive.wasConnected() ? 'needs-auth' : 'disconnected');
        await drive.connect();
        drive.fetchUser().catch(() => {});
      }
      set('syncing');
      const folderId = await drive.ensureFolder();
      const file = await drive.findDataFile(folderId);
      let remote = null;
      if (file) {
        const text = await drive.downloadText(file.id);
        if (text.trim()) {
          remote = await open(JSON.parse(text));
          if (remote === undefined) return set('needs-pass', 'Passwort erforderlich');
        }
      }
      const local = store.state;
      const merged = remote ? mergeStates(local, remote) : local;
      const dm = digest(merged);
      if (dm !== digest(local)) store.replace(merged, { dirty: false });
      // Verschlüsselung wurde auf einem anderen Gerät abgeschaltet
      if (!store.state.settings.encrypted && getCrypto()) { setCrypto(null); kvDel('trustedKey').catch(() => {}); }
      const v0 = store.version;
      if (!remote || digest(remote) !== dm) {
        await drive.uploadText(file?.id, folderId, JSON.stringify(await seal(store.state)));
      }
      if (store.version === v0) ls.del('fv.dirty'); else again = true;
      ls.set('fv.lastSync', new Date().toISOString());
      const fid = ls.get('fv.gfile');
      if (fid) drive.dailyBackup(fid, folderId).catch((e) => console.warn('Backup fehlgeschlagen', e));
      set(isDirty() ? 'pending' : 'synced');
    } catch (e) {
      console.error(e);
      if (e instanceof drive.AuthError) set('needs-auth', e.message);
      else set('error', e.message || String(e));
    }
  })().finally(() => {
    // bewusst hier und nicht im try/finally: endet der Ablauf synchron, würde
    // running sonst erst NACH dem Zurücksetzen zugewiesen und bliebe für immer gesetzt
    running = null;
    if (again) { again = false; setTimeout(() => syncNow(), 1500); }
  });
  return running;
}

// Automatik: nach Änderungen, beim Online-Werden, beim Zurückkehren in den Tab, alle 5 Minuten
let timer;
export function startAuto() {
  store.subscribe(({ dirty }) => {
    if (!dirty) return;
    if (status.state === 'synced') set('pending');
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(), 4000);
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => set('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60 * 1000);
  refreshIdle();
  syncNow();
}
