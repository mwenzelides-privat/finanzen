// Gehaltsentwicklung: alle Daten der Gehaltsabrechnungen und Auswertungen dazu.
// Grundlage ist der Abschnitt „gehalt“ der Finanzdaten (gehalt_daten.py): Monatswerte aus Lohn-02.xlsx seit 2021 und
// – mit allen Einzelheiten – die Abrechnungen als PDF. Planmonate (noch ohne Abrechnung) sind als Prognose markiert.
// Beträge hier in Euro (nicht in Cent wie im Rest der App).
import { alsExcelMappe } from './export.js';

let H = null;              // Helfer aus app.js (Bausteine, Grafik, Navigation)
let wahl = '';             // gewählter Abrechnungsmonat 'JJJJ-MM'
let basisWahl = 'vm';      // Vergleich in „Warum anders?“: vm = Vormonat, vj = Vorjahresmonat
let ansicht = 'jahre';     // Grafik Gehaltsentwicklung: jahre (Standard) | monate
let tabJahr = '';          // Tabelle „Alle Daten“: gezeigtes Jahr (leer = Jahr der gewählten Abrechnung)
let tabBereich = 'alle';   // Tabelle „Alle Daten“: nur ein Bereich (Bezüge, Steuer …)
let tabTeil = -1;          // schmaler Bildschirm: welcher Teil des Jahres (Halbjahr bzw. Quartal)
let erhoehung = 500;       // Rechner: Gehaltserhöhung brutto im Monat
let auto_ = null;          // Rechner Dienstwagen: { satz (% vom Listenpreis), preis, km }
try { auto_ = JSON.parse(localStorage.getItem('fd.dienstwagen') || 'null'); } catch {}
let tabStufe = 0, spaltenBreite = 0;   // Tabelle: 0 = 12 Monate mit Cent, 1 = ohne Cent, 2 = Halbjahre, 3 = Quartale (bis nichts mehr quer scrollt)

const e = (v) => H.eur(Math.round(v * 100));
const e0 = (v) => H.eur0(Math.round(v * 100));
const pm = (v) => `${v >= 0 ? '+' : '−'}${H.eur(Math.round(Math.abs(v) * 100))}`;
const pm0 = (v) => `${v >= 0 ? '+' : '−'}${H.eur0(Math.round(Math.abs(v) * 100))}`;
const pz = (x, n = 0) => `${(x * 100).toLocaleString('de-DE', { minimumFractionDigits: n, maximumFractionDigits: n })} %`;
const sum = (l, f) => l.reduce((t, x) => t + (f(x) || 0), 0);
const detail = (z) => z && z.lohnsteuer != null;
const steuer = (z) => (z.lohnsteuer || 0) + (z.soli || 0) + (z.kirchensteuer || 0);
const auto = (z) => (z.privatfahrten || 0) + (z.whg_arbeit || 0);
const kvpv = (z) => (z.kv || 0) + (z.pv || 0) - (z.kv_zuschuss || 0) - (z.pv_zuschuss || 0);
const sonder = (z) => (z.praemie || 0) + (z.sonder || 0);
const extra = (z) => sonder(z) + (z.sachbezug || 0);   // alles außer Grundgehalt und Dienstwagen
// Abgaben = Lohnsteuer/Soli/KiSt + eigene Sozialversicherung (RV, AV, KV und PV nach Abzug der Arbeitgeber-Zuschüsse)
const sozial = (z) => (z.rv || 0) + (z.av || 0) + kvpv(z);
const abgaben = (z) => steuer(z) + sozial(z);

// Wohin das Gesamtpaket fließt (Brutto + Betriebsrente vom Arbeitgeber). Feste Reihenfolge und Farben.
const GRUPPEN = {
  konto: { n: 'Aufs Konto', f: 'var(--ein)', u: 'Auszahlung' },
  steuer: { n: 'Lohnsteuer und Soli', f: 'var(--g-steuer)', u: 'ans Finanzamt' },
  bav: { n: 'Betriebsrente', f: 'var(--g-bav)', u: 'dein Anteil und der des Arbeitgebers', spaeter: true },
  rv: { n: 'Gesetzliche Rente', f: 'var(--g-rv)', u: 'dein Anteil', spaeter: true },
  kvpv: { n: 'Kranken-, Pflege-, Arbeitslosenvers.', f: 'var(--g-kv)', u: 'nach Abzug des Arbeitgeber-Zuschusses' },
  auto: { n: 'Dienstwagen', f: 'var(--g-auto)', u: 'Sachbezug: kein Geld, wird nur versteuert' },
  sach: { n: 'Gutscheine', f: 'var(--g-sach)', u: 'Sachbezug' },
  sonst: { n: 'Private Abzüge', f: 'var(--g-sonst)', u: 'z. B. private Belege' },
  abz: { n: 'Steuern, Abgaben, Vorsorge', f: 'var(--g-steuer)', u: 'nur als Summe bekannt (Lohn-02.xlsx)' },
};
function aufteilung(z) {
  if (!detail(z)) {
    const t = { konto: z.auszahlung, auto: auto(z) };
    t.abz = z.brutto - t.auto - t.konto;
    return { basis: z.brutto, t };
  }
  const t = { konto: z.auszahlung, steuer: steuer(z), bav: (z.bav_an || 0) + (z.bav_ag || 0), rv: z.rv || 0, kvpv: (z.av || 0) + kvpv(z),
    auto: auto(z), sach: z.sachbezug || 0, sonst: z.sonst_abzug || 0 };
  const basis = z.brutto + (z.bav_ag || 0);
  const rest = basis - sum(Object.values(t), (x) => x);
  if (Math.abs(rest) > 0.01) t.sonst += rest;
  return { basis, t };
}

// Brücke zwischen zwei Monaten: was die Auszahlung verändert hat (Summe = Unterschied der Auszahlungen)
function bruecke(a, b) {
  const fein = detail(a) && detail(b);
  const teile = (z) => (fein
    ? { gehalt: z.gehalt, sonder: sonder(z), steuer: -steuer(z), sv: -((z.rv || 0) + (z.av || 0) + kvpv(z)), bav: -(z.bav_an || 0), sonst: -(z.sonst_abzug || 0) }
    : { gehalt: z.gehalt, sonder: sonder(z), abz: z.auszahlung - z.gehalt - sonder(z) });
  const NAMEN = { gehalt: 'Grundgehalt', sonder: 'Prämien und Sonderzahlungen', steuer: 'Lohnsteuer und Soli', sv: 'Sozialversicherung',
    bav: 'Betriebsrente (dein Anteil)', sonst: 'Private Abzüge', abz: 'Steuern, Abgaben, Vorsorge', rest: 'Sonstiges' };
  const ta = teile(a), tb = teile(b), out = [];
  for (const k of Object.keys(tb)) { const d = tb[k] - ta[k]; if (Math.abs(d) >= 0.005) out.push({ k, n: NAMEN[k], d }); }
  const rest = (b.auszahlung - a.auszahlung) - sum(out, (x) => x.d);
  if (Math.abs(rest) >= 0.01) out.push({ k: 'rest', n: NAMEN.rest, d: rest });
  return { fein, teile: out };
}

// Grenzsteuersatz aus den eigenen Abrechnungen: Steuer-Unterschied je Euro Steuer-Brutto zwischen zwei Monaten
function grenzsatz(pdf) {
  for (let i = pdf.length - 1; i > 0; i--) {
    const a = pdf[i - 1], b = pdf[i], dsb = b.steuer_brutto - a.steuer_brutto;
    if (Math.abs(dsb) < 200) continue;
    const r = (steuer(b) - steuer(a)) / dsb;
    if (r > 0.1 && r < 0.6) return { r, a: a.m, b: b.m, gemessen: true };
  }
  return { r: 0.443, gemessen: false };
}

// Gehaltserhöhungen: neues Grundgehalt, das mindestens zwei Monate bleibt (einmalige Nachzahlungen zählen nicht)
function erhoehungen(L) {
  const out = [];
  let stufe = L[0]?.gehalt;
  for (let i = 1; i < L.length; i++) {
    const g = L[i].gehalt;
    if (!g || Math.abs(g - stufe) < 0.5) continue;
    const n = L[i + 1];
    if (n && Math.abs(n.gehalt - g) > 0.5) continue;
    out.push({ m: L[i].m, von: stufe, auf: g, p: g / stufe - 1, wechsel: L[i].arbeitgeber !== L[i - 1].arbeitgeber, plan: L[i].quelle === 'plan' });
    stufe = g;
  }
  return out;
}

// Gehaltseingang auf dem Konto zu einer Abrechnung (gleicher Betrag, vom 20. des Vormonats bis zum 15. des Folgemonats)
function eingang(z) {
  if (!z.auszahlung) return null;
  const von = `${H.mVor(z.m, -1)}-20`, bis = `${H.mVor(z.m, 1)}-15`, c = Math.round(z.auszahlung * 100);
  return H.D.rows.find((r) => r.art === 'Einnahme' && r.d >= von && r.d <= bis && Math.abs(r.c - c) <= 1) || null;
}

// ---------------------------------------------------------------- Daten
function daten() {
  const G = H.D.j.gehalt;
  if (!G?.monate?.length) return null;
  const alle = G.monate;
  const ist = alle.filter((z) => z.quelle === 'pdf' || z.quelle === 'excel');
  const pdf = ist.filter(detail);
  const plan = alle.filter((z) => z.quelle === 'plan');
  const fehlt = alle.filter((z) => z.quelle === 'fehlt');
  return { alle, ist, pdf, plan, fehlt, nach: new Map(alle.map((z) => [z.m, z])), gs: grenzsatz(pdf), erh: erhoehungen(alle.filter((z) => z.gehalt)) };
}

// ---------------------------------------------------------------- Seite
export function gehaltZeigen(el, helfer) {
  H = helfer;
  const G = daten();
  if (!G) {
    el.innerHTML = `<div class="s5">${H.kopf5('Gehaltsentwicklung', 'Noch keine Gehaltsdaten in der Datei. Sie kommen beim nächsten Einlesen aus Lohn-02.xlsx und den Abrechnungen im Ordner Gehalt.')}</div>`;
    return;
  }
  if (!G.nach.has(wahl) || !G.ist.includes(G.nach.get(wahl))) wahl = (G.pdf.at(-1) || G.ist.at(-1)).m;
  const z = G.nach.get(wahl);
  const ia = G.ist.indexOf(z);
  const vm = G.ist[ia - 1] || null;
  const erste = G.ist[0];
  const { basis, t } = aufteilung(z);

  // Kopf
  const stufe = [...G.erh].reverse().find((x) => x.m <= z.m)?.auf ?? erste.gehalt;
  const seit = erste.gehalt ? stufe / erste.gehalt - 1 : 0;
  const jahre = (Date.parse(`${z.m}-01`) - Date.parse(`${erste.m}-01`)) / (365.25 * 864e5);
  const proJahr = jahre > 0.9 ? Math.pow(stufe / erste.gehalt, 1 / jahre) - 1 : null;
  const auswahl = `<label class="ge-wahl"><span class="muted klein">Abrechnung</span><select id="ge-monat">${G.ist.slice().reverse().map((x) =>
    `<option value="${x.m}"${x.m === wahl ? ' selected' : ''}>${H.monLang(x.m)}${detail(x) ? '' : ' (nur Summen)'}</option>`).join('')}</select></label>`;
  let satz = `Im ${H.monLang(z.m)} kamen ${H.zl(`<b>${e(z.auszahlung)}</b>`, gehaltZiel(z))} aufs Konto – ${pz(z.auszahlung / basis)} von ${H.zs(`<b>${e0(basis)}</b>`, '#ge-fluss')}, die ${detail(z) && z.bav_ag ? 'dein Arbeitgeber für dich aufwendet (Brutto und Betriebsrente)' : 'du brutto verdienst'}.`;
  if (seit > 0) satz += ` Seit ${H.monLang(erste.m)} ist dein Grundgehalt von ${e0(erste.gehalt)} auf ${H.zs(`<b>${e0(stufe)}</b>`, '#ge-verlauf')} gestiegen (<b class="pos">+${pz(seit)}</b>${proJahr ? `, im Schnitt ${pz(proJahr, 1)} pro Jahr` : ''}).`;
  const offen = G.fehlt.at(-1);
  if (offen) satz += ` <span class="ge-fehlt">Die Abrechnung für ${H.MONAT[+offen.m.slice(5) - 1]} fehlt noch – als PDF in den Ordner <i>Gehalt</i> legen.</span>`;

  // Kacheln
  const ein = eingang(z);
  const j = z.m.slice(0, 4), jahrAlle = G.alle.filter((x) => x.m.slice(0, 4) === j && x.quelle !== 'fehlt');
  const jahrIst = jahrAlle.filter((x) => x.quelle !== 'plan');
  const jahrPlan = jahrAlle.length > jahrIst.length;
  const kacheln = [
    H.zahl5(`Aufs Konto im ${H.MONAT[+z.m.slice(5) - 1]}`, e(z.auszahlung), `${vm ? `${pm(z.auszahlung - vm.auszahlung)} ggü. ${H.MON[+vm.m.slice(5) - 1]}` : 'erste Abrechnung'}${ein ? ` · angekommen am ${H.dde(ein.d).slice(0, 6)} ✓` : ''}`, { ziel: gehaltZiel(z) }),
    H.zahl5(`Brutto im ${H.MONAT[+z.m.slice(5) - 1]}`, e0(z.brutto), `Grundgehalt ${e0(z.gehalt)}${auto(z) ? ` + Dienstwagen ${e0(auto(z))}` : ''}${sonder(z) > 1 ? ` + Sonderzahlung ${e0(sonder(z))}` : ''}`, { springe: '#ge-daten' }),
    H.zahl5('Grundgehalt', e0(stufe), `${seit > 0 ? `+${pz(seit)} seit ${H.monKurz(erste.m)} (${e0(erste.gehalt)})` : 'monatlich, ohne Zulagen'}${Math.abs(z.gehalt - stufe) > 0.5 ? ` · in diesem Monat ${e0(z.gehalt)} mit Nachzahlung` : ''}`, { cls: seit > 0 ? 'pos' : '', springe: '#ge-verlauf' }),
    H.zahl5(`Jahr ${j}${jahrPlan ? ' (mit Plan)' : ''}`, `${jahrPlan ? '≈ ' : ''}${e0(sum(jahrAlle, (x) => x.auszahlung))}`, `aufs Konto · brutto ${jahrPlan ? '≈ ' : ''}${e0(sum(jahrAlle, (x) => x.brutto))}${jahrPlan ? ` · ${jahrIst.length} von 12 Monaten abgerechnet` : ''}`, { springe: '#ge-jahrtab' }),
  ].join('');
  const jahrDet = jahrIst.filter(detail);
  const vorsorge = detail(z) ? 2 * (z.rv || 0) + (z.bav_an || 0) + (z.bav_ag || 0) : null;
  const kacheln2 = detail(z) ? [
    H.zahl5('Netto vom Brutto', pz((z.brutto - abgaben(z)) / z.brutto, 1), `${e0(z.brutto - abgaben(z))} von ${e0(z.brutto)} bleiben nach Steuern und Sozialabgaben`, { cls: 'pos', springe: '#ge-jahrtab' }),
    H.zahl5('Abgaben', pz(abgaben(z) / z.brutto, 1), `${e0(abgaben(z))}: Lohnsteuer und Soli ${e0(steuer(z))} · Sozialversicherung ${e0(sozial(z))}`, { cls: 'neg', springe: '#ge-quote' }),
    H.zahl5(`Lohnsteuer ${j}`, e0(sum(jahrDet, steuer)), `bis ${H.MONAT[+jahrDet.at(-1).m.slice(5) - 1]}, im Schnitt ${pz(sum(jahrDet, steuer) / Math.max(1, sum(jahrDet, (x) => x.brutto)), 1)} vom Brutto`, { springe: '#ge-quote' }),
    H.zahl5('Für die Rente im Monat', e0(vorsorge), `gesetzlich ${e0(2 * (z.rv || 0))} (mit Arbeitgeberanteil)${z.bav_an || z.bav_ag ? ` · Betriebsrente ${e0((z.bav_an || 0) + (z.bav_ag || 0))}` : ''}`, { springe: '#ge-rente' }),
  ].join('') : '';

  el.innerHTML = `<div class="s5 ge5">
    ${H.kopf5('Gehaltsentwicklung', satz, auswahl)}
    <div class="s5-zahlen">${kacheln}</div>
    ${kacheln2 ? `<div class="s5-zahlen">${kacheln2}</div>` : ''}
    <div class="s5-raster">
      ${flussKarte(z, basis, t)}
      ${brueckeKarte(G, z)}
      <div class="s5-spalte">${bavKarte(G, z)}${autoKarte(G, z)}</div>
    </div>
    ${zukunftKarte(G)}
    ${renteHtml(G, z)}
    ${verlaufKarte(G)}
    <div class="s5-raster">
      ${jahrTabelleKarte(G)}
      ${quoteKarte(G)}
    </div>
    ${heatmapKarte(G)}
    ${datenKarte(G, el)}
  </div>`;
  binden(el, G);
  verlaufZeichnen(G);
  quoteZeichnen(G);
  renteZeichnen(G);
  const rahmen = el.querySelector('#ge-daten .t3-rahmen');
  if (rahmen && rahmen.scrollWidth > rahmen.clientWidth + 1 && tabStufe < 3) { tabStufe++; gehaltZeigen(el, H); }
}

const gehaltZiel = (z) => {
  const r = eingang(z), k = r ? r.d.slice(0, 7) : z.m;
  return H.zuBuchungen({ kat: 'Einnahmen', ukat: 'Lohn / Gehalt', art: 'ein', ...H.monatZiel(k) });
};

// ---------------------------------------------------------------- Karten
function flussKarte(z, basis, t) {
  const keys = Object.keys(GRUPPEN).filter((k) => t[k] > 0.005);
  // 100 Kästchen, je 1 % (größte Reste zuerst aufrunden)
  const roh = keys.map((k) => ({ k, x: (t[k] / basis) * 100 }));
  roh.forEach((r) => { r.n = Math.floor(r.x); });
  let frei = 100 - sum(roh, (r) => r.n);
  roh.slice().sort((a, b) => (b.x - b.n) - (a.x - a.n)).forEach((r) => { if (frei > 0 && r.x > 0) { r.n++; frei--; } });
  const zellen = roh.flatMap((r) => Array.from({ length: r.n }, () => `<i style="background:${GRUPPEN[r.k].f}" title="${GRUPPEN[r.k].n}: ${pz(t[r.k] / basis, 1)}"></i>`)).join('');
  const spaeter = keys.filter((k) => GRUPPEN[k].spaeter);
  const legende = keys.map((k) => `<div class="ge-lg"><i style="background:${GRUPPEN[k].f}"></i><span>${GRUPPEN[k].n}<small>${GRUPPEN[k].u}</small></span><b>${e0(t[k])}</b><span class="muted">${pz(t[k] / basis)}</span></div>`).join('');
  const hundert = (k) => Math.round((t[k] / basis) * 100);
  const text = detail(z)
    ? `Von 100 € gehen <b>${hundert('konto')} €</b> aufs Konto, <b>${hundert('steuer')} €</b> ans Finanzamt${spaeter.length ? ` und <b>${Math.round(sum(spaeter, (k) => t[k]) / basis * 100)} €</b> in deine Rente` : ''}.`
    : 'Für diesen Monat gibt es nur die Summen aus Lohn-02.xlsx.';
  return H.karte5('Wohin dein Geld fließt', `${H.monLang(z.m)}: ${detail(z) && z.bav_ag ? 'Brutto plus Betriebsrente vom Arbeitgeber' : 'Brutto'} = ${e(basis)}, ein Kästchen = 1 %`,
    `<p class="ge-text">${text}</p><div class="ge-waffel" role="img" aria-label="Aufteilung in Prozent">${zellen}</div><div class="ge-legende">${legende}</div>${jahrFluss(z)}`, '', '', 'ge-fluss');
}

// Freie Fläche: dieselbe Aufteilung für alle Abrechnungen des Jahres bis zum gewählten Monat
function jahrFluss(z) {
  const ms = H.D.j.gehalt.monate.filter((x) => x.m.slice(0, 4) === z.m.slice(0, 4) && x.m <= z.m && x.quelle === 'pdf' && detail(x));
  if (ms.length < 2) return '';
  const t = {}; let basis = 0;
  for (const x of ms) { const a = aufteilung(x); basis += a.basis; for (const [k, w] of Object.entries(a.t)) t[k] = (t[k] || 0) + w; }
  const keys = Object.keys(GRUPPEN).filter((k) => t[k] > 0.005);
  return `<div class="ge-jfluss fuell-aus" data-fuell="1"><h3>${z.m.slice(0, 4)} bis ${H.MONAT[+z.m.slice(5) - 1]} zusammen: ${e0(basis)}</h3>
    <div class="ge-yb">${keys.map((k) => `<i style="flex:${t[k]};background:${GRUPPEN[k].f}" title="${GRUPPEN[k].n}: ${e0(t[k])}"></i>`).join('')}</div>
    <dl class="s5-dl">${keys.slice().sort((x, y) => t[y] - t[x]).slice(0, 4).map((k) => `<div><dt>${GRUPPEN[k].n}</dt><dd>${e0(t[k])}<small>${pz(t[k] / basis)}</small></dd></div>`).join('')}</dl></div>`;
}

function brueckeKarte(G, z) {
  const i = G.ist.indexOf(z);
  const vj = G.nach.get(H.mVor(z.m, -12));
  const kandidaten = { vm: G.ist[i - 1], vj: vj && vj.auszahlung != null ? vj : null };
  if (!kandidaten[basisWahl]) basisWahl = kandidaten.vm ? 'vm' : 'vj';
  const a = kandidaten[basisWahl];
  const seg = `<div class="seg">${[['vm', 'Vormonat'], ['vj', 'Vorjahr']].filter(([k]) => kandidaten[k]).map(([k, n]) => `<button data-ge-basis="${k}" class="${k === basisWahl ? 'an' : ''}">${n}</button>`).join('')}</div>`;
  let inhalt;
  if (!a) inhalt = '<p class="muted">Kein Vergleichsmonat vorhanden.</p>';
  else {
    const { fein, teile } = bruecke(a, z), d = z.auszahlung - a.auszahlung;
    const max = Math.max(1, ...teile.map((x) => Math.abs(x.d)));
    const zeilen = teile.sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).map((x) => `<div class="ge-bz">
      <span>${x.n}</span><span class="ge-bb"><i class="${x.d >= 0 ? 'plus' : 'minus'}" style="width:${(Math.abs(x.d) / max) * 50}%"></i></span><b class="${x.d >= 0 ? 'pos' : 'neg'}">${pm(x.d)}</b></div>`).join('');
    const groesste = teile[0];
    const satz = Math.abs(d) < 0.01 ? `Genau gleich wie im ${H.monLang(a.m)}.`
      : `<b class="${d >= 0 ? 'pos' : 'neg'}">${pm(d)}</b> gegenüber ${H.monLang(a.m)}${groesste ? ` – vor allem durch ${groesste.n.toLowerCase().startsWith('grund') ? 'das Grundgehalt' : groesste.n}` : ''}.`;
    inhalt = `<p class="ge-text">${satz}</p><div class="ge-br">
      <div class="ge-bz ge-bsum"><span>Auszahlung ${H.monKurz(a.m)}</span><span></span><b>${e(a.auszahlung)}</b></div>
      ${zeilen || '<p class="muted">Keine Veränderung.</p>'}
      <div class="ge-bz ge-bsum"><span>Auszahlung ${H.monKurz(z.m)}</span><span></span><b>${e(z.auszahlung)}</b></div></div>
      ${fein ? '' : '<p class="s5-erkl">Für den Vergleichsmonat gibt es nur Summen (Lohn-02.xlsx) – Steuer, Sozialversicherung und Betriebsrente stehen deshalb zusammen.</p>'}`;
  }
  // Rechner: was von einer Gehaltserhöhung netto bleibt
  const gs = G.gs.r, svFrei = detail(z) && z.sv_brutto && z.steuer_brutto > z.sv_brutto;
  const bleibt = erhoehung * (1 - gs - (svFrei ? 0 : 0.2));
  const rechner = `<div class="ge-rechner">
    <h3>Und bei einer Gehaltserhöhung?</h3>
    <label class="ge-regler"><span>brutto mehr im Monat</span><input type="range" id="ge-erh" min="100" max="3000" step="100" value="${erhoehung}"><b id="ge-erh-w">${e0(erhoehung)}</b></label>
    <p class="ge-text" id="ge-erh-t">${erhoehungText(erhoehung, bleibt)}</p>
    <p class="s5-erkl">Von jedem zusätzlichen Euro bleiben dir etwa <b>${Math.round((1 - gs - (svFrei ? 0 : 0.2)) * 100)} Cent</b>. ${G.gs.gemessen ? `Gemessen an deinen Abrechnungen ${H.monKurz(G.gs.a)} → ${H.monKurz(G.gs.b)}: Grenzsteuersatz ${pz(gs, 1)} inkl. Soli` : 'Angenommener Grenzsteuersatz 44,3 % inkl. Soli'}${svFrei ? ', Sozialversicherung schon an der Beitragsgrenze' : ', dazu rund 20 % Sozialversicherung'}. Schätzung, keine Steuerberatung.</p>
  </div>`;
  // Freie Fläche: wie sich die Auszahlung Monat für Monat entwickelt hat (so viele Monate, wie Platz ist)
  const chronik = G.ist.slice(Math.max(1, i - 11), i + 1).reverse().map((x, n) => {
    const v = G.ist[G.ist.indexOf(x) - 1], d = x.auszahlung - v.auszahlung, gr = bruecke(v, x).teile.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
    const grund = Math.abs(d) < 1 ? 'unverändert' : gr.filter((g, k) => k === 0 || (k === 1 && Math.abs(g.d) >= Math.abs(gr[0].d) * 0.25)).map((g) => `${g.n} ${pm0(g.d)}`).join(', ');
    return `<button class="ge-cz fuell-aus${x.m === z.m ? ' an' : ''}" data-ge-m="${x.m}" data-fuell="${10 + n}" data-stopp><span>${H.monKurz(x.m)}</span><span class="muted" title="${H.esc(grund)}">${grund}</span><b class="${Math.abs(d) < 1 ? '' : d > 0 ? 'pos' : 'neg'}">${Math.abs(d) < 1 ? '±0' : pm0(d)}</b><b>${e0(x.auszahlung)}</b></button>`;
  }).join('');
  const verlauf = chronik ? `<div class="ge-chronik fuell-aus" data-fuell="9"><h3>Monat für Monat</h3>${chronik}</div>` : '';
  return H.karte5('Warum die Auszahlung anders ist', 'was sich zwischen zwei Abrechnungen verändert hat', `${inhalt}${verlauf}${rechner}`, 'ge-bruecke', seg);
}
const erhoehungText = (b, n) => `≈ <b class="pos">+${e0(n)}</b> netto im Monat, <b>+${e0(n * 12)}</b> im Jahr.`;

function bavKarte(G, z) {
  const mit = G.pdf.filter((x) => x.bav_an || x.bav_ag);
  if (!detail(z) || !(z.bav_an || z.bav_ag)) {
    return H.karte5('Betriebsrente', '', `<p class="muted">${mit.length ? `Im ${H.monLang(z.m)} noch keine Beiträge – seit ${H.monLang(mit[0].m)} zahlst du ein.` : 'Laut deinen Abrechnungen zahlst du nicht in eine Betriebsrente ein.'}</p>`);
  }
  const an = z.bav_an || 0, ag = z.bav_ag || 0, ges = an + ag;
  const steuerSpar = an * G.gs.r, netto = an - steuerSpar;
  const bisher = sum(mit, (x) => (x.bav_an || 0) + (x.bav_ag || 0));
  const verein = z.arbeitgeber === 'Wittmann' ? H.D.j.gehalt?.vorsorge?.ag_vereinbart_prozent : null, sollAg = verein ? verein / 100 * z.gehalt : 0;
  const teil = (w, cls, n) => `<i class="${cls}" style="flex:${w}" title="${n}: ${e0(w)}"><span>${n}</span><b>${e0(w)}</b></i>`;
  return H.karte5('Betriebsrente', `${e0(ges)} im Monat fließen in deine Altersvorsorge`,
    `<div class="ge-bav">${teil(netto, 'du', 'du netto')}${teil(steuerSpar, 'fa', 'Steuer gespart')}${teil(ag, 'ag', 'Arbeitgeber')}</div>
    <p class="ge-text">Davon zahlst du netto nur <b>${e0(netto)}</b> (${pz(netto / ges)}) – den Rest tragen dein Arbeitgeber (${e0(ag)}) und die gesparte Lohnsteuer (≈ ${e0(steuerSpar)}).</p>
    <dl class="s5-dl">${verein && Math.abs(sollAg - ag) > 1 ? `<div><dt>Arbeitgeber laut Vereinbarung <small>${verein} % von ${e0(z.gehalt)}</small></dt><dd>${e0(sollAg)}<small class="neg">abgerechnet ${e0(ag)} · ${pm0(ag - sollAg)} im Monat</small></dd></div>` : ''}<div><dt>Seit ${H.monLang(mit[0].m)} eingezahlt</dt><dd>${e0(bisher)}</dd></div><div><dt>Pro Jahr</dt><dd>${e0(ges * 12)}<small>ohne Zinsen</small></dd></div></dl>`, 'ge-bavk');
}

// Dienstwagen: geldwerter Vorteil = Satz × Listenpreis (Privatfahrten) + 0,03 % × Listenpreis × km, beim E-Auto
// anteilig wie der Satz (0,5 % → Hälfte, 0,25 % → Viertel). Kosten für dich = Vorteil × Grenzsteuersatz.
const SAETZE = [[1, '1 %', 'Verbrenner'], [0.5, '0,5 %', 'Hybrid / E-Auto über 100.000 €'], [0.25, '0,25 %', 'E-Auto bis 100.000 €']];
function autoWerte(G, z) {
  const satzStd = H.D.j.gehalt?.dienstwagen?.satz_prozent ?? 1;
  const preisAbr = z.privatfahrten ? z.privatfahrten / (satzStd / 100) : null;
  const kmAbr = preisAbr ? z.whg_arbeit / (0.0003 * (satzStd / 1) * preisAbr) : null;
  const a = { satz: auto_?.satz ?? satzStd, preis: auto_?.preis ?? Math.round(preisAbr || 50000), km: auto_?.km ?? Math.round(kmAbr || 0) };
  const vorteil = (x) => { const lp = Math.floor(x.preis / 100) * 100; return (x.satz / 100) * lp + 0.0003 * x.satz * lp * x.km; };
  return { a, satzStd, preisAbr, kmAbr, vorteil, gs: G.gs.r, jetzt: auto(z), dw: H.D.j.gehalt?.dienstwagen || {} };
}
function autoText(W) {
  const v = W.vorteil(W.a), kosten = v * W.gs, d = (W.jetzt - v) * W.gs;
  const gleich = Math.abs(v - W.jetzt) < 1;
  return `<div class="ge-autoerg"><div><span>Geldwerter Vorteil</span><b>${e0(v)}</b><small>im Monat versteuert</small></div>
    <div><span>Kostet dich netto</span><b class="neg">${e0(kosten)}</b><small>${e0(kosten * 12)} im Jahr</small></div></div>
    <p class="ge-text">${gleich ? `So steht es auf deiner Abrechnung: ${e(W.jetzt)} geldwerter Vorteil, das kostet dich bei ${pz(W.gs, 1)} Grenzsteuersatz etwa <b>${e0(kosten)}</b> im Monat.`
      : `Gegenüber heute (${e0(W.jetzt * W.gs)} im Monat): <b class="${d >= 0 ? 'pos' : 'neg'}">${pm0(d)}</b> netto im Monat, ${pm0(d * 12)} im Jahr.`}</p>`;
}
function autoKarte(G, z) {
  if (!auto(z)) return H.karte5('Dienstwagen', '', '<p class="muted">In diesem Monat kein Dienstwagen auf der Abrechnung.</p>');
  const W = autoWerte(G, z), a = W.a;
  const best = W.dw.bestellt;
  const schnell = `<div class="ge-schnell"><button class="chip${!auto_ ? ' an' : ''}" data-ge-auto-zurueck>Wie heute (Abrechnung)</button>${best ? `<button class="chip${auto_ && auto_.preis === Math.round(best.listenpreis) && auto_.satz === best.satz_prozent ? ' an' : ''}" data-ge-auto-best>${H.esc(best.modell)}: ${e0(best.listenpreis)}, ${String(best.satz_prozent).replace('.', ',')} %</button>` : ''}</div>`;
  const knopf = SAETZE.map(([w, t, u]) => `<button data-ge-satz="${w}" class="${w === a.satz ? 'an' : ''}" title="${u}">${t}</button>`).join('');
  const regler = (id, label, min, max, step, wert, txt) => `<label class="ge-regler"><span>${label}</span><input type="range" data-ge-auto="${id}" min="${min}" max="${max}" step="${step}" value="${wert}"><b>${txt}</b></label>`;
  const herkunft = `Heute laut Abrechnung ${H.monKurz(z.m)}: Privatfahrten ${e(z.privatfahrten)}, Wohnung–Arbeit ${e(z.whg_arbeit)}.${W.dw.hinweis ? ` ${H.esc(W.dw.hinweis)}` : ''}${best ? ` Bestellt: ${H.esc(best.modell)}, Bruttolistenpreis ${e(best.listenpreis)}${best.liefertermin ? `, Liefertermin ${H.esc(best.liefertermin)}` : ''} – als E-Auto bis 100.000 € gilt 0,25 %.` : ''}`;
  return H.karte5('Dienstwagen', 'was er dich wirklich kostet – Versteuerung, Preis und Entfernung einstellbar',
    `${schnell}<div id="ge-auto-erg">${autoText(W)}</div>
    <div class="ge-autoregler">
      <div class="ge-regler"><span>Versteuerung</span><div class="seg ge-satz">${knopf}</div><b></b></div>
      ${regler('preis', 'Listenpreis', 20000, 150000, 500, a.preis, e0(a.preis))}
      ${regler('km', 'Entfernung zur Arbeit', 0, 150, 1, a.km, `${a.km} km`)}
    </div>
    <p class="s5-erkl">${herkunft} Fahrten Wohnung–Arbeit: 0,03 % je km, beim E-Auto vom ermäßigten Listenpreis. Sozialversicherung fällt nicht an (du liegst über der Beitragsgrenze). Schätzung mit deinem Grenzsteuersatz ${pz(W.gs, 1)} inkl. Soli, keine Steuerberatung.</p>`, 'ge-autok');
}
// ---------------------------------------------------------------- Abrechnung heute und künftig
// Ausgangspunkt ist die letzte Abrechnung. Bekannte Änderungen (gehalt.zukunft: Entfernung, Dienstwagen) verändern nur den
// geldwerten Vorteil; Steuer ändert sich mit dem gemessenen Grenzsteuersatz, Sozialversicherung nicht (über der Grenze).
function zukunftKarte(G) {
  const Z = H.D.j.gehalt?.zukunft || [], z = G.pdf.at(-1);
  if (!Z.length || !z || !auto(z)) return '';
  const dw = H.D.j.gehalt.dienstwagen || {}, satz0 = dw.satz_prozent ?? 1;
  const preis0 = z.privatfahrten / (satz0 / 100), km0 = Math.round(z.whg_arbeit / (0.0003 * satz0 * preis0));
  const gs = G.gs.r;
  const stufe = (a) => {
    const lp = Math.floor(a.preis / 100) * 100, pf = (a.satz / 100) * lp, wa = 0.0003 * a.satz * lp * a.km;
    const d = pf + wa - auto(z);
    return { ...a, pf, wa, d, brutto: z.brutto + d, stBrutto: z.steuer_brutto + d, steuer: steuer(z) + d * gs,
      netto: z.netto_verdienst + d - d * gs, ausz: z.auszahlung - d * gs };
  };
  let a = { satz: satz0, preis: preis0, km: km0 };
  const spalten = [{ titel: `Heute`, sub: `Abrechnung ${H.monKurz(z.m)}`, ...stufe(a) }];
  for (const x of Z) {
    a = { satz: x.satz_prozent ?? a.satz, preis: x.listenpreis ?? a.preis, km: x.km ?? a.km };
    spalten.push({ titel: `ab ${H.monKurz(x.ab)}`, sub: x.titel, ...stufe(a) });
  }
  const zeile = (name, f, opt = {}) => `<tr class="${opt.cls || ''}"><td>${name}${opt.sub ? `<small>${opt.sub}</small>` : ''}</td>${spalten.map((c, i) => {
    const v = f(c), d = i && opt.diff ? v - f(spalten[0]) : 0;
    const w = (x, f0) => `<span class="lang">${(f0 ? pm : e)(x).replace(/^-/, '−')}</span><span class="kurz">${(f0 ? pm0 : e0)(x).replace(/^-/, '−')}</span>`;
    return `<td class="r">${typeof v === 'string' ? v : w(v)}${i && opt.diff && Math.abs(d) >= 0.5 ? `<small class="${(opt.gut ? d > 0 : d < 0) ? 'pos' : 'neg'}">${w(d, true)}</small>` : ''}</td>`;
  }).join('')}</tr>`;
  const letzt = spalten.at(-1), plus = letzt.ausz - spalten[0].ausz;
  const satz = spalten.slice(1).map((c, i) => `${i ? 'Und ' + c.titel : c.titel.replace('ab ', 'Ab ')} (${H.esc(c.sub)}${c.km !== spalten[i].km ? `, ${c.km} statt ${spalten[i].km} km` : ''}${c.satz !== spalten[i].satz ? `, ${String(c.satz).replace('.', ',')} % statt ${String(spalten[i].satz).replace('.', ',')} %` : ''}): <b class="pos">${pm0(c.ausz - spalten[0].ausz)}</b> im Monat gegenüber heute.`).join(' ')
    + ` Der versteuerte Dienstwagen-Vorteil sinkt von ${e0(auto(z))} auf ${e0(letzt.pf + letzt.wa)}; das bringt ${pm0(plus * 12)} im Jahr.`;
  const tab = `<table class="t3 ge-zt"><thead><tr><th></th>${spalten.map((c) => `<th class="r">${c.titel}<small>${H.esc(c.sub)}</small></th>`).join('')}</tr></thead><tbody>
    ${zeile('Dienstwagen', (c) => `${String(c.satz).replace('.', ',')} %<small>${e0(c.preis)} Listenpreis</small>`)}
    ${zeile('Entfernung zur Arbeit', (c) => `${c.km} km`)}
    ${zeile('Grundgehalt', () => z.gehalt)}
    ${zeile('Privatfahrten', (c) => c.pf, { diff: true, sub: 'geldwerter Vorteil' })}
    ${zeile('Wohnung – Arbeit', (c) => c.wa, { diff: true, sub: '0,03 % je km' })}
    ${zeile('Gesamt-Brutto', (c) => c.brutto, { cls: 'ge-sum', diff: true })}
    ${zeile('Steuer-Brutto', (c) => c.stBrutto, { diff: true })}
    ${zeile('Lohnsteuer und Soli', (c) => -c.steuer, { diff: true, gut: true, sub: `geschätzt, ${pz(gs, 1)} Grenzsteuersatz` })}
    ${zeile('Sozialversicherung', () => -sozial(z), { sub: 'unverändert (über der Beitragsgrenze)' })}
    ${zeile('Betriebsrente (dein Anteil)', () => -(z.bav_an || 0))}
    ${zeile('Auszahlung', (c) => c.ausz, { cls: 'ge-sum', diff: true, gut: true })}
  </tbody></table>`;
  return H.karte5('Deine Abrechnung heute und ab 2027', 'was sich durch Umzug und neuen Dienstwagen ändert – alles andere wie in der letzten Abrechnung',
    `<p class="ge-text">${satz}</p><div class="t3-rahmen">${tab}</div>
    <p class="s5-erkl">Schätzung: Gehalt, Betriebsrente und Sozialversicherung wie heute; Änderungen bei Steuertarif, Beitragsgrenzen oder Gehalt 2027 sind nicht berücksichtigt. Keine Steuerberatung.</p>`, '', '', 'ge-zukunft');
}

function verlaufKarte(G) {
  const seg = `<div class="seg">${[['jahre', 'Jahre'], ['monate', 'Monate']].map(([k, n]) => `<button data-ge-ansicht="${k}" class="${k === ansicht ? 'an' : ''}">${n}</button>`).join('')}</div>`;
  const erh = G.erh.filter((x) => !x.plan);
  const liste = erh.map((x) => `<span class="ge-erh${x.wechsel ? ' wechsel' : ''}">${H.monKurz(x.m)} <b>+${pz(x.p, 1)}</b>${x.wechsel ? ' · neuer Arbeitgeber' : ''}</span>`).join('');
  return H.karte5('Gehaltsentwicklung seit ' + H.monLang(G.alle[0].m).split(' ')[1],
    'Säulen: brutto (Grundgehalt, Prämien und Sonderzahlungen, Dienstwagen) · Linie: was aufs Konto kam · schraffiert: Plan ohne Abrechnung',
    `<div class="s5-chart ge-chart"><canvas id="c-ge-verlauf"></canvas></div>${liste ? `<div class="ge-erhs"><span class="muted klein">Gehaltserhöhungen:</span>${liste}</div>` : ''}`, '', seg, 'ge-verlauf');
}

function heatmapKarte(G) {
  const jahre = [...new Set(G.alle.map((z) => z.m.slice(0, 4)))].sort().reverse();
  const werte = G.ist.map((z) => z.auszahlung).sort((a, b) => a - b);
  const lo = werte[Math.floor(werte.length * 0.05)] || 0, hi = werte[Math.floor(werte.length * 0.95)] || 1;
  const kurz = (v) => (v / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const zeilen = jahre.map((j) => {
    const zellen = Array.from({ length: 12 }, (_, i) => {
      const m = `${j}-${String(i + 1).padStart(2, '0')}`, z = G.nach.get(m);
      if (!z) return '<span class="ge-hz leer"></span>';
      if (z.quelle === 'fehlt') return `<span class="ge-hz fehlt" title="${H.monLang(m)}: Abrechnung fehlt">?</span>`;
      const v = z.auszahlung;
      if (v == null) return `<span class="ge-hz plan" title="${H.monLang(m)}: Plan, brutto ${e0(z.brutto)}">–</span>`;
      const x = Math.max(0.08, Math.min(1, (v - lo) / Math.max(1, hi - lo)));
      const plan = z.quelle === 'plan';
      return `<button class="ge-hz${plan ? ' plan' : ''}${m === wahl ? ' an' : ''}${x > 0.62 ? ' dunkel' : ''}" style="--x:${Math.round(x * 100)}%" ${plan ? '' : `data-ge-m="${m}"`} title="${H.monLang(m)}: ${plan ? 'erwartet ' : ''}${e(v)} aufs Konto · brutto ${e0(z.brutto)}${sonder(z) > 500 ? ` · Sonderzahlung ${e0(sonder(z))}` : ''}"><span class="lang">${plan ? '≈' : ''}${H.NUM.format(Math.round(v))}</span><span class="kurz">${kurz(v)}</span></button>`;
    }).join('');
    const ms = G.alle.filter((z) => z.m.startsWith(j) && z.auszahlung != null), planDa = ms.some((z) => z.quelle === 'plan');
    return `<span class="ge-hj">${j}</span>${zellen}<b class="ge-hs">${planDa ? '≈' : ''}${e0(sum(ms, (z) => z.auszahlung))}</b>`;
  }).join('');
  const kopf = `<span></span>${H.MON.map((m) => `<span class="ge-hk">${m}</span>`).join('')}<span class="ge-hk r">Jahr</span>`;
  return H.karte5('Jeder Monat auf einen Blick', 'was aufs Konto kam – je dunkler, desto mehr; Sonderzahlungen fallen sofort auf · Monat anklicken: Abrechnung oben zeigen',
    `<div class="ge-heat">${kopf}${zeilen}</div>`);
}

const TEILE = [
  ['steuer', 'Lohnsteuer, Soli', 'var(--g-steuer)'], ['sozial', 'Sozialversicherung', 'var(--g-kv)'], ['bav', 'Betriebsrente (dein Anteil)', 'var(--g-bav)'],
  ['auto', 'Dienstwagen, Sachbezüge', 'var(--g-auto)'], ['sonst', 'Sonstiges', 'var(--g-sonst)'], ['abz', 'Steuern, Abgaben, Vorsorge', 'var(--g-steuer)'], ['konto', 'Aufs Konto', 'var(--ein)'],
];
function jahrWerte(G) {
  const jahre = [...new Set(G.ist.map((z) => z.m.slice(0, 4)))].sort();
  return jahre.map((j) => {
    const ms = G.ist.filter((z) => z.m.startsWith(j)), det = ms.filter(detail);
    const brutto = sum(ms, (z) => z.brutto), bd = sum(det, (z) => z.brutto);
    const r = { j, n: ms.length, nDet: det.length, brutto, konto: sum(ms, (z) => z.auszahlung), sonder: sum(ms, sonder) };
    if (det.length) {
      Object.assign(r, { steuer: sum(det, steuer), sozial: sum(det, sozial), bav: sum(det, (z) => z.bav_an || 0), bavAg: sum(det, (z) => z.bav_ag || 0), bd });
      r.abgQ = (r.steuer + r.sozial) / bd;
      r.teile = { steuer: r.steuer / bd, sozial: r.sozial / bd, bav: r.bav / bd, auto: sum(det, (z) => auto(z) + (z.sachbezug || 0)) / bd, konto: sum(det, (z) => z.auszahlung) / bd };
      r.teile.sonst = Math.max(0, 1 - sum(Object.values(r.teile), (x) => x));
    } else {
      r.teile = { auto: sum(ms, (z) => Math.max(0, auto(z))) / brutto, konto: r.konto / brutto };
      r.teile.abz = Math.max(0, 1 - r.teile.auto - r.teile.konto);
    }
    return r;
  });
}
function jahrTabelleKarte(G) {
  const W = jahrWerte(G);
  const zeilen = W.slice().reverse().map((r) => {
    const vor = W[W.indexOf(r) - 1];
    const balken = TEILE.filter(([k]) => r.teile[k] > 0.001).map(([k, n, f]) => `<i style="flex:${r.teile[k]};background:${f}" title="${n}: ${pz(r.teile[k], 1)}"></i>`).join('');
    const teil = r.nDet && r.nDet < r.n ? `<small>Anteile aus ${r.nDet} von ${r.n} Abrechnungen</small>` : !r.nDet ? '<small>nur Summen (Lohn-02.xlsx)</small>' : `<small>${r.n} Monate</small>`;
    const netto = r.nDet ? 1 - r.abgQ : null;
    return `<button class="ge-yt"${H.geh(H.zuBuchungen({ kat: 'Einnahmen', ukat: 'Lohn / Gehalt', art: 'ein', jahr: r.j, monat: '', zr: '' }))} title="Gehaltseingänge ${r.j} anzeigen">
      <span class="ge-yj">${r.j}${teil}</span>
      <span class="ge-yb">${balken}</span>
      <span class="ge-yw"><b>${e0(r.brutto)}</b><small>${vor && vor.brutto ? `${r.brutto >= vor.brutto ? '+' : '−'}${pz(Math.abs(r.brutto / vor.brutto - 1))} ggü. Vorjahr` : 'brutto'}</small></span>
      <span class="ge-yw neg"><b>${r.nDet ? pz(r.abgQ, 1) : '–'}</b><small>${r.nDet ? `${e0(r.steuer + r.sozial)}${r.nDet < r.n ? ` in ${r.nDet} Mon.` : ''}` : 'Abgaben'}</small></span>
      <span class="ge-yw pos"><b>${netto != null ? pz(netto, 1) : '–'}</b><small>netto vom Brutto</small></span>
      <span class="ge-yw"><b>${e0(r.konto)}</b><small>${pz(r.konto / r.brutto)} aufs Konto</small></span></button>`;
  }).join('');
  const legende = TEILE.filter(([k]) => W.some((r) => r.teile[k] > 0.001)).map(([k, n, f]) => `<span><i style="background:${f}"></i>${n}</span>`).join('');
  return H.karte5('Brutto, Abgaben, Netto – Jahr für Jahr', 'Balken = 100 % des Brutto · Abgaben = Lohnsteuer, Soli und Sozialversicherung (dein Anteil, nach Zuschüssen) · netto vom Brutto = was danach bleibt',
    `<div class="ge-yleg">${legende}</div><div class="ge-ytab"><div class="ge-yt ge-ykopf"><span>Jahr</span><span>wohin das Brutto ging</span><span>Brutto</span><span>Abgaben</span><span>Netto</span><span>Aufs Konto</span></div>${zeilen}</div>`, 's5-b2', '', 'ge-jahrtab');
}

function quoteKarte(G) {
  const det = G.ist.filter(detail);
  if (!det.length) return H.karte5('Abgaben Monat für Monat', '', '<p class="muted">Keine Abrechnungen mit Einzelheiten.</p>', '', '', 'ge-quote');
  const wechsel = det.filter((z, i) => i && z.stkl && det[i - 1].stkl && z.stkl !== det[i - 1].stkl);
  const letzt = det.at(-1), erst = det[0];
  const text = `Im ${H.monLang(letzt.m)} gingen <b>${pz(abgaben(letzt) / letzt.brutto, 1)}</b> deines Brutto an Finanzamt und Sozialversicherung${erst !== letzt ? `, im ${H.monLang(erst.m)} waren es ${pz(abgaben(erst) / erst.brutto, 1)}` : ''}.${wechsel.length ? ` Steuerklasse: ${wechsel.map((z) => `${det[det.indexOf(z) - 1].stkl} → ${z.stkl} ab ${H.monKurz(z.m)}`).join(', ')}.` : ''}`;
  return H.karte5('Abgaben Monat für Monat', 'Anteil am Brutto: Lohnsteuer und Soli (orange) und Sozialversicherung (türkis) · Spitzen = Sonderzahlungen',
    `<p class="ge-text">${text}</p><div class="s5-chart fuell"><canvas id="c-ge-quote"></canvas></div>`, '', '', 'ge-quote');
}
function quoteZeichnen(G) {
  if (!document.getElementById('c-ge-quote')) return;
  const det = G.ist.filter(detail), { css } = H;
  const o = H.basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: 16, right: 6 } };
  o.plugins.tooltip.callbacks = {
    title: (it) => H.monLang(det[it[0].dataIndex].m),
    label: (it) => ` ${it.dataset.label}: ${pz(it.raw / 100, 1)}`,
    footer: (it) => { const z = det[it[0].dataIndex]; return `Abgaben ${e0(abgaben(z))} von ${e0(z.brutto)}${z.stkl ? ` · Steuerklasse ${z.stkl}` : ''}`; },
  };
  o.scales = {
    x: { ...H.achsenStil(), stacked: true, grid: { display: false }, ticks: { ...H.achsenStil().ticks, maxRotation: 0, autoSkip: true, autoSkipPadding: 10, font: { size: 11 } } },
    y: { ...H.achsenStil(), stacked: true, beginAtZero: true, ticks: { ...H.achsenStil().ticks, callback: (v) => `${v} %`, maxTicksLimit: 5 } },
  };
  const ds = (label, f, farbe) => ({ type: 'bar', label, data: det.map((z) => (f(z) / z.brutto) * 100), backgroundColor: farbe, categoryPercentage: 0.95, barPercentage: 0.95 });
  H.zeichne('c-ge-quote', { type: 'bar', data: { labels: det.map((z) => H.monKurz(z.m)), datasets: [ds('Lohnsteuer und Soli', steuer, css('--g-steuer')), ds('Sozialversicherung', sozial, css('--g-kv'))] }, options: o });
}

// ---------------------------------------------------------------- Rente: gesetzlich, betrieblich, privat – zusammen hochgerechnet
// Grundlage: gehalt.vorsorge (aus Renteninformation und Vertragsunterlagen, gehalt_daten.py). Annahmen sind einstellbar.
let annahme = { anpassung: 2, inflation: 2, kaufkraft: true, abzug: 30, agProz: null };   // agProz null = wie in der letzten Abrechnung
try { Object.assign(annahme, JSON.parse(localStorage.getItem('fd.renteannahme') || '{}')); } catch {}
const ART_FARBE = { gesetzlich: 'var(--g-rv)', bAV: 'var(--g-bav)', Riester: 'var(--g-kv)', privat: 'var(--g-sach)', sonstiges: 'var(--g-sonst)' };
const artGruppe = (a = '') => (/^bAV/i.test(a) ? 'bAV' : /riester/i.test(a) ? 'Riester' : /lebens|privat|rürup|ruerup|depot/i.test(a) ? 'privat' : 'sonstiges');
const ART_NAME = { gesetzlich: 'Gesetzliche Rente', bAV: 'Betriebsrente', Riester: 'Riester', privat: 'Private Vorsorge', sonstiges: 'Sonstiges' };

function renteRechnen(V, akt) {
  // Arbeitgeberbeitrag zur Betriebsrente: laut letzter Abrechnung oder wie eingestellt (% vom Grundgehalt)
  const agAbr = akt && akt.gehalt ? (akt.bav_ag || 0) / akt.gehalt * 100 : null;
  const agProz = annahme.agProz ?? (agAbr != null ? Math.round(agAbr * 10) / 10 : V.ag_vereinbart_prozent ?? null);
  const agNeu = agProz != null && akt ? agProz / 100 * akt.gehalt : null;
  const heute = new Date(), beginn = V.rentenbeginn ? new Date(V.rentenbeginn) : null;
  const jahre = beginn ? Math.max(0, (beginn - heute) / (365.25 * 864e5)) : 0;
  const real = (nominal) => (annahme.kaufkraft ? nominal / Math.pow(1 + annahme.inflation / 100, jahre) : nominal);
  const posten = [];
  const g = V.gesetzlich;
  if (g) {
    // DRV-Prognose: gleichbleibende Beiträge, ohne Rentenanpassung (heutige Werte) → mit Anpassung nominal, dann ggf. in Kaufkraft
    const basis = g.prognose ?? g.bisher;
    posten.push({ k: 'gesetzlich', name: 'Gesetzliche Rente', sub: `Renteninformation ${g.datum ? H.dde(g.datum) : ''}`.trim(), heute: g.bisher, nominal: basis != null ? basis * Math.pow(1 + annahme.anpassung / 100, jahre) : null, hinweis: g.hinweis });
  }
  for (const v of V.vertraege || []) {
    let nominal = v.rente_prognose ?? v.rente_garantiert ?? v.rente_schaetzung ?? null, garantiert = v.rente_garantiert;
    // Allianz-Prognose mit altem Beitrag: künftigen Teil (Restlaufzeit) im Verhältnis zum neuen Beitrag hochrechnen (grob)
    if (v.prognose_basis_beitrag && agNeu != null && v.beginn && beginn) {
      const ganz = (beginn - new Date(v.beginn)) / (365.25 * 864e5);
      const f = 1 + (agNeu / v.prognose_basis_beitrag - 1) * Math.min(1, jahre / ganz);
      nominal = nominal != null ? nominal * f : null; garantiert = garantiert != null ? garantiert * f : null;
    }
    posten.push({ k: artGruppe(v.art), name: v.name, sub: [v.anbieter, v.art.replace(/^bAV-/, ''), v.beitrag_ag ? `vom Arbeitgeber, ${e0(agNeu ?? v.beitrag_ag)} im Monat` : ''].filter(Boolean).join(' · '), nominal, garantiert,
      wert: v.wert, wertDatum: v.wert_datum, kapital: v.kapital, kapitalDatum: v.kapital_datum, beitrag: v.beitrag_an || 0, hinweis: v.hinweis,
      schaetzung: v.rente_prognose == null && v.rente_garantiert == null && v.rente_schaetzung != null });
  }
  posten.forEach((x) => { x.wert_rente = x.nominal != null ? real(x.nominal) : null; });
  const summe = sum(posten, (x) => x.wert_rente);
  const real0 = (x) => (x == null ? null : real(x));
  const garantiert = sum(posten, (x) => (x.k === 'gesetzlich' ? x.heute : real0(x.garantiert)));
  return { posten, summe, jahre, beginn, netto: summe * (1 - annahme.abzug / 100), agProz, agAbr, agNeu, garantiert, real };
}

function renteHtml(G, z) {
  const V = H.D.j.gehalt?.vorsorge;
  if (!V) return '';
  const akt = G.pdf.at(-1);
  const R = renteRechnen(V, akt);
  const gruppen = Object.keys(ART_NAME).map((k) => ({ k, w: sum(R.posten.filter((x) => x.k === k), (x) => x.wert_rente) })).filter((x) => x.w > 0);
  const det = G.ist.filter(detail), letzt = det.at(-1) || z;
  const nettoHeute = letzt ? letzt.auszahlung : null;   // Vergleich mit dem, was heute monatlich aufs Konto kommt
  const barHeute = letzt ? letzt.gehalt + sonder(letzt) : null;
  const quote = barHeute ? R.summe / barHeute : null;
  const balken = gruppen.map((x) => `<i style="flex:${x.w};background:${ART_FARBE[x.k]}" title="${ART_NAME[x.k]}: ${e0(x.w)}"><span>${ART_NAME[x.k]}</span><b>${e0(x.w)}</b></i>`).join('');
  const kaufkraft = annahme.kaufkraft ? 'in heutiger Kaufkraft' : 'in Euro des Rentenjahres';
  const regler = (id, label, min, max, step, wert, einheit) => `<label class="ge-regler"><span>${label}</span><input type="range" data-ge-annahme="${id}" min="${min}" max="${max}" step="${step}" value="${wert}"><b>${String(wert).replace('.', ',')} ${einheit}</b></label>`;
  const satz = `Mit ${R.beginn ? `Rentenbeginn ${H.dde(V.rentenbeginn)} (in ${Math.round(R.jahre)} Jahren)` : 'Rentenbeginn'} kommst du zusammen auf etwa <b>${e0(R.summe)}</b> im Monat ${kaufkraft}, vor Steuern und Krankenversicherung${quote ? ` – das sind <b>${pz(quote)}</b> deines heutigen Grundgehalts` : ''}. Nach Abzügen bleiben grob <b class="pos">${e0(R.netto)}</b>${nettoHeute ? ` (heute kommen ${e0(nettoHeute)} im Monat aufs Konto)` : ''}.`;
  const hoch = H.karte5('Deine Rente – alles zusammen hochgerechnet', `gesetzliche Rente, Betriebsrente und private Vorsorge · ${kaufkraft} · Annahmen unten änderbar`,
    `<p class="ge-text">${satz}</p>
    <div class="ge-rbalken">${balken}</div>
    <div class="ge-rvgl">
      <div><span>Heute aufs Konto</span><b>${e0(nettoHeute || 0)}</b><small>Auszahlung ${letzt ? H.monKurz(letzt.m) : ''}</small></div>
      <div><span>Rente brutto</span><b>${e0(R.summe)}</b><small>${kaufkraft}</small></div>
      <div><span>Rente nach Abzügen</span><b class="pos">${e0(R.netto)}</b><small>grob, ${annahme.abzug} % Steuer und KV/PV</small></div>
      <div><span>Lücke zu heute</span><b class="${nettoHeute && R.netto < nettoHeute ? 'neg' : 'pos'}">${nettoHeute ? pm0(R.netto - nettoHeute) : '–'}</b><small>im Monat</small></div>
    </div>
    <div class="ge-annahmen">
      ${regler('anpassung', 'Rentensteigerung gesetzlich pro Jahr', 0, 4, 0.5, annahme.anpassung, '%')}
      ${regler('inflation', 'Inflation pro Jahr', 0, 4, 0.5, annahme.inflation, '%')}
      ${regler('abzug', 'Abzüge im Alter (Steuer, KV/PV)', 10, 45, 1, annahme.abzug, '%')}
      ${R.agProz != null ? `<label class="ge-regler"><span>Arbeitgeber zahlt in die Betriebsrente<small>${R.agAbr != null ? `laut Abrechnung ${H.monKurz(akt.m)}: ${pz(R.agAbr / 100, 1)} = ${e0(akt.bav_ag)}` : ''}${V.ag_vereinbart_prozent && R.agAbr != null && Math.abs(V.ag_vereinbart_prozent - R.agAbr) > 0.2 ? ` · vereinbart ${V.ag_vereinbart_prozent} %` : ''}</small></span><input type="range" data-ge-annahme="agProz" min="0" max="15" step="0.5" value="${R.agProz}"><b>${String(R.agProz).replace('.', ',')} %</b></label>` : ''}
      <label class="ge-check"><input type="checkbox" data-ge-annahme="kaufkraft"${annahme.kaufkraft ? ' checked' : ''}> in heutiger Kaufkraft rechnen</label>
    </div>
    ${renteZusaetze(V, R, akt)}
    <p class="s5-erkl">Gesetzliche Rente: Prognose der Rentenversicherung (Beiträge wie in den letzten Jahren), mit der eingestellten Rentensteigerung. Betriebs- und Privatrenten: Prognosen der Anbieter, sonst die garantierten Werte. ${V.hinweise?.length ? V.hinweise.map(H.esc).join(' ') : ''} Grobe Hochrechnung, keine Beratung.</p>`, 's5-b2', '', 'ge-rente');

  const zeilen = R.posten.map((x) => `<div class="ge-rz">
      <i style="background:${ART_FARBE[x.k]}"></i>
      <span>${H.esc(x.name)}<small>${H.esc(x.sub || '')}${x.beitrag ? ` · ${e0(x.beitrag)} im Monat` : ''}${x.wert ? ` · Wert ${e0(x.wert)}${x.wertDatum ? ` (${H.dde(x.wertDatum)})` : ''}` : ''}</small></span>
      <b>${x.wert_rente != null ? `${x.schaetzung ? '≈ ' : ''}${e0(x.wert_rente)}` : x.kapital ? `${e0(x.kapital)}` : '–'}<small>${x.heute != null ? `heute erworben ${e0(x.heute)}` : x.kapital && x.wert_rente == null ? `Kapital ${x.kapitalDatum ? x.kapitalDatum.slice(0, 4) : ''}` : x.schaetzung ? 'grobe Schätzung' : x.garantiert != null ? `garantiert ${e0(annahme.kaufkraft ? x.garantiert / Math.pow(1 + annahme.inflation / 100, R.jahre) : x.garantiert)}` : 'Prognose'}</small></b>
    </div>${x.hinweis ? `<p class="ge-rh">${H.esc(x.hinweis)}</p>` : ''}`).join('');
  const liste = H.karte5('Deine Altersvorsorge', `Stand der Unterlagen: ${V.stand ? H.esc(V.stand) : '–'} · rechts: Rente im Monat ${kaufkraft}`,
    `<div class="ge-rliste">${zeilen}</div><div class="ge-rz ge-rsum"><i></i><span>Zusammen</span><b>${e0(R.summe)}</b></div>`);
  return `<div class="s5-raster">${hoch}${liste}</div>${vaKarte(V, R)}`;
}
// ---------------------------------------------------------------- Versorgungsausgleich (Scheidung)
// Je Anrecht wird der in der Ehezeit erworbene Teil halbiert. Gesetzliche Rente: Entgeltpunkte (EP) der Ehezeit, beide Seiten
// gleichen aus (abgeben die Hälfte der eigenen, bekommen die Hälfte der fremden). Verträge: Anteil der Rente aus der Ehezeit.
// „Wieder aufgebaut“: so viele Jahre mit den heutigen Beiträgen, bis der Verlust ersetzt ist.
function vaRechnen(V, R) {
  const va = V.va;
  if (!va) return null;
  const auf = (x) => R.real(x * Math.pow(1 + annahme.anpassung / 100, R.jahre));   // Euro heute → Rentenjahr → (Kaufkraft)
  const zeilen = [];
  let proJahr = 0;
  const g = va.grv;
  if (g) {
    const ab = (g.ep_ehe_m || 0) / 2, zu = (g.ep_ehe_s || 0) / 2;
    zeilen.push({ name: 'Gesetzliche Rente', ehe: `${(g.ep_ehe_m ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} EP in der Ehe (Sandra ${(g.ep_ehe_s ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} EP)`,
      ab: auf(ab * g.rentenwert), zu: auf(zu * g.rentenwert), sub: zu ? `du gibst ${ab.toLocaleString('de-DE', { maximumFractionDigits: 2 })} EP ab und bekommst ${zu.toLocaleString('de-DE', { maximumFractionDigits: 2 })} EP` : `du gibst ${ab.toLocaleString('de-DE', { maximumFractionDigits: 2 })} EP ab` });
    proJahr += auf((g.ep_pro_jahr || 0) * g.rentenwert);
  }
  // Betriebsrenten, Riester: Verlust und Zuwachs je Beitragsjahr sind in gehalt_daten/vorsorge_bauen als Rente im Rentenjahr gerechnet
  for (const x of R.posten) {
    const v = (va.vertraege || {})[x.name];
    if (!v) continue;
    zeilen.push({ name: x.name, ehe: `Ehezeitanteil ${e0(v.ehezeit_kapital)}`, ab: R.real(v.verlust_nominal || 0), zu: R.real(v.gewinn_nominal || 0), sub: v.hinweis || '' });
    proJahr += R.real(v.zuwachs_jahr_nominal || 0);
  }
  for (const z of va.zugang || []) zeilen.push({ name: z.name, ehe: 'Anrecht der Ehefrau', ab: 0, zu: R.real(z.rente_nominal ?? z.rente), sub: z.hinweis || '' });
  const ab = sum(zeilen, (x) => x.ab), zu = sum(zeilen, (x) => x.zu), netto = ab - zu;
  const erworben = (V.gesetzlich?.bisher || 0) + sum(Object.values(va.vertraege || {}), (v) => R.real(2 * (v.verlust_nominal || 0)));
  return { zeilen, ab, zu, netto, vorher: R.summe, nachher: R.summe - netto, proJahr, jahre: proJahr > 0 ? netto / proJahr : null, erworben };
}
function vaKarte(V, R) {
  const A = vaRechnen(V, R), va = V.va;
  if (!A) return '';
  const kk = annahme.kaufkraft ? 'in heutiger Kaufkraft' : 'in Euro des Rentenjahres';
  const jz = A.jahre > 0 ? A.jahre.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '';
  const jahreTxt = A.jahre == null ? '–' : A.jahre <= 0 ? 'kein Verlust' : `≈ ${jz} Jahre`;
  const bisWann = A.jahre > 0 && va.ehezeit_ende ? new Date(new Date(va.ehezeit_ende).getTime() + A.jahre * 365.25 * 864e5) : null;
  const zeilen = A.zeilen.map((x) => `<tr><td>${H.esc(x.name)}<small>${H.esc(x.ehe)}${x.sub ? ` · ${H.esc(x.sub)}` : ''}</small></td>
    <td class="r neg">${x.ab ? `−${e0(x.ab)}` : '–'}</td><td class="r pos">${x.zu ? `+${e0(x.zu)}` : '–'}</td><td class="r"><b>${pm0(x.zu - x.ab)}</b></td></tr>`).join('');
  const satz = `Nach dem Versorgungsausgleich bleiben dir mit 67 etwa <b>${e0(A.nachher)}</b> statt ${e0(A.vorher)} im Monat (${kk}), also <b class="neg">${e0(A.netto)} weniger</b> (−${pz(A.netto / A.vorher)}).`
    + ` Der Anteil wirkt klein, weil bis zur Rente noch viele Beitragsjahre dazukommen: Von dem, was du <b>bis heute</b> erworben hast (≈ ${e0(A.erworben)} Rente), gibst du <b>${pz(A.netto / A.erworben)}</b> ab. Bei der gesetzlichen Rente gleicht Sandras Hälfte rund die Hälfte deines Abgangs aus.`
    + (A.jahre > 0 ? ` Mit deinen heutigen Beiträgen (gesetzlich und Betriebsrente) hast du diesen Verlust nach etwa <b>${jz} Jahren</b> wieder aufgebaut${bisWann ? `, gerechnet ab Ehezeitende also etwa ${bisWann.getFullYear()}` : ''}.` : '');
  return H.karte5('Rente nach der Scheidung', `Versorgungsausgleich: Die in der Ehezeit (${va.ehezeit_beginn ? H.dde(va.ehezeit_beginn) : '?'} – ${va.ehezeit_ende ? H.dde(va.ehezeit_ende) : '?'}) erworbenen Anrechte werden geteilt · ${kk}`,
    `<p class="ge-text">${satz}</p>
    <div class="ge-rvgl">
      <div><span>Vor dem Ausgleich</span><b>${e0(A.vorher)}</b><small>Rente im Monat mit 67</small></div>
      <div><span>Nach dem Ausgleich</span><b>${e0(A.nachher)}</b><small>Rente im Monat mit 67</small></div>
      <div><span>Differenz</span><b class="neg">${pm0(-A.netto)}</b><small>${pz(A.netto / A.vorher, 1)} weniger</small></div>
      <div><span>Wieder aufgebaut nach</span><b>${jahreTxt}</b><small>Zuwachs ${e0(A.proJahr)} Rente je Beitragsjahr</small></div>
    </div>
    <div class="t3-rahmen"><table class="t3 ge-vat"><thead><tr><th>Anrecht</th><th class="r">gibst du ab</th><th class="r">bekommst du</th><th class="r">Saldo</th></tr></thead><tbody>${zeilen}
      <tr class="ge-sum"><td>Zusammen</td><td class="r neg">−${e0(A.ab)}</td><td class="r pos">${A.zu ? `+${e0(A.zu)}` : '–'}</td><td class="r"><b>${pm0(-A.netto)}</b></td></tr></tbody></table></div>
    <p class="s5-erkl">${(va.hinweise || []).map(H.esc).join(' ')} Schätzung, keine Rechts- oder Rentenberatung; maßgeblich ist der Beschluss des Familiengerichts.</p>`, '', '', 'ge-va');
}

function renteZusaetze(V, R, akt) {
  const monate = Math.round(R.jahre * 12);
  const teile = [];
  // 1. Was bis zur Rente noch eingezahlt wird (heutige Beiträge × Monate, ohne Steigerung)
  if (akt && monate > 0) {
    const rv = 2 * (akt.rv || 0) * monate, bavDu = (akt.bav_an || 0) * monate, bavAg = (R.agNeu ?? akt.bav_ag ?? 0) * monate;
    const bis = (v) => (v.beitrag_bis ? Math.max(0, Math.min(monate, Math.round((new Date(v.beitrag_bis) - new Date()) / (30.44 * 864e5)))) : monate);
    const privat = sum(V.vertraege.filter((v) => !/^bAV/i.test(v.art)), (v) => (v.beitrag_an || 0) * bis(v));
    teile.push(`<div class="ge-rteil fuell-aus" data-fuell="1"><h3>Bis zur Rente zahlst du noch ein</h3><dl class="s5-dl">
      <div><dt>Gesetzliche Rente <small>dein Anteil und der des Arbeitgebers</small></dt><dd>${e0(rv)}</dd></div>
      <div><dt>Betriebsrente <small>du ${e0(bavDu)} · Arbeitgeber ${e0(bavAg)}</small></dt><dd>${e0(bavDu + bavAg)}</dd></div>
      ${privat ? `<div><dt>Privat <small>Riester, Lebensversicherung</small></dt><dd>${e0(privat)}</dd></div>` : ''}
      <div><dt><b>Zusammen</b> <small>in ${monate} Monaten, Beiträge wie heute</small></dt><dd>${e0(rv + bavDu + bavAg + privat)}</dd></div></dl></div>`);
  }
  // 2. Betriebsrente als Einmalbetrag
  const kap = V.vertraege.filter((v) => /^bAV/i.test(v.art) && v.kapital_prognose);
  if (kap.length) {
    const nominal = sum(kap, (v) => v.kapital_prognose);
    teile.push(`<div class="ge-rteil fuell-aus" data-fuell="2"><h3>Statt Rente: Betriebsrente als Einmalbetrag</h3><dl class="s5-dl">
      <div><dt>Kapital laut Allianz-Prognose <small>${kap.length} Verträge, im Jahr ${H.esc((V.rentenbeginn || '').slice(0, 4))}</small></dt><dd>${e0(nominal)}</dd></div>
      <div><dt>in heutiger Kaufkraft <small>${String(annahme.inflation).replace('.', ',')} % Inflation</small></dt><dd>${e0(nominal / Math.pow(1 + annahme.inflation / 100, R.jahre))}</dd></div></dl>
      <p class="s5-erkl">Beim Einmalbetrag fallen Steuer und Kranken-/Pflegeversicherung ebenfalls an (KV/PV verteilt auf 10 Jahre).</p></div>`);
  }
  // 3. Garantiert gegenüber Prognose
  if (R.garantiert) {
    const max = Math.max(R.summe, R.garantiert);
    teile.push(`<div class="ge-rteil fuell-aus" data-fuell="3"><h3>Sicher oder erhofft?</h3>
      <div class="ge-gp"><span>garantiert</span><i style="width:${(R.garantiert / max) * 100}%"></i><b>${e0(R.garantiert)}</b></div>
      <div class="ge-gp"><span>Prognose</span><i class="p" style="width:${(R.summe / max) * 100}%"></i><b>${e0(R.summe)}</b></div>
      <p class="s5-erkl">Garantiert = gesetzliche Rente aus den bisherigen Beiträgen plus die garantierten Werte der Verträge.</p></div>`);
  }
  // 4. Gesetzliche Rente im Verlauf der Renteninformationen
  const vl = V.gesetzlich?.verlauf || [];
  if (vl.length > 1) {
    teile.push(`<div class="ge-rteil fuell-aus" data-fuell="4"><h3>Deine gesetzliche Rente wächst</h3><dl class="s5-dl">${vl.map((x) => `<div><dt>Renteninformation ${H.dde(x.datum)}</dt><dd>${e0(x.bisher)}<small>erworben · Prognose ${e0(x.prognose)}</small></dd></div>`).join('')}</dl></div>`);
  }
  return teile.length ? `<div class="ge-rzus">${teile.join('')}</div>` : '';
}
function renteZeichnen() {}

// ---------------------------------------------------------------- Alle Daten der Abrechnungen
const ZEILEN = [
  ['h', 'Bezüge'],
  ['gehalt', 'Grundgehalt'], ['praemie', 'Prämie'], ['sonder', 'Sonderzahlung'], ['privatfahrten', 'Dienstwagen: Privatfahrten'],
  ['whg_arbeit', 'Dienstwagen: Wohnung – Arbeit'], ['sachbezug', 'Gutscheine, Sachzuwendungen'], ['=brutto', 'Gesamt-Brutto'],
  ['h', 'Steuer'], ['steuer_brutto', 'Steuer-Brutto'], ['-lohnsteuer', 'Lohnsteuer'], ['-soli', 'Solidaritätszuschlag'], ['-kirchensteuer', 'Kirchensteuer'],
  ['h', 'Sozialversicherung'], ['sv_brutto', 'RV-/AV-Brutto'], ['-rv', 'Rentenversicherung'], ['-av', 'Arbeitslosenversicherung'],
  ['=netto_verdienst', 'Netto-Verdienst'],
  ['h', 'Netto-Abzüge und -Zuschüsse'], ['-bav_an', 'Betriebsrente (Entgeltumwandlung)'], ['-_auto', 'Dienstwagen (Sachbezug)'], ['-_sach', 'Gutscheine (Sachbezug)'],
  ['-kv', 'Krankenversicherung'], ['kv_zuschuss', 'Zuschuss Arbeitgeber KV'], ['-pv', 'Pflegeversicherung'], ['pv_zuschuss', 'Zuschuss Arbeitgeber PV'], ['-sonst_abzug', 'Private Abzüge'],
  ['=auszahlung', 'Auszahlung'],
  ['h', 'Zusätzlich vom Arbeitgeber'], ['bav_ag', 'Betriebsrente Arbeitgeber'], ['sv_ag', 'Sozialversicherung Arbeitgeberanteil'], ['_kosten', 'Kosten des Arbeitgebers'],
  ['h', 'Merkmale'], ['#stkl', 'Steuerklasse'], ['#kinderfreibetrag', 'Kinderfreibetrag'], ['#kv_satz', 'KV-Beitragssatz'], ['#krankenkasse', 'Krankenkasse'],
  ['#urlaubsanspruch', 'Urlaubsanspruch'], ['#erstellt', 'Abrechnung vom'], ['#_konto', 'Auf dem Konto'], ['#_quelle', 'Quelle'],
];
function wert(z, feld) {
  if (feld === '_auto') return detail(z) ? auto(z) : null;
  if (feld === '_sach') return detail(z) ? z.sachbezug : null;
  if (feld === '_kosten') return detail(z) && z.sv_ag != null ? z.brutto + (z.bav_ag || 0) + z.sv_ag : null;   // SV-Anteil enthält die Zuschüsse zu KV und PV
  if (feld === '_konto') { const r = eingang(z); return r ? `✓ ${H.dde(r.d).slice(0, 6)}` : '–'; }
  if (feld === '_quelle') return detail(z) ? (z.geprueft ? 'PDF ✓ geprüft' : 'PDF') : 'Lohn-02.xlsx';
  if (feld === 'kinderfreibetrag') return z.kinderfreibetrag != null ? z.kinderfreibetrag.toLocaleString('de-DE', { minimumFractionDigits: 1 }) : null;
  if (feld === 'kv_satz') return z.kv_satz != null ? `${z.kv_satz.toLocaleString('de-DE')} %` : null;
  if (feld === 'urlaubsanspruch') return z.urlaubsanspruch != null ? `${z.urlaubsanspruch} Tage` : null;
  if (feld === 'erstellt') return z.erstellt ? z.erstellt.slice(0, 6) : null;
  return z[feld] ?? null;
}
const BEREICHE = [['alle', 'Alles'], ['Bezüge', 'Bezüge'], ['Steuer', 'Steuer'], ['Sozialversicherung', 'Sozialvers.'],
  ['Netto-Abzüge und -Zuschüsse', 'Netto-Abzüge'], ['Zusätzlich vom Arbeitgeber', 'Arbeitgeber'], ['Merkmale', 'Merkmale']];
function datenKarte(G, el) {
  const breite = el.clientWidth || 1200, schmal = breite < 640;
  if (Math.abs(breite - spaltenBreite) > 20) { spaltenBreite = breite; tabStufe = 0; }
  // Stufe vorab schätzen: Name + Summe + 12 Monate à ~84 px (mit Cent) bzw. ~62 px (ohne)
  const platz = breite - (schmal ? 24 : 40) - (schmal ? 110 : 210) - (schmal ? 0 : 100);
  const stufe = Math.max(tabStufe, platz >= 12 * 84 ? 0 : platz >= 12 * 62 ? 1 : platz >= 6 * 62 ? 2 : 3);
  const teile = stufe <= 1 ? 1 : stufe === 2 ? 2 : 4, proTeil = 12 / teile, cent = stufe === 0;
  const jahre = [...new Set(G.ist.map((z) => z.m.slice(0, 4)))].sort().reverse();
  const jahr = jahre.includes(tabJahr) ? tabJahr : (wahl || G.ist.at(-1).m).slice(0, 4);
  // gezeigter Teil des Jahres: beim schmalen Bildschirm der mit der gewählten Abrechnung, bis man selbst blättert
  if (tabTeil >= teile) tabTeil = 0;
  const wm = wahl.startsWith(jahr) ? +wahl.slice(5) - 1 : 0;
  const teil = teile === 1 ? 0 : tabTeil < 0 ? Math.floor(wm / proTeil) : tabTeil;
  const monate = Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, '0')}`).slice(teil * proTeil, (teil + 1) * proTeil);
  const ist = new Set(G.ist);
  const ms = monate.map((m) => { const z = G.nach.get(m); return z && ist.has(z) ? z : null; });
  const jahrMs = G.ist.filter((z) => z.m.startsWith(jahr));
  const genutzt = (feld) => jahrMs.some((z) => { const v = wert(z, feld); return v != null && v !== 0 && v !== '–'; });
  const zahl = (v) => H.eur(Math.round(v * (cent ? 100 : 1)) * (cent ? 1 : 100)).replace(cent ? /\s?€/ : /,00\s?€/, '');
  const zeilen = [];
  let kopfOffen = null, bereich = '';
  for (const [f, name] of ZEILEN) {
    if (f === 'h') { kopfOffen = bereich = name; continue; }
    if (tabBereich !== 'alle' && bereich !== tabBereich) continue;
    const text = f.startsWith('#'), neg = f.startsWith('-'), summe = f.startsWith('=');
    const feld = f.replace(/^[-=#]/, '');
    if (!genutzt(feld)) continue;
    if (kopfOffen) { zeilen.push(`<tr class="ge-th"><th colspan="${ms.length + 1 + (schmal ? 0 : 1)}">${kopfOffen}</th></tr>`); kopfOffen = null; }
    const zelle = (z) => {
      if (!z) return '<td class="r muted ge-leer"></td>';
      const v = wert(z, feld);
      if (v == null || v === '') return `<td class="r muted"${z.scan ? ' title="Steht auf dieser Abrechnung nicht (neues Lohnsystem bei Wurzer ab 04/2025)"' : ''}>–</td>`;
      // nicht gedruckt, aus deinen Anteilen berechnet (eingescannte Wurzer-Abrechnungen 04/2025–04/2026)
      const ber = (z.berechnet || []).includes(feld) || ((feld === 'sv_ag' || feld === '_kosten') && z.sv_ag_berechnet);
      const tip = ber ? ' title="Steht nicht auf der Abrechnung – berechnet aus deinem Anteil: Renten- und Arbeitslosenversicherung gleich hoch, Krankenversicherung zur Hälfte, Pflege 1,8 % statt deiner 1,55 %"' : '';
      if (text || typeof v === 'string') return `<td class="r ge-txt${ber ? ' ge-ber' : ''}"${tip}>${ber ? '≈ ' : ''}${H.esc(String(v))}</td>`;
      if (!v) return '<td class="r muted">0</td>';
      return `<td class="r${neg ? ' neg' : ''}${ber ? ' ge-ber' : ''}"${tip || (cent ? '' : ` title="${H.eur(Math.round(v * 100))}"`)}>${ber ? '≈ ' : ''}${neg ? '−' : ''}${zahl(v)}</td>`;
    };
    const s = !text ? sum(jahrMs, (z) => { const v = wert(z, feld); return typeof v === 'number' ? v : 0; }) : null;
    const nJahr = jahrMs.filter((z) => typeof wert(z, feld) === 'number').length;
    zeilen.push(`<tr class="${summe ? 'ge-sum' : ''}"><td>${name}</td>${ms.map(zelle).join('')}${schmal ? '' : `<td class="r ge-js">${text ? '' : !nJahr ? '–' : `${neg ? '−' : ''}${zahl(s)}`}</td>`}</tr>`);
  }
  if (!zeilen.length) zeilen.push(`<tr><td colspan="${ms.length + 2}" class="muted">In ${jahr} gibt es zu diesem Bereich keine Werte.</td></tr>`);
  const kopf = `<tr><th>in €${cent ? '' : '<small>ohne Cent</small>'}</th>${monate.map((m, i) => {
    const z = ms[i];
    return z ? `<th class="r"><button class="ge-mk${z.m === wahl ? ' an' : ''}" data-ge-m="${z.m}" title="Diese Abrechnung oben zeigen">${H.MON[+m.slice(5) - 1]}${detail(z) ? '' : '<small>Summen</small>'}</button></th>`
      : `<th class="r muted ge-leer">${H.MON[+m.slice(5) - 1]}<small>${m > G.ist.at(-1).m ? 'kommt noch' : 'keine'}</small></th>`;
  }).join('')}${schmal ? '' : `<th class="r">Summe ${jahr}<small>${jahrMs.length} Mon.</small></th>`}</tr>`;
  const ji = jahre.indexOf(jahr);
  const TEILNAME = teile === 2 ? ['Jan – Jun', 'Jul – Dez'] : ['Jan – Mär', 'Apr – Jun', 'Jul – Sep', 'Okt – Dez'];
  const filter = `<div class="ge-tfilter">
    <div class="ge-tjahr"><button class="btn sm" data-ge-tjahr="${jahre[ji + 1] || ''}"${jahre[ji + 1] ? '' : ' disabled'} aria-label="Vorjahr">‹</button>
      <select id="ge-tjahr" aria-label="Jahr">${jahre.map((j) => `<option${j === jahr ? ' selected' : ''}>${j}</option>`).join('')}</select>
      <button class="btn sm" data-ge-tjahr="${jahre[ji - 1] || ''}"${jahre[ji - 1] ? '' : ' disabled'} aria-label="Folgejahr">›</button></div>
    ${teile > 1 ? `<div class="seg ge-tteil" role="group" aria-label="Teil des Jahres">${TEILNAME.map((t, i) => `<button data-ge-tteil="${i}" class="${i === teil ? 'an' : ''}">${t}</button>`).join('')}</div>` : ''}
    <select id="ge-tbereich" aria-label="Bereich">${BEREICHE.map(([k, t]) => `<option value="${k}"${k === tabBereich ? ' selected' : ''}>${k === 'alle' ? 'Alle Bereiche' : t}</option>`).join('')}</select>
    <button class="btn sm" id="ge-excel" title="Alle Monate und alle Lohnarten als Excel-Datei">Excel</button></div>`;
  return H.karte5('Alle Daten der Abrechnungen', `jede Zeile deiner Abrechnungen, ${teile === 1 ? 'Januar bis Dezember' : 'Monat für Monat'} ${jahr} · ${G.pdf.length} Abrechnungen als PDF mit allen Einzelheiten, frühere Monate aus Lohn-02.xlsx (nur Summen) · ≈ = berechnet, weil die Abrechnung es nicht druckt · Maus auf einen Wert: Erklärung`,
    `${filter}<div class="t3-rahmen"><table class="t3 ge-tab${cent ? '' : ' ohne-cent'}"><thead>${kopf}</thead><tbody>${zeilen.join('')}</tbody></table></div>`, '', '', 'ge-daten');
}

// ---------------------------------------------------------------- Grafik
function verlaufZeichnen(G) {
  if (!document.getElementById('c-ge-verlauf')) return;
  const { css, alpha } = H;
  const cG = css('--accent'), cS = '#9085e9', cA = css('--g-auto') || '#d9a21b', cK = css('--ein');
  const L = G.alle.filter((z) => z.quelle !== 'fehlt');
  let labels, reihen, planAb = -1, punkte = [];
  if (ansicht === 'jahre') {
    const jahre = [...new Set(L.map((z) => z.m.slice(0, 4)))].sort();
    labels = jahre;
    const s = (j, f, p) => sum(L.filter((z) => z.m.startsWith(j) && (z.quelle === 'plan') === p), f);
    reihen = { g: jahre.map((j) => s(j, (z) => z.gehalt, false)), s: jahre.map((j) => s(j, extra, false)), a: jahre.map((j) => s(j, (z) => Math.max(0, auto(z)), false)),
      p: jahre.map((j) => s(j, (z) => z.brutto, true) || null), k: jahre.map((j) => sum(L.filter((z) => z.m.startsWith(j)), (z) => z.auszahlung)) };
    if (reihen.p.some(Boolean)) planAb = reihen.p.findIndex(Boolean);
  } else {
    labels = L.map((z) => H.monKurz(z.m));
    const ist = (f) => L.map((z) => (z.quelle === 'plan' ? null : f(z)));
    const plan = (f) => L.map((z) => (z.quelle === 'plan' ? f(z) : null));
    reihen = { g: ist((z) => z.gehalt), s: ist(extra), a: ist((z) => Math.max(0, auto(z))), pg: plan((z) => z.gehalt), ps: plan(extra), pa: plan(auto), k: L.map((z) => z.auszahlung ?? null) };
    planAb = L.findIndex((z) => z.quelle === 'plan');
    punkte = G.erh.map((x) => ({ i: L.findIndex((z) => z.m === x.m), x }));
  }
  const bar = (label, data, farbe, extra = {}) => ({ type: 'bar', label, data, backgroundColor: farbe, stack: 'b', borderRadius: 0, borderSkipped: false, categoryPercentage: 0.9, barPercentage: 0.92, order: 2, ...extra });
  const ds = [
    bar('Grundgehalt', reihen.g, cG), bar('Prämien und Sonstiges', reihen.s, cS), bar('Dienstwagen', reihen.a, alpha(cA, 0.75)),
  ];
  if (ansicht === 'jahre') ds.push(bar('Plan (noch ohne Abrechnung)', reihen.p, H.schraffur(cG)));
  else ds.push(bar('Plan: Grundgehalt', reihen.pg, H.schraffur(cG)), bar('Plan: Sonderzahlungen', reihen.ps, H.schraffur(cS)), bar('Plan: Dienstwagen', reihen.pa, H.schraffur(cA)));
  ds.push({ type: 'line', label: 'Aufs Konto', data: reihen.k, borderColor: cK, backgroundColor: cK, borderWidth: 2, pointRadius: ansicht === 'jahre' ? 3.5 : 0, pointHoverRadius: 4, tension: 0, order: 1, spanGaps: false,
    segment: { borderDash: (sg) => (planAb >= 0 && sg.p1DataIndex >= planAb ? [5, 4] : undefined) } });
  const o = H.basis();
  o.interaction = { mode: 'index', intersect: false };
  o.layout = { padding: { top: ansicht === 'jahre' ? 20 : 26, right: 6 } };
  o.plugins.legend = { display: true, position: 'bottom', labels: { color: css('--text-2'), boxWidth: 12, boxHeight: 12, usePointStyle: false, filter: (it) => !it.text.startsWith('Plan:') } };
  o.plugins.tooltip.callbacks = {
    label: (it) => (it.raw ? ` ${it.dataset.label}: ${e0(it.raw)}` : null),
    footer: (its) => { const b = sum(its.filter((x) => x.dataset.type !== 'line'), (x) => x.raw || 0); return b ? `Brutto: ${e0(b)}` : ''; },
  };
  o.scales = {
    x: { ...H.achsenStil(), stacked: true, grid: { display: false }, ticks: { ...H.achsenStil().ticks, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 11 } } },
    y: { ...H.achsenStil(), stacked: true, beginAtZero: true, ticks: { ...H.achsenStil().ticks, callback: H.achse, maxTicksLimit: 6 } },
  };
  o.onClick = (_, els) => {
    if (ansicht !== 'monate' || !els.length) return;
    const z = L[els[0].index];
    if (z && z.quelle !== 'plan') { wahl = z.m; neu(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };
  o.onHover = (ev, els) => { ev.native.target.style.cursor = ansicht === 'monate' && els.length && L[els[0].index]?.quelle !== 'plan' ? 'pointer' : 'default'; };
  // Gehaltserhöhungen als Marke über der Säule, Wechsel des Arbeitgebers als senkrechte Linie
  const marken = {
    id: 'geMarken',
    afterDatasetsDraw(ch) {
      const c = ch.ctx, a = ch.chartArea;
      c.save(); c.font = `700 10.5px ${css('--font')}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
      if (ansicht === 'jahre') {
        // Summen über den Säulen
        labels.forEach((_, i) => {
          const tot = ch.data.datasets.filter((d) => d.type !== 'line').reduce((t, d) => t + (d.data[i] || 0), 0);
          const y = ch.scales.y.getPixelForValue(tot), x = ch.scales.x.getPixelForValue(i);
          c.fillStyle = css('--text-2'); c.fillText(`${reihen.p[i] ? '≈' : ''}${H.kurzWert(tot)}`, x, y - 3);
        });
      } else {
        for (const { i, x } of punkte) {
          if (i < 0) continue;
          const px = ch.scales.x.getPixelForValue(i);
          if (x.wechsel) {
            c.strokeStyle = css('--muted'); c.setLineDash([4, 3]); c.lineWidth = 1;
            c.beginPath(); c.moveTo(px - (ch.scales.x.width / labels.length) / 2, a.top); c.lineTo(px - (ch.scales.x.width / labels.length) / 2, a.bottom); c.stroke(); c.setLineDash([]);
          }
          const tot = ch.data.datasets.filter((d) => d.type !== 'line').reduce((t, d) => t + (d.data[i] || 0), 0);
          const y = Math.max(a.top + 12, ch.scales.y.getPixelForValue(tot) - 4);
          const t = `+${Math.round(x.p * 100)} %`;
          c.lineWidth = 3; c.strokeStyle = css('--surface'); c.lineJoin = 'round';
          c.fillStyle = x.plan ? css('--muted') : css('--ein-text');
          c.strokeText(t, px, y); c.fillText(t, px, y);
        }
      }
      c.restore();
    },
  };
  H.zeichne('c-ge-verlauf', { type: 'bar', data: { labels, datasets: ds }, options: o, plugins: [marken] });
}

// ---------------------------------------------------------------- Klicks und Regler
let neu = () => {};
function binden(el, G) {
  neu = () => gehaltZeigen(el, H);
  H.freiFuellen(el);
  H.gehBinden(el);
  el.querySelector('#ge-monat')?.addEventListener('change', (ev) => { wahl = ev.target.value; tabJahr = ''; tabTeil = -1; neu(); });
  el.querySelectorAll('[data-ge-m]').forEach((b) => b.onclick = () => { wahl = b.dataset.geM; neu(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  el.querySelectorAll('[data-ge-basis]').forEach((b) => b.onclick = () => { basisWahl = b.dataset.geBasis; neu(); });
  el.querySelectorAll('[data-ge-ansicht]').forEach((b) => b.onclick = () => { ansicht = b.dataset.geAnsicht; el.querySelectorAll('[data-ge-ansicht]').forEach((x) => x.classList.toggle('an', x === b)); verlaufZeichnen(G); });
  // Tabelle „Alle Daten“: Jahr, Teil des Jahres, Bereich
  const tabNeu = () => { neu(); H.springe('#ge-daten', false); };
  el.querySelector('#ge-tjahr')?.addEventListener('change', (ev) => { tabJahr = ev.target.value; tabTeil = 0; tabNeu(); });
  el.querySelectorAll('[data-ge-tjahr]').forEach((b) => b.onclick = () => { if (b.dataset.geTjahr) { tabJahr = b.dataset.geTjahr; tabTeil = 0; tabNeu(); } });
  el.querySelectorAll('[data-ge-tteil]').forEach((b) => b.onclick = () => { tabTeil = +b.dataset.geTteil; tabNeu(); });
  el.querySelector('#ge-tbereich')?.addEventListener('change', (ev) => { tabBereich = ev.target.value; tabNeu(); });
  const erh = el.querySelector('#ge-erh');
  if (erh) erh.oninput = () => {
    erhoehung = +erh.value;
    const z = G.nach.get(wahl), svFrei = detail(z) && z.sv_brutto && z.steuer_brutto > z.sv_brutto;
    el.querySelector('#ge-erh-w').textContent = e0(erhoehung);
    el.querySelector('#ge-erh-t').innerHTML = erhoehungText(erhoehung, erhoehung * (1 - G.gs.r - (svFrei ? 0 : 0.2)));
  };
  // Dienstwagen: Regler rechnen sofort, gespeichert wird beim Loslassen
  const zA = G.nach.get(wahl);
  const autoNeu = () => { const W = autoWerte(G, zA); const box = el.querySelector('#ge-auto-erg'); if (box) box.innerHTML = autoText(W); };
  const autoSpeichern = () => { try { localStorage.setItem('fd.dienstwagen', JSON.stringify(auto_)); } catch {} };
  el.querySelectorAll('[data-ge-auto]').forEach((r) => {
    r.oninput = () => {
      auto_ = { ...autoWerte(G, zA).a, [r.dataset.geAuto]: +r.value };
      r.nextElementSibling.textContent = r.dataset.geAuto === 'km' ? `${r.value} km` : e0(+r.value);
      autoNeu();
    };
    r.onchange = autoSpeichern;
  });
  el.querySelectorAll('[data-ge-satz]').forEach((b) => b.onclick = () => {
    auto_ = { ...autoWerte(G, zA).a, satz: +b.dataset.geSatz };
    el.querySelectorAll('[data-ge-satz]').forEach((x) => x.classList.toggle('an', x === b));
    autoNeu(); autoSpeichern();
  });
  el.querySelector('[data-ge-auto-zurueck]')?.addEventListener('click', () => { auto_ = null; try { localStorage.removeItem('fd.dienstwagen'); } catch {} neu(); });
  el.querySelector('[data-ge-auto-best]')?.addEventListener('click', () => {
    const b = H.D.j.gehalt.dienstwagen.bestellt;
    auto_ = { ...autoWerte(G, zA).a, preis: Math.round(b.listenpreis), satz: b.satz_prozent };
    autoSpeichern(); const y = window.scrollY; neu(); window.scrollTo({ top: y });
  });
  el.querySelector('#ge-excel')?.addEventListener('click', () => excel(G));
  el.querySelectorAll('[data-ge-annahme]').forEach((r) => {
    const k = r.dataset.geAnnahme;
    r.oninput = () => { if (k !== 'kaufkraft') r.nextElementSibling.textContent = `${String(r.value).replace('.', ',')} %`; };
    r.onchange = () => {
      annahme[k] = k === 'kaufkraft' ? r.checked : +r.value;
      try { localStorage.setItem('fd.renteannahme', JSON.stringify(annahme)); } catch {}
      const y = window.scrollY; neu(); window.scrollTo({ top: y });
    };
  });
}

async function excel(G) {
  const felder = ZEILEN.filter(([f]) => f !== 'h').map(([f, n]) => [f.replace(/^[-=#]/, ''), n, f.startsWith('#') ? 'text' : 'euro']);
  const monate = G.alle.slice().reverse().map((z) => [`${z.m}-01`, z.arbeitgeber, { pdf: 'Abrechnung (PDF)', excel: 'Lohn-02.xlsx', plan: 'Plan', fehlt: 'fehlt' }[z.quelle] || z.quelle,
    ...felder.map(([f, , typ]) => { const v = wert(z, f); return typ === 'euro' ? (typeof v === 'number' ? v : null) : v; })]);
  const posten = G.alle.slice().reverse().flatMap((z) => (z.posten || []).map((p) => [`${z.m}-01`, p.nr, p.text, p.betrag, p.nr.startsWith('9') ? 'Netto-Bezug/-Abzug' : 'Brutto-Bezug']));
  await alsExcelMappe('Gehaltsabrechnungen', [
    { blatt: 'Monate', spalten: [{ titel: 'Monat', typ: 'datum', breite: 11 }, { titel: 'Arbeitgeber', typ: 'text', breite: 12 }, { titel: 'Quelle', typ: 'text', breite: 16 },
      ...felder.map(([, n, typ]) => ({ titel: n, typ, breite: 15 }))], zeilen: monate },
    { blatt: 'Lohnarten', spalten: [{ titel: 'Monat', typ: 'datum', breite: 11 }, { titel: 'Nr.', typ: 'text', breite: 7 }, { titel: 'Bezeichnung', typ: 'text', breite: 30 },
      { titel: 'Betrag', typ: 'euro', breite: 14 }, { titel: 'Art', typ: 'text', breite: 18 }], zeilen: posten },
  ]);
}

// Kurzfassung für den Chat
export function gehaltKurz(D) {
  const G = D?.j?.gehalt?.monate?.filter((z) => z.quelle === 'pdf');
  const z = G?.at(-1);
  if (!z) return '';
  return `Letzte Gehaltsabrechnung (${z.m}): Grundgehalt ${z.gehalt} €, Gesamt-Brutto ${z.brutto} € (inkl. Dienstwagen ${((z.privatfahrten || 0) + (z.whg_arbeit || 0)).toFixed(2)} €), Lohnsteuer ${z.lohnsteuer} €, Soli ${z.soli} €, Betriebsrente Entgeltumwandlung ${z.bav_an} € + Arbeitgeber ${z.bav_ag} €, Auszahlung ${z.auszahlung} €. Alle Monatswerte stehen im Reiter Gehaltsentwicklung.`;
}
