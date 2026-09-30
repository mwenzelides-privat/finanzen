// Woher kommen die Daten? Aus „Finanzen-Daten.json“ in deinem Google Drive (nur lesend) oder aus einer Datei.
// Die zuletzt geladenen Daten bleiben auf diesem Gerät gespeichert, damit das Dashboard sofort (auch offline) öffnet.
import { CONFIG } from '../config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const K = { token: 'fd.token', verbunden: 'fd.verbunden', email: 'fd.email' };
const DB = 'finanzen-dashboard', STORE = 'daten';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ---------- Speicher auf dem Gerät (IndexedDB)
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
  });
}
export const cacheLesen = () => tx('readonly', (s) => s.get('aktuell')).catch(() => null);
export const cacheSchreiben = (v) => tx('readwrite', (s) => s.put(v, 'aktuell'));
// weitere Einstellungen/Entscheidungen auf dem Gerät (z. B. Steuer-Zuordnungen)
export const kvLesen = (k) => tx('readonly', (s) => s.get(k)).catch(() => null);
export const kvSchreiben = (k, v) => tx('readwrite', (s) => s.put(v, k));
export async function geraetLeeren() {
  await tx('readwrite', (s) => s.clear()).catch(() => {});
  abmelden();
}

// ---------- Prüfen, ob die Datei zum Dashboard passt
export function pruefen(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Die Datei ist keine gültige Daten-Datei (JSON).'); }
  if (j?.version !== 1 || !Array.isArray(j.buchungen) || !Array.isArray(j.konten)) {
    throw new Error('Das ist nicht die Datei „Finanzen-Daten.json“ aus deinem Finanzen-Ordner.');
  }
  return j;
}

// ---------- Datei vom Gerät
export function dateiWaehlen() {
  return new Promise((res, rej) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return rej(new Error('Keine Datei gewählt.'));
      try {
        const text = await f.text();
        pruefen(text);
        const v = { text, quelle: 'datei', name: f.name, geaendert: new Date(f.lastModified).toISOString(), geladen: new Date().toISOString() };
        await cacheSchreiben(v);
        res(v);
      } catch (e) { rej(e); }
    };
    inp.click();
  });
}

// ---------- Datei auf diesem PC verknüpfen (Chrome/Edge am Computer)
// Die App merkt sich die Datei (z. B. G:\Meine Ablage\10 Finanzen\Auswertung\Finanzen-Daten.json aus Google Drive
// for Desktop) und liest sie bei jedem Öffnen neu – ohne Google-Anmeldung. Der Browser fragt einmal nach Erlaubnis;
// mit „Bei jedem Besuch zulassen“ geht es danach ganz automatisch.
export const pcMoeglich = () => 'showOpenFilePicker' in window;
const handleLesen = () => tx('readonly', (s) => s.get('handle')).catch(() => null);
export const pcVerknuepft = async () => !!(await handleLesen());

async function pcLesen(h, aktuell) {
  const f = await h.getFile();
  const geaendert = new Date(f.lastModified).toISOString();
  if (aktuell?.quelle === 'pc' && aktuell.geaendert === geaendert) return null;
  const text = await f.text();
  pruefen(text);
  const v = { text, quelle: 'pc', name: f.name, geaendert, geladen: new Date().toISOString() };
  await cacheSchreiben(v);
  return v;
}

// Zustand der Leseerlaubnis: 'granted' | 'prompt' | 'denied' | null (keine Datei verknüpft)
export async function pcErlaubnis() {
  const h = await handleLesen();
  return h ? h.queryPermission({ mode: 'read' }) : null;
}

export async function pcVerknuepfen() {
  const [h] = await window.showOpenFilePicker({ multiple: false, id: 'finanzen-daten', types: [{ description: 'Finanzen-Daten', accept: { 'application/json': ['.json'] } }] });
  const v = await pcLesen(h, null);
  await tx('readwrite', (s) => s.put(h, 'handle'));
  return v;
}

// Neueste Fassung aus der verknüpften Datei. interaktiv = aus einem Klick (darf nach Erlaubnis fragen).
// Liefert die neue Fassung, null (unverändert) oder wirft { erlaubnis: true }, wenn der Browser erst fragen muss.
export async function pcLaden(aktuell, interaktiv) {
  const h = await handleLesen();
  if (!h) throw new Error('Keine Datei verknüpft.');
  let p = await h.queryPermission({ mode: 'read' });
  if (p !== 'granted' && interaktiv) p = await h.requestPermission({ mode: 'read' });
  if (p !== 'granted') throw Object.assign(new Error('Bitte den Zugriff auf die Datei erlauben (↻ oben rechts).'), { erlaubnis: true });
  return pcLesen(h, aktuell);
}

// ---------- Google Drive
const tokenObj = () => { try { return JSON.parse(ls.get(K.token) || 'null'); } catch { return null; } };
export const hatToken = () => { const t = tokenObj(); return !!t && t.exp > Date.now(); };
export const warVerbunden = () => ls.get(K.verbunden) === '1';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`) && window.google?.accounts?.oauth2) return res();
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = res;
    s.onerror = () => rej(new Error('Google-Anmeldung konnte nicht geladen werden (keine Internetverbindung?).'));
    document.head.append(s);
  });
}

// Google-Anmeldung vorab laden, damit ein Klick auf ↻ sofort das Fenster öffnen kann
export function vorladen() { if (warVerbunden() && navigator.onLine) loadScript(GIS).catch(() => {}); }

// Muss aus einem Klick heraus aufgerufen werden (öffnet ggf. das Google-Anmeldefenster).
// Mit dem gemerkten Konto (login_hint) schließt sich das Fenster nach der ersten Freigabe von selbst,
// auch wenn im Browser mehrere Google-Konten angemeldet sind.
export async function anmelden() {
  await loadScript(GIS);
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPE,
      login_hint: ls.get(K.email) || undefined,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new Error('Lesezugriff auf Google Drive wurde nicht erlaubt.'));
        ls.set(K.token, JSON.stringify({ t: r.access_token, exp: Date.now() + (Number(r.expires_in || 3600) - 120) * 1000 }));
        ls.set(K.verbunden, '1');
        kontoMerken();
        resolve();
      },
      error_callback: (e) => reject(new Error(
        e?.type === 'popup_closed' ? 'Anmeldefenster geschlossen.'
          : e?.type === 'popup_failed_to_open' ? 'Pop-up wurde blockiert – bitte Pop-ups für diese Seite erlauben.'
            : (e?.message || 'Anmeldung fehlgeschlagen.'))),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// Welches Google-Konto verbunden ist (für login_hint und die Anzeige)
async function kontoMerken() {
  try {
    const r = await api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    const m = (await r.json()).user?.emailAddress;
    if (m) ls.set(K.email, m);
  } catch {}
}
export const kontoEmail = () => ls.get(K.email);

export function abmelden() {
  const t = tokenObj()?.t;
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  ls.del(K.token); ls.del(K.verbunden); ls.del(K.email);
}

async function api(url) {
  const t = tokenObj();
  if (!t || t.exp <= Date.now()) throw Object.assign(new Error('Anmeldung abgelaufen'), { auth: true });
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t.t } });
  if (r.status === 401) { ls.del(K.token); throw Object.assign(new Error('Anmeldung abgelaufen'), { auth: true }); }
  if (!r.ok) throw new Error(`Google Drive meldet Fehler ${r.status}`);
  return r;
}

async function dateiSuchen() {
  const q = encodeURIComponent(`name='${CONFIG.dataFileName}' and trashed=false`);
  const r = await api(`${API}?q=${q}&spaces=drive&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime,size)`);
  const f = (await r.json()).files?.[0];
  if (!f) throw new Error(`„${CONFIG.dataFileName}“ wurde in deinem Google Drive nicht gefunden. Liegt sie im Ordner „10 Finanzen/Auswertung“?`);
  return f;
}

// Lädt die Datei, wenn sie neuer ist als die gespeicherte Fassung. Liefert die neue Fassung oder null.
export async function driveLaden(aktuell) {
  const f = await dateiSuchen();
  if (aktuell?.quelle === 'drive' && aktuell.id === f.id && aktuell.geaendert === f.modifiedTime) return null;
  const text = await (await api(`${API}/${f.id}?alt=media`)).text();
  pruefen(text);
  const v = { text, quelle: 'drive', id: f.id, name: f.name, geaendert: f.modifiedTime, geladen: new Date().toISOString() };
  await cacheSchreiben(v);
  return v;
}

// Nur auf dem eigenen Rechner zum Testen: Daten aus dem Ordner daten/ (nie im Repository)
export async function lokalLaden() {
  const r = await fetch('daten/' + CONFIG.dataFileName, { cache: 'no-store' });
  if (!r.ok) throw new Error('keine lokalen Testdaten');
  const text = await r.text();
  pruefen(text);
  return { text, quelle: 'lokal', name: CONFIG.dataFileName, geaendert: r.headers.get('last-modified') || '', geladen: new Date().toISOString() };
}
