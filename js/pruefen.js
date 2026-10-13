// Kategorien prüfen (Reiter Kategorien › Prüfen): Checkliste der Buchungen ohne passende Kategorie, je Empfänger mit allen
// Einzelheiten der Bank (Verwendungszweck, IBAN, Mandat, Gläubiger-ID, Umsatzart, Kategorie laut Quelle, Datei) und mit
// Hinweisen, was dahinterstecken könnte. Du entscheidest selbst; die Entscheidung gilt sofort in der App.
// Gespeichert wird auf dem Gerät und – am PC – über den Einlese-Dienst in Auswertung\Kategorie-Entscheidungen.json; am Handy
// als Datei sichern und in den Eingang legen. finanzen_aufbauen.py übernimmt die Entscheidungen beim nächsten Aufbau.
// Schlüssel: e|<Name wie norm() in Python>|<+, - oder leer> = alle Buchungen des Empfängers; b|Datum|Konto|Cent = eine Buchung.
import * as Q from './quelle.js';

const KV = 'kategorie-entscheidungen';
const FREMD_ART = new Set(['Kinderkonto', 'Gemeinschaftskonto']);
let ENT = {};               // alle Entscheidungen (eigene und aus den Daten)
let UNSYNC = new Set();     // Schlüssel, die der PC noch nicht hat
let dienstOk = null;        // null = nicht versucht, true = PC-Dienst erreichbar, false = nicht
let H = null;               // Helfer aus app.js
let filter = 'offen', sortierung = 'betrag', suche = '', mehrBuchungen = false;
const angehakt = new Set();
let G = null;               // Gruppen-Cache (je Datenstand)

// wie norm() in finanzen_aufbauen.py – damit Empfänger-Regeln dort dieselben Buchungen treffen
export function pyNorm(s) {
  return String(s ?? '').toLowerCase().replace(/\d{4,}/g, '').replace(/[^a-zäöüß ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
const jetzt = () => new Date().toISOString().slice(0, 19);
const neuer = (a, b) => !b || String(a?.zeit || '') > String(b.zeit || '');
function mischen(obj) {
  let n = 0;
  for (const [k, e] of Object.entries(obj || {})) if (e && typeof e === 'object' && neuer(e, ENT[k])) { ENT[k] = e; n++; }
  return n;
}

// ---------------------------------------------------------------- Einzelheiten einer Buchung (details aus dashboard_daten.py)
export function det(r, j) {
  const d = j?.details;
  if (!d) return {};
  const z = d.zeilen[r.i] || [], o = {};
  d.spalten.forEach((k, i) => { o[k] = d.listen[k][z[i] || 0] || ''; });
  return o;
}
const eigeneRegel = (t) => /^(Deine Entscheidung|Von dir geprüft)/.test(t || '');

// ---------------------------------------------------------------- Entscheidungen auf die Buchungen anwenden (in aufbereiten)
// Gibt die geänderten Buchungen zurück (deren Suchtext neu gebildet werden muss).
export function entscheidungenAnwenden(rows, j) {
  mischen(j.kategorie_entscheidungen);
  const konten = j.konten, geaendert = [];
  for (const r of rows) {
    const rg = det(r, j).regel;
    if (eigeneRegel(rg)) r.ent = 'daten';
    if (rg) r.regel = rg;
  }
  const keys = Object.keys(ENT).filter((k) => !ENT[k].geloescht).sort((a, b) => (a[0] === 'e' ? 0 : 1) - (b[0] === 'e' ? 0 : 1));
  if (!keys.length) return geaendert;
  const nachName = new Map(), nachB = new Map();
  for (const r of rows) {
    const n = pyNorm(r.g);
    if (n) { if (!nachName.has(n)) nachName.set(n, []); nachName.get(n).push(r); }
    const b = `${r.d}|${konten[r.k].name}|${r.c}`;
    if (!nachB.has(b)) nachB.set(b, []); nachB.get(b).push(r);
  }
  const anwenden = (r, e, k, wie) => {
    if (FREMD_ART.has(r.art)) return;
    if (e.kat) { r.kat = e.kat; r.ukat = e.ukat || ''; }
    if (e.kat || 'umb' in e) {
      const umb = 'umb' in e ? !!e.umb : r.art === 'Umbuchung';
      r.art = umb ? 'Umbuchung' : r.kat === 'Sparen' ? 'Sparen' : r.c > 0 ? 'Einnahme' : 'Ausgabe';
    }
    r.ent = k; r.regel = wie + (e.notiz ? `: ${e.notiz}` : '');
    geaendert.push(r);
  };
  for (const k of keys) {
    const e = ENT[k], t = k.split('|');
    const nurGeprueft = e.ok && !e.kat && !('umb' in e);
    if (t[0] === 'e' && t[1]) {
      for (const r of nachName.get(t[1]) || []) {
        if ((t[2] === '+' && r.c <= 0) || (t[2] === '-' && r.c >= 0)) continue;
        anwenden(r, e, k, nurGeprueft ? 'Von dir geprüft' : `Deine Entscheidung (alle Buchungen von ${e.name || t[1]})`);
      }
    } else if (t[0] === 'b' && t.length >= 4) {
      let l = nachB.get(t.slice(1, 4).join('|')) || [];
      if (l.length > 1 && e.name) { const l2 = l.filter((r) => r.g === e.name || pyNorm(r.g) === pyNorm(e.name)); if (l2.length) l = l2; }
      for (const r of l) anwenden(r, e, k, nurGeprueft ? 'Von dir geprüft' : 'Deine Entscheidung (diese Buchung)');
    }
  }
  return geaendert;
}

// ---------------------------------------------------------------- Laden, speichern, mit dem PC abgleichen
// true = es gibt eigene Entscheidungen, die in den geladenen Daten noch fehlen (dann neu aufbereiten)
let ladenP = null;   // Abgleich mit dem PC erst, wenn die Entscheidungen vom Gerät geladen sind
export function entscheidungenLaden(j) {
  ladenP = laden(j);
  return ladenP;
}
async function laden(j) {
  const lokal = await Q.kvLesen(KV).catch(() => null);
  if (lokal?.ent) mischen(lokal.ent);
  UNSYNC = new Set(lokal?.unsync || []);
  const dj = j.kategorie_entscheidungen || {};
  for (const k of [...UNSYNC]) if (dj[k] && !neuer(ENT[k], dj[k])) UNSYNC.delete(k);   // inzwischen in den Daten
  await lokalSpeichern();
  return Object.entries(ENT).some(([k, e]) => neuer(e, dj[k]));
}
const lokalSpeichern = () => Q.kvSchreiben(KV, { ent: ENT, unsync: [...UNSYNC] }).catch(() => {});
const amPc = () => matchMedia('(pointer: fine)').matches && !/android|iphone|ipad/i.test(navigator.userAgent);

async function abgleichen() {
  if (ladenP) await ladenP.catch(() => {});
  if (!H || !amPc()) { dienstOk = false; return false; }
  const neu = {};
  for (const k of UNSYNC) if (ENT[k]) neu[k] = ENT[k];
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(H.DIENST + '/kategorien', { method: 'POST', headers: { 'X-Finanzen': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ entscheidungen: neu }), signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const x = await r.json();
    const mehr = mischen(x.entscheidungen);
    UNSYNC.clear(); dienstOk = true;
    await lokalSpeichern();
    return mehr > 0;
  } catch { dienstOk = false; return false; } finally { clearTimeout(t); }
}

async function dateiSichern() {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  const name = `Kategorie-Entscheidungen-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}.json`;
  const text = JSON.stringify({ version: 1, geaendert: jetzt(), entscheidungen: ENT }, null, 1);
  const datei = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [datei] })) { await navigator.share({ files: [datei], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  H.herunterladen(new Blob([text], { type: 'application/json' }), name);
}

// ---------------------------------------------------------------- Gruppen (je Empfänger)
const zaehlt = (r, D) => (r.art === 'Ausgabe' || r.art === 'Einnahme') && !(D.konten[r.k].kind || D.konten[r.k].gemeinsam);
const istOffen = (r, D) => zaehlt(r, D) && !r.ent && (r.kat === 'Nicht zugeordnet' || !r.kat || r.ukat === 'Unkategorisiert');
const gKey = (r) => pyNorm(r.g) || `?${pyNorm(r.z).slice(0, 25)}`;
export const gruppenSchluessel = gKey;
// Anzahl offener Buchungen (für den Knopf „Prüfen“)
export function offenZahl(D) {
  if (D._offen == null) D._offen = D.rows.filter((r) => istOffen(r, D)).length;
  return D._offen;
}

function gruppen() {
  const D = H.D();
  if (G && G.D === D) return G;
  const m = new Map(), nachIban = new Map();
  for (const r of D.rows) {
    const k = gKey(r);
    if (k === '?') continue;
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, ohneName: k[0] === '?', namen: new Map(), rows: [], offen: [] }));
    g.rows.push(r);
    if (r.g) g.namen.set(r.g, (g.namen.get(r.g) || 0) + 1);
    if (istOffen(r, D)) g.offen.push(r);
    const ib = det(r, D.j).iban;
    if (ib) { if (!nachIban.has(ib)) nachIban.set(ib, []); nachIban.get(ib).push(r); }
  }
  const liste = [];
  for (const g of m.values()) {
    g.name = [...g.namen].sort((a, b) => b[1] - a[1])[0]?.[0] || (g.rows[0].z || '').slice(0, 50) || '(ohne Namen)';
    const z = g.rows.filter((r) => zaehlt(r, D));
    g.aus = -z.filter((r) => r.c < 0).reduce((t, r) => t + r.c, 0);
    g.ein = z.filter((r) => r.c > 0).reduce((t, r) => t + r.c, 0);
    g.oAus = -g.offen.filter((r) => r.c < 0).reduce((t, r) => t + r.c, 0);
    g.oEin = g.offen.filter((r) => r.c > 0).reduce((t, r) => t + r.c, 0);
    g.entschieden = g.rows.some((r) => r.ent);
    g.letzt = g.rows.reduce((t, r) => (r.d > t ? r.d : t), '');
    // Zur Kontrolle: viel unter „Sonstige Einnahmen“ oder Buchungen in vielen verschiedenen Kategorien
    if (!g.offen.length && !g.entschieden && z.length) {
      const sonst = z.filter((r) => r.ukat === 'Sonstige Einnahmen').reduce((t, r) => t + r.c, 0);
      const kats = new Set(z.map((r) => r.kat));
      if (sonst >= 30000) g.kontrolle = `${H.eur0(sonst)} als „Sonstige Einnahmen“`;
      else if (kats.size >= 3 && z.length >= 5 && g.aus + g.ein >= 50000) g.kontrolle = `in ${kats.size} verschiedenen Kategorien`;
    }
    liste.push(g);
  }
  G = { D, m, nachIban, liste };
  return G;
}

// ---------------------------------------------------------------- Hinweise und Vorschläge
const STICHWORTE = [
  [/\bmiete\b|kaltmiete|nebenkosten/, 'Wohnen', 'Miete'], [/kindesunterhalt/, 'Kinder', 'Kindesunterhalt'], [/trennungsunterhalt/, 'Finanzen', 'Trennungsunterhalt'],
  [/urlaub|ferienwohnung|ferienhaus|hotel|booking\.com|airbnb/, 'Freizeit', 'Urlaub'], [/geschenk|geburtstag|hochzeit|weihnacht/, 'Lifestyle', 'Geschenke'],
  [/darlehen|kredit|tilgung/, 'Finanzen', 'Kredit'], [/kindergeld|familienkasse/, 'Einnahmen', 'Kindergeld'], [/taschengeld/, 'Kinder', 'Taschengeld'],
  [/kita\b|kindergarten|\bhort\b|betreuung/, 'Kinder', 'Kinderbetreuung'], [/schule|nachhilfe|klassenfahrt/, 'Kinder', 'Schule & Foerderung'],
  [/zahnarzt|arztpraxis|\bpraxis\b|klinik|physio|\bdr\.? med/, 'Gesundheit', 'Aerztliche Behandlung'], [/apotheke/, 'Gesundheit', 'Apotheke'],
  [/rechtsanwalt|anwalt|kanzlei|amtsgericht|gerichtskasse/, 'Finanzen', 'Rechtsanwalt'], [/spende/, 'Finanzen', 'Spende'],
  [/mitgliedsbeitrag|\bverein\b|\be\.\s?v\.|ortsverein/, 'Freizeit', 'Mitgliedschaft'], [/jagd|revier|wildschaden|jagdpacht/, 'Freizeit', 'Jagd'],
  [/geldautomat|bargeld/, 'Sonstiges', 'Bargeld'], [/werkstatt|reifen|\bkfz\b|autohaus/, 'Mobilitaet', 'Auto'], [/stadtwerke|\bstrom\b/, 'Wohnen', 'Strom'],
  [/handwerk|renovier|baumarkt|fliesen|maler/, 'Wohnen', 'Bauen / Renovieren'], [/finanzamt|steuer/, 'Finanzen', 'Steuern'], [/versicherung/, 'Versicherungen', 'Sonstige Versicherungen'],
  [/gehalt|\blohn\b|bezuege|bezüge/, 'Einnahmen', 'Lohn / Gehalt', '+'], [/rueckzahlung|rückzahlung|erstattung|auslage|zurueck|zurück/, 'Einnahmen', 'Sonstige Einnahmen', '+'],
];
const FIRMA = /\b(gmbh|ag|kg|se|ohg|ug|e\.?\s?v|mbh|gbr|bank|kasse|versicherung|stadt|gemeinde|amt|verlag|service|shop|markt|apotheke|\.de|\.com|inc|ltd|paypal)\b/i;
const paar = (k, u) => `${k}|${u}`;
// IBAN in Vierergruppen; ältere Kontoauszüge haben nur die Kontonummer, PayPal die E-Mail-Adresse der Gegenseite
export const ibanText = (ib) => (!ib ? '' : /^[A-Z]{2}\d{2}/.test(ib) ? ib.replace(/(.{4})/g, '$1 ').trim() : ib.includes('@') ? `PayPal: ${ib.toLowerCase()}` : `Konto-Nr. ${ib}`);
const katText = (k, u) => `${H.schoen(k)}${u ? ` › ${H.schoen(u)}` : ''}`;

function analyse(g) {
  const { D, nachIban } = gruppen(), j = D.j;
  const hinw = [], vor = new Map();
  const vorschlag = (k, u, w, grund, umb = false) => {
    if (!k || k === 'Nicht zugeordnet' || u === 'Unkategorisiert') return;
    if (!umb && u && !D.ukatZu.has(u)) return;
    const key = umb ? 'umb' : paar(k, u), x = vor.get(key) || { kat: k, ukat: u, umb, w: 0, gruende: [] };
    x.w += w; if (grund && !x.gruende.includes(grund)) x.gruende.push(grund); vor.set(key, x);
  };
  const dts = g.rows.map((r) => det(r, j));
  // Vorschläge passend zur Richtung der offenen Buchungen (eine Ausgabe wird keine Einnahme)
  const ri = g.offen.length && g.offen.every((r) => r.c < 0) ? -1 : g.offen.length && g.offen.every((r) => r.c > 0) ? 1 : 0;
  const passt = (r) => !ri || Math.sign(r.c) === ri;
  // 1. IBAN: dieselbe Gegenseite unter anderem Namen bereits eingeordnet?
  const ibans = [...new Set(dts.map((d) => d.iban).filter(Boolean))];
  for (const ib of ibans.slice(0, 3)) {
    const andere = (nachIban.get(ib) || []).filter((r) => gKey(r) !== g.key && zaehlt(r, D) && !istOffen(r, D) && passt(r));
    if (!andere.length) continue;
    const c = new Map();
    for (const r of andere) { const k = paar(r.kat, r.ukat); c.set(k, (c.get(k) || 0) + 1); }
    const [top, n] = [...c].sort((a, b) => b[1] - a[1])[0];
    const namen = [...new Set(andere.map((r) => r.g).filter(Boolean))].slice(0, 2).join(', ');
    hinw.push(`Dieselbe IBAN kennst du auch als <b>${H.esc(namen)}</b> – dort meist <b>${H.esc(katText(...top.split('|')))}</b> (${n} von ${andere.length} Buchungen).`);
    vorschlag(...top.split('|'), 3, 'gleiche IBAN');
  }
  // 2. Derselbe Empfänger hat andere Buchungen, die schon eingeordnet sind
  const fertig = g.rows.filter((r) => zaehlt(r, D) && !istOffen(r, D) && passt(r));
  if (fertig.length) {
    const c = new Map();
    for (const r of fertig) { const k = paar(r.kat, r.ukat); c.set(k, (c.get(k) || 0) + 1); }
    const s = [...c].sort((a, b) => b[1] - a[1]);
    hinw.push(`Andere ${ri < 0 ? 'Ausgänge' : ri > 0 ? 'Eingänge' : 'Buchungen'} dieses Empfängers stehen unter ${s.slice(0, 3).map(([k, n]) => `<b>${H.esc(katText(...k.split('|')))}</b> (${n}×)`).join(', ')}.`);
    s.slice(0, 2).forEach(([k], i) => vorschlag(...k.split('|'), 2 - i * 0.5, 'wie seine anderen Buchungen'));
  }
  // 3. Lastschrift eines Unternehmens
  const gid = dts.find((d) => d.gid)?.gid, mref = dts.find((d) => d.mref)?.mref;
  if (gid) hinw.push(`Lastschrift mit Gläubiger-ID <code>${H.esc(gid)}</code>${mref ? ` (Mandat <code>${H.esc(mref)}</code>)` : ''} – ein Unternehmen zieht ein: meist Vertrag, Abo oder Rechnung.`);
  // 4. Kartenzahlung
  if (dts.some((d) => /karte/i.test(d.uart)) || g.rows.some((r) => /debitkarten|kartenzahlung|visa/i.test(r.z))) hinw.push('Kartenzahlung – also ein Geschäft, eine Tankstelle oder ein Online-Händler.');
  // 5. Regelmäßig gleicher Betrag
  const o = g.offen.length ? g.offen : g.rows;
  const betr = new Map();
  for (const r of o) betr.set(r.c, (betr.get(r.c) || 0) + 1);
  const [bc, bn] = [...betr].sort((a, b) => b[1] - a[1])[0] || [];
  if (bn >= 3) {
    const ds = o.filter((r) => r.c === bc).map((r) => r.d).sort();
    const tage = (new Date(ds.at(-1)) - new Date(ds[0])) / 864e5 / (ds.length - 1);
    const rh = tage < 10 ? '' : tage < 45 ? 'etwa monatlich' : tage < 120 ? 'etwa vierteljährlich' : tage < 400 ? 'etwa jährlich' : '';
    hinw.push(`Regelmäßig: <b>${bn}× ${H.eur(bc)}</b>${rh ? ` (${rh})` : ''} von ${H.dde(ds[0])} bis ${H.dde(ds.at(-1))} – sieht nach einer festen Zahlung aus.`);
  }
  // 6. Geld in beide Richtungen
  if (g.ein && g.aus) hinw.push(`Geld ging in beide Richtungen: raus <b class="neg">${H.eur0(g.aus)}</b>, rein <b class="pos">${H.eur0(g.ein)}</b> – z. B. Auslagen, geliehenes Geld oder Erstattungen.`);
  // 7. Gegenbuchung auf einem eigenen Konto (± 3 Tage, gleicher Betrag) → Umbuchung?
  const proKonto = D.proKonto;
  let gegen = null;
  for (const r of g.offen.slice(0, 40)) {
    const t0 = new Date(r.d).getTime();
    for (let k = 0; k < proKonto.length && !gegen; k++) {
      if (k === r.k) continue;
      // nur wenn die Gegenbuchung selbst nach eigenem Geld aussieht (Umbuchung, Sparen oder dein Name)
      const x = proKonto[k].find((y) => y.c === -r.c && Math.abs(new Date(y.d).getTime() - t0) <= 3 * 864e5
        && (y.art === 'Umbuchung' || y.art === 'Sparen' || /wenzelides/i.test(y.g)));
      if (x) gegen = [r, x];
    }
    if (gegen) break;
  }
  if (gegen) {
    hinw.push(`Am ${H.dde(gegen[1].d)} ${gegen[1].c > 0 ? 'kam' : 'ging'} derselbe Betrag (${H.eur(Math.abs(gegen[0].c))}) auf deinem Konto <b>${H.esc(D.konten[gegen[1].k].name)}</b> ${gegen[1].c > 0 ? 'an' : 'ab'} – vermutlich Geld zwischen deinen eigenen Konten.`);
    vorschlag('Umbuchung', '', 3, 'Gegenbuchung auf eigenem Konto', true);
  }
  // 8. Stichwörter im Text
  const text = H.norm(g.rows.slice(0, 80).map((r) => `${r.g} ${r.z}`).join(' '));
  for (const [re, k, u, vz] of STICHWORTE) {
    if (!re.test(text)) continue;
    if (vz === '+' && !g.ein) continue;
    vorschlag(k, u, 1.5, 'Stichwort im Text');
  }
  // 9. Privatperson?
  if (!g.ohneName && !FIRMA.test(g.name) && /^[a-zäöüß.-]+,?\s+[a-zäöüß.-]+(\s+[a-zäöüß.-]+)?$/i.test(g.name.trim()) && !gid) {
    hinw.push('Der Name sieht nach einer <b>Privatperson</b> aus – typisch: Geld an Familie oder Freunde, Privatverkauf, geteilte Kosten oder Rückzahlungen.');
  }
  // 10. Was Finanzguru bzw. die alte Quelle gesagt hat, und was eine Regel geändert hat
  const k0 = new Map();
  for (const d of dts) if (d.kat0) k0.set(d.kat0, (k0.get(d.kat0) || 0) + 1);
  const k0s = [...k0].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (k0s.length) hinw.push(`Kategorie laut Quelle (Finanzguru bzw. Bank/WISO): ${k0s.map(([k, n]) => `${H.esc(k.replace(/ › $/, ''))} (${n}×)`).join(', ')}.`);
  const vs = [...vor.values()].sort((a, b) => b.w - a.w).slice(0, 4);
  return { hinw, vor: vs, ibans, gegen };
}

// ---------------------------------------------------------------- Seite
const ART = { offen: 'Offen', kontrolle: 'Zur Kontrolle', erledigt: 'Erledigt' };
function sichtbar(liste) {
  let l = filter === 'offen' ? liste.filter((g) => g.offen.length) : filter === 'kontrolle' ? liste.filter((g) => g.kontrolle) : liste.filter((g) => g.entschieden);
  if (suche) { const q = H.norm(suche); l = l.filter((g) => H.norm(`${g.name} ${[...g.namen.keys()].join(' ')}`).includes(q)); }
  const wert = (g) => (filter === 'offen' ? g.oAus + g.oEin : g.aus + g.ein);
  const anz = (g) => (filter === 'offen' ? g.offen.length : g.rows.length);
  return l.sort(sortierung === 'anzahl' ? (a, b) => anz(b) - anz(a) || wert(b) - wert(a) : sortierung === 'datum' ? (a, b) => b.letzt.localeCompare(a.letzt) : (a, b) => wert(b) - wert(a));
}

export function pruefenSeite(h) {
  H = h;
  const { liste, m } = gruppen();
  const offen = liste.filter((g) => g.offen.length), kontr = liste.filter((g) => g.kontrolle), erl = liste.filter((g) => g.entschieden);
  const nOffen = offen.reduce((t, g) => t + g.offen.length, 0);
  const oAus = offen.reduce((t, g) => t + g.oAus, 0), oEin = offen.reduce((t, g) => t + g.oEin, 0);
  const l = sichtbar(liste);
  let wahl = m.get(H.S().wahl);
  if (!wahl || (!l.includes(wahl) && !H.S().wahl)) wahl = l[0] || null;
  const satz = nOffen
    ? `<b>${H.NUM.format(nOffen)} Buchungen</b> von ${H.NUM.format(offen.length)} Empfängern haben noch keine passende Kategorie – zusammen <b class="neg">${H.eur0(oAus)}</b> raus und <b class="pos">${H.eur0(oEin)}</b> rein. Je Empfänger genügt eine Entscheidung; sie gilt sofort.`
    : 'Alle Buchungen haben eine Kategorie. Unter „Zur Kontrolle“ stehen Empfänger, bei denen sich ein Blick lohnt.';
  const rechts = `<div class="seg" role="group" aria-label="Ausgaben, Einnahmen oder Prüfen"><button data-k2art="aus">Ausgaben</button><button data-k2art="ein">Einnahmen</button><button data-k2art="pruefen" class="an">Prüfen</button></div>`;
  const ung = Object.keys(ENT).filter((k) => UNSYNC.has(k)).length;
  const speicher = dienstOk ? (ung ? `${ung} noch nicht am PC` : 'am PC gespeichert') : ung ? `${ung} nur hier` : 'alles gespeichert';
  const zahlen = [
    H.zahl5('Offen', H.NUM.format(nOffen), `Buchungen · ${H.NUM.format(offen.length)} Empfänger`, { cls: nOffen ? 'neg' : 'pos' }),
    H.zahl5('Zur Kontrolle', H.NUM.format(kontr.length), 'Empfänger mit gemischten oder „sonstigen“ Kategorien'),
    H.zahl5('Erledigt', H.NUM.format(erl.length), 'Empfänger, die du entschieden hast'),
    `<div class="s5-z pr-speicher"><span class="s5-z-t">Gespeichert</span><b class="s5-z-w ${ung && !dienstOk ? 'neg' : ''}">${speicher}</b><span class="s5-z-u">
      ${dienstOk ? '<button class="link" id="pr-uebernehmen">Jetzt in die Auswertung übernehmen</button>' : `<button class="link" id="pr-sichern">Als Datei sichern</button> → Google Drive › 10 Finanzen › Eingang`}</span></div>`,
  ].join('');

  const zeile = (g) => {
    const n = filter === 'offen' ? g.offen.length : g.rows.length;
    const aus = filter === 'offen' ? g.oAus : g.aus, ein = filter === 'offen' ? g.oEin : g.ein;
    const sub = filter === 'kontrolle' ? g.kontrolle : filter === 'erledigt' ? H.esc(entText(g)) : `${n} ${n === 1 ? 'Buchung' : 'Buchungen'} · bis ${H.dde(g.letzt).slice(3)}`;
    return `<button class="pr-z${g === wahl ? ' an' : ''}${g.entschieden ? ' fertig' : ''}" data-pr-g="${H.esc(g.key)}">
      <i class="pr-haken" aria-hidden="true">${g.entschieden ? '✓' : ''}</i>
      <span class="pr-zn"><b>${H.esc(g.name)}</b><small>${sub}</small></span>
      <span class="pr-zw">${aus ? `<b class="neg">−${H.eur0(aus).replace('-', '')}</b>` : ''}${ein ? `<b class="pos">+${H.eur0(ein)}</b>` : ''}</span></button>`;
  };
  const kopfListe = `<div class="pr-lk">
    <div class="seg pr-filter" role="group">${Object.entries(ART).map(([k, t]) => `<button data-pr-f="${k}" class="${filter === k ? 'an' : ''}">${t}<small>${k === 'offen' ? offen.length : k === 'kontrolle' ? kontr.length : erl.length}</small></button>`).join('')}</div>
    <div class="pr-lk2"><input id="pr-suche" type="search" placeholder="Empfänger suchen …" value="${H.esc(suche)}" list="pr-namen" autocomplete="off">
      <select id="pr-sort" aria-label="Sortierung"><option value="betrag"${sortierung === 'betrag' ? ' selected' : ''}>nach Betrag</option><option value="anzahl"${sortierung === 'anzahl' ? ' selected' : ''}>nach Anzahl</option><option value="datum"${sortierung === 'datum' ? ' selected' : ''}>neueste zuerst</option></select></div>
    <datalist id="pr-namen">${gruppen().liste.filter((g) => !g.ohneName).sort((a, b) => b.rows.length - a.rows.length).slice(0, 400).map((g) => `<option value="${H.esc(g.name)}">`).join('')}</datalist></div>`;
  const listeHtml = `<div class="pr-liste">${l.length ? l.map(zeile).join('') : `<p class="leer klein">${suche ? 'Kein Empfänger passt zur Suche.' : filter === 'offen' ? 'Nichts mehr offen. 🎉' : 'Noch nichts.'}</p>`}</div>`;
  const links = `<section class="card s5-karte pr-links"><div class="s5-kt"><div class="s5-kt-t"><h2>Checkliste</h2><p class="s5-erkl">ein Eintrag je Empfänger · anklicken: alle Einzelheiten</p></div>
    <div class="s5-kt-r"><button class="btn sm" id="pr-excel" title="Alle offenen Buchungen mit allen Angaben als Excel-Datei">Excel</button></div></div>${kopfListe}${listeHtml}</section>`;
  return H.kopf5('Kategorien prüfen', satz, rechts) + `<div class="s5-zahlen">${zahlen}</div><div class="pr">${links}${wahl ? detailHtml(wahl) : '<section class="card s5-karte"><p class="leer">Links einen Empfänger wählen.</p></section>'}</div>`;
}

function entText(g) {
  const r = g.rows.find((x) => x.ent);
  if (!r) return '';
  return r.regel?.startsWith('Von dir geprüft') ? 'geprüft – passt so' : r.art === 'Umbuchung' ? 'zählt nicht (eigenes Geld)' : `→ ${katText(r.kat, r.ukat)}`;
}

function detailHtml(g) {
  const { D } = gruppen(), j = D.j;
  const A = analyse(g);
  const namen = [...g.namen.keys()].filter((n) => n !== g.name);
  const frueher = [...new Set(g.rows.flatMap((r) => r.ga))].filter((n) => !g.namen.has(n));
  const konten = [...new Set(g.rows.map((r) => D.konten[r.k].name))];
  const von = g.rows.reduce((t, r) => (r.d < t ? r.d : t), '9999'), bis = g.letzt;
  const kopf = `<div class="pr-dk"><h2>${H.esc(g.name)}</h2>
    <div class="pr-fakten">
      <span><small>Buchungen</small><b>${g.rows.length}${g.offen.length ? ` <em>· ${g.offen.length} offen</em>` : ''}</b></span>
      ${g.aus ? `<span><small>raus</small><b class="neg">${H.eur(-g.aus)}</b></span>` : ''}${g.ein ? `<span><small>rein</small><b class="pos">${H.eur(g.ein)}</b></span>` : ''}
      <span><small>Zeitraum</small><b>${H.dde(von)} – ${H.dde(bis)}</b></span>
    </div>
    <dl class="pr-dl">
      ${A.ibans.length ? `<dt>IBAN</dt><dd>${A.ibans.map((ib) => `<code>${ibanText(ib)}</code>`).join('<br>')}</dd>` : ''}
      ${namen.length ? `<dt>Auch geschrieben</dt><dd>${namen.slice(0, 4).map(H.esc).join(' · ')}</dd>` : ''}
      ${frueher.length ? `<dt>Früher genannt</dt><dd>${frueher.slice(0, 4).map(H.esc).join(' · ')}</dd>` : ''}
      <dt>Konten</dt><dd>${konten.map(H.esc).join(' · ')}</dd>
    </dl></div>`;
  const hinw = A.hinw.length ? `<div class="pr-hinw"><h3>Was dahinterstecken könnte</h3><ul>${A.hinw.map((t) => `<li>${t}</li>`).join('')}</ul></div>` : '';

  // Entscheidung
  const vz = g.offen.length && g.offen.every((r) => r.c < 0) ? '-' : g.offen.length && g.offen.every((r) => r.c > 0) ? '+' : '';
  const beide = g.ein && g.aus;
  const alleOffen = g.offen.length === g.rows.filter((r) => zaehlt(r, D)).length;
  const geltung = g.ohneName ? 'offen' : alleOffen || !g.offen.length ? 'alle' : 'offen';
  const kats = [...new Set([...D.kats, 'Umbuchung'])].filter((k) => k !== 'Nicht zugeordnet');
  const jetzigeR = g.rows.find((r) => r.ent) || g.offen[0] || g.rows[0];
  const startKat = A.vor[0] && !A.vor[0].umb ? A.vor[0].kat : jetzigeR.kat !== 'Nicht zugeordnet' ? jetzigeR.kat : '';
  const startUkat = A.vor[0] && !A.vor[0].umb ? A.vor[0].ukat : jetzigeR.kat !== 'Nicht zugeordnet' ? jetzigeR.ukat : '';
  const chips = A.vor.map((v, i) => `<button class="pr-chip" data-pr-v="${i}" title="${H.esc(v.gruende.join(', '))}">${v.umb ? 'Zählt nicht – eigenes Geld' : H.esc(katText(v.kat, v.ukat))}<small>${H.esc(v.gruende[0] || '')}</small></button>`).join('');
  const entsch = `<div class="pr-ent" id="pr-ent">
    <h3>Deine Entscheidung</h3>
    ${chips ? `<div class="pr-chips"><span class="klein muted">Vorschläge:</span>${chips}</div>` : ''}
    <div class="pr-form">
      <label><span>Kategorie</span><select id="pr-kat"><option value="">– wählen –</option>${kats.map((k) => `<option value="${H.esc(k)}"${k === startKat ? ' selected' : ''}>${H.esc(H.schoen(k))}</option>`).join('')}</select></label>
      <label><span>Unterkategorie</span><select id="pr-ukat">${ukatOptionen(startKat, startUkat)}</select></label>
      <label class="pr-neu" hidden><span>Neue Unterkategorie</span><input id="pr-ukat-neu" type="text" maxlength="40"></label>
      <label class="pr-check"><input type="checkbox" id="pr-umb"${startKat === 'Umbuchung' ? ' checked' : ''}> <span>Zählt nicht als Einnahme/Ausgabe<small>Geld zwischen deinen eigenen Konten oder durchlaufendes Geld</small></span></label>
      <label class="pr-notiz"><span>Notiz (optional)</span><input id="pr-notiz" type="text" maxlength="120" placeholder="z. B. Privatverkauf Kinderwagen"></label>
    </div>
    <div class="pr-geltung" role="radiogroup" aria-label="Gilt für">
      ${g.ohneName ? '' : `<label><input type="radio" name="pr-gilt" value="alle"${geltung === 'alle' ? ' checked' : ''}> alle ${g.rows.length} Buchungen von „${H.esc(g.name.slice(0, 40))}“, auch künftige${alleOffen ? '' : ' <small class="neg">(auch die schon eingeordneten)</small>'}</label>`}
      ${g.offen.length ? `<label><input type="radio" name="pr-gilt" value="offen"${geltung === 'offen' ? ' checked' : ''}> nur die ${g.offen.length} offenen</label>` : ''}
      <label><input type="radio" name="pr-gilt" value="auswahl"> nur die angehakten Buchungen <small id="pr-n-ausw">(${angehakt.size})</small></label>
      ${beide && !g.ohneName ? `<label class="pr-vz"><span>bei</span><select id="pr-vz"><option value=""${vz === '' ? ' selected' : ''}>Ein- und Ausgängen</option><option value="-"${vz === '-' ? ' selected' : ''}>nur Ausgängen</option><option value="+"${vz === '+' ? ' selected' : ''}>nur Eingängen</option></select></label>` : `<input type="hidden" id="pr-vz" value="${vz}">`}
    </div>
    <div class="pr-knoepfe"><button class="btn primary" id="pr-speichern">Speichern und weiter</button>
      ${g.kontrolle || g.entschieden ? '<button class="btn" id="pr-passt">Passt so</button>' : ''}
      ${g.entschieden ? '<button class="btn" id="pr-zuruecknehmen">Entscheidung zurücknehmen</button>' : ''}
      <button class="btn" id="pr-weiter">Später</button></div>
  </div>`;

  // Buchungen mit allen Angaben
  const sortiert = [...g.rows].sort((a, b) => (istOffen(b, D) - istOffen(a, D)) || b.d.localeCompare(a.d));
  const zeig = mehrBuchungen ? sortiert : sortiert.slice(0, 30);
  const wt = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const buchung = (r) => {
    const d = det(r, j), of = istOffen(r, D), fremd = !zaehlt(r, D);
    const x = [d.uart && ['Umsatzart', d.uart], d.iban && ['IBAN', ibanText(d.iban)], d.mref && ['Mandat', d.mref], d.gid && ['Gläubiger-ID', d.gid],
      ['jetzt', `${katText(r.kat, r.ukat)}${r.art === 'Umbuchung' ? ' · zählt nicht' : fremd ? ` · ${r.art}` : ''}`],
      d.kat0 && d.kat0.replace(/ › $/, '') !== r.kat + (r.ukat ? ` › ${r.ukat}` : '') && ['laut Quelle', d.kat0.replace(/ › $/, '')],
      r.regel && ['geändert durch', r.regel], r.v && ['Vertrag', r.v], r.t && ['Tags', r.t], r.n && ['Notiz', r.n], r.ga.length && ['früher', r.ga.join(', ')],
      d.quelle && ['Datei', d.quelle.replace(/ › .*/, '').split(/[\\/]/).pop()]].filter(Boolean);
    return `<label class="pr-b${of ? ' offen' : ''}${fremd ? ' fremd' : ''}"><input type="checkbox" data-pr-b="${r.i}"${angehakt.has(r.i) ? ' checked' : ''}>
      <span class="pr-b-k"><span>${wt[new Date(`${r.d}T12:00:00Z`).getUTCDay()]} ${H.dde(r.d)}</span><span class="muted">${H.esc(D.konten[r.k].name)}</span><b class="${r.c < 0 ? 'neg' : 'pos'}">${H.eur(r.c)}</b></span>
      ${r.g && r.g !== g.name ? `<span class="pr-b-n">${H.esc(r.g)}</span>` : ''}
      <span class="pr-b-z">${H.esc(r.z || '(kein Verwendungszweck)')}</span>
      <span class="pr-b-x">${x.map(([k, v]) => `<span><i>${k}</i> ${H.esc(v)}</span>`).join('')}</span></label>`;
  };
  const buchungen = `<div class="pr-bl"><div class="pr-bl-k"><h3>Alle Buchungen</h3><span class="klein muted">offene zuerst (orange) · anhaken, um nur einzelne zu entscheiden</span>
      <span class="pr-bl-r"><button class="link" id="pr-alle-haken">${g.offen.length ? 'offene anhaken' : 'alle anhaken'}</button> · <span class="zl" role="button" tabindex="0"${H.geh(H.zuBuchungen({ q: g.ohneName ? '' : `"${g.name}"` }))}>in Buchungen öffnen</span></span></div>
    ${zeig.map(buchung).join('')}${sortiert.length > zeig.length ? `<button class="btn sm" id="pr-mehr">alle ${sortiert.length} zeigen</button>` : ''}</div>`;
  return `<section class="card s5-karte pr-detail" data-pr-detail="${H.esc(g.key)}">${kopf}${hinw}${entsch}${buchungen}</section>`;
}

function ukatOptionen(kat, wahl) {
  const { D } = gruppen();
  const n = new Map();
  for (const r of D.rows) if (r.kat === kat && r.ukat && r.ukat !== 'Unkategorisiert') n.set(r.ukat, (n.get(r.ukat) || 0) + 1);
  const l = [...n].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  if (wahl && !l.includes(wahl)) l.unshift(wahl);
  return `<option value="">– ohne –</option>${l.map((u) => `<option value="${H.esc(u)}"${u === wahl ? ' selected' : ''}>${H.esc(H.schoen(u))}</option>`).join('')}<option value="__neu">+ neue Unterkategorie …</option>`;
}

// ---------------------------------------------------------------- Klicks
export function pruefenBinden(el) {
  const neu = (p = {}) => { if (Object.keys(p).length) H.setze(p); else H.neuZeichnen(); };
  el.querySelectorAll('[data-pr-f]').forEach((b) => b.onclick = () => { filter = b.dataset.prF; angehakt.clear(); mehrBuchungen = false; H.setze({ wahl: '' }); });
  el.querySelectorAll('[data-pr-g]').forEach((b) => b.onclick = () => {
    angehakt.clear(); mehrBuchungen = false; H.setze({ wahl: b.dataset.prG });
    if (matchMedia('(max-width: 1000px)').matches) document.querySelector('.pr-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const su = el.querySelector('#pr-suche');
  if (su) {
    su.oninput = () => {
      suche = su.value; const pos = su.selectionStart;
      const g = gruppen().liste.find((x) => x.name === suche);
      if (g) suche = '';
      neu(g ? { wahl: g.key } : {});
      const s2 = document.querySelector('#pr-suche'); if (s2 && !g) { s2.focus(); s2.setSelectionRange(pos, pos); }
    };
  }
  el.querySelector('#pr-sort')?.addEventListener('change', (e) => { sortierung = e.target.value; neu(); });
  el.querySelector('#pr-mehr')?.addEventListener('click', () => { mehrBuchungen = true; neu(); });
  el.querySelector('#pr-sichern')?.addEventListener('click', dateiSichern);
  el.querySelector('#pr-excel')?.addEventListener('click', excel);
  el.querySelector('#pr-uebernehmen')?.addEventListener('click', () => H.einlesen());
  const det_ = el.querySelector('[data-pr-detail]');
  if (!det_) return;
  const g = gruppen().m.get(det_.dataset.prDetail);
  const kat = el.querySelector('#pr-kat'), ukat = el.querySelector('#pr-ukat'), umb = el.querySelector('#pr-umb'), neuBox = el.querySelector('.pr-neu');
  const radio = (v) => { const x = el.querySelector(`input[name="pr-gilt"][value="${v}"]`); if (x) x.checked = true; };
  kat.onchange = () => { ukat.innerHTML = ukatOptionen(kat.value, ''); neuBox.hidden = true; if (kat.value === 'Umbuchung') umb.checked = true; };
  ukat.onchange = () => { neuBox.hidden = ukat.value !== '__neu'; if (!neuBox.hidden) el.querySelector('#pr-ukat-neu').focus(); };
  const A = analyse(g);
  el.querySelectorAll('[data-pr-v]').forEach((b) => b.onclick = () => {
    const v = A.vor[+b.dataset.prV];
    el.querySelectorAll('.pr-chip').forEach((c) => c.classList.toggle('an', c === b));
    if (v.umb) { umb.checked = true; return; }
    umb.checked = false; kat.value = v.kat; ukat.innerHTML = ukatOptionen(v.kat, v.ukat); neuBox.hidden = true;
  });
  el.querySelectorAll('[data-pr-b]').forEach((c) => c.onchange = () => {
    const i = +c.dataset.prB; c.checked ? angehakt.add(i) : angehakt.delete(i);
    el.querySelector('#pr-n-ausw').textContent = `(${angehakt.size})`;
    radio(angehakt.size ? 'auswahl' : g.offen.length ? 'offen' : 'alle');
  });
  el.querySelector('#pr-alle-haken')?.addEventListener('click', () => {
    const D = gruppen().D;
    for (const r of g.offen.length ? g.offen : g.rows) angehakt.add(r.i);
    el.querySelectorAll('[data-pr-b]').forEach((c) => { c.checked = angehakt.has(+c.dataset.prB); });
    el.querySelector('#pr-n-ausw').textContent = `(${angehakt.size})`; radio('auswahl'); void D;
  });
  const naechste = () => {
    const l = sichtbar(gruppen().liste).filter((x) => x.key !== g.key && !(filter === 'offen' && !x.offen.length));
    return l[0]?.key || '';
  };
  el.querySelector('#pr-weiter').onclick = () => { angehakt.clear(); mehrBuchungen = false; H.setze({ wahl: naechste() }); };
  el.querySelector('#pr-speichern').onclick = () => {
    let u = ukat.value === '__neu' ? el.querySelector('#pr-ukat-neu').value.trim() : ukat.value;
    const k = kat.value;
    if (!k && !umb.checked) { H.toast('Bitte eine Kategorie wählen oder „Zählt nicht“ anhaken.'); kat.focus(); return; }
    const e = { kat: k || 'Umbuchung', ukat: k ? u : '', umb: umb.checked, notiz: el.querySelector('#pr-notiz').value.trim() };
    speichern(g, e, el.querySelector('input[name="pr-gilt"]:checked')?.value || 'offen', el.querySelector('#pr-vz')?.value || '', naechste());
  };
  el.querySelector('#pr-passt')?.addEventListener('click', () => speichern(g, { ok: true }, 'alle', '', naechste()));
  el.querySelector('#pr-zuruecknehmen')?.addEventListener('click', () => {
    const keys = Object.keys(ENT).filter((k) => !ENT[k].geloescht && betrifft(k, g));
    if (!keys.length) { H.toast('Diese Entscheidung steht schon in den Daten – zurücknehmen geht in Auswertung › Kategorie-Entscheidungen.json bzw. nach dem nächsten Einlesen hier.'); return; }
    const vorher = keys.map((k) => [k, ENT[k]]);
    for (const k of keys) { ENT[k] = { geloescht: true, zeit: jetzt() }; UNSYNC.add(k); }
    fertig(`Entscheidung für „${g.name}“ zurückgenommen.`, vorher, g.key);
  });
}

function betrifft(k, g) {
  const t = k.split('|');
  if (t[0] === 'e') return t[1] === g.key;
  const { D } = gruppen();
  return g.rows.some((r) => `${r.d}|${D.konten[r.k].name}|${r.c}` === t.slice(1, 4).join('|'));
}

function speichern(g, e, gilt, vz, weiter) {
  const { D } = gruppen();
  e = { ...e, zeit: jetzt(), name: g.name };
  if (!e.notiz) delete e.notiz;
  let rows = gilt === 'alle' ? null : gilt === 'auswahl' ? g.rows.filter((r) => angehakt.has(r.i)) : g.offen;
  if (gilt === 'auswahl' && !rows.length) { H.toast('Keine Buchung angehakt.'); return; }
  if (g.ohneName && !rows) rows = g.offen.length ? g.offen : g.rows;
  const keys = rows ? rows.map((r) => [`b|${r.d}|${D.konten[r.k].name}|${r.c}`, { ...e, name: r.g || e.name }]) : [[`e|${g.key}|${vz}`, { ...e, n: g.rows.length }]];
  const vorher = keys.map(([k]) => [k, ENT[k]]);
  for (const [k, x] of keys) { ENT[k] = x; UNSYNC.add(k); }
  const was = e.ok ? 'geprüft – passt so' : e.umb ? 'zählt nicht' : katText(e.kat, e.ukat);
  fertig(`„${g.name}“: ${was} (${rows ? `${rows.length} ${rows.length === 1 ? 'Buchung' : 'Buchungen'}` : 'alle Buchungen'}).`, vorher, weiter);
}

let rueckT;
async function fertig(text, vorher, weiter) {
  angehakt.clear(); mehrBuchungen = false;
  if (ladenP) await ladenP.catch(() => {});
  await lokalSpeichern();
  H.neuAufbauen();       // Entscheidungen wirken sofort auf alle Seiten
  G = null;
  H.setze({ wahl: weiter });
  let bar = document.querySelector('#pr-rueck');
  if (!bar) { bar = Object.assign(document.createElement('div'), { id: 'pr-rueck', className: 'toast st-rueck' }); document.body.append(bar); }
  bar.innerHTML = `<span>${H.esc(text)}</span><button class="link">Rückgängig</button>`;
  bar.hidden = false;
  bar.querySelector('button').onclick = async () => {
    for (const [k, v] of vorher) { ENT[k] = v ? { ...v, zeit: jetzt() } : { geloescht: true, zeit: jetzt() }; UNSYNC.add(k); }
    bar.hidden = true;
    await lokalSpeichern(); H.neuAufbauen(); G = null; H.neuZeichnen(); abgleichen().then(() => H.S().kart === 'pruefen' && H.neuZeichnen());
  };
  clearTimeout(rueckT); rueckT = setTimeout(() => (bar.hidden = true), 7000);
  abgleichen().then((mehr) => { if (mehr) { H.neuAufbauen(); G = null; } if (H.S().kart === 'pruefen') H.neuZeichnen(); });
}

// beim Öffnen der Prüfseite: mit dem PC abgleichen (nur einmal je Sitzung, danach nach jeder Entscheidung)
let abgeglichen = false;
export function pruefenGeoeffnet() {
  if (abgeglichen) return;
  abgeglichen = true;
  abgleichen().then((mehr) => { if (mehr) { H.neuAufbauen(); G = null; } if (H.S().kart === 'pruefen') H.neuZeichnen(); });
}

async function excel() {
  const { D, liste } = gruppen(), j = D.j;
  const zeilen = [];
  for (const g of liste.filter((x) => x.offen.length).sort((a, b) => b.oAus + b.oEin - a.oAus - a.oEin)) {
    const A = analyse(g);
    const tipp = A.vor[0] ? (A.vor[0].umb ? 'zählt nicht (eigenes Geld)' : katText(A.vor[0].kat, A.vor[0].ukat)) : '';
    for (const r of g.offen) {
      const d = det(r, j);
      zeilen.push([g.name, r.d, D.konten[r.k].name, r.c / 100, r.g, r.z, d.uart, d.iban, d.mref, d.gid, d.kat0.replace(/ › $/, ''), tipp, d.quelle, '', '']);
    }
  }
  await H.alsExcel(`Kategorien-pruefen-${new Date().toISOString().slice(0, 10)}`, 'Offene Buchungen', [
    { titel: 'Empfänger (Gruppe)', breite: 28 }, { titel: 'Datum', typ: 'datum', breite: 11 }, { titel: 'Konto', breite: 16 }, { titel: 'Betrag', typ: 'euro', breite: 12 },
    { titel: 'Gegenseite', breite: 28 }, { titel: 'Verwendungszweck', breite: 60 }, { titel: 'Umsatzart', breite: 16 }, { titel: 'IBAN', breite: 24 },
    { titel: 'Mandatsreferenz', breite: 18 }, { titel: 'Gläubiger-ID', breite: 20 }, { titel: 'Kategorie laut Quelle', breite: 24 }, { titel: 'Vorschlag', breite: 26 },
    { titel: 'Datei', breite: 30 }, { titel: 'Deine Kategorie', breite: 22 }, { titel: 'Notiz', breite: 24 }], zeilen);
}
