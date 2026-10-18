// Steuer-Prognose für ein Jahr ohne Bescheid (Einzelveranlagung, Grundtarif): Arbeitslohn aus deinen Abrechnungen,
// Werbungskosten, Vorsorge, Sonderausgaben (ohne und mit Anlage U), Kinderfreibeträge, Tarif § 32a EStG und Soli –
// verglichen mit der einbehaltenen Lohnsteuer. Ist-Monate (Abrechnungen) und Plan-Monate (Gehaltsplan) stehen getrennt;
// alles ist nach fester Regel berechnet und so gekennzeichnet. Orientierung, keine Steuerberatung.
// Keine Imports und kein DOM beim Laden: alle Helfer kommen über H (siehe Einbau in app.js), damit es auch in Node läuft.

// ---------------------------------------------------------------- Regelwerte je Jahr (Geld in Cent, Tarif in Euro)
// Tarif: zvE ≤ gfb: 0 · bis z1: (a1·y + b1)·y, y = (zvE − gfb) / 10.000 · bis z2: (a2·z + b2)·z + c2, z = (zvE − z1) / 10.000
// · bis z3: 0,42·zvE − s3 · darüber: 0,45·zvE − s4; Ergebnis auf volle Euro abgerundet (§ 32a Abs. 1 EStG).
// Die Übergänge sind stetig (geprüft an z1, z2, z3); Werte 2026 abgeglichen mit dem Gesetzestext (Steuerfortentwicklungsgesetz).
const REGEL = {
  2025: {
    quelle: '§ 32a EStG 2025, § 9 Abs. 2 EStG (0,30 € bis 20 km, 0,38 € ab dem 21. km), § 3 SolZG',
    tarif: { gfb: 12096, z1: 17443, z2: 68480, z3: 277825, a1: 932.30, b1: 1400, a2: 176.64, b2: 2397, c2: 1015.13, s3: 10911.92, s4: 19246.67 },
    soliFrei: 19950, km1: 30, km21: 38, pausch: 123000, hoTag: 600, hoMax: 126000, saPausch: 3600, realsplitting: 1380500,
    vorsorgeMax: 190000, kfb: 480000, kindergeld: 25500, antrag: 60000,
  },
  2026: {
    quelle: '§ 32a EStG 2026, § 9 Abs. 2 EStG (0,38 € ab dem 1. km), § 3 SolZG',
    tarif: { gfb: 12348, z1: 17799, z2: 69878, z3: 277825, a1: 914.51, b1: 1400, a2: 173.10, b2: 2397, c2: 1034.87, s3: 11135.63, s4: 19470.38 },
    soliFrei: 20350, km1: 38, km21: 38, pausch: 123000, hoTag: 600, hoMax: 126000, saPausch: 3600, realsplitting: 1380500,
    vorsorgeMax: 190000, kfb: 487800, kindergeld: 25900, antrag: 60000,   // kfb: halber Kinderfreibetrag 3.414 € + halber BEA 1.464 €
  },
};
// Spätere Jahre: die neuesten bekannten Werte, mit Hinweis
function regel(j) {
  if (REGEL[j]) return { ...REGEL[j], jahr: j, fremd: false };
  const neu = Math.max(...Object.keys(REGEL).map(Number));
  return j > neu ? { ...REGEL[neu], jahr: neu, fremd: true } : null;
}

const MONAT = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const KV = 'steuer-prognose';
const ct = (e) => Math.round((+e || 0) * 100);   // Euro (Abrechnung, Eingabe) → Cent
const dOf = (H) => (typeof H.D === 'function' ? H.D() : H.D);
const heute = (H) => { if (H.heute) return H.heute(); const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mk = (j, m) => `${j}-${String(m).padStart(2, '0')}`;
const spanne = (ms) => (!ms.length ? '' : ms.length === 1 ? ms[0].slice(5) : `${ms[0].slice(5)}–${ms[ms.length - 1].slice(5)}`);
const monSpanne = (von, bis) => (von === bis ? MON[von - 1] : `${MON[von - 1]}–${MON[bis - 1]}`);

let EIN = null;          // Eingaben je Jahr aus IndexedDB
let angabenOffen = false;

// ---------------------------------------------------------------- Laden
export async function prognoseLaden(H) {
  if (!EIN) EIN = (await H.kvLesen(KV).catch(() => null)) || {};
  return EIN;
}
const eingabenVon = (j) => EIN?.[j] || {};

// ---------------------------------------------------------------- Tarif und Soli
function est(zve, T) {
  if (zve <= T.gfb) return 0;
  if (zve <= T.z1) { const y = (zve - T.gfb) / 1e4; return Math.floor((T.a1 * y + T.b1) * y); }
  if (zve <= T.z2) { const z = (zve - T.z1) / 1e4; return Math.floor((T.a2 * z + T.b2) * z + T.c2); }
  if (zve <= T.z3) return Math.floor(0.42 * zve - T.s3 + 1e-9);
  return Math.floor(0.45 * zve - T.s4 + 1e-9);
}
// Soli in Cent: 5,5 % der Einkommensteuer (Euro), über der Freigrenze höchstens 11,9 % des Betrags darüber
const soliCent = (e, frei) => (e <= frei ? 0 : Math.floor(Math.min(e * 5.5, (e - frei) * 11.9) + 1e-9));

// Eine Spalte: zvE → ESt mit Günstigerprüfung Kinderfreibetrag/Kindergeld → Soli (immer mit Freibeträgen)
function spalte(R, lohn, wk, vors, sa, kinder) {
  const einkommen = lohn - wk - vors - sa;
  const zve0 = Math.max(0, Math.floor(einkommen / 100)), e0 = est(zve0, R.tarif);
  const kfb = kinder * R.kfb, zveK = Math.max(0, Math.floor((einkommen - kfb) / 100)), eK = kinder ? est(zveK, R.tarif) : e0;
  const halbKG = Math.round((kinder * R.kindergeld * 12) / 2);
  const mitKfb = kinder > 0 && (e0 - eK) * 100 > halbKG;
  const soli = soliCent(eK, R.soliFrei);
  const e = (mitKfb ? eK : e0) * 100, kg = mitKfb ? halbKG : 0;
  return { sa, kfb: mitKfb ? kfb : 0, zve: (mitKfb ? zveK : zve0) * 100, est: e, kg, soli, steuer: e + kg + soli, ersparnis: (e0 - eK) * 100, halbKG };
}

// ---------------------------------------------------------------- Bausteine
function monate(D, j) {
  const alle = (D.j?.gehalt?.monate || []).filter((z) => z.m?.startsWith(`${j}-`)).sort((a, b) => (a.m < b.m ? -1 : 1));
  return { ist: alle.filter((z) => z.quelle === 'pdf' || z.quelle === 'excel'), plan: alle.filter((z) => z.quelle === 'plan') };
}
const summe = (zs, f) => zs.reduce((t, z) => t + ct(z[f]), 0);

// Entfernung je Monat: gehalt.zukunft mit km ab ihrem Monat, davor „km bisher“ (Eingabe); zusammengefasst zu Zeiträumen
function zeitraeume(D, j, kmBisher) {
  const zk = (D.j?.gehalt?.zukunft || []).filter((x) => x.km != null && x.ab).sort((a, b) => (a.ab < b.ab ? -1 : 1));
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const z = zk.filter((x) => x.ab <= mk(j, m)).pop();
    const km = z ? +z.km : kmBisher > 0 ? +kmBisher : null, plan = !!z;
    const l = out[out.length - 1];
    if (l && l.km === km && l.plan === plan) l.bis = m; else out.push({ von: m, bis: m, km, plan, titel: z?.titel || '' });
  }
  return out;
}
const kmCent = (km, R) => Math.min(km, 20) * R.km1 + Math.max(0, km - 20) * R.km21;

function werbungskosten(H, D, j, R, e, uebrige) {
  const tage = +e.arbeitstage || 0, ho = +e.hoTage || 0, hinweise = [];
  const zr = zeitraeume(D, j, +e.kmBisher || 0);
  let fahrt = 0;
  const teile = [];
  for (const z of zr) {
    const n = z.bis - z.von + 1, t = (tage * n) / 12;
    if (!tage) continue;
    if (z.km == null) { hinweise.push(`Für ${monSpanne(z.von, z.bis)} ${j} fehlt die Entfernung zur Arbeit – trag sie unter „Deine Angaben“ ein.`); continue; }
    fahrt += t * kmCent(z.km, R);
    teile.push(`${zr.length > 1 ? `${monSpanne(z.von, z.bis)}: ` : ''}${H.NUM.format(Math.round(t))} Tage × ${H.NUM.format(z.km)} km${z.plan ? ' (Plan)' : ''}`);
  }
  fahrt = Math.round(fahrt);
  const home = Math.min(ho * R.hoTag, R.hoMax);
  const einzeln = fahrt + home + uebrige, wk = Math.max(R.pausch, einzeln);
  const satz = R.km1 === R.km21 ? `${H.eur(R.km1)}/km` : `${H.eur(R.km1)}/km, ab 21 km ${H.eur(R.km21)}`;
  const q = [teile.length ? `Fahrten ${teile.join(' · ')} × ${satz} = ${H.eur0(fahrt)}` : '', home ? `Homeoffice ${H.NUM.format(ho)} Tage × ${H.eur0(R.hoTag)} = ${H.eur0(home)}` : '',
    uebrige ? `übrige ${H.eur0(uebrige)} (im Reiter Steuer bestätigt)` : ''].filter(Boolean);
  if (!tage) hinweise.push('Werbungskosten: trag deine Arbeitstage ein – bis dahin gilt der Pauschbetrag.');
  const quelle = einzeln > R.pausch ? q.join(' + ') : `Arbeitnehmer-Pauschbetrag${q.length ? ` (einzeln nur ${H.eur0(einzeln)})` : ''}`;
  return { wk, fahrt, home, uebrige, einzeln, quelle, pausch: einzeln <= R.pausch, hinweise, zr };
}

function vorsorge(zs, R) {
  const rv = summe(zs, 'rv'), av = summe(zs, 'av');
  const basis = Math.max(0, Math.round(zs.reduce((t, z) => t + (ct(z.kv) - ct(z.kv_zuschuss)) * 0.96 + (ct(z.pv) - ct(z.pv_zuschuss)), 0)));
  return { rv, av, basis, v: rv + Math.max(basis, Math.min(R.vorsorgeMax, basis + av)) };
}

// Trennungsunterhalt: gebucht im Jahr (nur eigene Konten) + noch fällig aus den laufenden Verträgen bis Jahresende
function unterhalt(H, D, j, von) {
  const eigen = (r) => !H.fremd(D.konten[r.k]) && !H.istGemeinsam?.(r.k);
  const alle = D.rows.filter((r) => r.ukat === 'Trennungsunterhalt' && eigen(r)).sort((a, b) => (a.d < b.d ? -1 : 1));
  const imJahr = alle.filter((r) => r.y === j);
  const gebucht = imJahr.reduce((t, r) => t - r.c, 0);
  const bis = `${j}-12-31`;
  let faellig = 0;
  if (von <= bis) {
    for (const f of H.fixkostenErkennen()) if (f.aktiv && !f.gemeinsam && f.ukat === 'Trennungsunterhalt') faellig += H.faellig(f, von, bis);
  }
  return { gebucht, faellig, summe: gebucht + faellig, n: imJahr.length, name: alle[alle.length - 1]?.g || '' };
}

// Freibetrag für die Lohnsteuer-Ermäßigung: Werbungskosten über dem Pauschbetrag + Sonderausgaben über 36 €
function freibetragJahr(R, wk, sa) {
  const b = Math.max(0, wk - R.pausch) + Math.max(0, sa - R.saPausch);
  return { betrag: b, ueber: b > R.antrag };
}

// ---------------------------------------------------------------- Rechnen
export function prognoseRechnen(H, jahr, eingaben) {
  const D = dOf(H), j = +jahr, R = regel(j);
  if (!D || !R) return null;
  const { ist, plan } = monate(D, j);
  if (!ist.length && !plan.length) return null;
  const e = eingaben || eingabenVon(j), alle = [...ist, ...plan], hinweise = [];
  const h = heute(H), hm = h.slice(0, 7);

  // 1 Arbeitslohn
  const lohnIst = summe(ist, 'steuer_brutto'), lohnPlan = summe(plan, 'steuer_brutto'), lohn = lohnIst + lohnPlan;
  const da = new Set(alle.map((z) => z.m)), ungeprueft = ist.filter((z) => z.geprueft === false);
  const fehlen = [], kommen = [];
  for (let m = 1; m <= 12; m++) if (!da.has(mk(j, m))) (mk(j, m) < hm ? fehlen : kommen).push(m);
  for (const m of fehlen) hinweise.push(`Für ${MONAT[m - 1]} fehlt die Abrechnung – Jahreswerte unvollständig.`);
  if (kommen.length) hinweise.push(`${monSpanne(kommen[0], kommen[kommen.length - 1])}: noch keine Abrechnung und kein Plan – Jahreswerte unvollständig.`);
  if (ungeprueft.length) hinweise.push(`Noch nicht geprüft: Abrechnung ${ungeprueft.map((z) => MON[+z.m.slice(5) - 1]).join(', ')}.`);
  if (plan.length) hinweise.push(`Plan ${spanne(plan.map((z) => z.m))}: Werte laut Gehaltsplan${plan.some((z) => /gesch/i.test(z.hinweis || '')) ? ', die Lohnsteuer darin ist geschätzt' : ''} – mit der echten Abrechnung wird es genauer.`);

  // 2 Werbungskosten (übrige: im Reiter Steuer bestätigte Posten ohne Fahrkarten/Reisekosten; mit Homeoffice-Tagen ohne
  // Arbeitszimmer – Tagespauschale und Arbeitszimmer schließen sich aus, § 4 Abs. 5 Nr. 6c EStG)
  const wkOhne = ['wk-fahrten', ...(+e.hoTage ? ['wk-arbeitszimmer'] : [])];
  const uebrige = Math.max(0, Math.round(H.steuerSumme?.(j, 'wk', wkOhne) || 0));
  const W = werbungskosten(H, D, j, R, e, uebrige);
  hinweise.push(...W.hinweise);
  const wkOffen = Math.round(H.steuerSumme?.(j, 'wk', wkOhne, true) || 0);
  if (wkOffen > 0) hinweise.push(`Werbungskosten ${H.eur0(wkOffen)} sind im Reiter Steuer noch offen – sie zählen erst, wenn du sie bestätigst.`);
  const zimmer = +e.hoTage ? Math.round((H.steuerSumme?.(j, 'wk', ['wk-fahrten']) || 0) - uebrige) : 0;
  if (zimmer > 0) hinweise.push(`Arbeitszimmer ${H.eur0(zimmer)} nicht gezählt, weil du Homeoffice-Tage eingetragen hast – Arbeitszimmer und Homeoffice-Pauschale schließen sich aus, nur eins ansetzen.`);
  // 3 Vorsorge
  const V = vorsorge(alle, R);
  // 4 Sonderausgaben
  const U = unterhalt(H, D, j, H.plusTage(D.bis, 1) > `${j}-01-01` ? H.plusTage(D.bis, 1) : `${j}-01-01`);
  const mitU = U.summe > 0, kvU = ct(e.kvUebernommen), grenze = R.realsplitting + kvU;
  const saOhne = R.saPausch, saMit = Math.max(R.saPausch, Math.min(grenze, U.summe));
  // 5 Kinder: deine Angabe, sonst Zähler laut Abrechnung (1,0 = zwei Kinder mit halbem Freibetrag)
  const zaehler = [...ist].reverse().find((z) => z.kinderfreibetrag != null)?.kinderfreibetrag ?? [...plan].reverse().find((z) => z.kinderfreibetrag != null)?.kinderfreibetrag;
  const kinderEin = e.kinder != null && e.kinder !== '';
  const kinder = Math.max(0, Math.round(kinderEin ? +e.kinder : (+zaehler || 0) * 2));
  // 6–8 je Spalte
  const gezIst = summe(ist, 'lohnsteuer') + summe(ist, 'soli'), gezPlan = summe(plan, 'lohnsteuer') + summe(plan, 'soli');
  const ohne = spalte(R, lohn, W.wk, V.v, saOhne, kinder), mit = mitU ? spalte(R, lohn, W.wk, V.v, saMit, kinder) : null;
  for (const s of [ohne, mit]) if (s) s.erg = gezIst + gezPlan - s.steuer;
  const mehr = ct(e.mehrsteuer), vorteil = mit ? mit.erg - ohne.erg - mehr : null;

  // Randfälle
  const stkl = [...new Set(alle.map((z) => z.stkl).filter((x) => x != null && +x !== 1))];
  if (stkl.length) hinweise.push(`Steuerklasse ${stkl.join(', ')} laut Abrechnung – die Prognose gilt für Einzelveranlagung (Grundtarif).`);
  const kist = summe(alle, 'kirchensteuer');
  if (kist > 0) hinweise.push(`Kirchensteuer ${H.eur0(kist)} einbehalten – in der Prognose nicht gerechnet.`);
  const kap = D.rows.some((r) => r.y === j && r.c > 0 && /kapitalertr/i.test(r.ukat || '') && !H.fremd(D.konten[r.k]));
  if (kap) hinweise.push('Kapitalerträge: Abgeltungsteuer, nicht enthalten.');
  if (R.fremd) hinweise.push(`Regelwerte ${R.jahr} – für ${j} noch nicht hinterlegt.`);

  // Rechenweg
  const zr = (t, o, m, q, art = '', cls = '', ziel = null) => ({ t, ohne: o, mit: mitU ? m : null, q, art, cls, ziel });
  const istQ = ist.length ? `Abrechnungen ${spanne(ist.map((z) => z.m))}` : '';
  const zuGehalt = { tab: 'gehalt' };
  const zuTU = { tab: 'buchungen', q: '', jahr: String(j), monat: '', zr: '', nf: '', kat: '', ukat: 'Trennungsunterhalt', art: 'alle', konto: '' };
  const zeilen = [];
  if (ist.length) zeilen.push(zr('Arbeitslohn (Steuer-Brutto)', lohnIst, lohnIst, istQ, 'ist', plan.length ? 'unter' : '', zuGehalt));
  if (plan.length) zeilen.push(zr(`Arbeitslohn ${spanne(plan.map((z) => z.m))}`, lohnPlan, lohnPlan, 'Gehaltsplan', 'plan', 'unter', zuGehalt));
  if (ist.length && plan.length) zeilen.push(zr('= Arbeitslohn im Jahr', lohn, lohn, '', '', 'sum'));
  zeilen.push(zr('− Werbungskosten', W.wk, W.wk, W.quelle, W.pausch ? 'regel' : 'berechnet'));
  zeilen.push(zr('− Vorsorgeaufwendungen', V.v, V.v, `Rente ${H.eur0(V.rv)} + Kranken-/Pflege-Basis ${H.eur0(V.basis)}${V.v - V.rv > V.basis ? ` + Arbeitslosenvers. bis ${H.eur0(R.vorsorgeMax)}` : ''} (§ 10 EStG)`, 'berechnet'));
  zeilen.push(zr('− Sonderausgaben', saOhne, saMit,
    mitU ? `ohne: Pauschbetrag · mit: Trennungsunterhalt ${H.eur0(U.gebucht)} gebucht${U.faellig ? ` + ${H.eur0(U.faellig)} noch fällig (Plan)` : ''}, höchstens ${H.eur0(grenze)}` : 'Sonderausgaben-Pauschbetrag',
    mitU ? (U.faellig ? 'plan' : 'berechnet') : 'regel', '', mitU ? zuTU : null));
  if (kinder) {
    const q = (s) => (s.kfb ? `${kinder} × ${H.eur0(R.kfb)}` : `Kindergeld günstiger (Ersparnis ${H.eur0(s.ersparnis)} ≤ ${H.eur0(s.halbKG)})`);
    zeilen.push(zr(`− Kinderfreibeträge (${kinder} × halb)`, ohne.kfb, mit?.kfb, `${kinderEin ? 'deine Angabe' : `Zähler ${(+zaehler || 0).toFixed(1).replace('.', ',')} laut Abrechnung`} · ${q(ohne)}${mit && mit.kfb !== ohne.kfb ? ` · mit: ${q(mit)}` : ''}`, 'berechnet'));
  }
  zeilen.push(zr('= zu versteuerndes Einkommen', ohne.zve, mit?.zve, 'auf volle Euro abgerundet', '', 'sum'));
  zeilen.push(zr('Einkommensteuer (Grundtarif)', ohne.est, mit?.est, `§ 32a EStG ${R.jahr}`, 'berechnet'));
  if (ohne.kg || mit?.kg) zeilen.push(zr('+ halbes Kindergeld', ohne.kg, mit?.kg, `Günstigerprüfung: ${kinder} × ${H.eur0(R.kindergeld)} × 12 ÷ 2`, 'berechnet'));
  zeilen.push(zr('+ Solidaritätszuschlag', ohne.soli, mit?.soli, `5,5 %, Freigrenze ${H.eur0(R.soliFrei * 100)}${kinder ? ', mit Kinderfreibeträgen' : ''}`, 'berechnet'));
  zeilen.push(zr('= Steuer laut Prognose', ohne.steuer, mit?.steuer, '', 'berechnet', 'sum'));
  if (ist.length) zeilen.push(zr('Gezahlt: Lohnsteuer + Soli', gezIst, gezIst, istQ, 'ist', '', zuGehalt));
  if (plan.length) zeilen.push(zr(`Gezahlt ${spanne(plan.map((z) => z.m))}`, gezPlan, gezPlan, 'Gehaltsplan', 'plan', '', zuGehalt));
  zeilen.push(zr('Erstattung (+) / Nachzahlung (−)', ohne.erg, mit?.erg, 'gezahlt − Steuer', 'berechnet', 'erg'));
  if (mitU) zeilen.push({ t: 'Vorteil Anlage U', nurMit: true, ohne: null, mit: vorteil, q: mehr ? `Unterschied der Spalten − Mehrsteuer der Empfängerin ${H.eur0(mehr)} (Nachteilsausgleich)` : 'Unterschied der Spalten · Mehrsteuer der Empfängerin noch nicht eingetragen', art: 'berechnet', cls: 'erg' });

  // Freibetrag: Jahresbetrag verteilt auf die Monate nach dem Antrag (Antrag bis 30.11.)
  const fb = freibetragJahr(R, W.wk, mitU ? saMit : saOhne), frist = `${j}-11-30`;
  const hj = +h.slice(0, 4), rest = hj === j ? 12 - +h.slice(5, 7) : hj < j ? 12 : 0;
  const moeglich = fb.ueber && h <= frist && rest > 0;
  // Plan im Freibetrag: nur über die Werbungskosten (Entfernung laut Plan) und die Sonderausgaben (noch fälliger Unterhalt)
  const kmPlan = +e.arbeitstage > 0 && W.zr.some((z) => z.plan && z.km != null), fbPlan = (mitU && U.faellig > 0) || kmPlan;
  const freibetrag = { jahr: fb.betrag, ueber: fb.ueber, frist, ab: moeglich ? (hj === j ? +h.slice(5, 7) + 1 : 1) : null, monat: moeglich ? Math.round(fb.betrag / rest) : null, naechstesJahr: null, plan: fbPlan };
  if (hj === j) freibetrag.naechstesJahr = naechstesJahr(H, D, j + 1, e);

  return { jahr: j, regel: R, zeilen, ohne, mit, vorteil, freibetrag, hinweise, name: U.name, unterhalt: U, kinder, ist: ist.length, plan: plan.length,
    planMon: spanne(plan.map((z) => z.m)), kmPlan, mitU, eingaben: e };
}

// Freibetrag fürs Folgejahr: Plan-Monate, Entfernung laut Gehaltsplan, deine Tage wie in diesem Jahr, Unterhalt aus dem
// laufenden Vertrag; übrige Werbungskosten zählen nicht (noch keine Buchungen)
function naechstesJahr(H, D, j, e) {
  const R = regel(j), { plan } = monate(D, j);
  if (!R || !plan.length) return null;
  const W = werbungskosten(H, D, j, R, e, 0);
  const U = unterhalt(H, D, j, `${j}-01-01`);
  const sa = Math.max(R.saPausch, Math.min(R.realsplitting + ct(e.kvUebernommen), U.faellig));
  const fb = freibetragJahr(R, W.wk, sa);
  return { jahr: j, betrag: fb.betrag, ueber: fb.ueber, monat: fb.ueber ? Math.round(fb.betrag / 12) : null, plan: true, fehltKm: W.hinweise.some((t) => t.includes('Entfernung')) };
}

// ---------------------------------------------------------------- Anzeige
const wertHtml = (H, c, vz = false) => (c == null ? '<span class="muted">–</span>'
  : `<span class="${c < 0 ? 'neg' : vz && c > 0 ? 'pos' : ''}">${c < 0 ? '−' : vz && c > 0 ? '+' : ''}${H.eur0(Math.abs(c))}</span>`);
const ART = { ist: '', plan: 'Plan', berechnet: 'berechnet', regel: 'Regel' };

export function prognoseKarte(H, jahr) {
  const P = prognoseRechnen(H, jahr);
  if (!P) return '';
  const D = dOf(H), j = P.jahr, e = P.eingaben, F = P.freibetrag, name = P.name || 'der Empfängerin';
  const pm = (c) => (c >= 0 ? '+' : '−') + H.eur0(Math.abs(c));
  // stecken Plan-Werte in der Zahl, steht das schon in der Kachel (nicht erst im Rechenweg)
  const planIn = (mitU) => [P.plan ? `Gehalt ${P.planMon}` : '', P.kmPlan ? 'Entfernung' : '', mitU && P.unterhalt.faellig ? 'fälliger Unterhalt' : ''].filter(Boolean).join(', ');
  const ergK = (s, t, mitU = false) => H.zahl5(`${s.erg >= 0 ? 'Erstattung' : 'Nachzahlung'} ${t}`, pm(s.erg),
    `berechnet${planIn(mitU) ? ` · enthält Plan (${planIn(mitU)})` : ''} · gezahlte Lohnsteuer + Soli minus Steuer laut Prognose`, { cls: s.erg >= 0 ? 'pos' : 'neg', springe: '#stp-rechenweg' });
  const fbText = (F.plan ? 'enthält Plan · ' : '') + (F.monat != null ? `Freibetrag ${MON[F.ab - 1]}–Dez · Jahresbetrag ${H.eur0(F.jahr)} · Antrag auf Lohnsteuer-Ermäßigung bis ${H.dde(F.frist)}`
    : !F.ueber ? `Jahresbetrag ${H.eur0(F.jahr)} – unter der Antragsgrenze ${H.eur0(P.regel.antrag)}` : `Jahresbetrag ${H.eur0(F.jahr)} – Antrag für ${j} nicht mehr möglich (Frist ${H.dde(F.frist)})`);
  const zahlen = [ergK(P.ohne, 'ohne Anlage U'),
    P.mit ? ergK(P.mit, 'mit Anlage U', true) : H.zahl5('Mit Anlage U', '–', `kein Trennungsunterhalt ${j} gebucht`),
    H.zahl5('Möglicher Freibetrag je Monat', F.monat != null ? H.eur0(F.monat) : '–', fbText)].join('');

  const N = F.naechstesJahr;
  const naechst = N ? `<p class="stp-naechst">Für ${N.jahr} ab Januar ${N.ueber ? `≈ <b>${H.eur0(N.monat)}</b> im Monat` : `kein Freibetrag (${H.eur0(N.betrag)} unter der Antragsgrenze)`} <em class="stp-art plan">Plan</em>
    <span class="muted">Gehaltsplan ${N.jahr}, Entfernung laut Plan${N.fehltKm ? ' (teils fehlt sie)' : ''}, deine Tage wie ${j}, Unterhalt aus dem laufenden Vertrag</span></p>` : '';

  const zeile = (z) => `<div class="stp-z ${z.cls}"><span class="stp-t">${H.esc(z.t)}${ART[z.art] ? ` <em class="stp-art ${z.art}">${ART[z.art]}</em>` : ''}</span>
    <span class="stp-w stp-o">${z.nurMit ? '' : wertHtml(H, z.ohne, z.cls === 'erg')}</span><span class="stp-w stp-m">${wertHtml(H, z.mit, z.cls === 'erg')}</span>
    <span class="stp-q">${z.q ? (z.ziel ? H.zl(H.esc(z.q), z.ziel) : H.esc(z.q)) : ''}</span></div>`;
  const tabelle = `<div class="stp-tab${P.mitU ? '' : ' stp-eins'}" id="stp-rechenweg">
    <div class="stp-z stp-kopf"><span class="stp-t">Rechenweg</span><span class="stp-w stp-o">ohne Anlage U</span><span class="stp-w stp-m">mit Anlage U</span><span class="stp-q">Quelle</span></div>
    ${P.zeilen.map(zeile).join('')}</div>`;

  const u = e.anlageU || {};
  const status = P.mitU ? `<p class="stp-status">Anlage U: ${u.unterschrieben ? `<span class="pos">unterschrieben am ${H.dde(u.unterschrieben)}</span>` : `<span class="neg">Zustimmung von ${H.esc(name)} fehlt noch</span>${u.angefragt ? ` · angefragt am ${H.dde(u.angefragt)}` : ''} – ohne sie gilt die Spalte „ohne Anlage U“`}</p>` : '';
  const hinweise = P.hinweise.length ? `<ul class="st-off-l stp-h">${P.hinweise.map((t) => `<li>${H.esc(t)}</li>`).join('')}</ul>` : '';

  // Deine Angaben (je Jahr auf diesem Gerät gespeichert)
  const zk = (D.j?.gehalt?.zukunft || []).filter((x) => x.km != null && x.ab?.startsWith(`${j}-`));
  const feld = (k, t, wert, art = 'zahl', tipp = '') => `<label class="feld"><span>${t}</span><input data-stp="${k}" ${art === 'datum' ? 'type="date"' : `type="text" inputmode="${art === 'euro' ? 'decimal' : 'numeric'}"`} value="${H.esc(wert ?? '')}"${tipp ? ` placeholder="${H.esc(tipp)}"` : ''}></label>`;
  const angaben = `<details class="st5-mehr stp-angaben"${angabenOffen ? ' open' : ''}><summary>Deine Angaben ${j}</summary>
    <div class="stp-form">
      ${feld('arbeitstage', 'Arbeitstage mit Fahrt ins Büro', e.arbeitstage, 'zahl', 'z. B. 180')}
      ${feld('hoTage', 'Homeoffice-Tage', e.hoTage)}
      ${feld('kmBisher', `Entfernung zur Arbeit (km)${zk.length && +zk[0].ab.slice(5) > 1 ? ` bis ${MON[+zk[0].ab.slice(5) - 2]}` : ''}`, e.kmBisher)}
      ${feld('kinder', 'Kinder mit halbem Freibetrag', e.kinder, 'zahl', String(P.kinder))}
      ${P.mitU ? feld('kvUebernommen', `Übernommene Kranken-/Pflegevers. für ${H.esc(name)} (€ im Jahr)`, e.kvUebernommen, 'euro') : ''}
      ${P.mitU ? feld('mehrsteuer', `Mehrsteuer von ${H.esc(name)} (Nachteilsausgleich, €)`, e.mehrsteuer, 'euro') : ''}
      ${P.mitU ? feld('angefragt', `Zustimmung von ${H.esc(name)} (Anlage U) angefragt am`, u.angefragt, 'datum') : ''}
      ${P.mitU ? feld('unterschrieben', 'unterschrieben am', u.unterschrieben, 'datum') : ''}
    </div>
    <p class="s5-erkl">Entfernung: kürzeste Straßenverbindung. ${zk.map((x) => `Ab ${MON[+x.ab.slice(5) - 1]} ${H.NUM.format(+x.km)} km laut Gehaltsplan (${H.esc(x.titel || '')}).`).join(' ')} Gespeichert nur auf diesem Gerät.</p></details>`;

  const L = D.j?.steuer_offiziell?.kuenftig || [];
  const vorjahre = L.length ? `<details class="st5-mehr"><summary>Was die Vorjahre bedeuten</summary><ul class="st-off-l">${L.map((t) => `<li>${H.esc(t)}</li>`).join('')}</ul></details>` : '';

  const inhalt = `<div class="stp-innen" data-stp-jahr="${j}"><div class="stp-zahlen">${zahlen}</div>${naechst}${status}${tabelle}${hinweise}${angaben}${vorjahre}
    <p class="s5-erkl">Regelwerte: ${H.esc(P.regel.quelle)}. Steuerklasse 1, ohne Kirchensteuer und Kapitalerträge.</p></div>`;
  return H.karte5(`Steuer-Prognose ${j} (Einzelveranlagung)`, 'berechnet aus deinen Abrechnungen und Buchungen · Orientierung, keine Steuerberatung – mit deiner Steuerberaterin klären', inhalt, 'stp', '', 'stp-karte');
}

// ---------------------------------------------------------------- Eingaben
const zahlLesen = (s, euro) => {
  s = String(s ?? '').trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, '');
  // Euro deutsch: Komma = Dezimalzeichen; ohne Komma ist „1.234“ (Punkt + genau drei Ziffern) ein Tausenderpunkt
  if (euro && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (euro && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = +s.replace(/[^\d.-]/g, '');
  return Number.isFinite(v) ? Math.max(0, euro ? Math.round(v * 100) / 100 : Math.round(v)) : null;
};

export function prognoseBinden(el, H) {
  const karte = el?.id === 'stp-karte' ? el : el?.querySelector?.('#stp-karte');
  if (!karte) return;
  const j = +karte.querySelector('[data-stp-jahr]')?.dataset.stpJahr;
  H.gehBinden(karte);
  const d = karte.querySelector('.stp-angaben');
  if (d) d.ontoggle = () => { angabenOffen = d.open; };
  karte.querySelectorAll('[data-stp]').forEach((inp) => inp.onchange = async () => {
    const k = inp.dataset.stp, alt = { ...eingabenVon(j) };
    const neu = { ...alt, anlageU: { ...(alt.anlageU || {}) } };
    if (k === 'angefragt' || k === 'unterschrieben') neu.anlageU[k] = inp.value || '';
    else neu[k] = zahlLesen(inp.value, k === 'kvUebernommen' || k === 'mehrsteuer');
    EIN = { ...(EIN || {}), [j]: neu };
    try { await H.kvSchreiben(KV, EIN); } catch { H.toast?.('Speichern auf diesem Gerät nicht möglich'); }
    // nur die Karte neu zeichnen; das Feld, in das du gerade wechselst, behält den Fokus
    setTimeout(() => {
      const fokus = document.activeElement?.dataset?.stp;
      const html = prognoseKarte(H, j);
      if (!html || !karte.isConnected) return H.neuZeichnen?.();
      karte.outerHTML = html;
      const neuK = document.getElementById('stp-karte');
      prognoseBinden(neuK, H);
      if (fokus) neuK.querySelector(`[data-stp="${fokus}"]`)?.focus();
    }, 0);
  });
}

// ---------------------------------------------------------------- Fristen (für Start/Termine)
export function prognoseFristen(H) {
  const j = +heute(H).slice(0, 4), h = heute(H);
  let P = null;
  try { P = prognoseRechnen(H, j); } catch { P = null; }
  if (!P) return [];
  const out = [], F = P.freibetrag, frist = `${j}-11-30`;
  if (F.ueber && h <= frist) out.push({ key: `stp-lstermaessigung-${j}`, am: frist, titel: `Lohnsteuer-Ermäßigung ${j} beantragen`,
    text: `möglicher Freibetrag ${H.eur0(F.jahr)}${F.monat != null ? ` (≈ ${H.eur0(F.monat)} je Monat ab ${MONAT[F.ab - 1]})` : ''} · berechnet, Orientierung`, ziel: { tab: 'steuer' }, art: 'Regel', orientierung: true });
  if (P.mitU && !P.eingaben.anlageU?.unterschrieben) out.push({ key: `stp-anlage-u-${j}`, am: frist, titel: 'Zustimmung Anlage U einholen',
    text: `${P.name || 'Die Empfängerin'} muss der Anlage U ${j} zustimmen${P.vorteil != null ? ` – Vorteil laut Prognose ${(P.vorteil < 0 ? '−' : '') + H.eur0(Math.abs(P.vorteil))}` : ''}${P.eingaben.anlageU?.angefragt ? ` · angefragt am ${H.dde(P.eingaben.anlageU.angefragt)}` : ''}`,
    ziel: { tab: 'steuer' }, art: 'Regel', orientierung: true });
  return out;
}
