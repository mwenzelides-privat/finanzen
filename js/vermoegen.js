// Vermögen und Reisen (Ideen 8 und 9)
//   Reiter Konten:     „Depot und Sparpläne“ (aus D.j.depot) und „Vermögen“ (Konten + Depot + Mietkaution + Vorsorge,
//                      jede Zeile mit Stichtag und Kennzeichnung, getrennt von den Kontosummen)
//   Reiter Kategorien: Ansicht „Reisen“ (S.kart = 'tags') aus den Finanzguru-Tags
// Keine Imports: alle Helfer kommen als H aus app.js. Geld immer in Cent, Datum ISO.
// Kinder- und Gemeinschaftskonten zählen in keiner Summe; Kurswerte nur aus einer Depot-Datei, nie geschätzt.

// ======================================================================= Eigene Eingaben
// IndexedDB 'vermoegen': { kaution: { c, am, notiz }, reisenAus: [Tag] }
let E = { kaution: null, reisenAus: [] };
export async function vermoegenLaden(H) {
  const v = await H.kvLesen('vermoegen');
  E = { kaution: v?.kaution?.c > 0 ? v.kaution : null, reisenAus: Array.isArray(v?.reisenAus) ? v.reisenAus : [] };
}
async function speichern(H) {
  try { await H.kvSchreiben('vermoegen', E); } catch { /* ohne Speicher gilt die Eingabe bis zum Neuladen */ }
  H.neuZeichnen();
}

// ---------------------------------------------------------------- kleine Helfer
const summe = (a, f) => a.reduce((t, x) => t + f(x), 0);
const tageZw = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
// Betrag mit Minus rot; pm mit Vorzeichen (für Differenzen und Gewinne)
const betrag = (H, c) => `<span class="${c < 0 ? 'neg' : ''}">${c < 0 ? '−' : ''}${H.eur0(Math.abs(c))}</span>`;
const pm = (H, c) => `<span class="${c < 0 ? 'neg' : ''}">${c >= 0 ? '+' : '−'}${H.eur0(Math.abs(c))}</span>`;
// Datum vor 12 Monaten (für „alter Stand“)
const vorJahr = (H, iso) => H.mVor(iso.slice(0, 7), -12) + iso.slice(7);
// „1.234,56“ / „1234“ → Cent
const centAus = (s) => { const v = parseFloat(String(s || '').replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? Math.round(v * 100) : null; };

// ======================================================================= Depot (Idee 8)
// Rechnet nur, was die Pipeline gebucht hat: eingezahlt, entnommen, Einstand (Durchschnittsmethode, berechnet).
// Kurswerte und Gewinne nur aus depot.kurse (Depot-Datei im Eingang).
export function depot(H) {
  const D = H.D(), dep = D.j.depot;
  if (!dep || !dep.papiere?.length) return null;
  const kurse = dep.kurse?.werte ? dep.kurse : null, kw = new Map((kurse?.werte || []).map((w) => [w.isin, w]));
  const papiere = dep.papiere.map((p) => {
    const k = kw.get(p.isin) || null, netto = (p.eingezahlt || 0) - (p.entnommen || 0);
    return { ...p, name: p.name || p.isin, netto, basis: p.einstand ?? netto, kurs: k,
      gewinn: k && p.einstand != null ? k.kurswert - p.einstand : null };
  });
  // Papiere aus der Depot-Datei ohne eine einzige Buchung (z. B. vor Beginn der Daten gekauft)
  const bekannt = new Set(papiere.map((p) => p.isin)), nurKurs = (kurse?.werte || []).filter((w) => !bekannt.has(w.isin));
  // Depot fürs Vermögen: Kurswert, wo die Depot-Datei einen hat, sonst Einstand bzw. netto eingezahlt (berechnet)
  let wert = 0, ausKurs = 0, berechnet = 0;
  for (const p of papiere) {
    if (p.kurs) { wert += p.kurs.kurswert; ausKurs++; } else if (p.basis) { wert += p.basis; berechnet++; }
  }
  for (const w of nurKurs) { wert += w.kurswert; ausKurs++; }

  // Sparplan-Satz (feste Regel): letzter abgeschlossener Monat < 50 % des Medians der 12 Monate davor
  const monate = dep.monate || [], bisM = D.bis.slice(0, 7), fertig = monate.filter((m) => m.m < bisM);
  let spar = null;
  if (fertig.length >= 13) {
    const med = H.median(fertig.slice(-13, -1).map((m) => m.kauf)), grenze = med * 0.5;
    if (med > 0 && fertig.at(-1).kauf < grenze) {
      let i = fertig.length - 1;
      while (i > 0 && fertig[i - 1].kauf < grenze) i--;
      const seit = fertig.slice(i), vorher = fertig.slice(Math.max(0, i - 12), i);
      spar = { seit: seit[0].m, jetzt: summe(seit, (m) => m.kauf) / seit.length, vorher: vorher.length ? summe(vorher, (m) => m.kauf) / vorher.length : med, med };
    }
  }
  const ab12 = H.mVor(bisM, -11), verkauf12 = summe(monate.filter((m) => m.m >= ab12), (m) => m.verkauf);
  return { stand: dep.stand, regel: dep.regel || '', hinweise: dep.hinweise || [], kurse, papiere, nurKurs, wert, ausKurs, berechnet,
    monate, spar, verkauf12, ab12, eingezahlt: summe(papiere, (p) => p.eingezahlt || 0), entnommen: summe(papiere, (p) => p.entnommen || 0) };
}

const OHNE_DEPOT = 'Depot-Daten kommen mit dem nächsten Aufbau am PC.';
const ZEILEN_KURZ = 8;   // so viele Papiere stehen sofort da, der Rest nach „alle zeigen“

export function depotKarte(H) {
  const dp = depot(H);
  if (!dp) return H.karte5('Depot und Sparpläne', '', `<p class="s5-erkl">${OHNE_DEPOT}</p>`, 'dp-karte');
  const { esc, eur0, dde, NUM } = H, k = dp.kurse;
  const kursText = k ? `Kurswerte laut Depot-Datei vom ${dde(k.stichtag)}` : 'ohne Kurswerte – dafür einen Depot-Export (CSV, Name beginnt mit „Depot“) in den Eingang legen';
  // Kennzahlen: Gebuchtes, nie „Wert“ ohne Depot-Datei
  const kz = [
    ['eingezahlt (gebucht)', eur0(dp.eingezahlt), `${NUM.format(summe(dp.papiere, (p) => p.kaeufe))} Käufe`],
    ['entnommen (Verkäufe)', eur0(dp.entnommen), `${NUM.format(summe(dp.papiere, (p) => p.verkaeufe))} Verkäufe`],
    k ? ['Kurswert', eur0(dp.wert), `laut Depot-Datei vom ${dde(k.stichtag)}${dp.berechnet ? ` · ${dp.berechnet} Papiere berechnet` : ''}`]
      : ['netto eingezahlt', betrag(H, dp.eingezahlt - dp.entnommen), 'eingezahlt minus entnommen · berechnet'],
  ].map(([t, w, u]) => `<div class="dp-z"><span>${t}</span><b>${w}</b><small>${u}</small></div>`).join('');

  const saetze = [];
  if (dp.spar) saetze.push(`Seit ${H.monKurz(dp.spar.seit)} gehen nur noch <b>${eur0(dp.spar.jetzt)}</b> im Monat in Sparpläne (vorher Ø ${eur0(dp.spar.vorher)}).`);
  if (dp.verkauf12 > 0) saetze.push(`In den letzten 12 Monaten hast du Wertpapiere für <b>${eur0(dp.verkauf12)}</b> verkauft.`);

  const ms = dp.monate.slice(-36);
  const grafik = ms.length ? `<div class="s5-chart klein"><canvas id="c-depot-spar"></canvas></div>
    <p class="s5-erkl">Käufe und Verkäufe je Monat${ms.length < 36 ? '' : ' (36 Monate)'} · Verkäufe nach unten${ms.at(-1).m >= dp.stand.slice(0, 7) && dp.stand < H.D().bis ? ` · ${H.monKurz(ms.at(-1).m)} bis ${dde(dp.stand)}` : ''}</p>` : '';

  const zeile = (p, i) => {
    const st = p.stueck != null ? `Stück ${NUM.format(p.stueck)}` : 'Stück: nicht in den Buchungen';
    const einst = p.einstand != null ? `${betrag(H, p.einstand)}<small>Einstand · berechnet</small>` : `${betrag(H, p.netto)}<small>netto eingezahlt</small>`;
    const kurs = !k ? '' : `<td class="r">${p.kurs ? `${eur0(p.kurs.kurswert)}${p.gewinn != null ? `<small>Gewinn ${pm(H, p.gewinn)} laut Depot-Datei vom ${dde(k.stichtag)}</small>` : '<small>ohne Einstand</small>'}` : '<span class="muted">–</span>'}</td>`;
    return `<tr class="klick${i >= ZEILEN_KURZ ? ' dp-mehr' : ''}"${H.geh(H.zuBuchungen({ q: p.isin, konto: '' }))} title="Anklicken: Buchungen zu ${esc(p.isin)}">
      <td class="dp-n"><b>${esc(p.name)}</b><small>${p.name !== p.isin ? `${esc(p.isin)} · ` : 'ohne Namen · '}${st}</small><small class="dp-handy">${p.kaeufe} Käufe · ${p.verkaeufe} Verkäufe${p.entnommen ? ` · entnommen ${eur0(p.entnommen)}` : ''}</small></td>
      <td class="r dp-m">${p.kaeufe} / ${p.verkaeufe}</td><td class="r${k ? ' dp-m2' : ''}">${eur0(p.eingezahlt)}</td><td class="r dp-m">${p.entnommen ? eur0(p.entnommen) : '<span class="muted">–</span>'}</td>
      <td class="r">${einst}</td>${kurs}</tr>`;
  };
  const tabelle = `<div class="dp-rahmen"><table class="t3 t3-eng dp-t" id="dp-tab"><thead><tr><th>Papier</th><th class="r dp-m">Käufe / Verk.</th><th class="r${k ? ' dp-m2' : ''}">eingezahlt</th><th class="r dp-m">entnommen</th><th class="r">Einstand</th>${k ? '<th class="r">Kurswert</th>' : ''}</tr></thead>
    <tbody>${dp.papiere.map(zeile).join('')}${dp.nurKurs.map((w) => `<tr><td class="dp-n"><b>${esc(w.isin)}</b><small>nur in der Depot-Datei, keine Buchung</small></td><td class="r dp-m"></td><td class="r${k ? ' dp-m2' : ''}"></td><td class="r dp-m"></td><td class="r"><span class="muted">–</span></td><td class="r">${eur0(w.kurswert)}</td></tr>`).join('')}</tbody></table></div>
    ${dp.papiere.length > ZEILEN_KURZ ? `<button class="btn sm dp-alle" data-dp-alle>Alle ${dp.papiere.length} Papiere zeigen</button>` : ''}`;
  const hinweise = dp.hinweise.length ? `<ul class="dp-hinw">${dp.hinweise.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';

  return H.karte5('Depot und Sparpläne', `Käufe und Verkäufe aus deinen Buchungen bis ${dde(dp.stand)} · ${kursText} · anklicken: Buchungen zum Papier`,
    `<div class="dp-zahlen">${kz}</div>${saetze.length ? `<p class="s5-tipp">${saetze.join(' ')}</p>` : ''}${grafik}${tabelle}${hinweise}
    <p class="s5-erkl dp-fuss">Regel: ${esc(dp.regel)}. Ohne Kinder- und gemeinsame Konten; Umbuchungen (Sparplan-Überträge) zählen nicht.</p>`, 's5-b2 dp-karte', '', 'dp-karte');
}

// ======================================================================= Vermögen (Idee 8)
export function vermoegen(H) {
  const D = H.D(), tag = D.bis, alt = vorJahr(H, tag);
  const ks = H.kontenSumme(tag), dp = depot(H);
  // Mietkaution: gibt es ein eigenes Konto dafür, steckt sie schon in den Konten – dann zählt die Eingabe nicht doppelt
  const ki = D.konten.findIndex((k) => /kaution/i.test(k.name) && !H.fremd(k));
  const kSum = ki >= 0 ? H.kontenSumme(tag, new Set([ki])) : null;
  const kautionKonto = kSum && (kSum.c !== 0 || !kSum.voll) ? { name: D.konten[ki].name, c: kSum.c } : null;
  const kaution = kautionKonto ? null : E.kaution;
  // Vorsorge: nur Verträge mit belegtem Wert (gesetzliche Rente nicht – sie ist eine Anwartschaft); Werte dort in Euro
  const V = D.j.gehalt?.vorsorge?.vertraege || [];
  const vertraege = V.filter((v) => v.wert != null && v.wert_datum).map((v) => ({ name: v.name, art: v.art, c: Math.round(v.wert * 100), am: v.wert_datum, alt: v.wert_datum < alt }))
    .sort((a, b) => b.c - a.c);
  const ohneWert = V.filter((v) => v.wert == null).length;
  const vorsorge = summe(vertraege, (v) => v.c);
  const c = (ks?.c || 0) + (dp?.wert || 0) + (kaution?.c || 0) + vorsorge;
  return { tag, ks, dp, kautionKonto, kaution, vertraege, ohneWert, vorsorge, c, voll: !!ks?.voll, ungefaehr: !!(ks?.abw || ks?.geschaetzt) };
}

export function vermoegenKarte(H) {
  const { esc, eur0, dde } = H, V = vermoegen(H), dp = V.dp, k = dp?.kurse;
  const zeile = (t, sub, w, wsub, cls = '') => `<div class="${cls}"><dt>${t}<small>${sub}</small></dt><dd>${w}<small>${wsub}</small></dd></div>`;
  const depotZeile = !dp ? zeile('Depot', OHNE_DEPOT, '<span class="muted">–</span>', '')
    : zeile('Depot', k && dp.ausKurs && !dp.berechnet ? 'Kurswert' : k && dp.ausKurs ? 'teils Kurswert, teils berechnet' : 'eingezahlt (gebucht): Einstand bzw. netto eingezahlt · berechnet, kein Kurswert',
      betrag(H, dp.wert), k && dp.ausKurs ? `laut Depot-Datei vom ${dde(k.stichtag)}` : `Stand ${dde(dp.stand)}`);
  const kautionZeile = V.kautionKonto
    ? zeile('Mietkaution', `steckt schon in „Konten“ (Konto „${esc(V.kautionKonto.name)}“)`, `<span class="muted">${eur0(V.kautionKonto.c)}</span>`, 'zählt nicht doppelt', 'vm-info')
    : zeile('Mietkaution', `eigene Eingabe${V.kaution?.notiz ? ` · ${esc(V.kaution.notiz)}` : ''}`, V.kaution ? eur0(V.kaution.c) : '<span class="muted">–</span>',
      V.kaution ? `Stand ${dde(V.kaution.am)}` : 'noch nicht eingetragen');
  const form = V.kautionKonto ? '' : `<details class="vm-ein"><summary>${V.kaution ? 'Mietkaution ändern' : 'Mietkaution eintragen'}</summary>
    <form class="vm-form" id="vm-kaution"><label class="feld">Betrag in €<input name="c" inputmode="decimal" required value="${V.kaution ? esc(String(V.kaution.c / 100).replace('.', ',')) : ''}"></label>
    <label class="feld">Stand am<input name="am" type="date" required value="${esc(V.kaution?.am || '')}"></label>
    <label class="feld vm-notiz">Notiz<input name="notiz" maxlength="60" value="${esc(V.kaution?.notiz || '')}"></label>
    <span class="vm-knoepfe"><button class="btn sm primary" type="submit">Speichern</button>${V.kaution ? '<button class="btn sm" type="button" data-vm-loeschen>Entfernen</button>' : ''}</span></form>
    <p class="s5-erkl">Bleibt nur auf diesem Gerät gespeichert.</p></details>`;
  const daten = V.vertraege.map((v) => v.am).sort();
  const vorsorgeZeile = V.vertraege.length
    ? zeile('Vorsorge', `${V.vertraege.length} ${V.vertraege.length === 1 ? 'Vertrag' : 'Verträge'} mit Wert laut Unterlagen`, eur0(V.vorsorge),
      daten[0] === daten.at(-1) ? `Stand ${dde(daten[0])}` : `Stände ${dde(daten[0])} – ${dde(daten.at(-1))}`)
    : zeile('Vorsorge', 'kein Vertrag mit belegtem Wert', '<span class="muted">–</span>', '');
  const liste = V.vertraege.length ? `<ul class="vm-l">${V.vertraege.map((v, i) => `<li${i >= 3 ? ` class="fuell-aus" data-fuell="${i}" data-stopp` : ''}><span>${esc(v.name)}<small>Stand ${dde(v.am)}${v.alt ? ' · <b class="vm-alt">alter Stand</b>' : ''}</small></span><b>${eur0(v.c)}</b></li>`).join('')}</ul>` : '';
  const ks = V.ks, sumText = `${V.ungefaehr ? '≈ ' : ''}${betrag(H, V.c)}${ks && !V.voll ? ' + ?' : ''}`;
  return H.karte5('Vermögen', 'Getrennt von den Kontosummen · jede Zeile mit eigenem Stichtag · ohne Kinder- und gemeinsame Konten',
    `<dl class="s5-dl vm-dl">
      ${zeile('Konten', 'Kontostände', `<span class="${ks?.c < 0 ? 'neg' : ''}">${H.summeText(ks)}</span>`, `Stand ${dde(V.tag)}${ks && !ks.voll ? ' · ein Konto ohne Stand' : ''}`)}
      ${depotZeile}${kautionZeile}${vorsorgeZeile}</dl>${liste}${form}
    <dl class="s5-dl vm-summe">${zeile('Zusammen', 'Werte mit unterschiedlichem Stichtag', sumText, 'Orientierung')}</dl>
    <p class="s5-erkl">Gesetzliche Rente nicht enthalten: sie ist eine Anwartschaft, kein Vermögen.${V.ohneWert ? ` ${V.ohneWert} ${V.ohneWert === 1 ? 'Vertrag hat' : 'Verträge haben'} keinen Wert in den Unterlagen (nur Rentenzusage).` : ''}${V.vertraege.some((v) => v.alt) ? ' „alter Stand“: älter als 12 Monate – neuen Stand beim Anbieter anfordern.' : ''}</p>`,
    'vm-karte', '', 'vm-karte');
}

// beide Karten zusammen, unter den vorhandenen Karten im Reiter Konten
export const vermoegenKarten = (H) => `<div class="s5-raster vm5">${depotKarte(H)}${vermoegenKarte(H)}</div>`;

export function vermoegenBinden(el, H) {
  H.gehBinden(el);
  const dp = depot(H);
  if (dp && el.querySelector('#c-depot-spar')) sparGrafik(H, dp);
  const alle = el.querySelector('[data-dp-alle]');
  if (alle) alle.onclick = () => { el.querySelector('#dp-tab')?.classList.add('dp-offen'); alle.remove(); };
  const f = el.querySelector('#vm-kaution');
  if (f) {
    f.onsubmit = (e) => {
      e.preventDefault();
      const c = centAus(f.elements.c.value), am = f.elements.am.value;
      if (!(c > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(am)) { f.elements[!(c > 0) ? 'c' : 'am'].focus(); return; }
      E.kaution = { c, am, notiz: f.elements.notiz.value.trim() };
      speichern(H);
    };
    const weg = f.querySelector('[data-vm-loeschen]');
    if (weg) weg.onclick = () => { E.kaution = null; speichern(H); };
  }
  H.freiFuellen(el);
}

function sparGrafik(H, dp) {
  const ms = dp.monate.slice(-36), o = H.basis(), st = H.achsenStil();
  const offen = ms.at(-1).m >= dp.stand.slice(0, 7) && dp.stand < H.D().bis;
  o.scales = {
    x: { ...st, stacked: true, grid: { display: false }, ticks: { ...st.ticks, maxRotation: 0, autoSkipPadding: 8 } },
    y: { ...st, stacked: true, ticks: { ...st.ticks, maxTicksLimit: 5, callback: (v) => H.achse(v) } },
  };
  o.plugins.tooltip.callbacks = {
    title: (it) => `${H.monKurz(ms[it[0].dataIndex].m)}${offen && it[0].dataIndex === ms.length - 1 ? ` (bis ${H.dde(dp.stand)})` : ''}`,
    label: (c) => `${c.dataset.label}: ${H.eur0(Math.abs(c.raw) * 100)}`,
    footer: (it) => { const m = ms[it[0].dataIndex], n = m.kauf - m.verkauf; return `netto ${n < 0 ? '−' : ''}${H.eur0(Math.abs(n))} · ${m.n} Buchungen`; },
  };
  H.zeichne('c-depot-spar', {
    type: 'bar',
    data: { labels: ms.map((m) => H.monKurz(m.m)), datasets: [
      { label: 'Kauf', data: ms.map((m) => m.kauf / 100), backgroundColor: H.css('--accent'), borderRadius: 3, maxBarThickness: 18 },
      { label: 'Verkauf', data: ms.map((m) => -m.verkauf / 100), backgroundColor: H.css('--aus-text'), borderRadius: 3, maxBarThickness: 18 },
    ] },
    options: o,
  });
}

// ======================================================================= Reisen und Projekte (Idee 9)
// Tags aus Finanzguru (r.t, durch Kommas getrennt). Nicht gezeigt: reine Jahreszahlen, „Urlaub“ (nur Kennzeichen),
// „Steuer“ (Reiter Steuer), die Ausgleich-Tags und die von dir ausgeblendeten.
// Trägt ein Tag Buchungen mit verschiedenen Jahres-Tags („2022,Gardasee“ und „2024,Gardasee“), ist jedes Jahr eine eigene Reise.
// Summe = Ausgaben minus Erstattungen auf deinen Konten; gemeinsame und Kinderkonten sowie „Anteil“-Gutschriften nur zur Info.
const NUR_ZEICHEN = new Set(['urlaub', 'steuer']);
// Klick: Buchungen mit diesem Tag (mit Leerzeichen als Wortfolge in Anführungszeichen; Jahr in Anführungszeichen = Text, nicht Buchungsjahr)
const zuTag = (H, t, jahr = '') => H.zuBuchungen({ q: `${/\s/.test(t) ? `"${t}"` : t}${jahr ? ` "${jahr}"` : ''}`, konto: '' });

export function reisen(H) {
  const D = H.D(), N = H.norm;
  const ausgleich = new Set((H.ausgleichTags?.() || []).map(N)), aus = new Set(E.reisenAus.map(N));
  const G = new Map();
  let mitTag = 0;
  for (const r of D.rows) {
    const tags = String(r.t || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!tags.length) continue;
    mitTag++;
    const urlaub = tags.some((t) => N(t) === 'urlaub'), jahr = tags.find((t) => /^\d{4}$/.test(t)) || '';
    for (const t of tags) {
      const key = N(t);
      if (/^\d{4}$/.test(key) || NUR_ZEICHEN.has(key) || ausgleich.has(key)) continue;
      let g = G.get(key);
      if (!g) G.set(key, (g = { key, tag: t, rows: new Map(), urlaub: /urlaub/.test(key) }));
      g.rows.set(r, jahr);
      if (urlaub) g.urlaub = true;
    }
  }
  // je Tag eine Reise – bei mehreren Jahres-Tags je Jahr eine (Buchungen ohne Jahres-Tag bleiben unter dem Tag allein)
  const gruppen = [];
  for (const g of G.values()) {
    const jahre = new Set([...g.rows.values()].filter(Boolean));
    if (jahre.size < 2) { gruppen.push({ ...g, name: g.tag, jahr: '', rows: [...g.rows.keys()] }); continue; }
    for (const j of ['', ...[...jahre].sort()]) {
      const rows = [...g.rows].filter(([, y]) => y === j).map(([r]) => r);
      if (rows.length) gruppen.push({ ...g, name: j ? `${g.tag} ${j}` : g.tag, jahr: j, rows });
    }
  }
  const karten = [], ausgeblendet = [];
  for (const g of gruppen) {
    if (aus.has(N(g.name)) || aus.has(g.key)) { ausgeblendet.push(g.name); continue; }
    const rows = g.rows.sort((a, b) => (a.d < b.d ? -1 : 1));
    let c = 0, n = 0, gem = 0, kind = 0, anteil = 0;
    const kats = new Map();
    for (const r of rows) {
      const k = D.konten[r.k];
      if (k.kind) { kind -= r.c; continue; }
      if (H.fremd(k) || H.istGemeinsam(r.k)) { gem -= r.c; continue; }
      if (r.art !== 'Ausgabe' && r.art !== 'Einnahme') continue;   // Umbuchungen, Sparen
      if (r.c > 0 && /\banteil\b/.test(N(`${r.z} ${r.g}`))) { anteil += r.c; continue; }
      c -= r.c; n++;
      const kat = r.kat || 'Ohne Kategorie';
      kats.set(kat, (kats.get(kat) || 0) - r.c);
    }
    const erste = rows[0].d, letzte = rows.at(-1).d, tage = tageZw(erste, letzte) + 1;
    karten.push({ tag: g.name, basis: g.tag, jahr: g.jahr, key: g.key, urlaub: g.urlaub, c, n, nAlle: rows.length, erste, letzte, tage, jeTag: c / tage,
      kats: [...kats].map(([k, v]) => ({ k, c: v })).filter((x) => x.c !== 0).sort((a, b) => b.c - a.c), gem, kind, anteil, vor: null });
  }
  // Vergleich mit der vorigen Reise: vorheriger Tag mit Kennzeichen Urlaub nach Startdatum
  const urlaube = karten.filter((x) => x.urlaub).sort((a, b) => (a.erste < b.erste ? -1 : a.erste > b.erste ? 1 : 0));
  urlaube.forEach((x, i) => { const v = urlaube[i - 1]; if (v) x.vor = { tag: v.tag, basis: v.basis, jahr: v.jahr, erste: v.erste, dC: x.c - v.c, dTag: x.jeTag - v.jeTag }; });
  karten.sort((a, b) => (a.erste < b.erste ? 1 : a.erste > b.erste ? -1 : 0));
  return { karten, ausgeblendet: ausgeblendet.sort((a, b) => a.localeCompare(b, 'de')), mitTag, gesamt: karten.length, c: summe(karten, (x) => x.c) };
}

const KAT_KURZ = 3;   // so viele Kategorien sofort, weitere füllen freie Fläche
function reiseKarte(H, x) {
  const { esc, eur0, dde } = H, ziel = zuTag(H, x.basis, x.jahr);
  const max = Math.max(1, ...x.kats.map((k) => Math.abs(k.c))), pos = summe(x.kats.filter((k) => k.c > 0), (k) => k.c);
  const item = (k) => ({ n: esc(H.schoen(k.k)), c: k.c, w: k.c < 0 ? `<span class="neg">−${eur0(-k.c)}</span>` : eur0(k.c),
    p: k.c > 0 && pos ? `${Math.round((k.c / pos) * 100)} %` : '', ziel: { ...ziel, kat: k.k }, tip: `${H.schoen(k.k)} – anklicken: Buchungen` });
  const balken = x.kats.length ? H.balkenListe(x.kats.slice(0, KAT_KURZ).map(item), { max })
    + x.kats.slice(KAT_KURZ).map((k, i) => `<div class="fuell-aus" data-fuell="${i + 1}" data-stopp>${H.balkenListe([item(k)], { max })}</div>`).join('')
    : '<p class="s5-erkl">Keine Buchungen auf deinen Konten.</p>';
  const vgl = x.vor ? `<p class="rs-vgl">ggü. ${H.zl(esc(x.vor.tag), zuTag(H, x.vor.basis, x.vor.jahr))} (${dde(x.vor.erste).slice(3)}): ${pm(H, x.vor.dC)} · ${pm(H, x.vor.dTag)} je Tag</p>` : '';
  const info = [x.gem ? `${betrag(H, x.gem)} auf gemeinsamen Konten` : '', x.kind ? `${betrag(H, x.kind)} auf Kinderkonten` : '', x.anteil ? `${eur0(x.anteil)} Anteile von anderen erhalten` : '']
    .filter(Boolean);
  const titel = `${esc(x.tag)}${x.urlaub ? ' <small class="rs-u">Urlaub</small>' : ''}`;
  const rechts = `<button class="rs-weg" data-rs-aus="${esc(x.tag)}" title="„${esc(x.tag)}“ ausblenden" aria-label="ausblenden">×</button>`;
  return H.karte5(titel, `${dde(x.erste)} – ${dde(x.letzte)} · ${x.tage} ${x.tage === 1 ? 'Tag' : 'Tage'} (erste bis letzte Buchung)`,
    `<button class="rs-summe"${H.geh(ziel)} title="Anklicken: alle Buchungen mit „${esc(x.tag)}“">
      <b>${betrag(H, x.c)}</b><span>von deinen Konten · ${x.n} ${x.n === 1 ? 'Buchung' : 'Buchungen'}${x.c && x.tage > 1 ? ` · ${betrag(H, Math.round(x.jeTag))} je Tag` : ''}</span></button>
    ${balken}<div class="rs-unten">${vgl}${info.length ? `<p class="rs-info">nur zur Info: ${info.join(' · ')}</p>` : ''}</div>`, 'rs-k');
}

export function reisenSeite(H, rechts = '') {
  const R = reisen(H), { esc, eur0 } = H, titel = 'Reisen und Projekte';
  if (!R.mitTag) return H.kopf5(titel, 'Vergib in Finanzguru Tags, dann erscheinen hier deine Reisen.', rechts);
  const weg = `<p class="s5-erkl rs-fuss">Nicht gezeigt: Jahreszahlen, „Urlaub“ (dient nur als Kennzeichen für den Vergleich), „Steuer“ (Reiter Steuer) und Ausgleich-Tags.${R.ausgeblendet.length
    ? ` Von dir ausgeblendet: ${R.ausgeblendet.map((t) => `<button class="rs-ein" data-rs-ein="${esc(t)}" title="Wieder zeigen">${esc(t)} ↺</button>`).join(' ')}` : ''}</p>`;
  if (!R.karten.length) return H.kopf5(titel, 'Alle Tags sind ausgeblendet.', rechts) + weg;
  const neu = R.karten[0];
  const satz = `<b>${R.gesamt}</b> ${R.gesamt === 1 ? 'Reise oder Projekt' : 'Reisen und Projekte'} aus deinen Finanzguru-Tags – zusammen ${betrag(H, R.c)} von deinen Konten. Zuletzt: ${H.zl(`<b>${esc(neu.tag)}</b>`, zuTag(H, neu.basis, neu.jahr))} (${betrag(H, neu.c)}).`;
  return H.kopf5(titel, satz, rechts) + `<div class="s5-raster rs5">${R.karten.map((x) => reiseKarte(H, x)).join('')}</div>` + weg;
}

export function reisenBinden(el, H) {
  H.gehBinden(el);
  el.querySelectorAll('[data-rs-aus]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    if (!E.reisenAus.includes(b.dataset.rsAus)) E.reisenAus.push(b.dataset.rsAus);
    speichern(H);
  });
  el.querySelectorAll('[data-rs-ein]').forEach((b) => b.onclick = () => { E.reisenAus = E.reisenAus.filter((t) => H.norm(t) !== H.norm(b.dataset.rsEin)); speichern(H); });
  H.freiFuellen(el);
}
