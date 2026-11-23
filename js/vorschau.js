// Vorschau 12 Monate (Bereich Geldfluss › Vorschau): alle zu erwartenden Einnahmen und Ausgaben je Monat, in Rubriken
// mit aufklappbaren Einzelposten und ihrer Herkunft (Beleg, aus Buchungen erkannt, Regel, Annahme, eigener Posten).
// Gerechnet wird am PC (vorschau_daten.py → D.j.vorschau) – dieselben Zahlen stehen in Vorschau-12-Monate.xlsx.
// Hier wird nichts geschätzt, nur gezeigt und auf volle Euro gerundet: Die gerundeten Teile ergeben genau die gezeigte
// Summe (größter Rest), Monatssummen und „12 Monate“ sind aus den gezeigten Zahlen addiert.
// Plan/Ist: Der Plan eines Monats wird beim letzten Aufbau vor Monatsbeginn festgehalten und dann mit den Buchungen verglichen.
// Keine Imports von app.js: Helfer kommen als H. Geld in Cent.

let H = null;
const offen = new Set();          // aufgeklappte Rubriken (Schlüssel)
const offenP = new Set();         // aufgeklappte Posten (Herkunft)
let vglMonat = '';                // gewählter Monat im Plan/Ist

const HER = {
  beleg: ['Beleg', 'laut Beleg (Vertrag, Schreiben)'],
  vertrag: ['erkannt', 'aus deinen Buchungen erkannt'],
  plan: ['Regel', 'nach fester Regel berechnet'],
  annahme: ['Annahme', 'Annahme – kein Beleg'],
  eigen: ['eigen', 'eigener Posten aus Planung.xlsx'],
};
const herkunft = (p) => (p.annahme ? 'annahme' : p.art);

// Teile auf volle Euro so runden, dass sie zusammen genau ziel (Euro) ergeben – größter Rest zuerst. schuld[j] = bisher
// zu wenig (+) bzw. zu viel (−) gezeigter Betrag dieses Teils aus den Vormonaten: Er zählt zum Rest dazu, so dass auch die
// Summe über 12 Monate je Posten auf den Euro stimmt (z. B. 2 × 811,50 € wechseln sich beim Aufrunden ab).
function teile(cs, ziel, schuld) {
  const e = cs.map((c) => c / 100), ab = e.map(Math.floor), rest = e.map((x, j) => x - ab[j] + (schuld[j] || 0));
  let fehlt = ziel - ab.reduce((t, x) => t + x, 0);
  const rang = e.map((x, j) => j).filter((j) => cs[j]).sort((a, b) => rest[b] - rest[a] || a - b);   // nur Teile mit Betrag
  for (const j of rang) { if (fehlt <= 0) break; ab[j]++; fehlt--; }
  for (const j of [...rang].reverse()) { if (fehlt >= 0) break; ab[j]--; fehlt++; }
  e.forEach((x, j) => { schuld[j] = (schuld[j] || 0) + x - ab[j]; });
  return ab;
}

// Gerundete Anzeige der ganzen Vorschau: je Monat Bereich → Rubriken → Posten (Euro)
function gerundet(v) {
  const n = v.monate.length, rub = new Map(), pos = new Map(), ber = { ein: [], aus: [] };
  for (const b of ['ein', 'aus']) {
    const rs = v.rubriken.filter((r) => r.bereich === b), sR = [], sP = rs.map(() => []);
    for (let i = 0; i < n; i++) {
      const ziel = Math.round((b === 'ein' ? v.einnahmen : v.ausgaben)[i] / 100);
      ber[b][i] = ziel;
      const rt = teile(rs.map((r) => r.werte[i]), ziel, sR);
      rs.forEach((r, j) => {
        if (!rub.has(r.key)) rub.set(r.key, []);
        rub.get(r.key)[i] = rt[j];
        const pt = teile(r.posten.map((p) => p.werte[i]), rt[j], sP[j]);
        r.posten.forEach((p, k) => { if (!pos.has(p.id)) pos.set(p.id, []); pos.get(p.id)[i] = pt[k]; });
      });
    }
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
function artikelHtml(l) {
  const zeilen = [...l].sort((a, b) => b.c - a.c).map((x) => `<li><span>${H.esc(x.name)}<small>${H.esc(x.stufe || '')}${x.monat ? ` · ${H.monKurz(x.monat)}` : ''}${x.notiz ? ` · ${H.esc(x.notiz)}` : ''}</small></span>`
    + `<b class="${x.fest ? '' : 'vs-ca'}" title="${x.fest ? 'fester Preis (Angebot oder Warenkorb)' : 'Schätzpreis aus deiner Kaufliste'}">${x.fest ? '' : 'ca. '}${H.eur(x.c)}</b></li>`).join('');
  return `<ul class="vs-art">${zeilen}<li class="vs-art-s"><span>${l.length} Artikel offen</span><b>${H.eur(l.reduce((t, x) => t + x.c, 0))}</b></li></ul>`;
}

function tabelleHtml(v, G) {
  const M = v.monate;
  const kopf = `<tr><th class="vs-n" scope="col">Rubrik und Posten</th>${M.map((k) => `<th scope="col">${H.monKurz(k)}</th>`).join('')}<th scope="col" class="vs-s">12 Monate</th></tr>`;
  const zellen = (werte, cls = '') => werte.map((x) => `<td class="${cls}${x < 0 ? ' neg' : ''}">${e0(x)}</td>`).join('') + `<td class="vs-s${summe(werte) < 0 ? ' neg' : ''}">${e0(summe(werte))}</td>`;
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
            + (p.artikel?.length ? artikelHtml(p.artikel) : '')
            + (ziel ? H.zl('Buchungen und Einzelheiten ›', ziel) : '') + '</div></td></tr>';
        }
      }
    }
  }
  body += `<tr class="vs-erg"><th scope="row" class="vs-n">Ergebnis</th>${zellen(G.erg)}</tr>`;
  return `<div class="vs-scroll" tabindex="0" aria-label="Tabelle: 12 Monate nebeneinander, seitlich verschiebbar"><table class="vs-tab"><thead>${kopf}</thead><tbody>${body}</tbody></table></div>`;
}

function balkenHtml(v, G) {
  const max = Math.max(1, ...G.erg.map(Math.abs));
  return `<div class="vs-bars" role="img" aria-label="Ergebnis je Monat">${v.monate.map((k, i) => {
    const x = G.erg[i], h = (Math.abs(x) / max) * 36;
    return `<span class="vs-bar" title="${H.monLang(k)}: Einnahmen ${e0(G.ber.ein[i])} − Ausgaben ${e0(G.ber.aus[i])} = ${pm0(x)}">`
      + `<small class="${x < 0 ? 'neg' : ''}">${x ? (x < 0 ? '−' : '+') + H.kurzWert(Math.abs(x)) : '0'}</small>`
      + `<i class="${x < 0 ? 'minus' : 'plus'}" style="height:${h.toFixed(1)}%;${x < 0 ? 'top:50%' : 'bottom:50%'}"></i><em>${H.MON[+k.slice(5) - 1]}</em></span>`;
  }).join('')}</div>`;
}

function vergleichHtml(v) {
  const l = v.vergleich || [];
  if (!l.length) {
    return `<p class="bx-u">Der Plan für ${H.esc(H.monLang(v.monate[0]))} ist festgehalten (Stand ${H.dde(v.stand)}). Sobald der Monat begonnen hat, steht hier, was wirklich gebucht wurde – je Rubrik mit Abweichung, Posten aufklappbar.</p>`;
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
  const D = H.D(), v = D.j.vorschau;
  if (!v?.monate?.length) {
    return `<div class="cp bx">${H.bxKopf('Vorschau 12 Monate', 'Die Vorschau ist noch nicht berechnet.', 'Sie entsteht am PC beim nächsten Einlesen (vorschau_daten.py).')}</div>`;
  }
  const G = gerundet(v), M = v.monate, n = M.length;
  const sEin = summe(G.ber.ein), sAus = summe(G.ber.aus), sErg = summe(G.erg);
  const einmal = ['einmalig', 'einrichtung'].reduce((t, k) => t + (G.rub.get(k) ? summe(G.rub.get(k)) : 0), 0);   // einmalige Zahlungen und Einrichtung
  const tief = G.erg.indexOf(Math.min(...G.erg));
  const gross = v.rubriken.flatMap((r) => r.posten.map((p) => ({ p, c: p.werte[tief] }))).filter((x) => ['einmalig', 'einrichtung'].includes(x.p.rubrik) && x.c).sort((a, b) => b.c - a.c)[0];
  const von = H.monLang(M[0]), bis = H.monLang(M[n - 1]);
  const kern = `Bis ${H.esc(bis)} ${sErg < 0 ? `fehlen <b class="neg">${H.eur0(Math.abs(sErg) * 100)}</b>` : `bleiben <b class="pos">${H.eur0(sErg * 100)}</b>`}${einmal ? ` – ohne Einrichtung und einmalige Zahlungen ${pm0(sErg + einmal)}` : ''}.`;
  const unter = `Einnahmen ${e0(sEin)} − Ausgaben ${e0(sAus)} von ${H.esc(von)} bis ${H.esc(bis)}`
    + (G.erg[tief] < 0 ? ` · schwächster Monat ${H.esc(H.monLang(M[tief]))} (${pm0(G.erg[tief])}${gross ? `, darin ${H.esc(gross.p.name)} ${e0(Math.round(gross.c / 100))}` : ''})` : '');
  const zahlen = [['Einnahmen', e0(sEin), '12 Monate'], ['Ausgaben', e0(sAus), '12 Monate'], ['Ergebnis', pm0(sErg), `Ø ${pm0(Math.round(sErg / n))} im Monat`, sErg < 0 ? 'neg' : ''],
    ['Einrichtung und Einmaliges', e0(einmal), 'darin enthalten']]
    .map(([t, w, u, c = '']) => `<div class="vs-zahl"><span>${t}</span><b class="${c}">${w}</b><small>${u}</small></div>`).join('');
  const zaehl = {};
  for (const r of v.rubriken) for (const p of r.posten) zaehl[herkunft(p)] = (zaehl[herkunft(p)] || 0) + 1;
  const legende = Object.keys(HER).filter((k) => zaehl[k]).map((k) => `<span class="vs-leg"><span class="vs-h vs-h-${k}">${HER[k][0]}</span>${HER[k][1]} (${zaehl[k]})</span>`).join('');
  const hinweise = (v.hinweise || []).length ? `<p class="vs-hinweis">${v.hinweise.map(H.esc).join('<br>')}</p>` : '';
  const leben = v.rubriken.find((r) => r.key === 'leben')?.posten[0];
  return `<div class="cp bx vs">
    ${H.bxKopf('Vorschau 12 Monate', kern, unter + ' · Beträge auf volle Euro gerundet, Summen aus den gezeigten Zahlen')}
    <div class="vs-zahlen">${zahlen}</div>
    ${H.bxKarte('Ergebnis je Monat', balkenHtml(v, G), { rechts: '<span class="klein muted">Einnahmen minus Ausgaben</span>', fuss: 'Grün = es bleibt etwas übrig, rot = Minus · Monat antippen für die Zahlen (Tooltip)' })}
    ${H.bxKarte('Monat für Monat', `<div class="vs-werkzeug"><button class="bx-link" data-vsalle="1">${[...offen].some((k) => !k.startsWith('vgl:')) ? 'Alle zuklappen' : 'Alle Rubriken aufklappen'}</button></div>${tabelleHtml(v, G)}`,
      { id: 'vs-monate', rechts: '<span class="klein muted">Rubrik antippen: Posten · Posten antippen: Herkunft</span>',
        fuss: `Ausgaben positiv · ohne Kinder- und Gemeinschaftskonten · Lebenshaltung: ${H.esc((leben?.herkunft || '').replace(/^Annahme: /, ''))}` })}
    <div class="bx-raster vs-unten">
      ${H.bxKarte('Plan und Ist', vergleichHtml(v), { id: 'vs-vgl' })}
      ${H.bxKarte('Herkunft und eigene Posten', `<div class="vs-legende">${legende}</div>
        <p class="bx-u">Eigene Posten (z. B. eine Anschaffung, eine Erstattung, ein Vertrag, der endet) trägst du in <b>Planung.xlsx</b> ein – Ordner 10 Finanzen › Auswertung, Blatt „Eigene Posten“. Beim nächsten Einlesen sind sie hier und in <b>Vorschau-12-Monate.xlsx</b> (formatiert, mit Filtern).</p>
        <p class="muted klein">${H.esc(v.regel)} Erstellt ${H.dde(v.erstellt.slice(0, 10))}, ${v.erstellt.slice(11, 16)} Uhr · ${v.planung?.posten || 0} eigene Posten.</p>${hinweise}`)}
    </div>
  </div>`;
}

export function vorschauBinden(box, neuZeichnen) {
  box.querySelectorAll('[data-vsrub]').forEach((b) => b.onclick = () => { const k = b.dataset.vsrub; if (offen.has(k)) offen.delete(k); else offen.add(k); neuZeichnen(); });
  box.querySelectorAll('[data-vspos]').forEach((b) => b.onclick = () => { const k = b.dataset.vspos; if (offenP.has(k)) offenP.delete(k); else offenP.add(k); neuZeichnen(); });
  box.querySelectorAll('[data-vsvgl]').forEach((b) => b.onclick = () => { vglMonat = b.dataset.vsvgl; neuZeichnen(); });
  box.querySelectorAll('[data-vsalle]').forEach((b) => b.onclick = () => {
    const v = H.D().j.vorschau;
    if ([...offen].some((k) => !k.startsWith('vgl:'))) { for (const k of [...offen]) if (!k.startsWith('vgl:')) offen.delete(k); }
    else v.rubriken.forEach((r) => offen.add(r.key));
    neuZeichnen();
  });
}
