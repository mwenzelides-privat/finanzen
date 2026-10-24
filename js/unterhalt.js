// Unterhalt (Fixkosten › Unterhalt): Monat für Monat mit Soll und Abweichung, Ausgleich mit der Gegenseite (offene
// Steueranteile, Sonderbedarf der Kinder, Auslagen) und das Einkommen der letzten 12 Monate als belegte Aufstellung.
// Alles kommt aus den Buchungen und Abrechnungen; deine Angaben (Kinder, Soll-Beträge, Tags, erledigte Posten) liegen nur
// in diesem Browser (IndexedDB „unterhalt“). Kinder- und Gemeinschaftskonten zählen nie mit, nichts wird geschätzt aufgeteilt.
// Alle Helfer kommen über H (siehe app.js), Geld immer in Cent.

const TU = 'Trennungsunterhalt', KU = 'Kindesunterhalt';
const FREMD_ART = new Set(['Umbuchung', 'Kinderkonto', 'Gemeinschaftskonto']);
import { rechnerKarte, rechnerBinden } from './unterhaltsrechner.js';

const leer = () => ({ kinder: [], soll: [], eigeneKinder: null, eigeneSoll: null, ausgleich: { tags: [], posten: {} }, bavProzent: 4 });
let E = leer();
let ende = '';   // letzter Monat der 12-Monats-Aufstellung ('' = der letzte geprüfte)

// ======================================================================= Laden, Angaben
export async function unterhaltLaden(H) {
  let v = null;
  try { v = await H.kvLesen('unterhalt'); } catch { v = null; }
  const a = v && typeof v === 'object' ? v : {};
  FAM = null;
  E = {
    kinder: Array.isArray(a.kinder) ? a.kinder.filter((k) => k && typeof k === 'object').map(kindAus) : [],
    soll: Array.isArray(a.soll) ? a.soll.filter((s) => s && typeof s === 'object').map(sollAus) : [],
    // eigene Angaben (true) oder Vorgabe aus Familie.json (false); fehlt das Merkmal (ältere Speicherung), entscheidet vorgabe()
    eigeneKinder: typeof a.eigeneKinder === 'boolean' ? a.eigeneKinder : null,
    eigeneSoll: typeof a.eigeneSoll === 'boolean' ? a.eigeneSoll : null,
    ausgleich: { tags: Array.isArray(a.ausgleich?.tags) ? a.ausgleich.tags.map(String) : [], posten: a.ausgleich?.posten && typeof a.ausgleich.posten === 'object' ? a.ausgleich.posten : {} },
    bavProzent: Number.isFinite(+a.bavProzent) && a.bavProzent !== '' && a.bavProzent != null ? +a.bavProzent : 4,
  };
  vorgabe(H);
}
// Vorgaben aus den Daten (Familie.json in Drive: Kinder, Soll laut Beleg) – gelten, solange du selbst nichts eingetragen hast
let FAM = null;
function vorgabe(H) {
  const f = H.D?.()?.j?.familie;
  if (!f || f === FAM) return;
  FAM = f;
  const fk = Array.isArray(f.kinder) ? f.kinder.map(kindAus) : [], fs = Array.isArray(f.soll) ? f.soll.map(sollAus) : [];
  // ältere Speicherung ohne Merkmal: nur dann eigene Angabe, wenn sie von der Vorgabe abweicht (früher wurde die Vorgabe mitgespeichert)
  const kk = (k) => `${k.name}|${k.geb}`, sk = (x) => `${x.ab}|${x.art}|${x.c}`;
  if (E.eigeneKinder == null) E.eigeneKinder = E.kinder.length > 0 && !E.kinder.every((k) => fk.some((x) => kk(x) === kk(k)));
  if (E.eigeneSoll == null) E.eigeneSoll = E.soll.length > 0 && !E.soll.every((s) => fs.some((x) => sk(x) === sk(s)));
  if (!E.eigeneKinder && fk.length) E.kinder = fk;
  if (!E.eigeneSoll && fs.length) E.soll = fs;
}
const kindAus = (k) => ({ name: String(k.name || ''), geb: String(k.geb || ''), status: String(k.status || '') });
const sollAus = (x) => ({ ab: String(x.ab || ''), art: String(x.art || 'tu'), c: Math.round(+x.c || 0), grundlage: String(x.grundlage || '') });
// Gespeichert werden nur eigene Angaben – Vorgaben aus Familie.json bleiben dort und kommen bei Änderungen neu an
const zumSpeichern = () => {
  const o = JSON.parse(JSON.stringify(E));
  if (E.eigeneKinder === false) o.kinder = [];   // null = noch unbekannt: lieber behalten
  if (E.eigeneSoll === false) o.soll = [];
  return o;
};
export const kinder = () => E.kinder.map((k) => ({ ...k }));
export const ausgleichTags = () => [...E.ausgleich.tags];

// ======================================================================= Bausteine
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wortRe = (w) => new RegExp(`(^|[^a-z0-9])${escRe(w)}([^a-z0-9]|$)`);
const plusTage = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const heute = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ct = (v) => Math.round((+v || 0) * 100);   // Abrechnungen und Bescheide stehen in Euro
// Betrag mit echtem Minuszeichen, minus rot; vz = mit Vorzeichen (+/−)
const bet = (H, c) => `<span class="${c < 0 ? 'neg' : ''}">${c < 0 ? '−' : ''}${H.eur(Math.abs(c))}</span>`;
const vz = (H, c) => `<span class="${c < 0 ? 'neg' : ''}">${c < 0 ? '−' : c > 0 ? '+' : ''}${H.eur(Math.abs(c))}</span>`;
const strich = '<span class="muted">–</span>';
// Nur eigene Konten: keine Umbuchungen, keine Kinder- und Gemeinschaftskonten
const eigen = (H, D) => (r) => !FREMD_ART.has(r.art) && !H.fremd(D.konten[r.k]) && !H.istGemeinsam(r.k);
const kinderRe = (H) => E.kinder.map((k) => (k.name || '').trim() ? wortRe(H.norm(k.name.trim())) : null);
const kindName = (i) => (E.kinder[i]?.name || '').trim() || `Kind ${i + 1}`;
const artName = (a) => (a === 'tu' ? TU : a === 'gesamt' ? 'Unterhalt gesamt' : /^kind:\d+$/.test(a) ? `${KU} ${kindName(+a.slice(5))}` : a);
// Gleiche Zahlung erkennen: Verwendungszweck ohne Ziffern und Monatswörter
const MONW = /(^|[^a-z])(januar|februar|maerz|marz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mrz|apr|jun|jul|aug|sep|sept|okt|nov|dez)(?=[^a-z]|$)/g;
const zweckKey = (H, z) => H.norm(z).replace(/\d+/g, ' ').replace(MONW, '$1 ').replace(/[^a-z]+/g, ' ').trim();
// Ein Kind volljährig ab (Monat des 18. Geburtstags)
const volljaehrig = (geb) => (/^\d{4}-\d{2}/.test(geb || '') ? `${+geb.slice(0, 4) + 18}-${geb.slice(5, 7)}` : '');

// Soll eines Monats: je Art die jüngste Stufe mit „ab“ ≤ Monat. Eine Gesamt-Stufe gilt, wenn sie jünger ist als alle Teile.
function sollFuer(k) {
  const gilt = (art) => E.soll.filter((s) => s.art === art && /^\d{4}-\d{2}$/.test(s.ab) && s.ab <= k).sort((a, b) => (a.ab < b.ab ? 1 : -1))[0];
  const teile = ['tu', ...E.kinder.map((_, i) => `kind:${i}`)].map(gilt).filter(Boolean), ges = gilt('gesamt');
  const abTeile = teile.reduce((m, s) => (s.ab > m ? s.ab : m), '');
  if (ges && (!teile.length || ges.ab >= abTeile)) return ges.c;
  return teile.length ? teile.reduce((t, s) => t + s.c, 0) : null;
}

// ======================================================================= Rechnen
// Monatsraster: alle Buchungen mit Trennungs- oder Kindesunterhalt deiner Konten, ab dem ersten Monat bis zum Datenstand
function rasterDaten(H) {
  const D = H.D(), ok = eigen(H, D), kRe = kinderRe(H);
  const rows = D.rows.filter((r) => (r.ukat === TU || r.ukat === KU) && ok(r)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // Kindesunterhalt gehört nur dann zu einem Kind, wenn der Zweck genau dieses eine Kind nennt
  // Nach Beleg aufgeteilte Sammelbuchungen tragen den Anteil am Ende („… – Anteil Leo“): dieser Teil zählt zuerst
  const treffer = (z) => kRe.map((re, i) => (re && re.test(H.norm(z)) ? i : -1)).filter((i) => i >= 0);
  const zuKind = (r) => {
    for (const z of [r.z.includes(' – ') ? r.z.split(' – ').pop() : '', r.z]) { const hit = z ? treffer(z) : []; if (hit.length === 1) return hit[0]; }
    return -1;
  };
  // Fehlerprüfung: gleicher Zweck, aber unterschiedlich eingeordnet
  const gr = new Map();
  for (const r of rows) { const k = zweckKey(H, r.z); if (k) (gr.get(k) || gr.set(k, []).get(k)).push(r); }
  const uneins = [...gr.values()].filter((l) => new Set(l.map((r) => r.ukat)).size > 1);
  const uneinsIds = new Set(uneins.flat().map((r) => r.i));
  const letzteTu = rows.filter((r) => r.ukat === TU).at(-1);
  const R = { rows, uneins, monate: [], name: letzteTu?.g || '', nameGa: letzteTu?.ga || [], bisM: D.bis.slice(0, 7), laeuft: D.bis < monatsEnde(D.bis) };
  if (!rows.length) return R;
  const erster = rows[0].d.slice(0, 7), letzter = rows.at(-1).d.slice(0, 7) > R.bisM ? rows.at(-1).d.slice(0, 7) : R.bisM;
  const idx = new Map();
  for (let k = erster; k <= letzter; k = H.mVor(k, 1)) { const m = { k, tu: 0, kind: E.kinder.map(() => 0), na: 0, sum: 0, uneins: false, soll: sollFuer(k) }; idx.set(k, m); R.monate.push(m); }
  for (const r of rows) {
    const m = idx.get(r.d.slice(0, 7)), b = -r.c;   // gezahlt = positiv
    if (r.ukat === TU) m.tu += b;
    else { const i = zuKind(r); if (i >= 0) m.kind[i] += b; else m.na += b; }
    m.sum += b;
    if (uneinsIds.has(r.i)) m.uneins = true;
  }
  for (const m of R.monate) m.abw = m.soll == null ? null : m.sum - m.soll;
  return R;
}
const monatsEnde = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).toISOString().slice(0, 10);

// Ausgleich: Buchungen mit der Gegenseite der letzten Trennungsunterhalt-Zahlung (seit der ersten Unterhaltszahlung, ohne
// die Unterhaltsraten) und alle Buchungen mit deinen gewählten Tags
function ausgleichDaten(H, R = rasterDaten(H)) {
  const D = H.D(), ok = eigen(H, D), kRe = kinderRe(H);
  const namen = new Set([R.name, ...R.nameGa].map((n) => H.norm(n).trim()).filter(Boolean));
  const gegen = (r) => namen.size > 0 && (namen.has(H.norm(r.g).trim()) || (r.ga || []).some((g) => namen.has(H.norm(g).trim())));
  const tags = new Set(E.ausgleich.tags), seit = R.monate[0] ? `${R.monate[0].k}-01` : '';
  const tagsVon = (r) => String(r.t || '').split(',').map((t) => t.trim()).filter(Boolean);
  const hatTag = (r) => tags.size > 0 && tagsVon(r).some((t) => tags.has(t));
  const rows = D.rows.filter((r) => ok(r) && r.ukat !== TU && r.ukat !== KU && ((gegen(r) && r.d >= seit) || hatTag(r)))
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  // Gruppen nach fester Regel (Reihenfolge zählt). Buchungen nur über einen Tag sind immer Auslagen/Erstattungen.
  const gruppe = (r) => {
    const z = H.norm(r.z);
    if (!gegen(r)) return 'auslagen';
    if (r.ukat === 'Steuern' || /steuer|finanzamt|bescheid/.test(z)) return 'steuer';
    if (r.kat === 'Kinder' || kRe.some((re) => re && re.test(z))) return 'kinder';
    if (hatTag(r) || /auslage|erstatt|rueckzahl/.test(z)) return 'auslagen';
    return 'sonst';
  };
  const g = new Map(rows.map((r) => [r.i, gruppe(r)]));
  // „Anteil …“ an andere Gegenseiten: nur zur Info
  const info = name0(R) ? D.rows.filter((r) => ok(r) && !gegen(r) && r.d >= seit && /(^|[^a-z])anteil/.test(H.norm(r.z))).sort((a, b) => (a.d < b.d ? 1 : -1)) : [];
  // Alle Tags deiner Konten (für die Auswahl), häufigste zuerst
  const tagZahl = new Map();
  for (const r of D.rows) if (r.t && ok(r)) for (const t of tagsVon(r)) tagZahl.set(t, (tagZahl.get(t) || 0) + 1);
  return { name: R.name, gegen, rows, gruppe: (r) => g.get(r.i), info, seit, alleTags: [...tagZahl].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')), posten: postenDaten(H, R, gegen) };
}
const name0 = (R) => !!R.name;

// Offene Posten: Für jedes zusammen veranlagte Jahr mit Bescheid die Erstattung des Finanzamts suchen (0–45 Tage nach dem
// Bescheid, Betrag am nächsten an der Erstattung laut Bescheid). Fehlt eine Buchung an die Gegenseite, deren Zweck das Jahr
// und „Anteil/Erstatt/Steuer“ nennt, ist der Anteil offen. Die Höhe des Anteils ist deine Angabe – nie geschätzt.
function postenDaten(H, R, gegen) {
  const D = H.D(), so = D.j.steuer_offiziell, ok = eigen(H, D);
  if (!so?.jahre || typeof so.jahre !== 'object') return { fehlt: true, liste: [] };
  const fa = D.rows.filter((r) => ok(r) && r.c > 0 && r.ukat === 'Steuern' && [r.g, ...(r.ga || [])].some((x) => /finanzamt/i.test(x || '')));
  const liste = [];
  for (const [J, x] of Object.entries(so.jahre).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (x?.art !== 'Bescheid' || !/zusammen/i.test(x.veranlagung || '') || !/^\d{4}-\d{2}-\d{2}$/.test(x.datum || '')) continue;
    const soll = ct(x.ergebnis?.erstattung);
    if (soll <= 0) continue;
    const bis = plusTage(x.datum, 45);
    const er = fa.filter((r) => r.d >= x.datum && r.d <= bis).sort((a, b) => Math.abs(a.c - soll) - Math.abs(b.c - soll))[0];
    const key = `est-${J}`, st = E.ausgleich.posten[key] || {};
    if (!er) { liste.push({ key, J, er: null, soll, bez: [], offen: false }); continue; }
    const jr = new RegExp(`(^|\\D)${J}(\\D|$)`);
    const bez = R.name ? D.rows.filter((r) => ok(r) && r.c < 0 && gegen(r) && jr.test(r.z) && /anteil|erstatt|steuer/.test(H.norm(r.z))) : [];
    liste.push({ key, J, er, soll, bez, erledigt: !!st.erledigt, c: Number.isFinite(st.c) ? st.c : null, notiz: st.notiz || '', offen: !!R.name && !bez.length && !st.erledigt });
  }
  return { fehlt: false, liste };
}

// Einkommen für den Unterhalt: 12 geprüfte Abrechnungs-Monate am Stück (keine Plan-Monate), dazu Buchungen im Zeitraum
function einkommenDaten(H, R, A) {
  const D = H.D(), G = D.j.gehalt, ok = eigen(H, D);
  if (!G?.monate?.length) return { fehlt: 'Keine Gehaltsabrechnungen in den Daten.' };
  const gm = new Map(G.monate.filter((m) => m.geprueft === true && m.quelle !== 'plan').map((m) => [m.m, m]));
  const enden = [...gm.keys()].sort().filter((k) => { for (let i = 1; i < 12; i++) if (!gm.has(H.mVor(k, -i))) return false; return true; }).reverse();
  if (!enden.length) return { fehlt: 'Noch keine 12 geprüften Abrechnungs-Monate am Stück – Plan-Monate zählen nicht.' };
  const e = enden.includes(ende) ? ende : enden[0];
  const ms = Array.from({ length: 12 }, (_, i) => H.mVor(e, i - 11)), ab = ms.map((k) => gm.get(k));
  const inZr = (r) => r.d.slice(0, 7) >= ms[0] && r.d.slice(0, 7) <= e;
  const summe = (l) => l.reduce((t, r) => t + r.c, 0);
  const p = Math.max(0, +E.bavProzent || 0);
  const x = {
    enden, e, ms, ab, p,
    netto: ab.reduce((t, m) => t + ct(m.netto_verdienst), 0), nettoFehlt: ab.filter((m) => m.netto_verdienst == null).map((m) => m.m),
    erst: summe(D.rows.filter((r) => ok(r) && r.c > 0 && inZr(r) && [r.g, ...(r.ga || [])].some((g) => /finanzamt/i.test(g || '')))),
    anteile: -summe(A.rows.filter((r) => r.c < 0 && inZr(r) && A.gegen(r) && A.gruppe(r) === 'steuer')),
    ku: -summe(R.rows.filter((r) => r.ukat === KU && inZr(r))),
    bav: ab.reduce((t, m) => t + ct(m.bav_an), 0),
    bavAnerk: ab.reduce((t, m) => t + Math.min(ct(m.bav_an), Math.round((ct(m.brutto) * p) / 100)), 0),
    gwv: ab.reduce((t, m) => t + ct(m.privatfahrten) + ct(m.whg_arbeit), 0),
    anlagen: ab.map((m) => ({ k: m.m, datei: m.datei || '' })),
  };
  x.summe = x.netto + x.erst - x.anteile - x.ku;
  x.ueber = x.bav - x.bavAnerk;
  return x;
}

// ======================================================================= Fristen (für Übersicht/Termine)
export function unterhaltFristen(H) {
  if (!H.D()) return [];
  vorgabe(H);
  const R = rasterDaten(H), A = ausgleichDaten(H, R);
  return A.posten.liste.filter((p) => p.offen).map((p) => ({
    key: p.key, am: p.er.d, titel: `Anteil an der Steuererstattung ${p.J} an ${A.name} offen (Erstattung ${H.eur(p.er.c)} am ${H.dde(p.er.d)})`,
    ziel: { tab: 'fix', fixtab: 'unterhalt' }, art: 'aus den Daten',
  }));
}

// ======================================================================= Anzeige
export function unterhaltSeite(H) {
  if (!H.D()) return '';
  vorgabe(H);
  const R = rasterDaten(H), A = ausgleichDaten(H, R), X = einkommenDaten(H, R, A);
  const fh = (H.D().j.familie?.hinweise || []).map((t) => `<p class="uh-hinweis">⚠ ${H.esc(t)}</p>`).join('');
  return `${fh}<div class="uh"><div class="uh-r1">${karteMonate(H, R)}${karteAngaben(H, A)}</div><div class="uh-r3">${rechnerKarte(H, R, E.kinder)}</div><div class="uh-r2">${karteAusgleich(H, R, A)}${karteEinkommen(H, R, A, X)}</div></div>`;
}

const nurDruck = (H) => `<p class="uh-nur-druck">Daten bis ${H.dde(H.D().bis)} · erstellt am ${H.dde(heute())} · aus den Buchungen deiner Konten (ohne Kinder- und Gemeinschaftskonten)</p>`;
const zuAngaben = (t) => `<span class="zl" role="button" tabindex="0" data-springe="#uh-angaben" title="Anklicken: zu deinen Angaben">${t}</span>`;

// ---------------------------------------------------------------- Karte A: Monat für Monat
function karteMonate(H, R) {
  const titel = 'Unterhalt Monat für Monat';
  if (!R.rows.length) return H.karte5(titel, 'Gezahlt laut Buchungen deiner Konten', '<p class="muted">Auf deinen Konten gibt es keine Buchungen mit Trennungs- oder Kindesunterhalt.</p>', 'uh-a', '', 'uh-a');
  const mitSoll = E.soll.length > 0, kz = E.kinder.length;
  const zb = (x) => H.zuBuchungen({ konto: '', ...x });
  const zelle = (c, ziel) => (c ? H.zl(bet(H, c), ziel) : strich);
  const abwZelle = (m) => {
    if (m.abw == null) return strich;
    if (Math.abs(m.abw) <= 100) return '<span class="muted">passt</span>';
    if (m.k === R.bisM && R.laeuft && m.abw < 0) return `<span class="muted" title="Der Monat läuft noch – die Zahlung kann noch kommen">${H.eur(Math.abs(m.abw))} offen</span>`;
    return `<b class="neg" title="Abweichung über 1 €">${m.abw > 0 ? '+' : '−'}${H.eur(Math.abs(m.abw))}</b>`;
  };
  const warn = (m) => (m.uneins ? '<span class="uh-warn" title="Enthält eine Zahlung, die anderswo anders eingeordnet ist">!</span>' : '');
  const teile = (m) => [
    [TU, m.tu, zb({ ukat: TU, ...H.monatZiel(m.k) })],
    ...m.kind.map((c, i) => [`${KU} ${H.esc(kindName(i))}`, c, zb({ ukat: KU, q: `"${kindName(i)}"`, ...H.monatZiel(m.k) })]),
    [`${KU} nicht aufgeteilt`, m.na, zb({ ukat: KU, ...H.monatZiel(m.k) })],
  ];
  const sumZiel = (m) => zb({ q: R.name ? `"${R.name}"` : '', ...H.monatZiel(m.k) });
  const S = { tu: 0, kind: E.kinder.map(() => 0), na: 0, sum: 0, soll: 0, abw: 0 };
  for (const m of R.monate) { S.tu += m.tu; m.kind.forEach((c, i) => (S.kind[i] += c)); S.na += m.na; S.sum += m.sum; if (m.soll != null) { S.soll += m.soll; S.abw += m.abw; } }
  const kopfKind = (k, i) => { const v = volljaehrig(k.geb); return `<th class="r">${H.esc(kindName(i))}${v ? `<small>18 ab ${H.monKurz(v)}</small>` : ''}</th>`; };
  const tabelle = `<table class="t uh-tab"><thead><tr><th>Monat</th><th class="r">Trennungs&shy;unterhalt</th>${E.kinder.map(kopfKind).join('')}<th class="r">nicht aufgeteilt</th><th class="r">Summe</th>${mitSoll ? '<th class="r" title="laut deinen Angaben (Vereinbarung/Titel)">Soll</th><th class="r">Abweichung</th>' : ''}</tr></thead>
    <tbody>${R.monate.map((m) => `<tr><td>${H.monLang(m.k)}${warn(m)}</td><td class="r">${zelle(m.tu, teile(m)[0][2])}</td>${m.kind.map((c, i) => `<td class="r">${zelle(c, teile(m)[i + 1][2])}</td>`).join('')}<td class="r">${zelle(m.na, teile(m)[kz + 1][2])}</td><td class="r"><b>${zelle(m.sum, sumZiel(m))}</b></td>${mitSoll ? `<td class="r">${m.soll == null ? strich : H.eur(m.soll)}</td><td class="r">${abwZelle(m)}</td>` : ''}</tr>`).join('')}</tbody>
    <tfoot><tr><td>Summe</td><td class="r">${bet(H, S.tu)}</td>${S.kind.map((c) => `<td class="r">${bet(H, c)}</td>`).join('')}<td class="r">${bet(H, S.na)}</td><td class="r">${bet(H, S.sum)}</td>${mitSoll ? `<td class="r">${H.eur(S.soll)}</td><td class="r">${Math.abs(S.abw) <= 100 ? '<span class="muted">passt</span>' : `<b class="neg">${S.abw > 0 ? '+' : '−'}${H.eur(Math.abs(S.abw))}</b>`}</td>` : ''}</tr></tfoot></table>`;
  // am Handy: eine Liste je Monat (Kopf: Monat · Summe, darunter die Teile)
  const liste = `<div class="uh-liste">${R.monate.map((m) => `<div class="uh-lm"><div class="uh-lm-k"><span>${H.monLang(m.k)}${warn(m)}</span><b>${zelle(m.sum, sumZiel(m))}</b></div>
    <div class="uh-lm-t">${teile(m).filter(([, c]) => c).map(([t, c, z]) => `<span>${t}</span><span>${H.zl(bet(H, c), z)}</span>`).join('')}${mitSoll ? `<span>Soll</span><span>${m.soll == null ? strich : H.eur(m.soll)}</span><span>Abweichung</span><span>${abwZelle(m)}</span>` : ''}</div></div>`).join('')}</div>`;
  const hinweise = [
    ...R.uneins.map((l) => {
      const n = new Map(); for (const r of l) n.set(r.ukat, (n.get(r.ukat) || 0) + 1);
      return `<div class="uh-warnung"><span>„${H.esc(l[0].z.slice(0, 80))}“: gleiche Zahlung, unterschiedlich eingeordnet (${l.length}×) – ${[...n].map(([u, z]) => `${z}× ${H.esc(u)}`).join(', ')}</span>
        <button class="btn sm uh-nicht-drucken"${H.geh({ tab: 'uebersicht', kart: 'pruefen', wahl: H.gruppenSchluessel(l[0]) })}>einheitlich zuordnen</button></div>`;
    }),
    !kz && S.na ? `<p class="s5-tipp uh-nicht-drucken">Trag unter ${zuAngaben('„Deine Angaben“')} deine Kinder ein – bis dahin steht aller Kindesunterhalt unter „nicht aufgeteilt“.</p>` : '',
    !mitSoll ? `<p class="s5-tipp uh-nicht-drucken">Trag die Beträge laut Vereinbarung/Titel ein (${zuAngaben('Soll-Stufen')}) – dann siehst du je Monat die Abweichung.</p>` : '',
  ].join('');
  const grundlagen = mitSoll ? `<div class="uh-grund"><b>Soll laut deinen Angaben:</b> ${[...E.soll].sort((a, b) => (a.ab < b.ab ? -1 : 1)).map((s) => `ab ${/^\d{4}-\d{2}$/.test(s.ab) ? H.monKurz(s.ab) : '?'} ${H.esc(artName(s.art))} ${H.eur(s.c)}${s.grundlage ? ` (${H.esc(s.grundlage)})` : ''}`).join(' · ')}</div>` : '';
  const erkl = `Gezahlt laut Buchungen deiner Konten (Unterkategorie Trennungs- bzw. Kindesunterhalt)${R.name ? ` an ${H.esc(R.name)}` : ''}. Ein Kind bekommt einen Betrag nur, wenn der Verwendungszweck genau dieses Kind nennt – sonst „nicht aufgeteilt“, nie geschätzt.${mitSoll ? ' Abweichung = gezahlt − Soll, ab 1 € rot.' : ''} Betrag anklicken: Buchungen.`;
  const rechts = '<span class="uh-knoepfe uh-nicht-drucken"><button class="btn sm" data-uh-excel>Excel</button><button class="btn sm" data-uh-druck="uh-a">Drucken/PDF</button></span>';
  return H.karte5(titel, erkl, `${nurDruck(H)}${hinweise}<div class="uh-tabw">${tabelle}${liste}</div>${grundlagen}`, 'uh-a', rechts, 'uh-a');
}

// ---------------------------------------------------------------- Einstellungen: Deine Angaben
function karteAngaben(H, A) {
  const kinderH = E.kinder.map((k, i) => `<div class="uh-kind-z"><input type="text" data-uh-kind="${i}" data-f="name" value="${H.esc(k.name)}" placeholder="Vorname" aria-label="Vorname">
    <input type="date" data-uh-kind="${i}" data-f="geb" value="${H.esc(k.geb)}" aria-label="Geburtsdatum"><button class="uh-x" data-uh-kind-weg="${i}" title="Kind entfernen" aria-label="Kind entfernen">×</button></div>`).join('');
  const arten = [['tu', TU], ...E.kinder.map((_, i) => [`kind:${i}`, `${KU} ${kindName(i)}`]), ['gesamt', 'Unterhalt gesamt']];
  const sollH = E.soll.map((s, i) => `<div class="uh-soll-z"><input type="month" class="uh-s-ab" data-uh-soll="${i}" data-f="ab" value="${H.esc(s.ab)}" placeholder="JJJJ-MM" aria-label="gültig ab">
    <select class="uh-s-art" data-uh-soll="${i}" data-f="art" aria-label="Art">${arten.map(([v, t]) => `<option value="${v}"${s.art === v ? ' selected' : ''}>${H.esc(t)}</option>`).join('')}</select>
    <label class="uh-s-c"><input type="number" data-uh-soll="${i}" data-f="c" min="0" step="0.01" inputmode="decimal" value="${s.c ? (s.c / 100).toFixed(2) : ''}" aria-label="Betrag im Monat"> €</label>
    <input type="text" class="uh-s-gr" data-uh-soll="${i}" data-f="grundlage" value="${H.esc(s.grundlage)}" placeholder="Grundlage, z. B. Vergleich vom …" aria-label="Grundlage">
    <button class="uh-x uh-s-x" data-uh-soll-weg="${i}" title="Stufe entfernen" aria-label="Stufe entfernen">×</button></div>`).join('');
  const tags = A.alleTags.length ? `<div class="uh-tags">${A.alleTags.map(([t, n]) => `<label class="uh-tag"><input type="checkbox" data-uh-tag="${H.esc(t)}"${E.ausgleich.tags.includes(t) ? ' checked' : ''}>${H.esc(t)} <small>${n}</small></label>`).join('')}</div>`
    : '<p class="muted uh-klein">In deinen Buchungen gibt es keine Tags.</p>';
  const inhalt = `<div class="s5-teil"><h3>Kinder</h3><div class="uh-ein">${kinderH || '<p class="muted uh-klein">Noch keine Kinder eingetragen.</p>'}</div><button class="link" data-uh-kind-neu>+ Kind</button></div>
    <div class="s5-teil"><h3>Soll laut Vereinbarung/Titel</h3><div class="uh-ein">${sollH || '<p class="muted uh-klein">Noch keine Soll-Stufen. Je Stufe: gültig ab, wofür, Betrag im Monat und Grundlage.</p>'}</div><button class="link" data-uh-soll-neu>+ Soll-Stufe</button></div>
    <div class="s5-teil"><h3>Tags für den Ausgleich</h3>${tags}</div>
    <div class="s5-teil"><h3>bAV-Grenze <span class="uh-orient">Orientierung</span></h3><label class="uh-bav"><input type="number" data-uh-bav min="0" max="100" step="0.5" inputmode="decimal" value="${E.bavProzent}"> % vom Brutto werden als Altersvorsorge anerkannt</label></div>
    <p class="muted uh-klein uh-fuss">Deine Angaben bleiben nur in diesem Browser und gehen nicht in die Daten-Datei.</p>`;
  return H.karte5('Deine Angaben', 'Für Unterhalt, Ausgleich und Einkommen', inhalt, 'uh-angaben', '', 'uh-angaben');
}

// ---------------------------------------------------------------- Karte B: Ausgleich
const GRUPPEN = [['steuer', 'Steueranteile'], ['kinder', 'Sonderbedarf Kinder'], ['auslagen', 'Auslagen/Erstattungen'], ['sonst', 'Sonstiges']];
function karteAusgleich(H, R, A) {
  const titel = A.name ? `Ausgleich mit ${H.esc(A.name)}` : 'Ausgleich';
  const zeile = (r, mitName = false) => `<button class="uh-bz"${H.geh(H.zuBuchungen({ konto: '', q: r.g ? `"${r.g}"` : '', ...H.monatZiel(r.d.slice(0, 7)) }))} title="Anklicken: Buchung">
    <span class="uh-bz-d">${H.dde(r.d)}</span><span class="uh-bz-t">${H.esc(mitName || !A.gegen(r) ? `${r.g || '–'} · ${r.z || ''}` : r.z || r.g || '–')}</span><b>${vz(H, r.c)}</b></button>`;
  // offene Posten
  const P = A.posten;
  let posten = '';
  if (!A.name) posten = '<p class="muted uh-klein">Gegenseite nicht erkennbar – es gibt keine Buchung mit Trennungsunterhalt. Offene Steueranteile lassen sich so nicht prüfen.</p>';
  else if (P.fehlt) posten = '<p class="muted uh-klein">Die Steuerbescheide fehlen in den Daten – offene Steueranteile lassen sich nicht prüfen.</p>';
  else if (!P.liste.length) posten = '<p class="muted uh-klein">Kein Jahr mit Zusammenveranlagung und Erstattung laut Bescheid.</p>';
  else posten = P.liste.map((p) => {
    if (!p.er) return `<div class="uh-po erl"><span class="uh-po-t">${p.J}: Erstattung laut Bescheid ${H.eur(p.soll)} – noch nicht gebucht.</span></div>`;
    const erst = `Erstattung ${H.zl(H.eur(p.er.c), H.zuBuchungen({ konto: '', q: '"Finanzamt"', ...H.monatZiel(p.er.d.slice(0, 7)) }))} am ${H.dde(p.er.d)}`;
    if (p.bez.length) return `<div class="uh-po erl"><span class="uh-po-t">${p.J}: Anteil gezahlt – ${p.bez.map((r) => `${H.zl(H.eur(-r.c), H.zuBuchungen({ konto: '', q: `"${r.g}"`, ...H.monatZiel(r.d.slice(0, 7)) }))} am ${H.dde(r.d)}`).join(', ')} (${erst})</span></div>`;
    return `<div class="uh-po${p.erledigt ? ' erl' : ''}"><span class="uh-po-t">${p.erledigt ? `${p.J}: als erledigt markiert` : `<b class="neg">offen:</b> Anteil Erstattung ${p.J}`} (${erst})</span>
      <label class="uh-po-c">Anteil <input type="number" data-uh-posten="${p.key}" data-f="c" min="0" step="0.01" inputmode="decimal" value="${p.c != null ? (p.c / 100).toFixed(2) : ''}" placeholder="deine Angabe"> €</label>
      <label class="uh-po-e"><input type="checkbox" data-uh-posten="${p.key}" data-f="erledigt"${p.erledigt ? ' checked' : ''}> erledigt</label>
      <input type="text" class="uh-po-n" data-uh-posten="${p.key}" data-f="notiz" value="${H.esc(p.notiz)}" placeholder="Notiz" aria-label="Notiz"></div>`;
  }).join('');
  const offen = P.liste.filter((p) => p.offen);
  // Gruppen mit Saldo
  const gesamt = A.rows.reduce((t, r) => t + r.c, 0);
  const gruppen = A.rows.length ? `${GRUPPEN.map(([k, t]) => {
    const l = A.rows.filter((r) => A.gruppe(r) === k);
    if (!l.length) return '';
    const s = l.reduce((x, r) => x + r.c, 0);
    return `<details class="uh-gr"><summary><span>${t} <small>${l.length} ${l.length === 1 ? 'Buchung' : 'Buchungen'}</small></span><b>${vz(H, s)}</b></summary><div class="uh-bl">${l.map((r) => zeile(r)).join('')}</div></details>`;
  }).join('')}<div class="uh-gr uh-gr-s"><span>Saldo</span><b>${vz(H, gesamt)}</b></div>` : '<p class="muted uh-klein">Keine Buchungen für den Ausgleich.</p>';
  const info = A.info.length ? `<details class="uh-info"><summary>Nur zur Info: „Anteil …“ an andere (${A.info.length})</summary><div class="uh-bl">${A.info.slice(0, 40).map((r) => zeile(r, true)).join('')}</div><p class="muted uh-klein">Ohne Summe – gehört nicht zum Ausgleich.</p></details>` : '';
  const tagText = E.ausgleich.tags.length ? ` und alle Buchungen mit ${E.ausgleich.tags.length === 1 ? 'dem Tag' : 'den Tags'} ${E.ausgleich.tags.map((t) => `„${H.esc(t)}“`).join(', ')}` : '';
  const erkl = A.name ? `Buchungen mit ${H.esc(A.name)} seit ${H.monLang(A.seit.slice(0, 7))} (erste Unterhaltszahlung), ohne die Unterhaltsraten${tagText}. Plus = an dich, minus = von dir.${E.ausgleich.tags.length ? '' : ` Tags für Auslagen wählst du unter ${zuAngaben('„Deine Angaben“')}.`}`
    : `Gegenseite nicht erkennbar (keine Buchung mit Trennungsunterhalt).${E.ausgleich.tags.length ? ' Gezeigt werden nur die Buchungen mit deinen Tags.' : ''}`;
  const rechts = offen.length ? '<button class="btn sm" data-uh-csv>Offene Posten (CSV)</button>' : '';
  return H.karte5(titel, erkl, `<div class="s5-teil"><h3>Offene Posten <small class="muted">Steueranteile nach fester Regel</small></h3><div class="uh-ein">${posten}</div></div>
    <div class="s5-teil"><h3>Gruppen</h3>${gruppen}</div>${info}`, 'uh-b', rechts, 'uh-b');
}

// ---------------------------------------------------------------- Karte C: Einkommen 12 Monate
function karteEinkommen(H, R, A, X) {
  const titel = 'Einkommen für den Unterhalt (12 Monate)';
  const fuss = '<p class="uh-fuss muted uh-klein">Unterhaltsrechtliche Bewertung ist eine Rechtsfrage – Orientierung.</p>';
  if (X.fehlt) return H.karte5(titel, 'Belegte Aufstellung aus Abrechnungen und Buchungen', `<p class="muted">${X.fehlt}</p>${fuss}`, 'uh-c', '', 'uh-c');
  const zt = H.zeitZiel(X.ms);
  const zeile = (t, quelle, c, ziel, cls = '') => `<div class="uh-ez ${cls}"><span>${t}<small>${quelle}</small></span><b>${ziel ? H.zl(vz(H, c), ziel) : vz(H, c)}</b></div>`;
  const wahl = `<label class="uh-ende uh-nicht-drucken">bis <select data-uh-ende aria-label="letzter Monat">${X.enden.map((k) => `<option value="${k}"${k === X.e ? ' selected' : ''}>${H.monKurz(k)}</option>`).join('')}</select></label>`;
  const rechts = `${wahl}<button class="btn sm uh-nicht-drucken" data-uh-druck="uh-c">Drucken/PDF</button>`;
  const name = A.name || 'die Gegenseite';
  const inhalt = `${nurDruck(H)}<p class="uh-zr">${H.monLang(X.ms[0])} bis ${H.monLang(X.e)} · 12 geprüfte Abrechnungen</p>
    <div class="uh-el">
      ${zeile('Netto-Verdienst', `Summe laut 12 Abrechnungen${X.nettoFehlt.length ? ` – fehlt in ${X.nettoFehlt.map(H.monKurz).join(', ')}` : ''}`, X.netto, { tab: 'gehalt' })}
      ${zeile('+ Steuererstattungen', 'Finanzamt, gebucht im Zeitraum', X.erst, H.zuBuchungen({ konto: '', q: '"Finanzamt"', art: 'ein', ...zt }))}
      ${zeile(`− Anteile an ${H.esc(name)}`, 'Steueranteile laut Buchungen', -X.anteile, A.name ? H.zuBuchungen({ konto: '', q: `"${A.name}"`, ...zt }) : null)}
      ${zeile('− Kindesunterhalt gezahlt', 'laut Buchungen', -X.ku, H.zuBuchungen({ konto: '', ukat: KU, ...zt }))}
      ${zeile('= Summe', 'belegt', X.summe, null, 'uh-summe')}
      ${zeile('÷ 12 = je Monat', 'berechnet', Math.round(X.summe / 12), null, 'uh-summe')}
    </div>
    <div class="s5-teil"><h3>Getrennt ausgewiesen</h3><div class="uh-el">
      ${zeile('bAV-Entgeltumwandlung', 'Summe laut Abrechnungen, im Netto schon abgezogen', X.bav, null, 'uh-info-z')}
      ${zeile(`davon bis ${H.NUM.format(X.p)} % vom Brutto <span class="uh-orient">Orientierung</span>`, 'je Monat höchstens dieser Anteil, Regelwert aus deinen Angaben', X.bavAnerk, null, 'uh-info-z')}
      ${X.ueber > 0 ? zeile(`Summe mit bAV-Grenze <span class="uh-orient">Orientierung</span>`, `+ ${H.eur(X.ueber)} über der Grenze · je Monat ${H.eur(Math.round((X.summe + X.ueber) / 12))}`, X.summe + X.ueber, null, 'uh-info-z') : ''}
      ${zeile('Geldwerter Vorteil Dienstwagen', 'Privatfahrten + Weg zur Arbeit laut Abrechnungen – nur zur Info, nicht ausgezahlt', X.gwv, null, 'uh-info-z')}
    </div></div>
    <details class="uh-anlagen"><summary>Anlagen: ${X.anlagen.filter((a) => a.datei).length} Abrechnungen</summary><ol>${X.anlagen.map((a) => `<li>${H.monKurz(a.k)} – ${a.datei ? H.esc(a.datei) : '<span class="muted">keine Datei</span>'}</li>`).join('')}</ol></details>
    ${fuss}`;
  return H.karte5(titel, 'Jede Zeile mit Quelle. Nur geprüfte Abrechnungen, keine Plan-Monate.', inhalt, 'uh-c', rechts, 'uh-c');
}

// ======================================================================= Klicks, Eingaben, Export
export function unterhaltBinden(el, H) {
  const box = el.querySelector('.uh');
  if (!box) return;
  H.gehBinden(box);
  rechnerBinden(box, () => H.neuZeichnen(), (t) => H.toast(t));
  const sichern = async () => {
    try { await H.kvSchreiben('unterhalt', zumSpeichern()); } catch { H.toast('Deine Angaben konnten nicht gespeichert werden.'); }
    H.neuZeichnen();
  };
  const euro = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
  box.querySelectorAll('[data-uh-druck]').forEach((b) => b.onclick = () => drucken(box.querySelector(`#${b.dataset.uhDruck}`)));
  box.querySelectorAll('[data-uh-excel]').forEach((b) => b.onclick = () => excelMonate(H));
  box.querySelectorAll('[data-uh-csv]').forEach((b) => b.onclick = () => csvPosten(H));
  box.querySelectorAll('[data-uh-ende]').forEach((s) => s.onchange = () => { ende = s.value; H.neuZeichnen(); });
  // Kinder
  box.querySelectorAll('[data-uh-kind]').forEach((i) => i.onchange = () => { const k = E.kinder[+i.dataset.uhKind]; if (!k) return; k[i.dataset.f] = i.value.trim(); E.eigeneKinder = true; sichern(); });
  box.querySelectorAll('[data-uh-kind-neu]').forEach((b) => b.onclick = () => {
    E.kinder.push({ name: '', geb: '', status: '' }); E.eigeneKinder = true; sichern();
    setTimeout(() => document.querySelector(`[data-uh-kind="${E.kinder.length - 1}"][data-f="name"]`)?.focus(), 60);
  });
  box.querySelectorAll('[data-uh-kind-weg]').forEach((b) => b.onclick = () => {
    const i = +b.dataset.uhKindWeg;
    if (!confirm(`${kindName(i)} entfernen? Soll-Stufen für dieses Kind werden mit entfernt.`)) return;
    E.kinder.splice(i, 1);
    E.soll = E.soll.filter((s) => s.art !== `kind:${i}`).map((s) => { const m = /^kind:(\d+)$/.exec(s.art); return m && +m[1] > i ? { ...s, art: `kind:${+m[1] - 1}` } : s; });
    E.eigeneKinder = true; E.eigeneSoll = true;
    sichern();
  });
  // Soll-Stufen
  box.querySelectorAll('[data-uh-soll]').forEach((i) => i.onchange = () => {
    const s = E.soll[+i.dataset.uhSoll]; if (!s) return;
    if (i.dataset.f === 'c') s.c = euro(i.value) ?? 0;
    else if (i.dataset.f === 'ab') { const v = i.value.trim(); if (v && !/^\d{4}-\d{2}$/.test(v)) { H.toast('Bitte als JJJJ-MM eingeben, z. B. 2026-02.'); return; } s.ab = v; }
    else s[i.dataset.f] = i.value.trim();
    E.eigeneSoll = true;
    sichern();
  });
  box.querySelectorAll('[data-uh-soll-neu]').forEach((b) => b.onclick = () => { E.soll.push({ ab: H.D().bis.slice(0, 7), art: 'tu', c: 0, grundlage: '' }); E.eigeneSoll = true; sichern(); });
  box.querySelectorAll('[data-uh-soll-weg]').forEach((b) => b.onclick = () => { E.soll.splice(+b.dataset.uhSollWeg, 1); E.eigeneSoll = true; sichern(); });
  // Tags, bAV
  box.querySelectorAll('[data-uh-tag]').forEach((c) => c.onchange = () => {
    const t = c.dataset.uhTag, l = E.ausgleich.tags.filter((x) => x !== t);
    E.ausgleich.tags = c.checked ? [...l, t] : l; sichern();
  });
  box.querySelectorAll('[data-uh-bav]').forEach((i) => i.onchange = () => {
    const n = parseFloat(String(i.value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) { H.toast('Bitte einen Wert zwischen 0 und 100 eingeben.'); return; }
    E.bavProzent = n; sichern();
  });
  // Offene Posten: Höhe (deine Angabe), erledigt, Notiz
  box.querySelectorAll('[data-uh-posten]').forEach((i) => i.onchange = () => {
    const p = E.ausgleich.posten[i.dataset.uhPosten] || (E.ausgleich.posten[i.dataset.uhPosten] = {});
    if (i.dataset.f === 'erledigt') p.erledigt = i.checked;
    else if (i.dataset.f === 'c') p.c = i.value.trim() === '' ? null : euro(i.value);
    else p.notiz = i.value.trim();
    sichern();
  });
}

// Drucken: nur die eine Karte (body.uh-druck, Druckregeln in unterhalt.css)
function drucken(karte) {
  if (!karte) return;
  const pfad = [];
  for (let e = karte.parentElement; e && e !== document.body; e = e.parentElement) { e.classList.add('uh-pfad'); pfad.push(e); }
  const offen = [...karte.querySelectorAll('details:not([open])')];
  offen.forEach((d) => (d.open = true));
  karte.classList.add('uh-druckziel');
  document.body.classList.add('uh-druck');
  const weg = () => {
    document.body.classList.remove('uh-druck'); karte.classList.remove('uh-druckziel');
    pfad.forEach((e) => e.classList.remove('uh-pfad')); offen.forEach((d) => (d.open = false));
    window.removeEventListener('afterprint', weg);
  };
  window.addEventListener('afterprint', weg);
  window.print();
}

async function excelMonate(H) {
  const R = rasterDaten(H), mitSoll = E.soll.length > 0, e = (c) => c / 100;
  const spalten = [{ titel: 'Monat', typ: 'text', breite: 16 }, { titel: TU, typ: 'euro', breite: 18 },
    ...E.kinder.map((_, i) => ({ titel: `${KU} ${kindName(i)}`, typ: 'euro', breite: 18 })), { titel: `${KU} nicht aufgeteilt`, typ: 'euro', breite: 20 }, { titel: 'Summe', typ: 'euro' },
    ...(mitSoll ? [{ titel: 'Soll', typ: 'euro' }, { titel: 'Abweichung', typ: 'euro' }] : [])];
  const zeilen = R.monate.map((m) => [H.monLang(m.k), e(m.tu), ...m.kind.map(e), e(m.na), e(m.sum), ...(mitSoll ? [m.soll == null ? '' : e(m.soll), m.abw == null ? '' : e(m.abw)] : [])]);
  const s = (f) => R.monate.reduce((t, m) => t + (f(m) ?? 0), 0);
  zeilen.push(['Summe', e(s((m) => m.tu)), ...E.kinder.map((_, i) => e(s((m) => m.kind[i]))), e(s((m) => m.na)), e(s((m) => m.sum)), ...(mitSoll ? [e(s((m) => m.soll)), e(s((m) => m.abw))] : [])]);
  try { await H.alsExcel(`Unterhalt-${H.D().bis}`, 'Unterhalt', spalten, zeilen); } catch (err) { H.toast(err.message || 'Excel-Export ging nicht.'); }
}

function csvPosten(H) {
  const R = rasterDaten(H), A = ausgleichDaten(H, R), l = A.posten.liste.filter((p) => p.offen);
  if (!l.length) { H.toast('Keine offenen Posten.'); return; }
  H.alsCsv(`Ausgleich-offene-Posten-${H.D().bis}`,
    [{ titel: 'Posten', typ: 'text' }, { titel: 'An', typ: 'text' }, { titel: 'Erstattung am', typ: 'datum' }, { titel: 'Erstattung', typ: 'euro' }, { titel: 'Anteil (deine Angabe)', typ: 'euro' }, { titel: 'Notiz', typ: 'text' }],
    l.map((p) => [`Anteil Erstattung ${p.J}`, A.name, p.er.d, p.er.c / 100, p.c != null ? p.c / 100 : '', p.notiz]));
}

// nur für Tests (Node): Rechenteile ohne Oberfläche
export const _test = { rasterDaten, ausgleichDaten, einkommenDaten, sollFuer, zweckKey, setzeAngaben: (a) => { E = { ...leer(), ...a, ausgleich: { tags: [], posten: {}, ...(a.ausgleich || {}) } }; }, setzeEnde: (k) => { ende = k; } };
