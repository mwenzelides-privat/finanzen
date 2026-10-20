// Unterhaltsrechner (Orientierung, keine Rechtsberatung): Kindes- und Trennungsunterhalt nach der Düsseldorfer Tabelle und den
// Süddeutschen Leitlinien – im Rechenweg der Unterhaltsberechnungen von RA Vitti (Programm-Ausdruck vom 20.01.2026):
// 1. Kindesunterhalt aus dem eigenen Einkommen, Einkommensgruppe um die Zahl der Berechtigten über zwei herabgestuft,
//    Tabellenbetrag aufgerundet, minus halbes Kindergeld (volljährig: ganzes).
// 2. Differenzunterhalt des betreuenden Elternteils, wenn der Bedarf nach beiderseitigem Einkommen höher ist.
// 3. Volljährige Schüler (privilegiert): Bedarf Altersstufe 4 nach beiderseitigem Einkommen, Haftung beider Eltern nach
//    Einkommen über dem Sockelbetrag.
// 4. Trennungsunterhalt: Halbteilung nach Vorwegabzug des Kindesunterhalts, 10 % Erwerbstätigenbonus, aufgerundet.
// Regelwerte (öffentlich) stehen hier; alle persönlichen Werte kommen aus Finanzen-Daten.json (familie, gehalt).

export const REGEL = {
  2025: { mindest: [482, 554, 649], vollj: 693, kg: 255, bbgRv: 8050, sb: { notw: 1450, ehe: 1600, angem: 1750 }, quelle: 'Düsseldorfer Tabelle 2025' },
  2026: { mindest: [486, 558, 653], vollj: 698, kg: 259, bbgRv: 8450, sb: { notw: 1450, ehe: 1600, angem: 1750 }, quelle: 'Düsseldorfer Tabelle 2026' },
};
// Einkommensgruppen (bereinigtes Netto bis …), Prozent des Mindestunterhalts, Bedarfskontrollbetrag
const BIS = [2100, 2500, 2900, 3300, 3700, 4100, 4500, 4900, 5300, 5700, 6400, 7200, 8200, 9700, 11200];
const PROZ = [100, 105, 110, 115, 120, 128, 136, 144, 152, 160, 168, 176, 184, 192, 200];
const BKB = [1450, 1750, 1850, 1950, 2050, 2150, 2250, 2350, 2450, 2550, 2850, 3250, 3750, 4350, 5150];

export const regelFuer = (j) => REGEL[j] || REGEL[Math.max(...Object.keys(REGEL).map(Number).filter((x) => x <= j))] || REGEL[2026];
export const gruppe = (e) => { const i = BIS.findIndex((b) => e <= b); return i < 0 ? 15 : i + 1; };
const auf = (x) => Math.ceil(x - 1e-9);
const r2 = (x) => Math.round(x * 100) / 100;
// Tabellenbetrag: Altersstufe 0–2 (minderjährig) bzw. 3 (volljährig), Gruppe 1–15
export const tabelle = (R, stufe, g) => auf((stufe === 3 ? R.vollj : R.mindest[stufe]) * PROZ[Math.min(15, Math.max(1, g)) - 1] / 100);

// Altersstufe im Monat m (JJJJ-MM): ab dem Monat, in dem das Kind 6, 12 bzw. 18 wird
export function altersstufe(geb, m) {
  const [gj, gm] = geb.split('-').map(Number), [j, mo] = m.split('-').map(Number);
  const jahre = j - gj - (mo < gm ? 1 : 0);
  return jahre >= 18 ? 3 : jahre >= 12 ? 2 : jahre >= 6 ? 1 : 0;
}

// Bereinigtes Einkommen aus einer Abrechnung (In-Prinzip: tatsächliche Steuern und Beiträge):
// Netto-Verdienst (enthält den Dienstwagen-Vorteil und die Entgeltumwandlung) − zusätzliche Altersvorsorge (höchstens 4 % des
// Bruttos bis zur Beitragsgrenze + 22,6 % darüber, wie in der Berechnung vom 20.01.2026) − feste Abzüge − 5 % berufsbedingt
export function einkommenAus(z, R, abzuege) {
  const vorsorgeMax = 0.04 * Math.min(z.brutto, R.bbgRv) + 0.226 * Math.max(0, z.brutto - R.bbgRv);
  const vorsorge = Math.min(z.bav_an || 0, vorsorgeMax), fest = abzuege.reduce((t, a) => t + (+a.b || 0), 0);
  const vor5 = z.netto_verdienst - vorsorge - fest, pausch = vor5 * 0.05;
  return { e: r2(vor5 - pausch), netto: z.netto_verdienst, vorsorge: r2(vorsorge), vorsorgeMax: r2(vorsorgeMax), bav: z.bav_an || 0, fest: r2(fest), pausch: r2(pausch) };
}

// Kern: Unterhalt im Monat m für Einkommen eM (Zahlender) und eS (betreuender Elternteil)
// kinder: [{ name, geb, status }] – status 'Schule' bei Volljährigen = privilegiert (Rang 1, beide Eltern barunterhaltspflichtig)
export function berechne({ m, eM, eS, kinder, R = regelFuer(+m.slice(0, 4)), berechtigte = kinder.length + 1, sockel = 'angem' }) {
  const ab = Math.max(0, berechtigte - 2), gEigen = gruppe(eM), gBeide = gruppe(eM + eS);
  const K = kinder.map((k) => ({ ...k, stufe: altersstufe(k.geb, m) }));
  let g = Math.max(1, gEigen - ab), erg;
  for (;;) {
    erg = rechne(g);
    if (g <= 1 || eM - erg.kuM >= BKB[g - 1]) break;
    g--;   // Bedarfskontrollbetrag unterschritten: eine Gruppe tiefer
  }
  return { ...erg, gEigen, gBeide, g, ab, bkb: BKB[g - 1], R };

  function rechne(gM) {
    const kind = K.map((k) => {
      const vollj = k.stufe === 3;
      if (!vollj) {
        const tab = tabelle(R, k.stufe, gM), zahl = tab - R.kg / 2;
        const tabB = tabelle(R, k.stufe, gBeide), rest = tabB - R.kg / 2, diffS = Math.max(0, r2(rest - zahl));
        return { ...k, vollj, tab, zahl, gesamt: tabB, rest, diffS, zahlS: diffS };
      }
      // privilegiert volljährig: Bedarf nach beiderseitigem Einkommen, volles Kindergeld, Haftung nach Leistungsfähigkeit
      const bedarf = tabelle(R, 3, gBeide), rest = bedarf - R.kg;
      return { ...k, vollj, bedarf, rest, privilegiert: /schul/i.test(k.status || '') };
    });
    const minderM = kind.filter((k) => !k.vollj).reduce((t, k) => t + k.zahl, 0);
    const minderS = kind.filter((k) => !k.vollj).reduce((t, k) => t + k.diffS, 0);
    const sb = R.sb[sockel] ?? R.sb.angem;
    for (const k of kind.filter((x) => x.vollj)) {
      const vM = Math.max(0, eM - minderM - sb), vS = Math.max(0, eS - minderS - sb);
      const quoteM = vM + vS > 0 ? vM / (vM + vS) : 1;
      const alleinM = tabelle(R, 3, gM) - R.kg;   // nie mehr als aus dem eigenen Einkommen allein
      k.vM = r2(vM); k.vS = r2(vS); k.quoteM = quoteM; k.sockel = sb; k.alleinM = alleinM;
      k.zahl = Math.min(auf(k.rest * quoteM), alleinM);
      k.zahlS = r2(Math.max(0, k.rest - k.zahl));
    }
    const kuM = kind.reduce((t, k) => t + k.zahl, 0), kuS = kind.reduce((t, k) => t + (k.zahlS || 0), 0);
    // Trennungsunterhalt: Halbteilung mit 10 % Erwerbstätigenbonus nach Vorwegabzug des Kindesunterhalts
    const eM2 = eM - kuM, eS2 = eS - kuS, bM = eM2 * 0.9, bS = eS2 * 0.9;
    const tuVoll = Math.max(0, (bM + bS) / 2 - bS);
    let tu = tuVoll > 0 ? auf(r2(tuVoll)) : 0;
    const restM = eM - kuM - tu;
    if (restM < R.sb.ehe) tu = Math.max(0, Math.floor(eM - kuM - R.sb.ehe));   // Ehegattenselbstbehalt
    return { kind, kuM: r2(kuM), kuS: r2(kuS), eM2: r2(eM2), eS2: r2(eS2), bM: r2(bM), bS: r2(bS), tuVoll: r2(tuVoll), tu, summe: r2(kuM + tu), restM: r2(eM - kuM - tu) };
  }
}

// ======================================================================= Anzeige (Fixkosten › Unterhalt)
let wahl = { basis: 'aktuell', sandra: null, sockel: 'angem' };
const LS = 'fd.uh-rechner';
try { wahl = { ...wahl, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch {}
const merken = () => { try { localStorage.setItem(LS, JSON.stringify(wahl)); } catch {} };

// Monate mit gedruckten Werten: geprüfte Abrechnungen und Probeabrechnungen
const abrechnungen = (G) => (G?.monate || []).filter((z) => z.netto_verdienst != null && z.brutto && (z.geprueft || z.probe));

function basisEinkommen(H, F) {
  const G = H.D().j.gehalt, ms = abrechnungen(G), abz = F?.rechner?.abzuege || [];
  if (!ms.length) return null;
  const letzte = ms.at(-1);
  if (wahl.basis === '12') {
    const zw = ms.filter((z) => z.m > H.mVor(letzte.m, -12));
    const er = zw.map((z) => einkommenAus(z, regelFuer(+z.m.slice(0, 4)), abz));
    const s = (f) => er.reduce((t, x) => t + x[f], 0) / er.length;
    return { e: r2(s('e')), netto: r2(s('netto')), vorsorge: r2(s('vorsorge')), fest: r2(s('fest')), pausch: r2(s('pausch')), von: zw[0].m, bis: letzte.m, n: zw.length, text: `Ø ${zw.length} Monate ${H.monKurz(zw[0].m)} – ${H.monKurz(letzte.m)} (mit Sonderzahlungen)` };
  }
  return { ...einkommenAus(letzte, regelFuer(+letzte.m.slice(0, 4)), abz), von: letzte.m, bis: letzte.m, n: 1,
    text: `${letzte.probe ? 'Probeabrechnung' : 'Abrechnung'} ${H.monKurz(letzte.m)} (ohne Sonderzahlungen)` };
}

export function rechnerKarte(H, R, eigeneKinder) {
  const D = H.D(), F = D?.j?.familie;
  // Kinder: deine Angaben, wenn alle ein Geburtsdatum haben, sonst die Vorgabe aus den Daten
  const kinder = eigeneKinder?.length && eigeneKinder.every((k) => /^\d{4}-\d{2}/.test(k.geb || '')) ? eigeneKinder : F?.kinder;
  if (!kinder?.length) return '';
  const e = H.eur, B = basisEinkommen(H, F || {});
  if (!B) return '';
  const S = F?.rechner?.sandra || { netto: 0, unzumutbar: 0 };
  const sNetto = wahl.sandra ?? S.netto, eS = r2((sNetto - (wahl.sandra == null ? S.unzumutbar || 0 : 0)) * 0.95);
  const m = D.bis.slice(0, 7);
  const X = berechne({ m, eM: B.e, eS, kinder, berechtigte: F?.rechner?.berechtigte || kinder.length + 1, sockel: wahl.sockel });
  const jetzt = R.monate.find((x) => x.k === D.bis.slice(0, 7)) || R.monate.at(-1);
  const gez = jetzt ? jetzt.sum / 100 : null;
  const zeile = (t, w, cls = '', sub = '') => `<div class="ur-z ${cls}"><span>${t}${sub ? `<small>${sub}</small>` : ''}</span><b>${w}</b></div>`;
  const kinderZ = X.kind.map((k) => k.vollj
    ? zeile(`${H.esc(k.name)} <span class="ur-m">volljährig${k.privilegiert ? ', Schule' : ''}</span>`, e(k.zahl * 100), '',
      `Bedarf ${e(k.bedarf * 100)} (Stufe 4, Gruppe ${X.gBeide} nach euch beiden) − Kindergeld ${e(X.R.kg * 100)} = ${e(k.rest * 100)}; dein Anteil ${Math.round(k.quoteM * 100)} % (Einkommen über ${e(k.sockel * 100)} Sockel: du ${e(k.vM * 100)}, sie ${e(k.vS * 100)})`
      + (k.zahlS ? ` · ihr Anteil ${e(k.zahlS * 100)}` : ''))
    : zeile(`${H.esc(k.name)} <span class="ur-m">Altersstufe ${k.stufe + 1}</span>`, e(k.zahl * 100), '',
      `Tabelle ${e(k.tab * 100)} (${PROZ[X.g - 1]} %) − halbes Kindergeld ${e(X.R.kg / 2 * 100)}`)).join('');
  const rechenweg = `<div class="ur-weg">
    ${zeile('Netto-Verdienst', e(B.netto * 100), '', B.text)}
    ${zeile('− zusätzliche Altersvorsorge', e(-B.vorsorge * 100), '', 'Entgeltumwandlung, höchstens 4 % bis zur Beitragsgrenze + 22,6 % darüber')}
    ${zeile('− feste Abzüge', e(-B.fest * 100), '', (F?.rechner?.abzuege || []).map((a) => H.esc(a.t)).join(', '))}
    ${zeile('− pauschal 5 % berufsbedingte Aufwendungen', e(-B.pausch * 100))}
    ${zeile('= dein bereinigtes Einkommen', e(B.e * 100), 'ur-sum', `Gruppe ${X.gEigen} der Düsseldorfer Tabelle${X.ab ? `, ${X.ab} tiefer wegen ${X.ab + 2} Berechtigten` : ''}${X.g !== Math.max(1, X.gEigen - X.ab) ? ', weitere wegen Bedarfskontrollbetrag' : ''} → Gruppe ${X.g}`)}
    ${zeile('Einkommen deiner Ex-Frau', e(eS * 100), '', `${e(sNetto * 100)} netto − 5 %${wahl.sandra == null && S.unzumutbar ? ` (ohne ${e(S.unzumutbar * 100)} unzumutbar)` : ''}`)}
  </div>`;
  const ergebnis = `<div class="ur-erg">
    ${kinderZ}
    ${zeile('Trennungsunterhalt', e(X.tu * 100), '', `(${e(X.eM2 * 100)} − ${e(X.eS2 * 100)}) × 90 % ÷ 2 – Einkommen nach Kindesunterhalt, 10 % Erwerbstätigenbonus`)}
    ${zeile('= du zahlst im Monat', e(X.summe * 100), 'ur-sum', `dir bleiben ${e(X.restM * 100)} (Selbstbehalt ${e(X.R.sb.ehe * 100)})`)}
    ${gez != null ? zeile(`Heute überwiesen (${H.monKurz(jetzt.k)})`, e(gez * 100), Math.abs(gez - X.summe) > 1 ? 'ur-abw' : '', Math.abs(gez - X.summe) > 1 ? `Rechner liegt ${e(Math.abs(X.summe - gez) * 100)} ${X.summe > gez ? 'darüber' : 'darunter'}` : 'passt') : ''}
  </div>`;

  // Bisherige Berechnungen: nachgerechnet mit demselben Rechenweg und verglichen mit dem, was du überwiesen hast
  const verlauf = (F?.berechnungen || []).map((b, i, L) => {
    const bis = L[i + 1] ? H.mVor(L[i + 1].ab, -1) : R.bisM;
    const ms = R.monate.filter((x) => x.k >= b.ab && x.k <= bis && x.k <= R.bisM);
    const gezahlt = ms.length ? ms.reduce((t, x) => t + x.sum, 0) / ms.length / 100 : null;
    let nach = '';
    if (b.eM && b.eS) {
      const Y = berechne({ m: b.ab, eM: b.eM, eS: b.eS, kinder, R: regelFuer(b.jahr), berechtigte: F?.rechner?.berechtigte || 3 });
      nach = Math.abs(Y.summe - b.summe) < 1 ? '<span class="pos">✓ nachgerechnet</span>' : `<span class="neg">Rechner: ${e(Y.summe * 100)}</span>`;
    } else if (b.eM && b.ku) {
      const ok = b.ku.every((x) => Math.abs(x - (tabelle(regelFuer(b.jahr), 2, Math.max(1, gruppe(b.eM) - 1)) - regelFuer(b.jahr).kg / 2)) < 0.01);
      nach = ok ? '<span class="pos">✓ Kindesunterhalt nachgerechnet</span>' : '';
    }
    return `<tr><td>${H.dde(b.datum)}<small>${H.esc(b.titel)} · ${H.esc(b.kurz || '')}</small></td><td class="r">${b.eM ? e(b.eM * 100) : '–'}</td>
      <td class="r">${(b.ku || []).map((x) => e(x * 100)).join(' + ')}</td><td class="r">${e(b.tu * 100)}</td><td class="r"><b>${e(b.summe * 100)}</b></td>
      <td class="r">${gezahlt != null ? `${e(gezahlt * 100)}<small>Ø ${ms.length} Mon. ab ${H.monKurz(b.ab)}</small>` : '–'}</td><td>${nach}</td></tr>`;
  }).join('');
  const tab = verlauf ? `<div class="ur-tab-r"><table class="t ur-tab"><thead><tr><th>Berechnung</th><th class="r">dein Einkommen</th><th class="r">Kinder</th><th class="r">Trennung</th><th class="r">Summe</th><th class="r">überwiesen</th><th></th></tr></thead><tbody>${verlauf}</tbody></table></div>` : '';

  const regler = `<div class="ur-wahl">
    <label>Dein Einkommen <select data-ur="basis"><option value="aktuell"${wahl.basis === 'aktuell' ? ' selected' : ''}>aktuelle Abrechnung</option><option value="12"${wahl.basis === '12' ? ' selected' : ''}>Ø letzte 12 Monate</option></select></label>
    <label>Netto deiner Ex-Frau (€) <input data-ur="sandra" type="text" inputmode="decimal" value="${H.NUM ? H.NUM.format(sNetto) : sNetto}"></label>
    <label>Sockel für Leo <select data-ur="sockel"><option value="angem"${wahl.sockel === 'angem' ? ' selected' : ''}>angemessener Selbstbehalt (${e(X.R.sb.angem * 100)})</option><option value="notw"${wahl.sockel === 'notw' ? ' selected' : ''}>notwendiger Selbstbehalt (${e(X.R.sb.notw * 100)})</option></select></label>
  </div>`;
  return H.karte5('Unterhaltsrechner', `Kindes- und Trennungsunterhalt für ${H.monLang(m)} – Rechenweg wie bei RA Vitti, mit deinen Abrechnungen`,
    `${regler}<div class="ur-r">${rechenweg}${ergebnis}</div>
    <h3 class="ur-h">Bisherige Berechnungen und was du überwiesen hast</h3>${tab}
    <p class="s5-erkl">${X.R.quelle}, Süddeutsche Leitlinien (OLG München). Dein Einkommen aus den echten Abrechnungen (tatsächliche Steuern); RA Vitti hat 2026 mit einem fiktiven Netto aus dem Brutto der Lohnsteuerbescheinigung 2025 gerechnet – daher liegt dein Einkommen hier anders. Der Dienstwagen-Vorteil zählt wie dort als Einkommen. Für Leo ab 18: Bedarf nach eurem gemeinsamen Einkommen, beide zahlen nach Leistungsfähigkeit. Orientierung, keine Rechtsberatung – verbindlich ist nur eine Berechnung deines Anwalts.</p>`, 'ur-k', '', 'uh-rechner');
}

export function rechnerBinden(el, neu) {
  el.querySelectorAll('[data-ur]').forEach((i) => {
    i.onchange = () => {
      const k = i.dataset.ur;
      if (k === 'sandra') { const v = parseFloat(String(i.value).replace(/\./g, '').replace(',', '.')); wahl.sandra = Number.isFinite(v) ? v : null; }
      else wahl[k] = i.value;
      merken(); neu();
    };
  });
}
