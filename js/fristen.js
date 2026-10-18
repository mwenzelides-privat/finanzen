// Fristen und Termine: Einspruchs- und Abgabefristen (nach fester Regel berechnet, nur zur Orientierung), Termine aus dem
// Gehaltsplan (Dienstwagen, Umzug), Volljährigkeit der Kinder, Fristen anderer Module (H.fristQuellen) und eigene Einträge.
// Dazu der Kalender-Export (.ics) mit den Abbuchungen der eigenen Verträge und dem erwarteten Gehalt.
// Keine Imports: alle Helfer kommen über H aus app.js. Eingaben bleiben im Gerät (IndexedDB, Schlüssel 'fristen').

const KV = 'fristen';
const LEER = () => ({ eigene: [], erledigt: {}, berater: false, icsSchwelle: 50000, icsFristen: true });   // Schwelle in Cent
let F = LEER();

const Z_LISTE = { tab: 'fix', fixtab: 'kalender', _springe: '#fr-liste' };
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const QUELLE_MARKE = { 'aus den Daten': 'gebucht', Regel: 'berechnet' };   // Abzeichen für Einträge anderer Module ohne eigene Marke
const ORIENTIERUNG = 'Orientierung, keine Steuerberatung';

// ---------------------------------------------------------------- Datum (alles in UTC, ein Datum ist immer 'JJJJ-MM-TT')
const p2 = (n) => String(n).padStart(2, '0');
const gueltig = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const ut = (iso) => Date.parse(`${iso}T00:00:00Z`);
const plus = (iso, n) => new Date(ut(iso) + n * 864e5).toISOString().slice(0, 10);
const tageBis = (von, bis) => Math.round((ut(bis) - ut(von)) / 864e5);
const monatsTage = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1 … 12
const monatsende = (mk) => `${mk}-${p2(monatsTage(+mk.slice(0, 4), +mk.slice(5, 7)))}`;
const monatLang = (mk) => `${MONATE[+mk.slice(5, 7) - 1]} ${mk.slice(0, 4)}`;
const mmjj = (mk) => `${mk.slice(5, 7)}/${mk.slice(0, 4)}`;
// n Monate weiter; gibt es den Tag im Zielmonat nicht, gilt dessen letzter Tag (§ 188 Abs. 3 BGB)
function plusMonate(iso, n) {
  let [y, m, d] = iso.split('-').map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${p2(m)}-${p2(Math.min(d, monatsTage(y, m)))}`;
}
const plusJahre = (iso, n) => plusMonate(iso, 12 * n);

// Ostersonntag nach der Gaußschen Osterformel (ergänzt nach Lichtenberg)
function ostern(y) {
  const k = Math.floor(y / 100), m = 15 + Math.floor((3 * k + 3) / 4) - Math.floor((8 * k + 13) / 25), s = 2 - Math.floor((3 * k + 3) / 4);
  const a = y % 19, d = (19 * a + m) % 30, r = Math.floor((d + Math.floor(a / 11)) / 29), og = 21 + d - r;
  const sz = 7 - ((y + Math.floor(y / 4) + s) % 7), oe = 7 - ((((og - sz) % 7) + 7) % 7);
  return plus(`${y}-03-01`, og + oe - 1);
}
// Gesetzliche Feiertage in Bayern (landesweit; Mariä Himmelfahrt und das Augsburger Friedensfest gelten nur örtlich)
const FT_FEST = ['01-01', '01-06', '05-01', '10-03', '11-01', '12-25', '12-26'];
const FT_OSTERN = [-2, 1, 39, 50, 60];   // Karfreitag, Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam
const ftCache = new Map();
function feiertage(y) {
  if (!ftCache.has(y)) { const o = ostern(y); ftCache.set(y, new Set([...FT_FEST.map((t) => `${y}-${t}`), ...FT_OSTERN.map((n) => plus(o, n))])); }
  return ftCache.get(y);
}
const frei = (iso) => { const w = new Date(ut(iso)).getUTCDay(); return w === 0 || w === 6 || feiertage(+iso.slice(0, 4)).has(iso); };
const werktag = (iso) => { while (frei(iso)) iso = plus(iso, 1); return iso; };

// Einspruchsfrist: Bekanntgabe am 4. Tag nach dem Bescheiddatum (Bescheide bis 2024: am 3.), fällt sie auf Wochenende
// oder Feiertag, gilt der nächste Werktag; Frist = Bekanntgabe + 1 Monat, Fristende ebenso auf den nächsten Werktag
function einspruchsfrist(datum) {
  if (!gueltig(datum)) return null;
  const n = datum >= '2025-01-01' ? 4 : 3, bekannt = werktag(plus(datum, n));
  return { n, bekannt, frist: werktag(plusMonate(bekannt, 1)) };
}
// Abgabefrist der Erklärung für ein Jahr: 31.07. des Folgejahres, mit Steuerberaterin letzter Februartag des übernächsten
const abgabefrist = (jahr, berater) => werktag(berater ? monatsende(`${jahr + 2}-02`) : `${jahr + 1}-07-31`);

// für Tests und andere Module
export const fristRegeln = { ostern, feiertage, werktag, einspruchsfrist, abgabefrist, plusMonate, gueltig };

// ---------------------------------------------------------------- Eingaben (IndexedDB)
const neueId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function normal(v) {
  const o = LEER();
  if (!v || typeof v !== 'object') return o;
  o.eigene = (Array.isArray(v.eigene) ? v.eigene : []).filter((e) => e && gueltig(e.am) && typeof e.titel === 'string' && e.titel.trim())
    .map((e) => ({ id: String(e.id || neueId()), am: e.am, titel: e.titel.trim().slice(0, 80), notiz: typeof e.notiz === 'string' ? e.notiz.trim().slice(0, 200) : '', jaehrlich: !!e.jaehrlich }));
  if (v.erledigt && typeof v.erledigt === 'object') for (const [k, t] of Object.entries(v.erledigt)) if (t) o.erledigt[k] = String(t);
  o.berater = !!v.berater;
  if (v.icsSchwelle != null && Number.isFinite(+v.icsSchwelle)) o.icsSchwelle = Math.max(0, Math.round(+v.icsSchwelle));
  if (typeof v.icsFristen === 'boolean') o.icsFristen = v.icsFristen;
  return o;
}
export async function fristenLaden(H) {
  try { F = normal(await H.kvLesen(KV)); } catch { F = LEER(); }
}
const speichern = (H) => Promise.resolve(H.kvSchreiben(KV, F)).catch(() => H.toast('Konnte nicht auf dem Gerät gespeichert werden.'));

// ---------------------------------------------------------------- Einträge sammeln
// Ein Eintrag: { key, am, titel, text, ziel, art, orientierung, erledigt, marke, … }
// info: reiner Hinweis, verschwindet nach seinem Tag · bis: verschwindet nach diesem Tag · sonst bleibt er, bis er abgehakt ist
function sammeln(H) {
  const D0 = H.D() || {}, D = D0.j || D0, heute = H.heuteLokal(), out = [], hinweise = [];   // in der App ist H.D() das aufbereitete D (Rohdaten in D.j)
  const dazu = (x) => out.push({ orientierung: false, marke: '', text: '', ziel: null, ...x });

  // 1 Einspruchsfrist je Bescheid
  const so = D.steuer_offiziell, jahre = so && so.jahre && typeof so.jahre === 'object' ? so.jahre : null;
  for (const j of Object.values(jahre || {})) {
    if (!j || !/bescheid/i.test(j.art || '')) continue;
    const e = einspruchsfrist(j.datum);
    if (!e) continue;
    dazu({ key: `einspruch|${j.jahr}|${j.datum}`, am: e.frist, bis: plus(e.frist, 30), art: 'steuer', orientierung: true, marke: 'berechnet',
      titel: `Einspruchsfrist ${j.kurz || `Bescheid ${j.jahr}`}`,
      text: `Bescheid vom ${H.dde(j.datum)}, gilt als bekannt gegeben am ${H.dde(e.bekannt)} (${e.n} Tage danach, Wochenende und Feiertag verschieben) – Einspruch innerhalb eines Monats.`,
      ziel: { tab: 'steuer', sjahr: String(j.jahr) } });
  }
  // 2 Abgabefrist der Erklärung für das Vorjahr, solange dazu nichts in den Steuerunterlagen steht
  const vj = +heute.slice(0, 4) - 1;
  if (!jahre || !jahre[vj]) {
    dazu({ key: `abgabe|${vj}`, am: abgabefrist(vj, F.berater), art: 'steuer', orientierung: true, marke: 'berechnet',
      titel: `Steuererklärung ${vj} abgeben – falls Abgabepflicht`,
      text: F.berater ? `Mit Steuerberaterin: letzter Februartag ${vj + 2}, Wochenende und Feiertag verschieben.` : `Ohne Steuerberaterin: 31.07.${vj + 1}, Wochenende und Feiertag verschieben. Mit Steuerberaterin gilt eine längere Frist (Schalter unten).`,
      ziel: { tab: 'steuer' } });
  }
  // 3 Gehaltsplan: Änderungen ab einem Monat, vor einem Umzug die Adresse ändern
  const G = D.gehalt || {};
  for (const z of Array.isArray(G.zukunft) ? G.zukunft : []) {
    if (!/^\d{4}-\d{2}$/.test(z?.ab || '') || !z.titel) continue;
    dazu({ key: `zukunft|${z.ab}|${z.titel}`, am: `${z.ab}-01`, info: true, art: 'gehalt', marke: 'Plan',
      titel: `Ab ${monatLang(z.ab)}: ${z.titel}`, text: 'Aus deinem Gehaltsplan – ab diesem Monat in der Gehalts-Prognose.', ziel: { tab: 'gehalt', gmonat: z.ab } });
    if (z.km && /umzug/i.test(z.titel)) {
      dazu({ key: `umzug|${z.ab}`, am: plusMonate(`${z.ab}-01`, -1), bis: plus(`${z.ab}-01`, 30), art: 'pruef', marke: 'Prüfpunkt',
        titel: 'Adresse bei Verträgen und Versicherungen ändern', text: `Einen Monat vor dem Umzug (${z.titel}).`, ziel: { tab: 'fix', fixtab: 'vertraege' } });
    }
  }
  // 4 Dienstwagen mit nur angenommenem Listenpreis – entfällt, sobald eine geprüfte Abrechnung ab diesem Monat vorliegt
  const geprueft = (Array.isArray(G.monate) ? G.monate : []).filter((m) => m && m.geprueft).map((m) => m.m);
  for (const w of Array.isArray(G.dienstwagen?.wagen) ? G.dienstwagen.wagen : []) {
    if (!w || !w.preis_angenommen || !/^\d{4}-\d{2}$/.test(w.ab || '') || geprueft.some((m) => m >= w.ab)) continue;
    dazu({ key: `listenpreis|${w.modell}|${w.ab}`, am: monatsende(w.ab), art: 'gehalt', marke: 'Prüfpunkt',
      titel: `Listenpreis ${w.modell || 'Dienstwagen'} prüfen, sobald die Abrechnung ${mmjj(w.ab)} da ist`,
      text: `${w.listenpreis ? `Angenommen sind ${H.eur0(Math.round(w.listenpreis * 100))}. ` : ''}Der Preis bestimmt den geldwerten Vorteil. Der Eintrag verschwindet, sobald eine geprüfte Abrechnung ab ${mmjj(w.ab)} vorliegt.`,
      ziel: { tab: 'gehalt', gmonat: w.ab } });
  }
  // 5 Kinder werden volljährig (sichtbar in den nächsten 24 Monaten)
  let kinder = [];
  try { kinder = typeof H.kinder === 'function' ? H.kinder() || [] : []; } catch { kinder = []; }
  let ohneGeb = 0;
  const zuKindern = H.kinderZiel || { tab: 'fix', fixtab: 'unterhalt' };
  kinder.forEach((k, i) => {
    if (!k || typeof k !== 'object') return;
    const geb = k.geb || k.geburt || k.geburtsdatum || k.geboren, name = String(k.name || k.vorname || `Kind ${i + 1}`);
    if (!gueltig(geb)) { ohneGeb++; return; }
    const am = plusJahre(geb, 18);
    if (am <= plusMonate(heute, 24)) dazu({ key: `kind18|${name}|${geb}`, am, info: true, art: 'kind', marke: 'berechnet',
      titel: `${name} wird 18`, text: `Geboren am ${H.dde(geb)}. Ab dann gilt Unterhalt für Volljährige – Höhe neu klären.`, ziel: zuKindern });
  });
  const kinderKonten = (D.konten || []).some((k) => k && k.kind);
  if (ohneGeb || (!kinder.length && kinderKonten)) hinweise.push(`Ohne Geburtsdaten fehlt, wann deine Kinder volljährig werden. Trag sie unter ${H.zl('Fixkosten › Unterhalt', zuKindern)} ein.`);
  if (!jahre) hinweise.push('Noch keine Steuerbescheide in den Daten – Einspruchsfristen erscheinen, sobald einer da ist.');

  // 6 Fristen anderer Module (z. B. Steuer-Prognose, Unterhalt): Funktionen oder fertige Listen. Das Modul entscheidet,
  // wie lange ein Eintrag gilt (er steht hier, solange es ihn liefert), höchstens bis x.bis
  const q = H.fristQuellen, quellen = typeof q === 'function' ? [q] : Array.isArray(q) ? q : q && typeof q === 'object' ? Object.values(q) : [];
  for (const fn of quellen) {
    let l = null;
    try { l = typeof fn === 'function' ? fn(H) : fn; } catch { l = null; }
    for (const x of Array.isArray(l) ? l : []) {
      if (!x || !gueltig(x.am) || !x.titel) continue;
      dazu({ key: String(x.key || `quelle|${x.am}|${x.titel}`), am: x.am, titel: String(x.titel), text: x.text ? String(x.text) : '', ziel: x.ziel || null,
        art: x.art || 'quelle', orientierung: !!x.orientierung, marke: x.marke || QUELLE_MARKE[x.art] || '', info: !!x.info, bis: gueltig(x.bis) ? x.bis : '' });
    }
  }
  // Eigene Einträge; jährliche: der erste nicht abgehakte Termin ab 30 Tagen vor heute, der zuletzt abgehakte unter „erledigt“
  for (const e of F.eigene) {
    const basis = { art: 'eigen', marke: 'eigener Termin', titel: e.titel, text: e.notiz, ziel: Z_LISTE, id: e.id, jaehrlich: e.jaehrlich };
    if (!e.jaehrlich) { dazu({ ...basis, key: `eigen|${e.id}`, am: e.am }); continue; }
    let n = 0, am = e.am, zuletzt = '';
    while (n < 300 && (F.erledigt[`eigen|${e.id}|${am}`] || am < plus(heute, -30))) { if (F.erledigt[`eigen|${e.id}|${am}`]) zuletzt = am; am = plusJahre(e.am, ++n); }
    dazu({ ...basis, key: `eigen|${e.id}|${am}`, am });
    if (zuletzt) dazu({ ...basis, key: `eigen|${e.id}|${zuletzt}`, am: zuletzt });
  }

  const liste = out.map((x) => ({ ...x, erledigt: !!F.erledigt[x.key], erledigtAm: F.erledigt[x.key] || '' }))
    .filter((x) => (!x.info || x.am >= heute) && (!x.bis || x.bis >= heute))
    .sort((a, b) => (a.am < b.am ? -1 : a.am > b.am ? 1 : a.titel.localeCompare(b.titel, 'de')));
  return { liste, hinweise };
}

// Alle Einträge (offene und erledigte), nach Datum sortiert
export function fristenAlle(H) {
  return sammeln(H).liste;
}

// ---------------------------------------------------------------- Darstellung
function wann(H, x) {
  const n = tageBis(H.heuteLokal(), x.am);
  if (x.erledigt) return { t: 'erledigt', rot: false };
  if (n === 0) return { t: 'heute', rot: false };
  if (n === 1) return { t: 'morgen', rot: false };
  if (n > 0) return { t: `in ${n} Tagen`, rot: false };
  return { t: `seit ${-n} ${n === -1 ? 'Tag' : 'Tagen'} überfällig`, rot: true };
}
const marken = (H, x) => (x.marke ? `<span class="fr-m">${H.esc(x.marke)}</span>` : '')
  + (x.orientierung ? `<span class="fr-m fr-or" title="${ORIENTIERUNG}">Orientierung</span>` : '');
const datum = (H, iso) => (iso.slice(0, 4) === H.heuteLokal().slice(0, 4) ? H.tagKurz(iso) : H.dde(iso));

function zeile(H, x, { liste = false, fuell = 0 } = {}) {
  const w = wann(H, x), titel = x.ziel ? H.zl(H.esc(x.titel), x.ziel) : H.esc(x.titel);
  return `<div class="fr-z${w.rot ? ' ueber' : ''}${x.erledigt ? ' erl' : ''}${fuell ? ' fuell-aus' : ''}"${fuell ? ` data-fuell="${fuell}" data-stopp` : ''}>
    ${liste ? `<label class="fr-h" title="${x.erledigt ? 'Wieder offen' : 'Als erledigt abhaken'}"><input type="checkbox" data-fr-erl="${H.esc(x.key)}"${x.erledigt ? ' checked' : ''} aria-label="erledigt: ${H.esc(x.titel)}"></label>` : ''}
    <div class="fr-d"><b>${datum(H, x.am)}</b><span${w.rot ? ' class="neg"' : ''}>${w.t}</span></div>
    <div class="fr-t">${titel}${marken(H, x)}${liste && x.text ? `<small>${H.esc(x.text)}</small>` : ''}</div>
    ${liste ? (x.art === 'eigen' ? `<button class="fr-x" data-fr-weg="${H.esc(x.id)}" title="Eintrag entfernen" aria-label="Eintrag entfernen">×</button>` : '<span></span>') : ''}</div>`;
}

// Übersicht: Karte „Nächste Fristen“ (die nächsten 5 offenen; bis zu 3 weitere sind verborgen und erscheinen nur,
// wenn freiFuellen() sie ohne höheren Kasten unterbringt)
export function fristenKarte(H) {
  const offen = fristenAlle(H).filter((x) => !x.erledigt);
  const inhalt = offen.length
    ? `<div class="fr-l">${offen.slice(0, 8).map((x, i) => zeile(H, x, { fuell: i >= 5 ? i : 0 })).join('')}</div>`
    : `<div class="leer klein">Keine offenen Fristen. Eigene Termine kannst du unter ${H.zl('Fixkosten › Wann abgebucht wird', Z_LISTE)} eintragen.</div>`;
  return H.karte5('Nächste Fristen', 'Steuer, Gehalt, Kinder und deine eigenen Termine · anklicken: Einzelheiten', inhalt, 'fr-karte', H.zl('alle →', Z_LISTE));
}

// Fixkosten › Wann abgebucht wird: Liste offen/erledigt, eigene Einträge, Sicherung und Kalender-Datei
export function fristenListe(H) {
  const { liste, hinweise } = sammeln(H);
  const offen = liste.filter((x) => !x.erledigt), erl = liste.filter((x) => x.erledigt);
  const iv = icsVertraege(H), gt = H.gehaltstag();
  const inhalt = `${hinweise.map((t) => `<p class="fr-hinw">${t}</p>`).join('')}
    ${offen.length ? `<div class="fr-l fr-mit">${offen.map((x) => zeile(H, x, { liste: true })).join('')}</div>`
      : '<div class="leer klein">Keine offenen Fristen. Eigene Termine kannst du unten eintragen.</div>'}
    ${erl.length ? `<details class="fr-erl"><summary>Erledigt (${erl.length})</summary><div class="fr-l fr-mit">${erl.map((x) => zeile(H, x, { liste: true })).join('')}</div></details>` : ''}
    <form class="fr-neu" id="fr-neu" autocomplete="off">
      <label class="feld fr-neu-d">Datum<input type="date" name="am" required></label>
      <label class="feld fr-neu-t">Titel<input name="titel" maxlength="80" required placeholder="z. B. Bezugsrecht der Versicherung prüfen"></label>
      <label class="feld fr-neu-n">Notiz<input name="notiz" maxlength="200" placeholder="optional"></label>
      <label class="fr-cb"><input type="checkbox" name="jaehrlich"> jährlich wiederholen</label>
      <button class="btn sm primary" type="submit">Eintragen</button>
    </form>
    <div class="fr-opt">
      <label class="fr-cb"><input type="checkbox" id="fr-berater"${F.berater ? ' checked' : ''}> Erklärung mit Steuerberaterin (längere Abgabefrist)</label>
      <span class="muted klein"><button class="link klein" id="fr-sichern" title="Eigene Termine und Haken als Datei sichern">Als Datei sichern</button> · <button class="link klein" id="fr-laden" title="Gesicherte Termine laden und zusammenführen">Aus Datei laden</button></span>
    </div>
    <div class="fr-ics">
      <div class="fr-ics-t"><b>In deinen Kalender</b><p class="s5-erkl">${iv.liste.length} laufende Verträge (ohne gemeinsame Konten) als wiederkehrende Termine${gt ? `, dazu das Gehalt um den ${gt}.` : ''}${iv.aus ? ` ${iv.aus} mit unüblichem Rhythmus fehlen.` : ''} Die Datei bleibt auf deinem Gerät.</p></div>
      <label class="feld fr-schw">Erinnerung am Vortag ab<span class="fr-eur"><input type="number" id="fr-schwelle" min="0" step="50" inputmode="numeric" value="${Math.round(F.icsSchwelle / 100)}"> €</span></label>
      <label class="fr-cb"><input type="checkbox" id="fr-icsfristen"${F.icsFristen ? ' checked' : ''}> offene Fristen mitnehmen</label>
      <button class="btn sm" id="fr-ics">In meinen Kalender (.ics)</button>
    </div>`;
  return H.karte5('Fristen und Termine', `Steuerfristen sind nach fester Regel berechnet – ${ORIENTIERUNG}. Abhaken: erledigt · Titel anklicken: Einzelheiten`, inhalt, 'fr-karte fr-gross', '', 'fr-liste');
}

export function fristenBinden(el, H) {
  if (!el) return;
  const $ = (s) => el.querySelector(s), neu = () => { speichern(H); H.neuZeichnen(); };
  el.querySelectorAll('[data-fr-erl]').forEach((cb) => cb.onchange = () => {
    const k = cb.dataset.frErl;
    if (cb.checked) F.erledigt[k] = new Date().toISOString(); else delete F.erledigt[k];
    neu();
  });
  el.querySelectorAll('[data-fr-weg]').forEach((b) => b.onclick = () => {
    const id = b.dataset.frWeg, e = F.eigene.find((x) => x.id === id);
    if (!e || !confirm(`„${e.titel}“ entfernen?`)) return;
    F.eigene = F.eigene.filter((x) => x.id !== id);
    for (const k of Object.keys(F.erledigt)) if (k === `eigen|${id}` || k.startsWith(`eigen|${id}|`)) delete F.erledigt[k];
    H.toast('Eintrag entfernt'); neu();
  });
  const form = $('#fr-neu');
  if (form) form.onsubmit = (ev) => {
    ev.preventDefault();
    const f = form.elements, am = f.am.value, titel = f.titel.value.trim();
    if (!gueltig(am)) return H.toast('Bitte ein gültiges Datum eingeben.');
    if (!titel) return H.toast('Bitte einen Titel eingeben.');
    F.eigene.push({ id: neueId(), am, titel: titel.slice(0, 80), notiz: f.notiz.value.trim().slice(0, 200), jaehrlich: f.jaehrlich.checked });
    H.toast('Termin eingetragen'); neu();
  };
  const ber = $('#fr-berater');
  if (ber) ber.onchange = () => { F.berater = ber.checked; neu(); };
  const sw = $('#fr-schwelle');
  if (sw) sw.onchange = () => { const v = Math.round(parseFloat(String(sw.value).replace(',', '.')) * 100); F.icsSchwelle = Number.isFinite(v) && v >= 0 ? v : 50000; speichern(H); };
  const mf = $('#fr-icsfristen');
  if (mf) mf.onchange = () => { F.icsFristen = mf.checked; speichern(H); };
  const ics = $('#fr-ics');
  if (ics) ics.onclick = () => {
    try {
      H.herunterladen(new Blob([icsText(H, { schwelle: F.icsSchwelle, fristen: F.icsFristen })], { type: 'text/calendar;charset=utf-8' }), 'Finanzen-Termine.ics');
      H.toast('Kalender-Datei erstellt – öffne sie, um die Termine zu übernehmen.');
    } catch { H.toast('Die Kalender-Datei konnte nicht erstellt werden.'); }
  };
  const si = $('#fr-sichern');
  if (si) si.onclick = () => H.herunterladen(new Blob([JSON.stringify({ art: 'finanzen-fristen', version: 1, ...F }, null, 1)], { type: 'application/json' }), 'Finanzen-Fristen.json');
  const la = $('#fr-laden');
  if (la) la.onclick = () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => {
      try {
        const roh = JSON.parse(await inp.files[0].text()), j = normal(roh);
        const ids = new Map(F.eigene.map((e) => [e.id, e]));
        let n = 0;
        for (const e of j.eigene) { if (!ids.has(e.id)) n++; ids.set(e.id, e); }
        F.eigene = [...ids.values()];
        for (const [k, t] of Object.entries(j.erledigt)) if (!F.erledigt[k]) F.erledigt[k] = t;
        if ('berater' in roh) F.berater = j.berater;
        if ('icsSchwelle' in roh) F.icsSchwelle = j.icsSchwelle;
        if ('icsFristen' in roh) F.icsFristen = j.icsFristen;
        H.toast(`${n} neue Termine übernommen`); neu();
      } catch { H.toast('Die Datei konnte nicht gelesen werden.'); }
    };
    inp.click();
  };
}

// ---------------------------------------------------------------- Kalender-Datei (.ics, RFC 5545)
const INTERVALL = { 12: 1, 6: 2, 4: 3, 2: 6 };   // Zahlungen im Jahr → Monate zwischen zwei Abbuchungen
// Laufende eigene Verträge mit einem Rhythmus, den der Kalender abbilden kann (gemeinsame und Kinderkonten nie)
function icsVertraege(H) {
  const D = H.D() || {}, liste = [];
  let aus = 0;
  let alle = [];
  try { alle = H.fixkostenErkennen() || []; } catch { alle = []; }
  for (const f of alle) {
    if (!f || !f.aktiv || f.gemeinsam || D.konten?.[f.k]?.kind) continue;
    const pj = f.rh?.proJahr, start = H.naechsteRegulaer(f);
    if (!gueltig(start) || !(pj === 1 || pj in INTERVALL)) { aus++; continue; }
    liste.push({ f, pj, start });
  }
  return { liste, aus };
}
const icsDatum = (iso) => iso.replace(/-/g, '');
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36) + s.length.toString(36); };
const oktette = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
// Zeilen über 75 Oktette falten: CRLF + Leerzeichen, nie mitten in einem UTF-8-Zeichen
function falten(z) {
  const teile = [];
  let teil = '', n = 0, max = 75;
  for (const ch of z) {
    const l = oktette(ch.codePointAt(0));
    if (n + l > max) { teile.push(teil); teil = ''; n = 0; max = 74; }
    teil += ch; n += l;
  }
  teile.push(teil);
  return teile.join('\r\n ');
}
// Tag t im Monat (über 28: der letzte Tag, passend zu BYMONTHDAY=-1)
const tagIm = (mk, t) => (t > 28 ? monatsende(mk) : `${mk}-${p2(t)}`);
const naechsterMonat = (mk) => plusMonate(`${mk}-01`, 1).slice(0, 7);

export function icsText(H, optionen = {}) {
  const heute = H.heuteLokal(), schwelle = optionen.schwelle ?? F.icsSchwelle, mitFristen = optionen.fristen ?? F.icsFristen;
  const stamp = new Date(optionen.jetzt || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const z = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finanzen//Fristen und Abbuchungen//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Finanzen'];
  const termin = ({ uid, am, titel, text, rrule, alarm }) => {
    z.push('BEGIN:VEVENT', `UID:${uid}@finanzen.local`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDatum(am)}`, `DTEND;VALUE=DATE:${icsDatum(plus(am, 1))}`, `SUMMARY:${icsEsc(titel)}`);
    if (text) z.push(`DESCRIPTION:${icsEsc(text)}`);
    if (rrule) z.push(`RRULE:${rrule}`);
    z.push('TRANSP:TRANSPARENT');
    if (alarm) z.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(titel)}`, 'TRIGGER:-P1D', 'END:VALARM');
    z.push('END:VEVENT');
  };
  // je laufendem eigenem Vertrag eine Serie ab der nächsten regulären Abbuchung
  for (const { f, pj, start } of icsVertraege(H).liste) {
    const betrag = Math.abs(f.betrag || 0), titel = `Abbuchung ${H.vertragName(f)} ${H.eur0(betrag)}`;
    let am = start, rrule = 'FREQ=YEARLY';
    if (pj !== 1) {
      const t = H.zahltag(f);
      am = tagIm(start.slice(0, 7), t);
      if (am < heute) am = tagIm(naechsterMonat(start.slice(0, 7)), t);
      rrule = `FREQ=MONTHLY${INTERVALL[pj] > 1 ? `;INTERVAL=${INTERVALL[pj]}` : ''};BYMONTHDAY=${t > 28 ? -1 : t}`;
    }
    termin({ uid: `v-${hash(H.vertragsKey(f))}`, am, titel, text: `${f.rh?.name || ''} · Tag und Rhythmus aus deinen Buchungen erkannt`, rrule, alarm: betrag >= schwelle });
  }
  // erwartetes Gehalt am üblichen Tag
  const gt = H.gehaltstag();
  if (gt > 0) {
    let am = tagIm(heute.slice(0, 7), gt);
    if (am < heute) am = tagIm(naechsterMonat(heute.slice(0, 7)), gt);
    termin({ uid: 'gehalt', am, titel: 'Gehalt erwartet', text: `Üblicher Tag laut deinen letzten Gehaltseingängen: der ${gt}.`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${gt > 28 ? -1 : gt}` });
  }
  // offene Fristen ab heute (jährliche eigene Termine als Serie)
  if (mitFristen) {
    for (const x of fristenAlle(H)) {
      if (x.erledigt || x.am < heute) continue;
      const text = [x.text, x.marke, x.orientierung ? ORIENTIERUNG : ''].filter(Boolean).join(' · ');
      termin({ uid: `f-${hash(x.jaehrlich ? `eigen|${x.id}` : x.key)}`, am: x.am, titel: x.titel, text, rrule: x.jaehrlich ? 'FREQ=YEARLY' : '', alarm: true });
    }
  }
  z.push('END:VCALENDAR');
  return z.map(falten).join('\r\n') + '\r\n';
}
