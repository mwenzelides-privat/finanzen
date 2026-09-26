// Zentraler Datenspeicher: Zustand im Speicher, persistiert in IndexedDB,
// jede Änderung trägt updatedAt – damit lassen sich Geräte konfliktarm zusammenführen.
import { uid, debounce, hash, ls } from './util.js';
import { encryptJSON, decryptJSON, deriveKey } from './crypto.js';
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from './defaults.js';

export const COLLECTIONS = [
  'accounts', 'categories', 'transactions', 'budgets', 'rules',
  'vacations', 'vacationEntries', 'taxItems', 'taxYears', 'imports',
];

export function emptyState() {
  const s = { schema: 1, settings: { updatedAt: 0 } };
  for (const c of COLLECTIONS) s[c] = [];
  return s;
}

function normalize(s) {
  const e = emptyState();
  const out = { ...e, ...s, settings: { ...e.settings, ...(s?.settings || {}) } };
  for (const c of COLLECTIONS) out[c] = Array.isArray(s?.[c]) ? s[c] : [];
  return out;
}

// ---------- IndexedDB (einfacher Key-Value-Store) ----------
let dbp;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('finanzverwaltung', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
export const kvGet = (k) => tx('readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('readwrite', (s) => s.put(v, k));
export const kvDel = (k) => tx('readwrite', (s) => s.delete(k));
export const kvClear = () => tx('readwrite', (s) => s.clear());

// ---------- Zustand ----------
let state = emptyState();
let version = 0;
let cryptoCtx = null; // { key: CryptoKey, salt }
const listeners = new Set();
const index = new Map();

export const getCrypto = () => cryptoCtx;
export function setCrypto(ctx) { cryptoCtx = ctx; saveSoon(); }

function changed(dirty = true) {
  version++;
  index.clear();
  if (dirty) ls.set('fv.dirty', '1');
  saveSoon();
  for (const fn of listeners) fn({ dirty });
}

// Nach „Gerät leeren“ darf nichts mehr zurückgeschrieben werden (auch nicht beim Schließen der Seite)
let persist = true;
export function stopPersisting() { persist = false; }

export async function saveNow() {
  if (!persist) return;
  const payload = cryptoCtx
    ? await encryptJSON(state, cryptoCtx.key, cryptoCtx.salt)
    : { enc: false, data: state };
  await kvSet('state', payload);
}
const saveSoon = debounce(() => saveNow().catch((e) => console.error('Speichern fehlgeschlagen', e)), 250);

export const store = {
  get state() { return state; },
  get version() { return version; },
  all(c) { return state[c].filter((r) => !r.deleted); },
  byId(c) {
    let m = index.get(c);
    if (!m) { m = new Map(); for (const r of state[c]) if (!r.deleted) m.set(r.id, r); index.set(c, m); }
    return m;
  },
  get(c, id) { return id ? this.byId(c).get(id) : undefined; },
  put(c, rec) { return this.putMany(c, [rec])[0]; },
  putMany(c, recs) {
    if (!recs.length) return [];
    const t = Date.now();
    const arr = state[c];
    const pos = new Map(arr.map((r, i) => [r.id, i]));
    const out = recs.map((r) => {
      const rec = { ...r, id: r.id || uid(), updatedAt: t };
      delete rec.deleted;
      const i = pos.get(rec.id);
      if (i === undefined) { pos.set(rec.id, arr.length); arr.push(rec); } else arr[i] = rec;
      return rec;
    });
    changed();
    return out;
  },
  remove(c, id) { this.removeMany(c, [id]); },
  removeMany(c, ids) {
    if (!ids.length) return;
    const t = Date.now();
    const set = new Set(ids);
    state[c] = state[c].map((r) => (set.has(r.id) ? { id: r.id, deleted: true, updatedAt: t } : r));
    changed();
  },
  settings() { return state.settings; },
  setSettings(patch) { state.settings = { ...state.settings, ...patch, updatedAt: Date.now() }; changed(); },
  replace(next, { dirty = false } = {}) { state = normalize(next); changed(dirty); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  flush: () => saveSoon.flush(),
};

// Standardkategorien einmalig anlegen (sehr altes updatedAt → Drive-Daten gewinnen immer)
export function ensureDefaults() {
  let touched = false;
  if (!state.categories.length) { state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c })); touched = true; }
  if (!state.rules.length) { state.rules = DEFAULT_RULES.map((r) => ({ ...r })); touched = true; }
  if (touched) changed(false);
}

// ---------- Laden / Entsperren ----------
export async function loadLocal() {
  const raw = await kvGet('state');
  if (!raw) return { status: 'empty' };
  if (!raw.enc) { state = normalize(raw.data); version++; return { status: 'ok' }; }
  const trusted = await kvGet('trustedKey').catch(() => null);
  if (trusted) {
    try {
      state = normalize(await decryptJSON(raw, trusted));
      cryptoCtx = { key: trusted, salt: raw.salt };
      version++;
      return { status: 'ok' };
    } catch { /* Schlüssel passt nicht mehr */ }
  }
  return { status: 'locked', envelope: raw };
}

export async function unlock(envelope, passphrase) {
  const key = await deriveKey(passphrase, envelope.salt);
  const data = await decryptJSON(envelope, key); // wirft bei falschem Passwort
  state = normalize(data);
  cryptoCtx = { key, salt: envelope.salt };
  version++;
  return key;
}

// ---------- Zusammenführen (Sync) ----------
export function mergeStates(a, b) {
  const out = emptyState();
  for (const c of COLLECTIONS) {
    const m = new Map();
    for (const r of a[c] || []) m.set(r.id, r);
    for (const r of b[c] || []) {
      const ex = m.get(r.id);
      if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) m.set(r.id, r);
    }
    out[c] = [...m.values()];
  }
  out.settings = (b.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0) ? b.settings : a.settings;
  return out;
}

export function digest(s) {
  const parts = [];
  for (const c of COLLECTIONS) for (const r of s[c] || []) parts.push(c + r.id + ':' + r.updatedAt + (r.deleted ? 'x' : ''));
  parts.sort();
  return hash(parts.join(';') + '|S' + (s.settings?.updatedAt || 0));
}
