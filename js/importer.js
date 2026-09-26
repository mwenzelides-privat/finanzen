// Import von Kontoauszügen (CSV aller gängigen deutschen Banken, Excel)
import { store } from './store.js';
import { uid, loadScript, parseDate, parseMoney, norm, todayISO, hash } from './util.js';
import { compileRules, matchRule } from './categorize.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

export const FIELDS = [
  { key: 'date', label: 'Buchungsdatum', required: true },
  { key: 'amount', label: 'Betrag' },
  { key: 'debit', label: 'Soll / Ausgang' },
  { key: 'credit', label: 'Haben / Eingang' },
  { key: 'sh', label: 'Soll/Haben-Kennzeichen' },
  { key: 'payee', label: 'Empfänger / Gegenseite' },
  { key: 'payeeIn', label: 'Auftraggeber (bei Eingängen)' },
  { key: 'purpose', label: 'Verwendungszweck' },
  { key: 'text', label: 'Buchungstext / Umsatzart' },
  { key: 'category', label: 'Kategorie' },
  { key: 'account', label: 'Konto (Name)' },
  { key: 'balance', label: 'Saldo nach Buchung' },
  { key: 'note', label: 'Notiz' },
];

const PATTERNS = {
  balance: [/saldo nach buchung/, /^saldo$/, /^saldo ?\((€|eur)\)$/, /^kontostand$/],
  date: [/^buchungstag$/, /^buchungsdatum$/, /^buchung$/, /^datum$/, /^date$/, /buchungstag/, /buchungsdatum/, /^belegdatum$/, /datum/, /valuta|wertstellung/],
  sh: [/^soll\/haben$/, /^s\/h$/, /^soll-haben/, /^kennzeichen$/],
  debit: [/^soll( \(eur\)| in eur)?$/, /^ausgang/, /^belastung/, /^ausgabe/],
  credit: [/^haben( \(eur\)| in eur)?$/, /^eingang/, /^gutschrift/, /^einnahme/],
  amount: [/^betrag$/, /^betrag ?\((€|eur)\)$/, /^umsatz$/, /umsatz in eur/, /^betrag/, /^amount$/, /betrag/, /umsatz/],
  payeeIn: [/zahlungspflichtige/, /^auftraggeber$/],
  payee: [/zahlungsempf/, /beguenstigter|begünstigter/, /auftraggeber ?\/ ?empf/, /name zahlungsbeteiligter/, /^empf(ä|ae|a)nger/, /^name$/, /gegenkonto ?name|gegenseite|^payee$|empfänger/],
  purpose: [/^verwendungszweck$/, /verwendungszweck/, /buchungsdetails/, /^beschreibung$/, /^zweck/, /^memo$|^description$|^text$/],
  text: [/^buchungstext$/, /^vorgang$/, /^umsatztyp$/, /^umsatzart$/, /buchungsart/, /^art$/, /^transaktionstyp$/],
  category: [/^kategorie$/, /^category$/, /^hauptkategorie$/],
  account: [/^konto$/, /^kontoname$/, /^account$/],
  note: [/^notiz$/, /^bemerkung$/, /^kommentar$/],
};
const AMOUNT_EXCLUDE = /saldo|ursprung|auslagen|währung|waehrung|fremdw/;

// ---------- Datei lesen ----------
export async function readFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    await loadScript(XLSX_URL);
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheets = wb.SheetNames.map((n) => ({
      name: n,
      rows: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })
        .filter((r) => r.some((c) => String(c).trim() !== '')),
    }));
    return { kind: 'xlsx', sheets };
  }
  const text = decode(await file.arrayBuffer());
  return { kind: 'csv', sheets: [{ name: 'CSV', rows: parseCSV(text) }] };
}

function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

export function parseCSV(text) {
  const sample = text.split(/\r?\n/).slice(0, 40).join('\n');
  const counts = [';', ',', '\t', '|'].map((d) => [d, (sample.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  const d = counts[0][1] > 0 ? counts[0][0] : ';';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// ---------- Kopfzeile & Spalten erkennen ----------
export function findHeaderRow(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map((c) => norm(c instanceof Date ? '' : c));
    if (cells.filter(Boolean).length < 3) continue;
    let s = 0;
    if (cells.some((c) => /datum|buchung|date|valuta|wertstellung/.test(c))) s += 2;
    if (cells.some((c) => /betrag|umsatz|amount|^soll|^haben/.test(c))) s += 2;
    if (cells.some((c) => /verwendungszweck|empf|auftraggeber|beschreibung|buchungstext|zahlungs|vorgang/.test(c))) s += 1;
    if (cells.some((c) => /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(c))) s -= 3; // Datenzeile, keine Kopfzeile
    if (s > bestScore) { bestScore = s; best = i; }
    if (s >= 5) break;
  }
  return best;
}

export function guessMapping(header) {
  const h = header.map((c) => norm(c));
  const used = new Set();
  const map = {};
  for (const key of ['balance', 'date', 'sh', 'debit', 'credit', 'amount', 'payeeIn', 'payee', 'purpose', 'text', 'category', 'account', 'note']) {
    for (const re of PATTERNS[key]) {
      const idx = h.findIndex((c, i) => c && !used.has(i) && re.test(c) && !(key === 'amount' && AMOUNT_EXCLUDE.test(c)));
      if (idx >= 0) { map[key] = idx; used.add(idx); break; }
    }
  }
  // Nur ein Empfänger-Feld, das eigentlich "Auftraggeber" heißt → als allgemeines Gegenseite-Feld nutzen
  if (map.payee == null && map.payeeIn != null) { map.payee = map.payeeIn; delete map.payeeIn; }
  // Soll/Haben-Kennzeichen ohne Betrag macht keinen Sinn
  if (map.sh != null && map.amount == null) delete map.sh;
  return map;
}

export const headerSignature = (header) => hash(header.map((c) => norm(c)).join('|'));

// Kontostand aus Kopfzeilen (z. B. DKB „Kontostand vom …“, ING „Saldo“)
function metaBalance(rows, headerIdx) {
  for (let i = 0; i < headerIdx; i++) {
    const r = rows[i].map((c) => String(c));
    if (!/kontostand|saldo/i.test(r[0] || '')) continue;
    for (let j = 1; j < r.length; j++) {
      const c = parseMoney(r[j]);
      if (c != null && /\d/.test(r[j])) {
        const dm = r.join(' ').match(/\d{1,2}\.\d{1,2}\.\d{2,4}/);
        return { balance: c, date: dm ? parseDate(dm[0]) : null };
      }
    }
  }
  return null;
}
export function metaIban(rows, headerIdx) {
  for (let i = 0; i < Math.min(headerIdx + 2, rows.length); i++) {
    for (const c of rows[i]) { const m = String(c).replace(/\s/g, '').match(/DE\d{20}/); if (m) return m[0]; }
  }
  return '';
}

// ---------- Zeilen in Buchungen umwandeln ----------
export function buildItems(rows, headerIdx, map, { invert = false } = {}) {
  const items = [];
  const get = (r, k) => (map[k] != null && map[k] !== '' ? r[map[k]] : '');
  const str = (v) => (v instanceof Date ? '' : String(v ?? '').trim());
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(get(r, 'date'));
    let amount = map.amount != null ? parseMoney(get(r, 'amount')) : null;
    if (map.debit != null || map.credit != null) {
      const deb = parseMoney(get(r, 'debit')), cre = parseMoney(get(r, 'credit'));
      if (amount == null && (deb != null || cre != null)) amount = Math.abs(cre || 0) - Math.abs(deb || 0);
    }
    if (map.sh != null && amount != null) {
      const s = str(get(r, 'sh')).toUpperCase();
      if (s.startsWith('S')) amount = -Math.abs(amount);
      else if (s.startsWith('H')) amount = Math.abs(amount);
    }
    if (invert && amount != null) amount = -amount;
    let payee = str(get(r, 'payee'));
    const payeeIn = str(get(r, 'payeeIn'));
    if (map.payeeIn != null) payee = amount >= 0 ? payeeIn || payee : payee || payeeIn;
    const text = str(get(r, 'text'));
    let purpose = str(get(r, 'purpose'));
    if (!payee && text) {
      const m = text.match(/(?:Auftraggeber|Empfänger|Empfaenger):\s*(.+?)(?:\s+Buchungstext:|\s+Kto\/IBAN:|\s+IBAN:|$)/i);
      if (m) payee = m[1].trim();
      const bt = text.match(/Buchungstext:\s*(.+?)(?:\s+Ref\.|$)/i);
      if (bt && !purpose) purpose = bt[1].trim();
    }
    const pending = r.some((c) => /^(umsatz )?vorgemerkt$|^offen$|^pending$/i.test(str(c))) || /^offen$/i.test(str(get(r, 'date')));
    items.push({
      row: i, date, amount, payee, purpose: purpose || (map.purpose == null ? text : ''), text,
      category: str(get(r, 'category')), account: str(get(r, 'account')),
      balance: map.balance != null ? parseMoney(get(r, 'balance')) : null,
      note: str(get(r, 'note')),
      pending,
      valid: !!date && amount != null && Number.isFinite(amount) && !pending,
    });
  }
  return items;
}

export const dupKey = (accountId, date, amount, payee, purpose) =>
  `${accountId}|${date}|${amount}|${norm(`${payee} ${purpose}`).replace(/[^a-z0-9äöüß]/g, '').slice(0, 60)}`;

// Duplikate: gleiche Buchung schon vorhanden. Mehrfach identische Zeilen (z. B. 2× gleicher Kaffee)
// werden per Vorkommens-Zähler unterschieden.
export function markDuplicates(items, resolveAccount) {
  const existing = new Map();
  for (const t of store.all('transactions')) {
    const k = t.hash || dupKey(t.accountId, t.date, t.amount, t.payee, t.purpose);
    existing.set(k, (existing.get(k) || 0) + 1);
  }
  const seen = new Map();
  for (const it of items) {
    it.dup = false;
    if (!it.valid) continue;
    const acc = resolveAccount(it);
    it.hash = dupKey(acc, it.date, it.amount, it.payee, it.purpose);
    const n = (seen.get(it.hash) || 0) + 1;
    seen.set(it.hash, n);
    it.dup = n <= (existing.get(it.hash) || 0);
  }
  return items;
}

export function guessCategory(it, compiled, catByName) {
  if (it.category) {
    const c = catByName.get(norm(it.category));
    if (c) return { categoryId: c.id, taxCategory: null, source: 'file' };
  }
  const r = matchRule({ payee: it.payee, purpose: it.purpose, bookingText: it.text, amount: it.amount }, compiled);
  return r ? { categoryId: r.categoryId, taxCategory: r.taxCategory || null, source: 'rule' } : { categoryId: null, taxCategory: null, source: null };
}

// ---------- Import ausführen ----------
export function commitImport(items, { accountId, newAccount, fileName, autoCat = true, rows, headerIdx, map }) {
  const accounts = store.all('accounts');
  const accByName = new Map(accounts.map((a) => [norm(a.name), a]));
  let targetId = accountId;
  if (!targetId && newAccount) targetId = store.put('accounts', { type: 'giro', balanceAnchor: 0, anchorDate: '', ...newAccount }).id;

  // Konten aus einer Konto-Spalte (z. B. eigene Excel-Liste)
  const rowAccount = (it) => {
    if (!it.account) return targetId;
    let a = accByName.get(norm(it.account));
    if (!a) { a = store.put('accounts', { name: it.account, type: 'giro', balanceAnchor: 0, anchorDate: '' }); accByName.set(norm(a.name), a); }
    return a.id;
  };
  markDuplicates(items, rowAccount);

  // Kategorien aus Datei: fehlende anlegen
  const catByName = new Map(store.all('categories').map((c) => [norm(c.name), c]));
  if (map.category != null) {
    const missing = [...new Set(items.filter((i) => i.valid && i.category && !catByName.has(norm(i.category))).map((i) => i.category))];
    for (const name of missing) {
      const sample = items.find((i) => i.category === name);
      const c = store.put('categories', { name, group: 'Importiert', type: sample.amount >= 0 ? 'income' : 'expense', order: 800 });
      catByName.set(norm(name), c);
    }
  }

  const compiled = autoCat ? compileRules() : [];
  const batchId = uid();
  const recs = [];
  let dup = 0, invalid = 0;
  for (const it of items) {
    if (!it.valid) { invalid++; continue; }
    if (it.dup) { dup++; continue; }
    const g = autoCat || it.category ? guessCategory(it, compiled, catByName) : { categoryId: null, taxCategory: null };
    recs.push({
      accountId: rowAccount(it), date: it.date, amount: it.amount,
      payee: it.payee, purpose: it.purpose, bookingText: it.text !== it.purpose ? it.text : '',
      categoryId: g.categoryId, taxCategory: g.taxCategory, note: it.note, tags: [],
      hash: it.hash, importBatch: batchId, source: 'import', catManual: g.source === 'file',
    });
  }
  store.putMany('transactions', recs);

  // Kontostand übernehmen, falls die Datei ihn liefert
  if (targetId) {
    const acc = store.get('accounts', targetId);
    let anchor = null;
    const withBal = items.filter((i) => i.valid && i.balance != null);
    if (withBal.length) {
      const desc = withBal[0].date >= withBal[withBal.length - 1].date;
      const newest = withBal.reduce((best, i) => (i.date > best.date || (!desc && i.date === best.date) ? i : best), withBal[0]);
      anchor = { balance: newest.balance, date: newest.date };
    } else {
      const m = metaBalance(rows, headerIdx);
      if (m) anchor = { balance: m.balance, date: m.date || items.filter((i) => i.valid).reduce((mx, i) => (i.date > mx ? i.date : mx), '') || todayISO() };
    }
    if (acc && anchor && anchor.date && (!acc.anchorDate || anchor.date >= acc.anchorDate)) {
      store.put('accounts', { ...acc, balanceAnchor: anchor.balance, anchorDate: anchor.date });
    }
  }

  if (recs.length) {
    store.put('imports', { id: batchId, fileName, date: todayISO(), accountId: targetId || null, count: recs.length, dup, invalid });
  }
  return { imported: recs.length, dup, invalid, batchId };
}

export function undoImport(batchId) {
  const ids = store.all('transactions').filter((t) => t.importBatch === batchId).map((t) => t.id);
  store.removeMany('transactions', ids);
  store.remove('imports', batchId);
  return ids.length;
}
