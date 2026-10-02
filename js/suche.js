// Suche: ein Eingabefeld versteht Text, Beträge und Zeiträume.
//   rewe edeka     → beide Wörter müssen vorkommen
//   rewe|edeka     → eines von beiden
//   "dm drogerie"  → genau diese Wortfolge
//   -storno        → ohne dieses Wort
//   49,99          → Betrag genau 49,99 € (egal ob Ein- oder Ausgabe); auch 49.99, 49,99 €, −49,99 (typografisches Minus)
//   >500  <20  100-250  → Betragsbereich
//   2024  2019-2021  03.2024  12.03.2024  → Zeitraum

// Kleinschreibung, Umlaute und Akzente vereinheitlichen: „Mobilität“ findet „Mobilitaet“
export function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const cent = (s) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * 100);
const isYear = (n) => n >= 1990 && n <= 2099;
const pad = (n) => String(n).padStart(2, '0');

// Zerlegt die Eingabe in Wörter; "…" bleibt zusammen
export function tokens(q) {
  const out = [];
  const re = /(-?)"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[3] !== undefined) out.push({ raw: m[0], text: m[3], quoted: false });
    else if (m[2].trim()) out.push({ raw: m[0], text: (m[1] || '') + m[2], quoted: true });
  }
  return out;
}

// Liefert eine Liste von Bedingungen, jede mit Beschreibung (für die Anzeige) und Prüffunktion
export function parse(q) {
  const out = [];
  for (const tk of tokens(q)) {
    // typografische Minus- und Gedankenstriche wie „-“ behandeln, „€“/„EUR“ hinter einem Betrag ignorieren
    let t = tk.text.trim().replace(/^[−–—]/, '-');
    if (!tk.quoted && /^(€|eur|euro|-)$/i.test(t)) continue;
    if (!tk.quoted) t = t.replace(/(\d)\s*(€|eur|euro)$/i, '$1');
    let m;
    const add = (label, test, kind = 'filter', span) => out.push({ raw: tk.raw, label, test, kind, span });
    if (!tk.quoted) {
      if ((m = t.match(/^(\d{4})$/)) && isYear(+m[1])) { const y = +m[1]; add(`Jahr ${y}`, (r) => r.y === y, 'zeit', [`${y}-01`, `${y}-12`]); continue; }
      if ((m = t.match(/^(\d{4})-(\d{4})$/)) && isYear(+m[1]) && isYear(+m[2])) {
        const a = Math.min(+m[1], +m[2]), b = Math.max(+m[1], +m[2]);
        add(`${a} bis ${b}`, (r) => r.y >= a && r.y <= b, 'zeit', [`${a}-01`, `${b}-12`]); continue;
      }
      if ((m = t.match(/^(\d{1,2})[./](\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) {
        const iso = `${m[2]}-${pad(m[1])}`;
        add(`Monat ${pad(m[1])}/${m[2]}`, (r) => r.d.startsWith(iso), 'zeit', [iso, iso]); continue;
      }
      if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/))) {
        const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        const iso = `${y}-${pad(m[2])}-${pad(m[1])}`;
        add(`am ${pad(m[1])}.${pad(m[2])}.${y}`, (r) => r.d === iso, 'zeit', [iso.slice(0, 7), iso.slice(0, 7)]); continue;
      }
      if ((m = t.match(/^([<>]=?)(\d[\d.]*(?:,\d{1,2})?)€?$/))) {
        const v = cent(m[2]), op = m[1];
        const f = { '>': (a) => a > v, '>=': (a) => a >= v, '<': (a) => a < v, '<=': (a) => a <= v }[op];
        add(`Betrag ${op.startsWith('>') ? 'über' : 'unter'} ${fmtC(v)}`, (r) => f(Math.abs(r.c)), 'betrag'); continue;
      }
      if ((m = t.match(/^(\d[\d.]*(?:,\d{1,2})?)-(\d[\d.]*(?:,\d{1,2})?)€?$/))) {
        const a = cent(m[1]), b = cent(m[2]);
        add(`Betrag ${fmtC(Math.min(a, b))} bis ${fmtC(Math.max(a, b))}`, (r) => Math.abs(r.c) >= Math.min(a, b) && Math.abs(r.c) <= Math.max(a, b), 'betrag'); continue;
      }
      if ((m = t.match(/^-?(\d+)\.(\d{2})$/))) {
        // Dezimalpunkt (252.96) – drei Stellen nach dem Punkt bleiben Tausender (1.305)
        const v = +m[1] * 100 + +m[2], neg = t.startsWith('-');
        add(`Betrag ${neg ? '−' : ''}${fmtC(v)}`, (r) => (neg ? r.c === -v : Math.abs(r.c) === v), 'betrag'); continue;
      }
      if ((m = t.match(/^-?(\d[\d.]*,\d{1,2})€?$/)) || (m = t.match(/^-?(\d+)€$/))) {
        const v = cent(m[1]), neg = t.startsWith('-');
        add(`Betrag ${neg ? '−' : ''}${fmtC(v)}`, (r) => (neg ? r.c === -v : Math.abs(r.c) === v), 'betrag'); continue;
      }
      if ((m = t.match(/^(\d{1,4})$/))) {
        // Zahl ohne Komma: Betrag in vollen Euro ODER Text (z. B. Vertrags- oder Rechnungsnummer)
        const v = +m[1] * 100, n = m[1];
        add(`„${n}“ oder ${fmtC(v)}`, (r) => Math.abs(r.c) === v || r.s.includes(n), 'text'); continue;
      }
    }
    const neg = t.startsWith('-') && t.length > 1;
    const body = neg ? t.slice(1) : t;
    const alts = (tk.quoted ? [body] : body.split('|')).map(norm).filter(Boolean);
    if (!alts.length) continue;
    const label = alts.map((a) => `„${a}“`).join(' oder ');
    if (neg) add(`ohne ${label}`, (r) => !alts.some((w) => r.s.includes(w)), 'ohne');
    else out.push({ raw: tk.raw, label, test: (r) => alts.some((w) => r.s.includes(w)), kind: 'text', words: alts });
  }
  return out;
}

export function matcher(conds) {
  if (!conds.length) return () => true;
  return (r) => conds.every((c) => c.test(r));
}

// Suchwörter für die Hervorhebung in der Tabelle
export function highlightWords(conds) {
  return conds.filter((c) => c.kind === 'text' && c.words).flatMap((c) => c.words).filter((w) => w.length >= 2);
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
function fmtC(c) { return eur.format(c / 100).replace(',00', ''); }
