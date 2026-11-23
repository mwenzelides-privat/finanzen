// Jahresvorschau (Bereich Geldfluss › Vorschau): immer Januar–Dezember, dazu schlicht je ein Randmonat davor und danach
// (zählen nicht in den Summen); vergangene Monate des Jahres zeigen den festgehaltenen Plan. Einnahmen und Ausgaben je Monat, in Rubriken
// mit aufklappbaren Einzelposten und ihrer Herkunft (Beleg, aus Buchungen erkannt, Regel, Annahme, eigener Posten).
// Gerechnet wird am PC (vorschau_daten.py → D.j.vorschau) – dieselben Zahlen stehen in Vorschau-12-Monate.xlsx.
// Hier wird nichts geschätzt, nur gezeigt: jeder Posten kaufmännisch auf volle Euro gerundet, alle Summen (Rubrik, Monat,
// Jahr, Ergebnis) aus den gezeigten Zahlen addiert.
// Plan/Ist: Der Plan eines Monats wird beim letzten Aufbau vor Monatsbeginn festgehalten und dann mit den Buchungen verglichen.
// Keine Imports von app.js: Helfer kommen als H. Geld in Cent.

let H = null;
const offen = new Set();          // aufgeklappte Rubriken (Schlüssel)
const offenP = new Set();         // aufgeklappte Posten (Herkunft)
let vglMonat = '';                // gewählter Monat im Plan/Ist

// ---------------------------------------------------------------- Einrichtung: Artikel herausnehmen und wieder einplanen
// Deine Auswahl wirkt sofort hier (die Rubrik Einrichtung wird mit ihr neu gerechnet) und wird am PC über den Einlese-Dienst
// in Planung.xlsx (Blatt Einrichtung) eingetragen – danach baut der PC Vorschau und Excel neu. Auf anderen Geräten bleibt sie
// vorgemerkt (IndexedDB) und geht mit, sobald die App am PC geöffnet wird. Ein übertragener Eintrag fällt weg, sobald Daten
// da sind, die nach ihm gebaut wurden (dann steht er in Planung.xlsx – oder du hast ihn dort inzwischen selbst geändert).
const KV_E = 'vorschau.einrichtung';
let ENT = null, ladeP = null, neuZ = null, meldung = '', anker = '', gOffen = false;
const ekey = (x) => `${x.raum}|${x.name}`;
const amPc = () => matchMedia('(pointer: fine)').matches && !/android|iphone|ipad/i.test(navigator.userAgent);
const jetztLokal = () => { const d = new Date(), p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const entSpeichern = () => Promise.resolve(H.kvSchreiben(KV_E, { ent: Object.fromEntries(ENT || []) })).catch(() => {});
async function entLaden(v) {
  const l = await Promise.resolve(H.kvLesen(KV_E)).catch(() => null);
  ENT = new Map(Object.entries(l?.ent || {}));
  let weg = 0;
  for (const [k, e] of ENT) if (e.sync && v?.erstellt && v.erstellt > String(e.zeit).slice(0, 16)) { ENT.delete(k); weg++; }
  if (weg) await entSpeichern();
  if ([...ENT.values()].some((e) => !e.sync)) senden();
}
async function senden() {
  const offenE = [...ENT.entries()].filter(([, e]) => !e.sync);
  if (!offenE.length) return;
  if (!amPc() || !H.DIENST) { meldung = 'Auf diesem Gerät vorgemerkt – wird in Planung.xlsx eingetragen, sobald du die App am PC öffnest.'; return; }
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(H.DIENST + '/einrichtung', { method: 'POST', headers: { 'X-Finanzen': '1', 'Content-Type': 'application/json' }, signal: ctl.signal, cache: 'no-store',
      body: JSON.stringify({ artikel: offenE.map(([, e]) => ({ raum: e.raum, name: e.name, status: e.status, monat: e.monat })) }) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.fehler || String(r.status));
    for (const [k, e] of offenE) if (ENT.get(k) === e) e.sync = true;
    meldung = `In Planung.xlsx eingetragen${x.nicht_gefunden ? ` (${x.nicht_gefunden} Artikel dort nicht gefunden)` : ''} – der PC baut Vorschau und Excel neu.`;
    await entSpeichern();
  } catch (e) {
    meldung = `Vorgemerkt, noch nicht in Planung.xlsx: ${e.name === 'AbortError' ? 'Einlese-Dienst antwortet nicht' : e.message}. Ich versuche es beim nächsten Öffnen wieder.`;
  } finally { clearTimeout(t); neuZ?.(); }
}
function setzeArtikel(x, status, monat) {
  ENT.set(ekey(x), { raum: x.raum, name: x.name, status, monat, zeit: jetztLokal(), sync: false });
  entSpeichern();
  senden();
  neuZ?.();
}
// Artikel mit deiner Auswahl: status offen | raus (herausgenommen) | gekauft | entfaellt
function wirksam(v) {
  return (v.einrichtung || []).map((x) => { const e = ENT?.get(ekey(x)); return e ? { ...x, status: e.status === 'herausgenommen' ? 'raus' : e.status === 'entfällt' ? 'entfaellt' : 'offen', monat: e.monat || x.monat, vorgemerkt: !e.sync } : x; });
}
// Jahresfenster: Januar–Dezember (kern) plus je ein Randmonat davor und danach; Summen zählen nur Januar–Dezember
const kernVon = (v) => v.kern || [0, v.monate.length - 1];
const imKern = (v, i) => { const [a, b] = kernVon(v); return i >= a && i <= b; };
const jahrSumme = (v, werte) => werte.reduce((t, x, i) => t + (imKern(v, i) ? x : 0), 0);
const jahrVon = (v) => v.jahr || +v.monate[kernVon(v)[0]].slice(0, 4);

// Vorschau mit deiner Auswahl: Rubrik Einrichtung je Raum neu, Ausgaben und Ergebnis angepasst (Cent, genau)
function mitAuswahl(v) {
  if (!ENT?.size || !v.einrichtung?.length) return v;
  const w = structuredClone(v), l = wirksam(v), n = w.monate.length;
  let rub = w.rubriken.find((r) => r.key === 'einrichtung');
  const alt = rub ? rub.werte.slice() : Array(n).fill(0);
  const vorher = new Map((rub?.posten || []).map((p) => [p.id, p]));
  const neu = (rub?.posten || []).filter((p) => !p.id.startsWith('einrichtung:'));
  for (const raum of [...new Set(l.map((x) => x.raum))]) {
    const alle = l.filter((x) => x.raum === raum), of = alle.filter((x) => x.status === 'offen');
    const id0 = `einrichtung:${H.norm(raum)}`;   // vergangene Monate: festgehaltener Plan bleibt
    const werte = w.monate.map((k, i) => (i < (w.ab || 0) ? (vorher.get(id0)?.werte[i] || 0) : of.filter((x) => x.monat === k).reduce((t, x) => t + x.c, 0)));
    if (!werte.some(Boolean)) continue;
    const st = {};
    for (const x of of) st[x.stufe || 'ohne Einstufung'] = (st[x.stufe || 'ohne Einstufung'] || 0) + x.c;
    const fest = of.filter((x) => x.fest).length, raus = alle.filter((x) => x.status === 'raus').length;
    const erl = alle.filter((x) => ['gekauft', 'entfaellt', 'finanziert'].includes(x.status)).length, id = `einrichtung:${H.norm(raum)}`;
    neu.push({ ...(vorher.get(id) || { art: 'eigen', beleg: 'Kaufliste Dettenhofen (Planung.xlsx, Blatt Einrichtung)' }), id, rubrik: 'einrichtung', name: raum, werte, summe: jahrSumme(w, werte),
      annahme: fest < of.length, artikel: of,
      herkunft: `${of.length} Artikel offen: ${Object.entries(st).map(([k, c]) => `${k} ${H.eur(c)}`).join(', ')} (${fest} mit festem Preis, ${of.length - fest} geschätzt)`
        + (erl ? `, ${erl} gekauft, finanziert oder entfallen` : '') + (raus ? `, ${raus} herausgenommen` : '') });
  }
  if (!rub && neu.length) { rub = { key: 'einrichtung', name: 'Einrichtung', bereich: 'aus' }; w.rubriken.splice(Math.max(0, w.rubriken.findIndex((r) => r.key === 'leben')), 0, rub); }
  if (rub) {
    rub.posten = neu;
    rub.werte = w.monate.map((_, i) => neu.reduce((t, p) => t + p.werte[i], 0));
    rub.summe = jahrSumme(w, rub.werte);
    if (!neu.length) w.rubriken = w.rubriken.filter((r) => r !== rub);
  }
  const jetzt = rub && neu.length ? rub.werte : Array(n).fill(0);
  w.ausgaben = w.ausgaben.map((c, i) => c - alt[i] + jetzt[i]);
  w.ergebnis = w.einnahmen.map((c, i) => c - w.ausgaben[i]);
  return w;
}

// Sammelliste: alle herausgenommenen Artikel mit Summe; je Artikel „einplanen in …“ Monat oder „ganz streichen“.
// Darunter (aufklappbar) die gestrichenen Artikel – von dort zurück in einen Monat oder in die Sammelliste.
function sammelHtml(v) {
  const alle = wirksam(v), l = alle.filter((x) => x.status === 'raus'), g = alle.filter((x) => x.status === 'entfaellt');
  const opts = v.monate.map((k) => `<option value="${k}">${H.monKurz(k)}</option>`).join('');
  const zeile = (x, extra, hilfe) => `<li><span>${H.esc(x.name)}<small>${H.esc(x.raum)} · ${H.esc(x.stufe || '')}${x.monat ? ` · war ${H.monKurz(x.monat)}` : ''}${x.vorgemerkt ? ' · vorgemerkt' : ''}</small></span>`
    + `<b>${x.fest ? '' : 'ca. '}${H.eur(x.c)}</b><label class="vs-ein"><span class="vs-sr">${hilfe}</span><select data-vsein="${H.esc(ekey(x))}" aria-label="${H.esc(x.name)}: ${hilfe}"><option value="">einplanen in …</option>${opts}<option disabled>──────</option>${extra}</select></label></li>`;
  const summe = (a) => H.eur(a.reduce((t, x) => t + x.c, 0));
  const liste = !l.length ? '<p class="bx-u">Noch nichts herausgenommen. Öffne in „Monat für Monat“ die Rubrik Einrichtung, tippe auf einen Raum und dort bei einem Artikel auf „rausnehmen“.</p>'
    : `<ul class="vs-art vs-raus-l">${l.map((x) => zeile(x, '<option value="streichen">ganz streichen</option>', 'Einplanen in Monat oder ganz streichen')).join('')}
      <li class="vs-art-s"><span>${l.length} Artikel herausgenommen</span><b>${summe(l)}</b></li></ul>`;
  const gestr = !g.length ? '' : `<details class="vs-gestr"${gOffen ? ' open' : ''}><summary>Gestrichen: ${g.length} Artikel, ${summe(g)}</summary>
      <ul class="vs-art vs-raus-l">${g.map((x) => zeile(x, '<option value="raus">zurück in die Sammelliste</option>', 'Wieder einplanen oder zurück in die Sammelliste')).join('')}
      <li class="vs-art-s"><span>${g.length} Artikel gestrichen</span><b>${summe(g)}</b></li></ul></details>`;
  return liste + gestr + (meldung ? `<p class="vs-meld">${H.esc(meldung)}</p>` : '')
    + '<p class="muted klein">Herausgenommene und gestrichene Artikel zählen in keinem Monat. Wieder einplanen: Monat wählen. „Ganz streichen“ setzt den Artikel auf „entfällt“, er steht dann unter „Gestrichen“. Dasselbe geht in Planung.xlsx (Status „herausgenommen“, „entfällt“ bzw. „offen“ und Monat).</p>';
}

const HER = {
  beleg: ['Beleg', 'laut Beleg (Vertrag, Schreiben)'],
  vertrag: ['erkannt', 'aus deinen Buchungen erkannt'],
  plan: ['Regel', 'nach fester Regel berechnet'],
  annahme: ['Annahme', 'Annahme – kein Beleg'],
  eigen: ['eigen', 'eigener Posten aus Planung.xlsx'],
};
const herkunft = (p) => (p.annahme ? 'annahme' : p.art);

// Kaufmännisch auf volle Euro runden (ab 50 Cent auf, z. B. 324,50 € → 325 €), Cent → Euro
const kfm = (c) => Math.sign(c) * Math.round(Math.abs(c) / 100);

// Gerundete Anzeige der ganzen Vorschau: jeder Posten je Monat kaufmännisch gerundet; Rubrik, Bereich, Ergebnis und
// Jahressumme aus den gezeigten (gerundeten) Zahlen addiert – sie gehen genau auf, können aber um ein paar Euro vom
// Cent-genauen Wert abweichen (vom Nutzer so gewünscht, 23.11.2026)
function gerundet(v) {
  const n = v.monate.length, rub = new Map(), pos = new Map(), ber = { ein: Array(n).fill(0), aus: Array(n).fill(0) };
  for (const r of v.rubriken) {
    const rw = Array(n).fill(0);
    for (const p of r.posten) {
      const pw = p.werte.map(kfm);
      pos.set(p.id, pw);
      pw.forEach((x, i) => { rw[i] += x; });
    }
    rub.set(r.key, rw);
    rw.forEach((x, i) => { ber[r.bereich][i] += x; });
  }
  const erg = ber.ein.map((x, i) => x - (ber.aus[i] || 0));
  return { rub, pos, ber, erg };
}

const summe = (a) => a.reduce((t, x) => t + x, 0);
const e0 = (x) => (x ? H.eur0(x * 100) : '–');                       // Euro (ganze Zahl) → „1.234 €“, 0 → „–“
const pm0 = (x) => (x ? `${x > 0 ? '+' : '−'}${H.eur0(Math.abs(x) * 100)}` : '±0 €');

// Wohin ein Posten führt (Buchungen, Gehalt, Fixkosten …)
function zielVon(p) {
  if (p.id === 'gehalt') return { tab: 'gehalt' };
  if (p.id === 'leben') return { tab: 'fix', fixtab: 'vertraege', konto: '', _springe: '#fix-leben' };
  if (p.id.startsWith('unterhalt:') || p.rubrik === 'unterhalt') return H.zuBuchungen({ q: 'unterhalt', konto: '' });
  if (p.id.startsWith('kredit:')) return { tab: 'vermoegen' };
  if (p.vertrag) {
    const da = H.fixkostenErkennen().some((f) => H.vertragsKey(f) === p.vertrag);
    return da ? H.zuBuchungen({ vertrag: p.vertrag, konto: '' }) : H.zuBuchungen({ q: `an:"${p.name}"`, konto: '' });
  }
  if (p.such?.wort) return H.zuBuchungen({ q: p.such.wort, konto: '' });
  return null;
}

// Artikel eines Einrichtungs-Postens (offen, aus Planung.xlsx › Einrichtung): Name, Einstufung, Preis (fest oder geschätzt)
function artikelHtml(l, raum) {
  const zeilen = [...l].sort((a, b) => b.c - a.c).map((x) => `<li><span>${H.esc(x.name)}<small>${H.esc(x.stufe || '')}${x.monat ? ` · ${H.monKurz(x.monat)}` : ''}${x.notiz ? ` · ${H.esc(x.notiz)}` : ''}</small></span>`
    + `<b class="${x.fest ? '' : 'vs-ca'}" title="${x.fest ? 'fester Preis (Angebot oder Warenkorb)' : 'Schätzpreis aus deiner Kaufliste'}">${x.fest ? '' : 'ca. '}${H.eur(x.c)}</b>`
    + (raum ? `<button class="vs-raus" data-vsraus="${H.esc(ekey({ raum, name: x.name }))}" title="Aus ${H.esc(x.monat ? H.monKurz(x.monat) : 'dem Monat')} herausnehmen – kommt in die Sammelliste">rausnehmen</button>` : '') + '</li>').join('');
  return `<ul class="vs-art">${zeilen}<li class="vs-art-s"><span>${l.length} Artikel offen</span><b>${H.eur(l.reduce((t, x) => t + x.c, 0))}</b></li></ul>`;
}

function tabelleHtml(v, G) {
  const M = v.monate, [ka, kb] = kernVon(v);
  const rc = (i) => (i < ka ? ' vs-rand vs-vor' : i > kb ? ' vs-rand vs-nach' : '');   // Randmonate schlicht
  const alt = v.alt || {};
  const kopf = `<tr><th class="vs-n" scope="col">Rubrik und Posten</th>${M.map((k, i) => `<th scope="col" class="${rc(i)}"${alt[k] ? ` title="festgehaltener Plan vom ${H.dde(alt[k])} – Ist unter „Plan und Ist“"` : ''}>${H.monKurz(k)}${alt[k] ? '<small class="vs-altm">Plan</small>' : ''}</th>`).join('')}<th scope="col" class="vs-s">Jahr ${jahrVon(v)}</th></tr>`;
  const zellen = (werte) => { const s = jahrSumme(v, werte); return werte.map((x, i) => `<td class="${rc(i)}${x < 0 ? ' neg' : ''}">${e0(x)}</td>`).join('') + `<td class="vs-s${s < 0 ? ' neg' : ''}">${e0(s)}</td>`; };
  let body = '';
  for (const [b, titel] of [['ein', 'Einnahmen'], ['aus', 'Ausgaben']]) {
    body += `<tr class="vs-ber"><th scope="row" class="vs-n">${titel}</th>${zellen(G.ber[b])}</tr>`;
    for (const r of v.rubriken.filter((x) => x.bereich === b)) {
      const auf = offen.has(r.key);
      body += `<tr class="vs-rub${auf ? ' auf' : ''}"><th scope="row" class="vs-n"><button class="vs-auf" data-vsrub="${r.key}" aria-expanded="${auf}"><span class="vs-pfeil" aria-hidden="true">›</span>${H.esc(r.name)} <small>${r.posten.length}</small></button></th>${zellen(G.rub.get(r.key))}</tr>`;
      if (!auf) continue;
      for (const p of r.posten) {
        const h = herkunft(p), pa = offenP.has(p.id), ziel = zielVon(p);
        body += `<tr class="vs-pos vs-${h}"><th scope="row" class="vs-n"><button class="vs-auf" data-vspos="${H.esc(p.id)}" aria-expanded="${pa}" title="${H.esc(HER[h]?.[1] || '')} – anklicken: Herkunft">`
          + `<span class="vs-h vs-h-${h}">${HER[h]?.[0] || h}</span><span class="vs-pn">${H.esc(p.name)}</span></button></th>${zellen(G.pos.get(p.id))}</tr>`;
        if (pa) {
          body += `<tr class="vs-det"><td colspan="${M.length + 2}"><div class="vs-det-i"><p><b>${H.esc(HER[h]?.[1] || '')}:</b> ${H.esc(p.herkunft)}</p>`
            + (p.beleg ? `<p class="muted">${H.esc(p.beleg)}</p>` : '')
            + (p.artikel?.length ? artikelHtml(p.artikel, p.id.startsWith('einrichtung:') ? p.name : '') : '')
            + (ziel ? H.zl('Buchungen und Einzelheiten ›', ziel) : '') + '</div></td></tr>';
        }
      }
    }
  }
  body += `<tr class="vs-erg"><th scope="row" class="vs-n">Ergebnis</th>${zellen(G.erg)}</tr>`;
  return `<div class="vs-scroll" tabindex="0" aria-label="Tabelle: Monate nebeneinander, seitlich verschiebbar"><table class="vs-tab"><thead>${kopf}</thead><tbody>${body}</tbody></table></div>`;
}

function balkenHtml(v, G) {
  const max = Math.max(1, ...G.erg.map(Math.abs));
  return `<div class="vs-bars" role="img" aria-label="Ergebnis je Monat" style="grid-template-columns: repeat(${v.monate.length}, minmax(0, 1fr))">${v.monate.map((k, i) => {
    const x = G.erg[i], h = (Math.abs(x) / max) * 36;
    return `<span class="vs-bar${imKern(v, i) ? '' : ' vs-rand'}" title="${H.monLang(k)}: Einnahmen ${e0(G.ber.ein[i])} − Ausgaben ${e0(G.ber.aus[i])} = ${pm0(x)}">`
      + `<small class="${x < 0 ? 'neg' : ''}">${x ? (x < 0 ? '−' : '+') + H.kurzWert(Math.abs(x)) : '0'}</small>`
      + `<i class="${x < 0 ? 'minus' : 'plus'}" style="height:${h.toFixed(1)}%;${x < 0 ? 'top:50%' : 'bottom:50%'}"></i><em>${H.MON[+k.slice(5) - 1]}</em></span>`;
  }).join('')}</div>`;
}

function vergleichHtml(v) {
  const l = v.vergleich || [];
  if (!l.length) {
    return `<p class="bx-u">Der Plan für ${H.esc(H.monLang(v.monate[v.ab || 0]))} ist festgehalten (Stand ${H.dde(v.stand)}). Sobald der Monat begonnen hat, steht hier, was wirklich gebucht wurde – je Rubrik mit Abweichung, Posten aufklappbar.</p>`;
  }
  if (!l.some((x) => x.monat === vglMonat)) vglMonat = l.at(-1).monat;
  const x = l.find((y) => y.monat === vglMonat);
  const seg = `<div class="seg vs-seg" role="group" aria-label="Monat">${l.slice(-6).map((y) => `<button data-vsvgl="${y.monat}" class="${y.monat === vglMonat ? 'an' : ''}">${H.monKurz(y.monat)}${y.laufend ? ' (läuft)' : ''}</button>`).join('')}</div>`;
  const r0 = (c) => Math.round(c / 100);
  let zeilen = '', sP = { ein: 0, aus: 0 }, sI = { ein: 0, aus: 0 };
  for (const z of x.zeilen) {
    const p = r0(z.plan), i = r0(z.ist), d = i - p, schlecht = z.bereich === 'aus' ? d > 0 : d < 0;
    sP[z.bereich] += p; sI[z.bereich] += i;
    const auf = offen.has(`vgl:${z.key}`), pos = x.posten.filter((q) => q.rubrik === z.key);
    zeilen += `<tr class="vs-rub${auf ? ' auf' : ''}"><th scope="row" class="vs-n">${pos.length ? `<button class="vs-auf" data-vsrub="vgl:${z.key}" aria-expanded="${auf}"><span class="vs-pfeil" aria-hidden="true">›</span>${H.esc(z.name)}</button>` : H.esc(z.name)}</th>`
      + `<td>${e0(p)}</td><td>${e0(i)}</td><td class="${Math.abs(d) >= 1 && schlecht ? 'neg' : ''}">${pm0(d)}</td></tr>`;
    if (auf) for (const q of pos) {
      const qp = r0(q.c), qi = q.ist == null ? null : r0(q.ist);
      zeilen += `<tr class="vs-pos"><th scope="row" class="vs-n"><span class="vs-pn">${H.esc(q.name)}</span></th><td>${e0(qp)}</td><td>${qi == null ? '<span class="muted" title="Buchungen nicht eindeutig zuzuordnen – zählt in der Rubrik bzw. Lebenshaltung">?</span>' : e0(qi)}</td><td>${qi == null ? '' : pm0(qi - qp)}</td></tr>`;
    }
  }
  const erg = (s) => s.ein - s.aus;
  const tab = `<div class="vs-scroll"><table class="vs-tab vs-vgl"><thead><tr><th class="vs-n" scope="col">${H.esc(H.monLang(x.monat))}${x.laufend ? ' – Ist bisher' : ''}</th><th scope="col">Plan</th><th scope="col">Ist</th><th scope="col">Abweichung</th></tr></thead><tbody>
    ${zeilen}
    <tr class="vs-ber"><th scope="row" class="vs-n">Einnahmen</th><td>${e0(sP.ein)}</td><td>${e0(sI.ein)}</td><td class="${sI.ein < sP.ein ? 'neg' : ''}">${pm0(sI.ein - sP.ein)}</td></tr>
    <tr class="vs-ber"><th scope="row" class="vs-n">Ausgaben</th><td>${e0(sP.aus)}</td><td>${e0(sI.aus)}</td><td class="${sI.aus > sP.aus ? 'neg' : ''}">${pm0(sI.aus - sP.aus)}</td></tr>
    <tr class="vs-erg"><th scope="row" class="vs-n">Ergebnis</th><td class="${erg(sP) < 0 ? 'neg' : ''}">${pm0(erg(sP))}</td><td class="${erg(sI) < 0 ? 'neg' : ''}">${pm0(erg(sI))}</td><td class="${erg(sI) < erg(sP) ? 'neg' : ''}">${pm0(erg(sI) - erg(sP))}</td></tr>
  </tbody></table></div>`;
  const fragen = (v.vorschlaege || []).length ? `<div class="vs-fragen"><p class="cp-auff-t">Rückfragen</p>${v.vorschlaege.map((s) => `<p class="vs-frage">${H.esc(s.text)}</p>`).join('')}
    <p class="muted klein">Anpassen in Planung.xlsx (Ordner 10 Finanzen › Auswertung): Lebenshaltung unter „Einstellungen“, alles andere als eigener Posten. Oder sag Claude Bescheid.</p></div>` : '';
  return seg + tab + fragen + `<p class="muted klein">Plan festgehalten am ${H.dde(x.plan_stand)} · Ist = Buchungen deiner eigenen Konten · „?“ = nicht eindeutig einem Posten zuzuordnen</p>`;
}

export function vorschauSeite(h) {
  H = h;
  const D = H.D(), v0 = D.j.vorschau;
  if (v0?.einrichtung?.length && !ENT && !ladeP) ladeP = entLaden(v0).then(() => neuZ?.());
  const v = v0?.monate?.length ? mitAuswahl(v0) : v0;
  if (!v?.monate?.length) {
    return `<div class="cp bx">${H.bxKopf('Vorschau','Die Vorschau ist noch nicht berechnet.', 'Sie entsteht am PC beim nächsten Einlesen (vorschau_daten.py).')}</div>`;
  }
  const G = gerundet(v), M = v.monate, [ka, kb] = kernVon(v), n = kb - ka + 1, J = jahrVon(v);
  const js = (a) => jahrSumme(v, a);   // nur Januar–Dezember
  const sEin = js(G.ber.ein), sAus = js(G.ber.aus), sErg = js(G.erg);
  const einmal = ['einmalig', 'einrichtung'].reduce((t, k) => t + (G.rub.get(k) ? js(G.rub.get(k)) : 0), 0);   // einmalige Zahlungen und Einrichtung
  const imJahr = G.erg.slice(ka, kb + 1), tief = ka + imJahr.indexOf(Math.min(...imJahr));
  const gross = v.rubriken.flatMap((r) => r.posten.map((p) => ({ p, c: p.werte[tief] }))).filter((x) => ['einmalig', 'einrichtung'].includes(x.p.rubrik) && x.c).sort((a, b) => b.c - a.c)[0];
  const kern = `Im Jahr ${J} ${sErg < 0 ? `fehlen <b class="neg">${H.eur0(Math.abs(sErg) * 100)}</b>` : `bleiben <b class="pos">${H.eur0(sErg * 100)}</b>`}${einmal ? ` – ohne Einrichtung und einmalige Zahlungen ${pm0(sErg + einmal)}` : ''}.`;
  const unter = `Einnahmen ${e0(sEin)} − Ausgaben ${e0(sAus)} von Januar bis Dezember ${J}`
    + (G.erg[tief] < 0 ? ` · schwächster Monat ${H.esc(H.monLang(M[tief]))} (${pm0(G.erg[tief])}${gross ? `, darin ${H.esc(gross.p.name)} ${e0(Math.round(gross.c / 100))}` : ''})` : '')
    + (ka > 0 || kb < M.length - 1 ? ` · ${H.esc(H.monKurz(M[0]))} und ${H.esc(H.monKurz(M.at(-1)))} am Rand zur Vollständigkeit, nicht in den Summen` : '');
  const zahlen = [['Einnahmen', e0(sEin), `Jan – Dez ${J}`], ['Ausgaben', e0(sAus), `Jan – Dez ${J}`], ['Ergebnis', pm0(sErg), `Ø ${pm0(Math.round(sErg / n))} im Monat`, sErg < 0 ? 'neg' : ''],
    ['Einrichtung und Einmaliges', e0(einmal), 'darin enthalten']]
    .map(([t, w, u, c = '']) => `<div class="vs-zahl"><span>${t}</span><b class="${c}">${w}</b><small>${u}</small></div>`).join('');
  const zaehl = {};
  for (const r of v.rubriken) for (const p of r.posten) zaehl[herkunft(p)] = (zaehl[herkunft(p)] || 0) + 1;
  const legende = Object.keys(HER).filter((k) => zaehl[k]).map((k) => `<span class="vs-leg"><span class="vs-h vs-h-${k}">${HER[k][0]}</span>${HER[k][1]} (${zaehl[k]})</span>`).join('');
  const hinweise = (v.hinweise || []).length ? `<p class="vs-hinweis">${v.hinweise.map(H.esc).join('<br>')}</p>` : '';
  const leben = v.rubriken.find((r) => r.key === 'leben')?.posten[0];
  return `<div class="cp bx vs">
    ${H.bxKopf(`Vorschau ${J}`, kern, unter + ' · Beträge auf volle Euro gerundet, Summen aus den gezeigten Zahlen')}
    <div class="vs-zahlen">${zahlen}</div>
    ${H.bxKarte('Ergebnis je Monat', balkenHtml(v, G), { rechts: '<span class="klein muted">Einnahmen minus Ausgaben</span>', fuss: 'Grün = es bleibt etwas übrig, rot = Minus · Monat antippen für die Zahlen (Tooltip)' })}
    ${H.bxKarte('Monat für Monat', `<div class="vs-werkzeug"><button class="bx-link" data-vsalle="1">${[...offen].some((k) => !k.startsWith('vgl:')) ? 'Alle zuklappen' : 'Alle Rubriken aufklappen'}</button></div>${tabelleHtml(v, G)}`,
      { id: 'vs-monate', rechts: '<span class="klein muted">Rubrik antippen: Posten · Posten antippen: Herkunft</span>',
        fuss: `Ausgaben positiv · ohne Kinder- und Gemeinschaftskonten · Lebenshaltung: ${H.esc((leben?.herkunft || '').replace(/^Annahme: /, ''))}` })}
    ${v.einrichtung?.length ? H.bxKarte('Herausgenommen', sammelHtml(v), { id: 'vs-raus', rechts: '<span class="klein muted">Einrichtung, in keinem Monat</span>' }) : ''}
    <div class="bx-raster vs-unten">
      ${H.bxKarte('Plan und Ist', vergleichHtml(v), { id: 'vs-vgl' })}
      ${H.bxKarte('Herkunft und eigene Posten', `<div class="vs-legende">${legende}</div>
        <p class="bx-u">Eigene Posten (z. B. eine Anschaffung, eine Erstattung, ein Vertrag, der endet) trägst du in <b>Planung.xlsx</b> ein – Ordner 10 Finanzen › Auswertung, Blatt „Eigene Posten“. Beim nächsten Einlesen sind sie hier und in <b>Vorschau-12-Monate.xlsx</b> (formatiert, mit Filtern).</p>
        <p class="muted klein">${H.esc(v.regel)} Erstellt ${H.dde(v.erstellt.slice(0, 10))}, ${v.erstellt.slice(11, 16)} Uhr · ${v.planung?.posten || 0} eigene Posten.</p>${hinweise}`)}
    </div>
  </div>`;
}

// Neu zeichnen, ohne dass die Seite springt: die Zeile, an der du gerade warst (anker), bleibt an derselben Stelle im Bild,
// die Tabelle bleibt seitlich so verschoben wie vorher
function stabil(zeichnen) {
  const el = anker && document.querySelector(anker), oben = el?.getBoundingClientRect().top;
  const links = document.querySelector('#vs-monate .vs-scroll')?.scrollLeft || 0;
  zeichnen();
  const sc = document.querySelector('#vs-monate .vs-scroll');
  if (sc) sc.scrollLeft = links;
  const neuEl = anker && (document.querySelector(anker) || document.querySelector('[data-vsrub="einrichtung"]'));
  if (neuEl && oben != null) window.scrollBy(0, neuEl.getBoundingClientRect().top - oben);
}
const raumAnker = (raum) => `[data-vspos="einrichtung:${CSS.escape(H.norm(raum))}"]`;

export function vorschauBinden(box, neuZeichnen) {
  neuZ = () => stabil(neuZeichnen);
  box.querySelectorAll('[data-vsraus]').forEach((b) => b.onclick = () => { const x = wirksam(H.D().j.vorschau).find((y) => ekey(y) === b.dataset.vsraus); if (x) { anker = raumAnker(x.raum); setzeArtikel(x, 'herausgenommen', x.monat); } });
  box.querySelector('.vs-gestr')?.addEventListener('toggle', (e) => { gOffen = e.target.open; });
  box.querySelectorAll('[data-vsein]').forEach((sel) => sel.onchange = () => {
    const x = wirksam(H.D().j.vorschau).find((y) => ekey(y) === sel.dataset.vsein), w = sel.value;
    if (!x || !w) return;
    anker = '#vs-raus';
    if (w === 'streichen') setzeArtikel(x, 'entfällt', x.monat);
    else if (w === 'raus') setzeArtikel(x, 'herausgenommen', x.monat);
    else setzeArtikel(x, 'offen', w);
  });
  box.querySelectorAll('[data-vsrub]').forEach((b) => b.onclick = () => { const k = b.dataset.vsrub; if (offen.has(k)) offen.delete(k); else offen.add(k); anker = `[data-vsrub="${CSS.escape(k)}"]`; neuZ(); });
  box.querySelectorAll('[data-vspos]').forEach((b) => b.onclick = () => { const k = b.dataset.vspos; if (offenP.has(k)) offenP.delete(k); else offenP.add(k); anker = `[data-vspos="${CSS.escape(k)}"]`; neuZ(); });
  box.querySelectorAll('[data-vsvgl]').forEach((b) => b.onclick = () => { vglMonat = b.dataset.vsvgl; neuZeichnen(); });
  box.querySelectorAll('[data-vsalle]').forEach((b) => b.onclick = () => {
    const v = H.D().j.vorschau;
    if ([...offen].some((k) => !k.startsWith('vgl:'))) { for (const k of [...offen]) if (!k.startsWith('vgl:')) offen.delete(k); }
    else v.rubriken.forEach((r) => offen.add(r.key));
    neuZeichnen();
  });
}
