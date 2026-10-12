// Gehaltsentwicklung: alle Daten der Gehaltsabrechnungen und Auswertungen dazu.
// Grundlage ist der Abschnitt „gehalt“ der Finanzdaten (gehalt_daten.py): Monatswerte aus Lohn-02.xlsx seit 2021 und
// – mit allen Einzelheiten – die Abrechnungen als PDF. Planmonate (noch ohne Abrechnung) sind als Prognose markiert.
// Beträge hier in Euro (nicht in Cent wie im Rest der App).
import { alsExcelMappe } from './export.js';

let H = null;              // Helfer aus app.js (Bausteine, Grafik, Navigation)
let wahl = '';             // gewählter Abrechnungsmonat 'JJJJ-MM'
let basisWahl = 'vm';      // Vergleich in „Warum anders?“: vm = Vormonat, vj = Vorjahresmonat
let ansicht = 'monate';    // Grafik Gehaltsentwicklung: monate | jahre
let tabEnde = '';          // Tabelle „Alle Daten“: neuester gezeigter Monat
let erhoehung = 500;       // Rechner: Gehaltserhöhung brutto im Monat
let km = null;             // Rechner Dienstwagen: Entfernung zur Arbeit
let spaltenMax = 12, spaltenBreite = 0;   // Tabelle: höchstens so viele Monate, wie ohne Querscrollen passen

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
    H.zahl5(`Jahr ${j}${jahrPlan ? ' (mit Plan)' : ''}`, `${jahrPlan ? '≈ ' : ''}${e0(sum(jahrAlle, (x) => x.auszahlung))}`, `aufs Konto · brutto ${jahrPlan ? '≈ ' : ''}${e0(sum(jahrAlle, (x) => x.brutto))}${jahrPlan ? ` · ${jahrIst.length} von 12 Monaten abgerechnet` : ''}`, { springe: '#ge-jahre' }),
  ].join('');

  el.innerHTML = `<div class="s5 ge5">
    ${H.kopf5('Gehaltsentwicklung', satz, auswahl)}
    <div class="s5-zahlen">${kacheln}</div>
    <div class="s5-raster">
      ${flussKarte(z, basis, t)}
      ${brueckeKarte(G, z)}
      <div class="s5-spalte">${bavKarte(G, z)}${autoKarte(G, z)}</div>
    </div>
    ${verlaufKarte(G)}
    <div class="s5-raster">
      ${heatmapKarte(G)}
      ${jahreKarte(G)}
    </div>
    ${datenKarte(G, el)}
  </div>`;
  binden(el, G);
  verlaufZeichnen(G);
  const rahmen = el.querySelector('#ge-daten .t3-rahmen'), n = el.querySelectorAll('.ge-tab thead .ge-mk').length;
  if (rahmen && rahmen.scrollWidth > rahmen.clientWidth + 1 && n > 1) { spaltenMax = n - 1; gehaltZeigen(el, H); }
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
    `<p class="ge-text">${text}</p><div class="ge-waffel" role="img" aria-label="Aufteilung in Prozent">${zellen}</div><div class="ge-legende">${legende}</div>`, '', '', 'ge-fluss');
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
  const teil = (w, cls, n) => `<i class="${cls}" style="flex:${w}" title="${n}: ${e0(w)}"><span>${n}</span><b>${e0(w)}</b></i>`;
  return H.karte5('Betriebsrente', `${e0(ges)} im Monat fließen in deine Altersvorsorge`,
    `<div class="ge-bav">${teil(netto, 'du', 'du netto')}${teil(steuerSpar, 'fa', 'Steuer gespart')}${teil(ag, 'ag', 'Arbeitgeber')}</div>
    <p class="ge-text">Davon zahlst du netto nur <b>${e0(netto)}</b> (${pz(netto / ges)}) – den Rest tragen dein Arbeitgeber (${e0(ag)}) und die gesparte Lohnsteuer (≈ ${e0(steuerSpar)}).</p>
    <dl class="s5-dl"><div><dt>Seit ${H.monLang(mit[0].m)} eingezahlt</dt><dd>${e0(bisher)}</dd></div><div><dt>Pro Jahr</dt><dd>${e0(ges * 12)}<small>ohne Zinsen</small></dd></div></dl>`, 'ge-bavk');
}

function autoKarte(G, z) {
  if (!auto(z)) return H.karte5('Dienstwagen', '', '<p class="muted">In diesem Monat kein Dienstwagen auf der Abrechnung.</p>');
  const lp = z.privatfahrten / 0.01, kmJetzt = z.privatfahrten ? z.whg_arbeit / (lp * 0.0003) : 0;
  const kmOk = kmJetzt > 1 && kmJetzt < 300 && Math.abs(kmJetzt - Math.round(kmJetzt)) < 0.05;
  const gs = G.gs.r, kosten = auto(z) * gs;
  if (km == null && kmOk) km = Math.round(kmJetzt);
  const rechner = kmOk ? `<label class="ge-regler"><span>Entfernung zur Arbeit</span><input type="range" id="ge-km" min="0" max="120" step="1" value="${km}" data-lp="${lp}" data-km="${Math.round(kmJetzt)}" data-gs="${gs}"><b id="ge-km-w">${km} km</b></label>
    <p class="ge-text" id="ge-km-t">${kmText(lp, Math.round(kmJetzt), km, gs)}</p>` : '';
  return H.karte5('Dienstwagen', `geldwerter Vorteil ${e(auto(z))} im Monat – kein Geld, wird aber versteuert`,
    `<dl class="s5-dl"><div><dt>Privatfahrten${z.privatfahrten ? ` <small>1 % von ${e0(lp)} Listenpreis</small>` : ''}</dt><dd>${e(z.privatfahrten)}</dd></div>
    <div><dt>Wohnung – Arbeit${kmOk ? ` <small>0,03 % × ${Math.round(kmJetzt)} km</small>` : ''}</dt><dd>${e(z.whg_arbeit)}</dd></div>
    <div><dt>Kostet dich an Steuer</dt><dd class="neg">≈ ${e0(kosten)}<small>im Monat · ${e0(kosten * 12)} im Jahr</small></dd></div></dl>${rechner}`);
}
const kmText = (lp, kmJetzt, kmNeu, gs) => {
  if (kmNeu === kmJetzt) return 'Regler bewegen: So ändert sich deine Auszahlung, wenn der Weg zur Arbeit kürzer oder länger wird.';
  const d = (kmJetzt - kmNeu) * lp * 0.0003 * gs;
  return `Bei ${kmNeu} km statt ${kmJetzt} km: ≈ <b class="${d >= 0 ? 'pos' : 'neg'}">${pm0(d)}</b> netto im Monat (${pm0(d * 12)} im Jahr).`;
};

function verlaufKarte(G) {
  const seg = `<div class="seg">${[['monate', 'Monate'], ['jahre', 'Jahre']].map(([k, n]) => `<button data-ge-ansicht="${k}" class="${k === ansicht ? 'an' : ''}">${n}</button>`).join('')}</div>`;
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
    `<div class="ge-heat">${kopf}${zeilen}</div>`, 's5-b2');
}

function jahreKarte(G) {
  const jahre = [...new Set(G.alle.map((z) => z.m.slice(0, 4)))].sort();
  const rows = jahre.map((j) => {
    const ms = G.alle.filter((z) => z.m.startsWith(j) && z.quelle !== 'fehlt');
    const plan = ms.some((z) => z.quelle === 'plan' || z.auszahlung == null);
    return { j, plan, brutto: sum(ms, (z) => z.brutto), konto: sum(ms, (z) => z.auszahlung), sonder: sum(ms, sonder), n: ms.filter((z) => z.quelle !== 'plan').length };
  });
  const max = Math.max(...rows.map((r) => r.brutto));
  const html = rows.slice().reverse().map((r, i, l) => {
    const vor = rows[rows.indexOf(r) - 1];
    const d = vor && vor.brutto ? r.brutto / vor.brutto - 1 : null;
    return `<button class="ge-jz"${H.geh(H.zuBuchungen({ kat: 'Einnahmen', ukat: 'Lohn / Gehalt', art: 'ein', jahr: r.j, monat: '', zr: '' }))} title="Gehaltseingänge ${r.j} anzeigen">
      <span class="ge-jj">${r.j}${r.plan ? '<small>mit Plan</small>' : ''}</span>
      <span class="ge-jb"><i class="b" style="width:${(r.brutto / max) * 100}%"></i><i class="k" style="width:${(r.konto / max) * 100}%"></i></span>
      <b>${r.plan ? '≈ ' : ''}${e0(r.brutto)}<small>${r.plan ? '≈ ' : ''}${e0(r.konto)} aufs Konto</small></b>
      <span class="ge-jd ${d == null ? 'muted' : d >= 0 ? 'pos' : 'neg'}">${d == null ? '–' : `${d >= 0 ? '+' : '−'}${pz(Math.abs(d))}`}</span></button>`;
  }).join('');
  return H.karte5('Jahr für Jahr', 'brutto (hell) und aufs Konto (kräftig) · rechts: Veränderung zum Vorjahr', `<div class="ge-jahre">${html}</div>`, '', '', 'ge-jahre');
}

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
  ['h', 'Zusätzlich vom Arbeitgeber'], ['bav_ag', 'Betriebsrente Arbeitgeber'], ['sv_ag', 'Sozialversicherung Arbeitgeberanteil'], ['_kosten', 'Kosten des Arbeitgebers (laut Abrechnung)'],
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
function datenKarte(G, el) {
  const breite = el.clientWidth || 1200, schmal = breite < 640;
  if (Math.abs(breite - spaltenBreite) > 20) { spaltenBreite = breite; spaltenMax = 12; }
  const n = Math.max(1, Math.min(spaltenMax, Math.floor((breite - (schmal ? 30 : 40) - (schmal ? 128 : 230) - (schmal ? 0 : 108)) / (schmal ? 80 : 92))));
  if (!tabEnde || !G.ist.some((z) => z.m === tabEnde)) tabEnde = G.ist.at(-1).m;
  let ende = G.ist.findIndex((z) => z.m === tabEnde);
  if (G.ist.findIndex((z) => z.m === wahl) > ende) ende = G.ist.findIndex((z) => z.m === wahl);
  if (G.ist.findIndex((z) => z.m === wahl) <= ende - n) ende = G.ist.findIndex((z) => z.m === wahl) + n - 1;
  ende = Math.min(G.ist.length - 1, Math.max(n - 1, ende));
  tabEnde = G.ist[ende].m;
  const ms = G.ist.slice(Math.max(0, ende - n + 1), ende + 1);
  const jahr = ms.at(-1).m.slice(0, 4), jahrMs = G.ist.filter((z) => z.m.startsWith(jahr));
  const genutzt = (feld) => G.ist.some((z) => { const v = wert(z, feld); return v != null && v !== 0 && v !== '–'; });
  const zeilen = [];
  let kopfOffen = null;
  for (const [f, name] of ZEILEN) {
    if (f === 'h') { kopfOffen = name; continue; }
    const text = f.startsWith('#'), neg = f.startsWith('-'), summe = f.startsWith('=');
    const feld = f.replace(/^[-=#]/, '');
    if (!genutzt(feld)) continue;
    if (kopfOffen) { zeilen.push(`<tr class="ge-th"><th colspan="${ms.length + 1 + (schmal ? 0 : 1)}">${kopfOffen}</th></tr>`); kopfOffen = null; }
    const zelle = (z) => {
      const v = wert(z, feld);
      if (v == null || v === '') return '<td class="r muted">–</td>';
      if (text || typeof v === 'string') return `<td class="r ge-txt">${H.esc(String(v))}</td>`;
      if (!v) return '<td class="r muted">0</td>';
      return `<td class="r${neg ? ' neg' : ''}">${neg ? '−' : ''}${H.eur(Math.round(v * 100)).replace(/\s?€/, '')}</td>`;
    };
    const s = !text ? sum(jahrMs, (z) => { const v = wert(z, feld); return typeof v === 'number' ? v : 0; }) : null;
    const nJahr = jahrMs.filter((z) => typeof wert(z, feld) === 'number').length;
    zeilen.push(`<tr class="${summe ? 'ge-sum' : ''}"><td>${name}</td>${ms.map(zelle).join('')}${schmal ? '' : `<td class="r ge-js">${text ? '' : !nJahr ? '–' : `${neg ? '−' : ''}${H.eur(Math.round(s * 100)).replace(/\s?€/, '')}`}</td>`}</tr>`);
  }
  const kopf = `<tr><th>in €</th>${ms.map((z) => `<th class="r"><button class="ge-mk${z.m === wahl ? ' an' : ''}" data-ge-m="${z.m}" title="Diese Abrechnung oben zeigen">${H.monKurz(z.m)}${detail(z) ? '' : '<small>Summen</small>'}</button></th>`).join('')}${schmal ? '' : `<th class="r">Summe ${jahr}<small>${jahrMs.length} Mon.</small></th>`}</tr>`;
  const i0 = G.ist.indexOf(ms[0]);
  const blaettern = `<div class="ge-blaettern"><button class="btn sm" data-ge-blatt="-1"${i0 <= 0 ? ' disabled' : ''}>‹ früher</button><button class="btn sm" data-ge-blatt="1"${ende >= G.ist.length - 1 ? ' disabled' : ''}>später ›</button><button class="btn sm" id="ge-excel" title="Alle Monate und alle Lohnarten als Excel-Datei">Excel</button></div>`;
  return H.karte5('Alle Daten der Abrechnungen', `jede Zeile deiner Abrechnungen, Monat für Monat · ${G.pdf.length} Abrechnungen als PDF mit allen Einzelheiten, frühere Monate aus Lohn-02.xlsx (nur Summen)`,
    `<div class="t3-rahmen"><table class="t3 ge-tab"><thead>${kopf}</thead><tbody>${zeilen.join('')}</tbody></table></div>`, '', blaettern, 'ge-daten');
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
  el.querySelector('#ge-monat')?.addEventListener('change', (ev) => { wahl = ev.target.value; neu(); });
  el.querySelectorAll('[data-ge-m]').forEach((b) => b.onclick = () => { wahl = b.dataset.geM; neu(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  el.querySelectorAll('[data-ge-basis]').forEach((b) => b.onclick = () => { basisWahl = b.dataset.geBasis; neu(); });
  el.querySelectorAll('[data-ge-ansicht]').forEach((b) => b.onclick = () => { ansicht = b.dataset.geAnsicht; el.querySelectorAll('[data-ge-ansicht]').forEach((x) => x.classList.toggle('an', x === b)); verlaufZeichnen(G); });
  el.querySelectorAll('[data-ge-blatt]').forEach((b) => b.onclick = () => {
    const i = G.ist.findIndex((z) => z.m === tabEnde), n = el.querySelectorAll('.ge-tab thead .ge-mk').length;
    tabEnde = G.ist[Math.max(0, Math.min(G.ist.length - 1, i + Number(b.dataset.geBlatt) * n))].m;
    const ziel = G.ist.find((z) => z.m === tabEnde);
    if (G.ist.indexOf(G.nach.get(wahl)) > G.ist.indexOf(ziel) || G.ist.indexOf(G.nach.get(wahl)) <= G.ist.indexOf(ziel) - n) wahl = tabEnde;
    neu();
    H.springe('#ge-daten', false);
  });
  const erh = el.querySelector('#ge-erh');
  if (erh) erh.oninput = () => {
    erhoehung = +erh.value;
    const z = G.nach.get(wahl), svFrei = detail(z) && z.sv_brutto && z.steuer_brutto > z.sv_brutto;
    el.querySelector('#ge-erh-w').textContent = e0(erhoehung);
    el.querySelector('#ge-erh-t').innerHTML = erhoehungText(erhoehung, erhoehung * (1 - G.gs.r - (svFrei ? 0 : 0.2)));
  };
  const kmR = el.querySelector('#ge-km');
  if (kmR) kmR.oninput = () => {
    km = +kmR.value;
    el.querySelector('#ge-km-w').textContent = `${km} km`;
    el.querySelector('#ge-km-t').innerHTML = kmText(+kmR.dataset.lp, +kmR.dataset.km, km, +kmR.dataset.gs);
  };
  el.querySelector('#ge-excel')?.addEventListener('click', () => excel(G));
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
