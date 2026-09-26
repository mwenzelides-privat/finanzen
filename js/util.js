// Kleine Helfer: Geld, Datum, Text, DOM

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

// ---------- Geld (alle Beträge intern in Cent, Integer) ----------
const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const money = (cents) => EUR.format((cents || 0) / 100);
export const money0 = (cents) => EUR0.format((cents || 0) / 100);
export const signedMoney = (cents) => (cents > 0 ? '+' : '') + money(cents);
export const pct = (v, digits = 0) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'percent', maximumFractionDigits: digits });
export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export function parseMoney(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input).replace(/[\s €]|EUR/gi, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');           // 1.234,56
  else if (ld > lc && lc >= 0) s = s.replace(/,/g, '');               // 1,234.56
  else if (ld >= 0 && lc < 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234 (Tausender)
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return null;
  return Math.round((neg ? -v : v) * 100);
}

// ---------- Datum (ISO-Strings YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
export const fmtDateShort = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.` : '');
export const monthKey = (s) => s.slice(0, 7);
export function addMonths(mk, n) {
  let [y, m] = mk.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
export const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
export const monthStart = (mk) => mk + '-01';
export const monthEnd = (mk) => { const [y, m] = mk.split('-').map(Number); return toISO(new Date(y, m, 0)); };
export function monthsBetween(fromMk, toMk) {
  const out = [];
  for (let m = fromMk; m <= toMk && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
}
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MON_L = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monthLabel = (mk, long = false) =>
  long ? `${MON_L[+mk.slice(5, 7) - 1]} ${mk.slice(0, 4)}` : `${MON[+mk.slice(5, 7) - 1]} ${mk.slice(2, 4)}`;

export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : toISO(v);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return valid(y, +m[2], +m[1]); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// ---------- Text ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function hash(str) {
  // cyrb53 – schneller, nicht-kryptografischer Hash
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}

export function download(filename, data, type = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// CSV für deutsches Excel: Semikolon, BOM, Dezimalkomma
export function toCSV(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = () => { scripts.delete(src); rej(new Error('Konnte ' + src + ' nicht laden')); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

export const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privat/voll */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
  json(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } },
};

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
