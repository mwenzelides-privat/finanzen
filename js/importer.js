// Import von Kontoauszügen (CSV aller gängigen deutschen Banken, Excel, Finanzguru-Export)
import { store } from './store.js';
import { uid, loadScript, parseDate, parseMoney, norm, todayISO, hash } from './util.js';
import { compileRules, matchRule } from './categorize.js';
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from './defaults.js';

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
  { key: 'categoryGroup', label: 'Hauptkategorie' },
  { key: 'category', label: 'Kategorie / Unterkategorie' },
  { key: 'account', label: 'Konto (Name)' },
  { key: 'accountRef', label: 'Konto (IBAN / Kennung)' },
  { key: 'balance', label: 'Saldo nach Buchung' },
  { key: 'transferFlag', label: 'Umbuchung (ja/nein)' },
  { key: 'tags', label: 'Tags' },
  { key: 'note', label: 'Notiz' },
  { key: 'extId', label: 'Buchungs-ID' },
  { key: 'splitType', label: 'Split-Typ' },
];

const PATTERNS = {
  extId: [/^buchungs-id$/, /^transaktions-id$/, /^transaction id$/],
  splitType: [/^split-typ$/],
  transferFlag: [/^analyse-umbuchung$/, /^umbuchung$/],
  categoryGroup: [/^analyse-hauptkategorie$/, /^hauptkategorie$/],
  accountRef: [/^referenzkonto$/, /^iban auftragskonto$/, /^auftragskonto$/],
  balance: [/saldo nach buchung/, /^saldo$/, /^saldo ?\((€|eur)\)$/, /^kontostand$/],
  date: [/^buchungstag$/, /^buchungsdatum$/, /^buchung$/, /^datum$/, /^date$/, /buchungstag/, /buchungsdatum/, /^belegdatum$/, /datum/, /valuta|wertstellung/],
  sh: [/^soll\/haben$/, /^s\/h$/, /^soll-haben/, /^kennzeichen$/],
  debit: [/^soll( \(eur\)| in eur)?$/, /^ausgang/, /^belastung/, /^ausgabe/],
  credit: [/^haben( \(eur\)| in eur)?$/, /^eingang/, /^gutschrift/, /^einnahme/],
  amount: [/^betrag$/, /^betrag ?\((€|eur)\)$/, /^umsatz$/, /umsatz in eur/, /^betrag/, /^amount$/, /betrag/, /umsatz/],
  payeeIn: [/zahlungspflichtige/, /^auftraggeber$/],
  payee: [/zahlungsempf/, /^beguenstigter|^begünstigter/, /auftraggeber ?\/ ?empf/, /name zahlungsbeteiligter/, /^empf(ä|ae|a)nger/, /^name$/, /gegenkonto ?name|gegenseite|^payee$|empfänger/],
  purpose: [/^verwendungszweck$/, /verwendungszweck/, /buchungsdetails/, /^beschreibung$/, /^zweck/, /^memo$|^description$|^text$/],
  text: [/^buchungstext$/, /^vorgang$/, /^umsatztyp$/, /^umsatzart$/, /^analyse-umsatzart$/, /buchungsart/, /^art$/, /^transaktionstyp$/],
  category: [/^analyse-unterkategorie$/, /^unterkategorie$/, /^kategorie$/, /^category$/],
  account: [/^name referenzkonto$/, /^konto$/, /^kontoname$/, /^account$/],
  tags: [/^tags$/, /^tag$/, /^schlagworte$/],
  note: [/^notiz$/, /^bemerkung$/, /^kommentar$/],
};
const AMOUNT_EXCLUDE = /saldo|ursprung|auslagen|währung|waehrung|fremdw|analyse/;
const ORDER = ['extId', 'splitType', 'transferFlag', 'categoryGroup', 'accountRef', 'balance', 'date', 'sh', 'debit', 'credit', 'amount',
  'payeeIn', 'payee', 'purpose', 'text', 'category', 'account', 'tags', 'note'];

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
  for (const key of ORDER) {
    for (const re of PATTERNS[key]) {
      const idx = h.findIndex((c, i) => c && !used.has(i) && re.test(c) && !(key === 'amount' && AMOUNT_EXCLUDE.test(c)));
      if (idx >= 0) { map[key] = idx; used.add(idx); break; }
    }
  }
  if (map.payee == null && map.payeeIn != null) { map.payee = map.payeeIn; delete map.payeeIn; }
  if (map.sh != null && map.amount == null) delete map.sh;
  return map;
}

export const headerSignature = (header) => hash(header.map((c) => norm(c)).join('|'));
export const isFinanzguru = (header) => {
  const h = header.map((c) => norm(c));
  return h.includes('analyse-hauptkategorie') && h.includes('buchungs-id') && h.includes('referenzkonto');
};

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
const YES = /^(ja|yes|true|wahr|x|1)$/i;

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
    // Split-Buchungen (Finanzguru): das „Original“ steht zusätzlich zu seinen Teilen in der Datei → überspringen
    const splitOriginal = /^original$/i.test(str(get(r, 'splitType')));
    items.push({
      row: i, date, amount, payee, purpose: purpose || (map.purpose == null ? text : ''), text,
      category: str(get(r, 'category')), categoryGroup: str(get(r, 'categoryGroup')),
      account: str(get(r, 'account')), accountRef: str(get(r, 'accountRef')).replace(/\s+/g, ''),
      balance: map.balance != null ? parseMoney(get(r, 'balance')) : null,
      transfer: YES.test(str(get(r, 'transferFlag'))),
      tags: str(get(r, 'tags')).split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      note: str(get(r, 'note')),
      extId: str(get(r, 'extId')),
      pending, splitOriginal,
      valid: !!date && amount != null && Number.isFinite(amount) && !pending && !splitOriginal,
    });
  }
  return items;
}

export const dupKey = (accountId, date, amount, payee, purpose) =>
  `${accountId}|${date}|${amount}|${norm(`${payee} ${purpose}`).replace(/[^a-z0-9äöüß]/g, '').slice(0, 60)}`;

// ---------- Konten zuordnen ----------
export function guessAccountType(name) {
  const n = norm(name);
  if (/paypal/.test(n)) return 'paypal';
  if (/kredit|barclays|easybank|visa|mastercard|amex|card/.test(n)) return 'kredit';
  if (/depot|etf|wertpapier|broker/.test(n)) return 'depot';
  if (/extra|pocket|spar|tagesgeld|kaution|festgeld|rücklage|ruecklage/.test(n)) return 'spar';
  if (/bar|cash|geldbörse|portemonnaie/.test(n)) return 'bar';
  return 'giro';
}

const isIban = (s) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(s || '');

// Liefert zu jeder Zeile die Konto-ID: über IBAN/Kennung, sonst Name, sonst Zielkonto.
// create=false (Vorschau): unbekannte Konten bekommen eine Platzhalter-ID „_new:…“.
export function accountResolver(targetId, { create = false, created = [] } = {}) {
  const accs = store.all('accounts');
  const byRef = new Map();
  for (const a of accs) { if (a.iban) byRef.set(a.iban.toUpperCase(), a.id); if (a.ref) byRef.set(norm(a.ref), a.id); }
  const byName = new Map(accs.map((a) => [norm(a.name), a.id]));
  return (it) => {
    const ref = it.accountRef || '';
    const refKey = isIban(ref) ? ref.toUpperCase() : norm(ref);
    if (ref && byRef.has(refKey)) return byRef.get(refKey);
    if (it.account) {
      if (byName.has(norm(it.account))) return byName.get(norm(it.account));
      if (!create) return '_new:' + (refKey || norm(it.account));
      const a = store.put('accounts', {
        name: it.account, type: guessAccountType(it.account), bank: '',
        iban: isIban(ref) ? ref.toUpperCase() : '', ref: isIban(ref) ? '' : ref,
        balanceAnchor: 0, anchorDate: '',
      });
      created.push(a.id);
      byName.set(norm(a.name), a.id);
      if (ref) byRef.set(refKey, a.id);
      return a.id;
    }
    return targetId;
  };
}

// Duplikate: 1) gleiche Buchungs-ID, 2) gleicher Inhalt, 3) gleiches Konto+Datum+Betrag
// (erkennt auch Buchungen, die vorher aus einer anderen Quelle, z. B. Bank-CSV, kamen).
// Mehrfach identische Zeilen werden per Vorkommens-Zähler unterschieden.
export function markDuplicates(items, resolveAccount) {
  const exact = new Map(), loose = new Map(), ext = new Set();
  for (const t of store.all('transactions')) {
    const k = t.hash || dupKey(t.accountId, t.date, t.amount, t.payee, t.purpose);
    exact.set(k, (exact.get(k) || 0) + 1);
    const lk = `${t.accountId}|${t.date}|${t.amount}`;
    loose.set(lk, (loose.get(lk) || 0) + 1);
    if (t.extId) ext.add(t.extId.replace(/^[a-z]+:/, '')); // gespeichert als „quelle:id“
  }
  const seenE = new Map(), seenL = new Map();
  for (const it of items) {
    it.dup = false;
    if (!it.valid) continue;
    const acc = resolveAccount(it);
    it.accountId = acc;
    it.hash = dupKey(acc, it.date, it.amount, it.payee, it.purpose);
    if (it.extId && ext.has(it.extId)) { it.dup = true; continue; }
    const n = (seenE.get(it.hash) || 0) + 1;
    seenE.set(it.hash, n);
    const lk = `${acc}|${it.date}|${it.amount}`;
    const nl = (seenL.get(lk) || 0) + 1;
    seenL.set(lk, nl);
    it.dup = n <= (exact.get(it.hash) || 0) || nl <= (loose.get(lk) || 0);
  }
  return items;
}

// ---------- Kategorien zuordnen ----------
const catKey = (group, name) => `${norm(group)}›${norm(name)}`;

export function categoryFinder() {
  const cats = store.all('categories');
  const byGN = new Map(cats.map((c) => [catKey(c.group, c.name), c]));
  const byN = new Map();
  for (const c of cats) { const k = norm(c.name); byN.set(k, byN.has(k) ? null : c); } // nur eindeutige Namen
  return (it) => {
    if (!it.category) return null;
    if (it.categoryGroup) return byGN.get(catKey(it.categoryGroup, it.category)) || null;
    return byN.get(norm(it.category)) || null;
  };
}

function guessCatType(group, name, items) {
  if (/^einnahmen|^income|^einkommen/i.test(group)) return 'income';
  if (/^sparen$|umbuchung|transfer/i.test(group)) return 'transfer';
  if (/einnahme|gehalt|lohn|kindergeld|erstattung|ertr(ä|ae)ge|zinsen|dividende/i.test(name)) return 'income';
  const sum = items.reduce((s, i) => s + (i.amount || 0), 0);
  return sum > 0 ? 'income' : 'expense';
}

export function guessCategory(it, compiled, findCat) {
  const c = findCat(it);
  if (c) return { categoryId: c.id, taxCategory: null, source: 'file' };
  if (it.category) return { categoryId: null, taxCategory: null, source: 'new', newName: it.categoryGroup ? `${it.categoryGroup} › ${it.category}` : it.category };
  const r = matchRule({ payee: it.payee, purpose: it.purpose, bookingText: it.text, amount: it.amount }, compiled);
  return r ? { categoryId: r.categoryId, taxCategory: r.taxCategory || null, source: 'rule' } : { categoryId: null, taxCategory: null, source: null };
}

// ---------- Aus der Historie Regeln lernen ----------
// Empfänger, die fast immer in derselben Kategorie landen, bekommen eine Regel –
// so werden künftige Bank-CSV-Importe genauso kategorisiert wie bisher.
export function learnRulesFromHistory({ minCount = 3, minShare = 0.8, max = 400 } = {}) {
  const cm = store.byId('categories');
  const groups = new Map();
  for (const t of store.all('transactions')) {
    if (!t.categoryId || t.transfer) continue;
    const p = norm(t.payee).replace(/\|/g, ' ').slice(0, 40);
    if (p.length < 3) continue;
    const g = groups.get(p) || { total: 0, cats: new Map(), inSum: 0, outSum: 0 };
    g.total++;
    g.cats.set(t.categoryId, (g.cats.get(t.categoryId) || 0) + 1);
    if (t.amount >= 0) g.inSum++; else g.outSum++;
    groups.set(p, g);
  }
  const existing = new Set(store.all('rules').map((r) => `${r.field}|${norm(r.match)}`));
  const out = [];
  for (const [p, g] of [...groups.entries()].sort((a, b) => b[1].total - a[1].total)) {
    if (g.total < minCount || out.length >= max) continue;
    const [catId, n] = [...g.cats.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / g.total < minShare || !cm.get(catId) || cm.get(catId).type === 'transfer') continue;
    if (existing.has(`payee|${p}`)) continue;
    out.push({ match: p, field: 'payee', sign: g.inSum === 0 ? 'out' : g.outSum === 0 ? 'in' : 'any', categoryId: catId, taxCategory: null, prio: 5, learned: true });
  }
  return store.putMany('rules', out).map((r) => r.id);
}

// Standardkategorien ohne Buchungen/Budgets entfernen (z. B. nach Übernahme der Finanzguru-Kategorien)
export function removeUnusedDefaults() {
  const used = new Set(store.all('transactions').map((t) => t.categoryId));
  store.all('budgets').forEach((b) => used.add(b.categoryId));
  const del = store.all('categories').filter((c) => c.id.startsWith('cat-') && !used.has(c.id)).map((c) => c.id);
  const delSet = new Set(del);
  store.removeMany('rules', store.all('rules').filter((r) => delSet.has(r.categoryId)).map((r) => r.id));
  store.removeMany('categories', del);
  return del;
}

// ---------- Import ausführen ----------
export function commitImport(items, {
  accountId, newAccount, fileName, autoCat = true, rows, headerIdx, map,
  learnRules = false, cleanupDefaults = false, format = 'csv',
}) {
  const created = { accounts: [], categories: [], rules: [], removedDefaults: [] };
  let targetId = accountId || null;
  const ensureTarget = () => {
    if (!targetId && newAccount) {
      targetId = store.put('accounts', { type: 'giro', balanceAnchor: 0, anchorDate: '', ...newAccount }).id;
      created.accounts.push(targetId);
    }
    return targetId;
  };
  const resolveRow = accountResolver(null, { create: true, created: created.accounts });
  const resolver = (it) => resolveRow(it) || ensureTarget();
  markDuplicates(items, resolver);

  // Kategorien aus der Datei: fehlende anlegen (mit Gruppe, Art geschätzt)
  let findCat = categoryFinder();
  if (map.category != null) {
    const missing = new Map();
    for (const it of items) {
      if (!it.valid || !it.category || findCat(it)) continue;
      const k = catKey(it.categoryGroup, it.category);
      if (!missing.has(k)) missing.set(k, { group: it.categoryGroup || 'Importiert', name: it.category, items: [] });
      missing.get(k).items.push(it);
    }
    const recs = [...missing.values()].map((m, i) => ({ name: m.name, group: m.group, type: guessCatType(m.group, m.name, m.items), order: 600 + i }));
    created.categories = store.putMany('categories', recs).map((c) => c.id);
    findCat = categoryFinder();
  }

  const compiled = autoCat ? compileRules() : [];
  const batchId = uid();
  const recs = [];
  let dup = 0, invalid = 0;
  for (const it of items) {
    if (!it.valid) { invalid++; continue; }
    if (it.dup) { dup++; continue; }
    const g = guessCategory(it, autoCat ? compiled : [], findCat);
    recs.push({
      accountId: it.accountId, date: it.date, amount: it.amount,
      payee: it.payee, purpose: it.purpose, bookingText: it.text !== it.purpose ? it.text : '',
      categoryId: g.categoryId, taxCategory: g.taxCategory, note: it.note, tags: it.tags || [],
      transfer: it.transfer || undefined, extId: it.extId ? `${format}:${it.extId}` : undefined,
      hash: it.hash, importBatch: batchId, source: format === 'finanzguru' ? 'finanzguru' : 'import', catManual: g.source === 'file',
    });
  }
  store.putMany('transactions', recs);

  // Kontostände übernehmen: je Konto die neueste Zeile mit Saldo
  const withBal = new Map();
  for (const it of items) {
    if (!it.valid || it.balance == null || !it.accountId) continue;
    if (!withBal.has(it.accountId)) withBal.set(it.accountId, []);
    withBal.get(it.accountId).push(it);
  }
  const anchors = new Map();
  for (const [acc, list] of withBal) {
    const desc = list[0].date >= list[list.length - 1].date;
    const newest = list.reduce((best, i) => (i.date > best.date || (!desc && i.date === best.date) ? i : best), list[0]);
    anchors.set(acc, { balance: newest.balance, date: newest.date });
  }
  if (!anchors.size && targetId) {
    const m = metaBalance(rows, headerIdx);
    if (m) anchors.set(targetId, { balance: m.balance, date: m.date || items.filter((i) => i.valid).reduce((mx, i) => (i.date > mx ? i.date : mx), '') || todayISO() });
  }
  for (const [accId, a] of anchors) {
    const acc = store.get('accounts', accId);
    if (acc && a.date && (!acc.anchorDate || a.date >= acc.anchorDate)) store.put('accounts', { ...acc, balanceAnchor: a.balance, anchorDate: a.date });
  }

  if (learnRules) created.rules = learnRulesFromHistory();
  if (cleanupDefaults) created.removedDefaults = removeUnusedDefaults();

  if (recs.length) {
    store.put('imports', {
      id: batchId, fileName, date: todayISO(), accountId: targetId || null, count: recs.length, dup, invalid,
      accounts: [...new Set(recs.map((r) => r.accountId))].length, format, created,
    });
  }
  return { imported: recs.length, dup, invalid, batchId, accounts: created.accounts.length, categories: created.categories.length, rules: created.rules.length };
}

// Import rückgängig: Buchungen löschen, dabei angelegte Konten/Kategorien/Regeln entfernen
// (sofern nicht inzwischen anders genutzt) und entfernte Standardkategorien zurückholen.
export function undoImport(batchId) {
  const imp = store.get('imports', batchId);
  const ids = store.all('transactions').filter((t) => t.importBatch === batchId).map((t) => t.id);
  store.removeMany('transactions', ids);
  const c = imp?.created;
  if (c) {
    const rest = store.all('transactions');
    const usedAcc = new Set(rest.map((t) => t.accountId));
    const usedCat = new Set(rest.map((t) => t.categoryId));
    store.removeMany('accounts', (c.accounts || []).filter((id) => !usedAcc.has(id)));
    store.removeMany('rules', c.rules || []);
    const delCats = (c.categories || []).filter((id) => !usedCat.has(id));
    store.removeMany('rules', store.all('rules').filter((r) => delCats.includes(r.categoryId)).map((r) => r.id));
    store.removeMany('categories', delCats);
    if (c.removedDefaults?.length) {
      const back = new Set(c.removedDefaults);
      store.putMany('categories', DEFAULT_CATEGORIES.filter((d) => back.has(d.id)).map((d) => ({ ...d })));
      store.putMany('rules', DEFAULT_RULES.filter((r) => back.has(r.categoryId)).map((r) => ({ ...r })));
    }
  }
  store.remove('imports', batchId);
  return ids.length;
}
