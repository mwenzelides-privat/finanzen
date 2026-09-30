// Chat: Fragen in eigenen Worten, die KI (Claude) wertet die Buchungen aus und antwortet mit Text, Tabellen und Grafiken.
// Die KI bekommt NICHT die ganze Datei. Sie ruft Werkzeuge auf, die hier im Browser rechnen,
// und sieht nur deren Ergebnisse (Summen, Gruppen, einzelne Buchungen).
// Zugang: eigener API-Schlüssel von Anthropic, nur auf diesem Gerät gespeichert.
import { parse, matcher } from './suche.js';
import { kontostaende, STATUS_TEXT } from './salden.js';

const API = 'https://api.anthropic.com/v1/messages';
const MODELLE = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (empfohlen)' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (gründlicher, teurer)' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (schnell, günstig)' },
];
const LIBS = ['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'];
const K = { key: 'fd.apikey', modell: 'fd.modell' };
const ls = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const e2 = (c) => Math.round(c) / 100;   // Cent → Euro (Zahl)
const dde = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

let D = null, app = null;
let verlauf = [];      // Nachrichten für die API
let laeuft = false;

export const chatDaten = (d) => { D = d; };
export function chatVergessen() { ls.del(K.key); ls.del(K.modell); verlauf = []; }

// ======================================================================= Werkzeuge
const TOOLS = [
  {
    name: 'buchungen_auswerten',
    description: 'Filtert die Buchungsliste und liefert Summen, auf Wunsch gruppiert, oder die einzelnen Buchungen. Für jede Frage zu Einnahmen, Ausgaben, Empfängern, Kategorien und Zeiträumen verwenden. Mehrere Aufrufe sind erlaubt, z. B. einer je Jahr zum Vergleich.',
    input_schema: {
      type: 'object',
      properties: {
        von: { type: 'string', description: 'Erster Tag, YYYY-MM-DD (optional)' },
        bis: { type: 'string', description: 'Letzter Tag, YYYY-MM-DD (optional)' },
        konten: { type: 'array', items: { type: 'string' }, description: 'Kontonamen genau wie in der Kontenliste (optional, sonst alle)' },
        kategorien: { type: 'array', items: { type: 'string' }, description: 'Hauptkategorien genau wie in der Liste (optional)' },
        unterkategorien: { type: 'array', items: { type: 'string' }, description: 'Unterkategorien genau wie in der Liste (optional)' },
        suche: { type: 'string', description: 'Suchtext wie im Dashboard: Wörter (alle müssen vorkommen), a|b (eines davon), "genaue Folge", -ohne, Beträge 49,99 >500 100-250. Durchsucht Empfänger, Verwendungszweck, Kategorie, Konto, Vertrag, Tags, Notiz.' },
        art: { type: 'string', enum: ['ohne Umbuchungen', 'alle', 'Einnahme', 'Ausgabe', 'Sparen', 'Umbuchung'], description: 'Standard: ohne Umbuchungen' },
        gruppieren_nach: { type: 'string', enum: ['keine', 'jahr', 'monat', 'kategorie', 'unterkategorie', 'konto', 'empfaenger'], description: 'Standard: keine (dann einzelne Buchungen)' },
        sortierung: { type: 'string', enum: ['datum', 'datum_absteigend', 'betrag_groesste_zuerst'], description: 'Für einzelne Buchungen. Standard: datum' },
        max_zeilen: { type: 'integer', description: 'Höchstzahl einzelner Buchungen oder Gruppen, Standard 40, höchstens 200' },
      },
    },
  },
  {
    name: 'kontostaende_am',
    description: 'Kontostände aller Konten an einem Tag (Tagesende), mit Angabe wie sicher der Wert ist.',
    input_schema: { type: 'object', properties: { datum: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['datum'] },
  },
  {
    name: 'fixkosten',
    description: 'Automatisch erkannte regelmäßige Zahlungen (Verträge, Abos, Miete, Versicherungen) mit Rhythmus, Betrag, pro Monat, seit, zuletzt.',
    input_schema: { type: 'object', properties: { auch_beendete: { type: 'boolean' } } },
  },
  {
    name: 'diagramm_zeigen',
    description: 'Zeigt dem Nutzer ein Diagramm in der Antwort. Nur mit Zahlen aus vorherigen Werkzeug-Ergebnissen.',
    input_schema: {
      type: 'object',
      properties: {
        titel: { type: 'string' },
        typ: { type: 'string', enum: ['balken', 'balken_horizontal', 'linie'] },
        beschriftungen: { type: 'array', items: { type: 'string' } },
        reihen: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, werte: { type: 'array', items: { type: 'number' } } }, required: ['name', 'werte'] } },
      },
      required: ['titel', 'typ', 'beschriftungen', 'reihen'],
    },
  },
  {
    name: 'dashboard_knopf',
    description: 'Fügt der Antwort einen Knopf hinzu, der das Dashboard mit passenden Filtern öffnet (dort kann der Nutzer die Buchungen sehen und als Excel herunterladen).',
    input_schema: {
      type: 'object',
      properties: {
        beschriftung: { type: 'string', description: 'z. B. „Alle Versicherungen 2025 anzeigen“' },
        suche: { type: 'string' }, jahr: { type: 'integer' }, monat: { type: 'integer' }, konto: { type: 'string' },
        kategorie: { type: 'string' }, unterkategorie: { type: 'string' }, art: { type: 'string', enum: ['alle', 'aus', 'ein'] },
        tab: { type: 'string', enum: ['buchungen', 'uebersicht', 'fix', 'konten'] },
      },
      required: ['beschriftung'],
    },
  },
];

function buchungenAuswerten(a) {
  const conds = a.suche ? parse(a.suche) : [];
  const test = matcher(conds);
  const konten = a.konten?.length ? new Set(a.konten.map((n) => D.kontoIdx.get(n)).filter((i) => i !== undefined)) : null;
  const unbekannt = (a.konten || []).filter((n) => !D.kontoIdx.has(n));
  const kats = a.kategorien?.length ? new Set(a.kategorien) : null;
  const ukats = a.unterkategorien?.length ? new Set(a.unterkategorien) : null;
  const art = a.art || 'ohne Umbuchungen';
  const rows = D.rows.filter((r) => (!a.von || r.d >= a.von) && (!a.bis || r.d <= a.bis)
    && (!konten || konten.has(r.k)) && (!kats || kats.has(r.kat)) && (!ukats || ukats.has(r.ukat))
    && (art === 'alle' || (art === 'ohne Umbuchungen' ? r.art !== 'Umbuchung' : r.art === art)) && test(r));
  let ein = 0, aus = 0, sum = 0;
  for (const r of rows) { sum += r.c; if (r.art === 'Einnahme') ein += r.c; else if (r.art === 'Ausgabe') aus += r.c; }
  const max = Math.min(200, Math.max(1, a.max_zeilen || 40));
  const out = {
    treffer: rows.length, summe_euro: e2(sum), einnahmen_euro: e2(ein), ausgaben_euro: e2(aus),
    erste_buchung: rows[0]?.d || null, letzte_buchung: rows[rows.length - 1]?.d || null,
  };
  if (unbekannt.length) out.hinweis_unbekannte_konten = unbekannt;
  if (conds.length) out.suche_verstanden_als = conds.map((c) => c.label);
  const g = a.gruppieren_nach || 'keine';
  if (g !== 'keine') {
    const key = { jahr: (r) => String(r.y), monat: (r) => r.d.slice(0, 7), kategorie: (r) => r.kat, unterkategorie: (r) => `${r.kat} / ${r.ukat || '–'}`,
      konto: (r) => D.konten[r.k].name, empfaenger: (r) => r.g || '(ohne Empfänger)' }[g];
    const m = new Map();
    for (const r of rows) { const k = key(r); const x = m.get(k) || m.set(k, { anzahl: 0, c: 0 }).get(k); x.anzahl++; x.c += r.c; }
    let gr = [...m].map(([k, x]) => ({ gruppe: k, anzahl: x.anzahl, summe_euro: e2(x.c) }));
    gr.sort(g === 'jahr' || g === 'monat' ? (x, y) => (x.gruppe < y.gruppe ? -1 : 1) : (x, y) => Math.abs(y.summe_euro) - Math.abs(x.summe_euro));
    out.gruppen_gesamt = gr.length;
    out.gruppen = gr.slice(0, max);
  } else {
    let rs = rows;
    if (a.sortierung === 'datum_absteigend') rs = [...rows].reverse();
    if (a.sortierung === 'betrag_groesste_zuerst') rs = [...rows].sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
    out.buchungen = rs.slice(0, max).map((r) => ({
      datum: r.d, konto: D.konten[r.k].name, empfaenger: r.g, zweck: r.z.length > 140 ? r.z.slice(0, 140) + '…' : r.z,
      kategorie: r.kat, unterkategorie: r.ukat, art: r.art, betrag_euro: e2(r.c), ...(r.v ? { vertrag: r.v } : {}), ...(r.n ? { notiz: r.n } : {}),
    }));
    if (rows.length > max) out.hinweis = `Nur ${max} von ${rows.length} Buchungen gezeigt. Für mehr: gruppieren oder enger filtern.`;
  }
  return out;
}

function kontostaendeAm({ datum }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum || '')) return { fehler: 'datum als YYYY-MM-DD angeben' };
  const liste = kontostaende(D, datum).filter((x) => !['nicht_eroeffnet', 'geschlossen'].includes(x.status));
  const out = liste.map((x) => ({
    konto: x.k.name, kontostand_euro: x.c == null ? null : e2(x.c),
    sicherheit: STATUS_TEXT[x.status] + (x.status === 'unbekannt' ? ` (Daten ab ${x.k.von})` : x.status === 'ungefaehr' ? ` (bis zu ${EUR.format(x.abw)} Abweichung)` : ''),
  }));
  const summe = liste.reduce((s, x) => s + (x.c ?? 0), 0);
  return { datum, konten: out, summe_euro: e2(summe), hinweis: 'Stand am Ende des Tages. Depot ist nicht enthalten. Konten ohne Wert (unbekannt, nicht berechenbar) sind nicht in der Summe.' };
}

function fixkostenListe({ auch_beendete } = {}) {
  const f = app.fixkosten().filter((x) => auch_beendete || x.aktiv);
  return {
    stand: D.bis,
    hinweis: 'Beiträge aufs Gemeinschaftskonto zählen zu den Fixkosten; Verträge, die vom Gemeinschaftskonto abgehen (gemeinsam=true), sind darin enthalten und nicht in der Summe.',
    summe_pro_monat_laufend_euro: e2(-f.filter((x) => x.aktiv && !x.gemeinsam).reduce((s, x) => s + x.proMonat, 0)),
    zahlungen: f.map((x) => ({ empfaenger: x.name, verwendungszweck: x.zweck, kategorie: `${x.kat} / ${x.ukat}`, konto: D.konten[x.k].name, rhythmus: x.rh.name,
      betrag_euro: e2(-x.betrag), pro_monat_euro: e2(-x.proMonat), preisverlauf_euro: x.stufen.map((s) => ({ betrag: e2(s.betrag), von: s.von, bis: s.bis })),
      seit: x.seit, zuletzt: x.zuletzt, laeuft: x.aktiv, ...(x.beitrag ? { beitrag_gemeinschaftskonto: true } : {}), ...(x.gemeinsam ? { gemeinsam: true } : {}) })),
  };
}

// ======================================================================= Anfrage an Claude
function systemText() {
  const kat = new Map();
  for (const [u, k] of D.ukatZu) { if (!kat.has(k)) kat.set(k, []); kat.get(k).push(u); }
  const konten = D.konten.map((k) => `- ${k.name}: Buchungen ${k.von} bis ${k.bis}${k.saldo != null ? `, Kontostand ${EUR.format(k.saldo)} am ${k.saldoAm}` : ''}${k.vollstaendig ? ', lückenlos seit Eröffnung' : ''}`).join('\n');
  return `Du bist der Finanz-Assistent in der privaten App „Finanzen“ des Nutzers. Heute ist der ${new Date().toISOString().slice(0, 10)}.
Die Daten: ${D.rows.length} Buchungen vom ${D.von} bis ${D.bis} (Stand der Datei ${D.j.erstellt}).

Konten:
${konten}

Kategorien (Hauptkategorie: Unterkategorien):
${[...kat].map(([k, u]) => `- ${k}: ${u.join(', ')}`).join('\n')}

Begriffe: Beträge < 0 sind Ausgaben, > 0 Einnahmen. Art „Umbuchung“ = Übertrag zwischen eigenen Konten (für Einnahmen/Ausgaben weglassen), „Sparen“ = Übertrag auf ein eigenes Sparkonto außerhalb der Liste.

Regeln:
- Rechne nie selbst aus dem Gedächtnis: hole jede Zahl mit den Werkzeugen. Ergebnisse sind in Euro.
- Antworte auf Deutsch, kurz und klar. Beträge im deutschen Format (1.234,56 €), Datum als TT.MM.JJJJ. Nutze Markdown-Tabellen für Aufstellungen.
- Wenn eine Grafik hilft (Verlauf, Vergleich), rufe diagramm_zeigen auf. Biete mit dashboard_knopf an, die Buchungen im Dashboard zu öffnen, wenn das nützlich ist.
- Steuerliche Fragen: suche breit (z. B. Kategorien Versicherungen, Steuern, Kinder, Gesundheit, Wohnen mit Handwerker/Nebenkosten; Suchbegriffe wie spende|kirchensteuer|handwerker|reparatur|schornstein|kita|kindergarten|tagesmutter|arzt|apotheke|brille|fortbildung|fachbuch|gewerkschaft|steuerberat|riester|ruerup|unterhalt|haftpflicht|berufsunfaehig) und ordne die Treffer den üblichen Posten der Einkommensteuererklärung zu (Vorsorgeaufwendungen, Sonderausgaben, außergewöhnliche Belastungen, haushaltsnahe Dienstleistungen/Handwerker § 35a, Kinderbetreuung, Werbungskosten). Weise kurz darauf hin, dass das eine Vorsortierung ist und keine Steuerberatung.
- Kontostände: nenne die Sicherheit des Werts, wenn er nicht exakt ist.
- Wenn etwas in den Daten fehlt, sag es offen.`;
}

async function claude(messages) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ls.get(K.key), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: ls.get(K.modell) || MODELLE[0].id, max_tokens: 4096, system: systemText(), tools: TOOLS, messages }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const m = j?.error?.message || '';
    if (r.status === 401) throw new Error('Der API-Schlüssel wird nicht akzeptiert. Bitte in den Chat-Einstellungen prüfen.');
    if (r.status === 400 && /credit|balance/i.test(m)) throw new Error('Das Guthaben im Anthropic-Konto reicht nicht (console.anthropic.com → Billing).');
    if (r.status === 429) throw new Error('Zu viele Anfragen – bitte kurz warten.');
    if (r.status === 529 || r.status >= 500) throw new Error('Der KI-Dienst ist gerade überlastet – bitte gleich noch einmal.');
    throw new Error(`Fehler ${r.status}${m ? ': ' + m : ''}`);
  }
  return r.json();
}

// ======================================================================= Anzeige
let libs = null;
function libsLaden() {
  if (!libs) libs = Promise.all(LIBS.map((src) => new Promise((res) => {
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = res; s.onerror = res;
    document.head.append(s);
  })));
  return libs;
}
function md(text) {
  // Nur einfache Textformatierung erlauben: keine Bilder, Formulare oder Einbettungen, über die Daten nach außen gelangen könnten
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(text, { gfm: true, breaks: true }), {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'blockquote', 'hr', 'del'],
      ALLOWED_ATTR: ['align'],
    });
  }
  return esc(text).replace(/\n/g, '<br>');
}

const liste = () => $('#chat-liste');
function nachUnten() { const l = liste(); l.scrollTop = l.scrollHeight; }
function blase(cls, html) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.innerHTML = html;
  liste().append(d);
  nachUnten();
  return d;
}

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function diagramm(ziel, a) {
  if (!window.Chart) return 'Diagramm-Bibliothek nicht geladen';
  const box = document.createElement('div');
  box.className = 'chat-chart';
  box.innerHTML = `<div class="chat-chart-t">${esc(a.titel)}</div><div class="chat-chart-c"><canvas></canvas></div>`;
  ziel.append(box);
  const farben = [css('--accent'), css('--aus'), css('--ein'), css('--muted'), '#9085e9', '#eda100'];
  const quer = a.typ === 'balken_horizontal';
  if (quer) box.querySelector('.chat-chart-c').style.height = `${Math.max(160, a.beschriftungen.length * 26 + 40)}px`;
  new window.Chart(box.querySelector('canvas'), {
    type: a.typ === 'linie' ? 'line' : 'bar',
    data: {
      labels: a.beschriftungen,
      datasets: a.reihen.map((r, i) => ({ label: r.name, data: r.werte, backgroundColor: farben[i % farben.length], borderColor: farben[i % farben.length], borderRadius: 4, tension: 0.3, pointRadius: 2 })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: quer ? 'y' : 'x', animation: { duration: 200 },
      plugins: {
        legend: { display: a.reihen.length > 1, labels: { color: css('--text-2'), boxWidth: 10 } },
        tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${EUR.format(it.raw)}` } },
      },
      scales: {
        x: { ticks: { color: css('--muted') }, grid: { color: quer ? css('--grid') : 'transparent' } },
        y: { ticks: { color: css('--muted') }, grid: { color: quer ? 'transparent' : css('--grid') } },
      },
    },
  });
  nachUnten();
  return 'Diagramm angezeigt';
}

function knopf(ziel, a) {
  const b = document.createElement('button');
  b.className = 'btn sm chat-aktion';
  b.textContent = '→ ' + a.beschriftung;
  const f = { q: a.suche || '', jahr: a.jahr ? String(a.jahr) : '', monat: a.monat ? String(a.monat) : '', konto: a.konto || '', kat: a.kategorie || '',
    ukat: a.unterkategorie || '', art: a.art || 'alle', tab: a.tab || 'buchungen' };
  b.onclick = () => { app.setze(f); if (matchMedia('(max-width: 760px)').matches) schliessen(); };
  ziel.append(b);
  nachUnten();
  return 'Knopf angezeigt';
}

const STATUS = { buchungen_auswerten: 'Buchungen ausgewertet', kontostaende_am: 'Kontostände berechnet', fixkosten: 'Fixkosten geprüft' };
function statusText(t) {
  const a = t.input || {};
  const teile = [a.von && a.bis ? `${dde(a.von)}–${dde(a.bis)}` : a.von ? `ab ${dde(a.von)}` : a.bis ? `bis ${dde(a.bis)}` : '', a.datum && dde(a.datum),
    ...(a.konten || []), ...(a.kategorien || []), ...(a.unterkategorien || []), a.suche && `„${a.suche}“`].filter(Boolean);
  return `${STATUS[t.name]}${teile.length ? ': ' + teile.join(', ') : ''}`;
}

async function fragen(text) {
  if (laeuft || !text.trim()) return;
  if (!D) return blase('fehler', 'Noch keine Daten geladen.');
  laeuft = true;
  $('#chat-senden').disabled = true;
  $('#chat-leer')?.remove();
  blase('user', esc(text).replace(/\n/g, '<br>'));
  const antwort = blase('ai', '<div class="denkt"><span></span><span></span><span></span></div>');
  const inhalt = document.createElement('div');
  await libsLaden();
  const start = verlauf.length;
  verlauf.push({ role: 'user', content: text });
  try {
    for (let runde = 0; runde < 12; runde++) {
      const r = await claude(verlauf);
      verlauf.push({ role: 'assistant', content: r.content });
      const ergebnisse = [];
      for (const b of r.content) {
        if (b.type === 'text' && b.text.trim()) { const d = document.createElement('div'); d.className = 'md'; d.innerHTML = md(b.text); inhalt.append(d); }
        if (b.type !== 'tool_use') continue;
        let res;
        try {
          if (b.name === 'buchungen_auswerten') res = buchungenAuswerten(b.input);
          else if (b.name === 'kontostaende_am') res = kontostaendeAm(b.input);
          else if (b.name === 'fixkosten') res = fixkostenListe(b.input);
          else if (b.name === 'diagramm_zeigen') res = diagramm(inhalt, b.input);
          else if (b.name === 'dashboard_knopf') res = knopf(inhalt, b.input);
          else res = { fehler: 'unbekanntes Werkzeug' };
        } catch (e) { res = { fehler: String(e.message || e) }; }
        if (STATUS[b.name]) { const s = document.createElement('div'); s.className = 'werkzeug'; s.textContent = '✓ ' + statusText(b); inhalt.append(s); }
        ergebnisse.push({ type: 'tool_result', tool_use_id: b.id, content: typeof res === 'string' ? res : JSON.stringify(res) });
      }
      antwort.replaceChildren(inhalt);
      if (r.stop_reason === 'tool_use') { const d = document.createElement('div'); d.className = 'denkt'; d.innerHTML = '<span></span><span></span><span></span>'; antwort.append(d); }
      nachUnten();
      if (r.stop_reason !== 'tool_use') break;
      verlauf.push({ role: 'user', content: ergebnisse });
    }
  } catch (e) {
    antwort.querySelector('.denkt')?.remove();
    const f = document.createElement('div'); f.className = 'fehler'; f.textContent = e.message; antwort.append(f);
    verlauf.length = start;  // abgebrochene Frage aus dem Verlauf nehmen, damit die nächste sauber startet
  } finally {
    antwort.querySelector('.denkt')?.remove();
    laeuft = false;
    $('#chat-senden').disabled = false;
    nachUnten();
  }
}

// ======================================================================= Fenster
const BEISPIELE = [
  'Wie waren meine Kontostände am 31.12.2024?',
  'Welche steuerlich relevanten Buchungen hatte ich 2025?',
  'Wofür habe ich 2025 mehr ausgegeben als 2024?',
  'Was kosten mich meine Versicherungen im Jahr?',
  'Wie haben sich meine Lebensmittelausgaben seit 2020 entwickelt?',
];

function leerZeigen() {
  liste().innerHTML = `<div id="chat-leer" class="chat-leer"><p>Frag einfach in eigenen Worten. Die KI wertet deine Buchungen aus und zeigt dir Tabellen und Grafiken.</p>
    <div class="beispiele">${BEISPIELE.map((b) => `<button>${esc(b)}</button>`).join('')}</div></div>`;
  liste().querySelectorAll('.beispiele button').forEach((b) => b.onclick = () => fragen(b.textContent));
}

function einrichtungZeigen(an) {
  $('#chat-setup').hidden = !an;
  $('#chat-haupt').hidden = an;
  if (an) {
    $('#chat-key').value = '';
    $('#chat-key').placeholder = ls.get(K.key) ? 'gespeichert – zum Ändern neu eingeben' : 'sk-ant-…';
    $('#chat-modell').innerHTML = MODELLE.map((m) => `<option value="${m.id}"${(ls.get(K.modell) || MODELLE[0].id) === m.id ? ' selected' : ''}>${m.name}</option>`).join('');
    $('#chat-key-loeschen').hidden = !ls.get(K.key);
  }
}

function oeffnen() {
  $('#chat').hidden = false;
  document.body.classList.add('chat-offen');
  libsLaden();
  if (!ls.get(K.key)) einrichtungZeigen(true);
  else { einrichtungZeigen(false); setTimeout(() => $('#chat-eingabe').focus(), 50); }
}
function schliessen() { $('#chat').hidden = true; document.body.classList.remove('chat-offen'); }

export function chatStart(api) {
  app = api;
  leerZeigen();
  $('#chat-knopf').onclick = () => ($('#chat').hidden ? oeffnen() : schliessen());
  $('#chat-zu').onclick = schliessen;
  $('#chat-neu').onclick = () => { if (laeuft) return; verlauf = []; leerZeigen(); };
  $('#chat-einst').onclick = () => einrichtungZeigen($('#chat-setup').hidden);
  $('#chat-speichern').onclick = () => {
    const k = $('#chat-key').value.trim();
    if (k) ls.set(K.key, k);
    ls.set(K.modell, $('#chat-modell').value);
    if (!ls.get(K.key)) { $('#chat-key').focus(); return; }
    einrichtungZeigen(false);
    $('#chat-eingabe').focus();
  };
  $('#chat-key-loeschen').onclick = () => { ls.del(K.key); einrichtungZeigen(true); };
  const ein = $('#chat-eingabe');
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); const t = ein.value; ein.value = ''; ein.style.height = ''; fragen(t); };
  ein.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); } });
  ein.addEventListener('input', () => { ein.style.height = ''; ein.style.height = Math.min(160, ein.scrollHeight) + 'px'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#chat').hidden && !document.querySelector('dialog[open]')) schliessen(); });
}
