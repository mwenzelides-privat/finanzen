// Steuer: steuerlich relevante Buchungen eines Jahres, vorgeprüft und den Abschnitten der Einkommensteuererklärung
// zugeordnet. Grundlage sind die Steuerkategorien aus WISO/Buhl (falls vorhanden) und Regeln für nicht markierte
// Buchungen. Du kannst jede Buchung umsortieren, bestätigen, ausschließen und kommentieren; die Entscheidungen
// bleiben auf diesem Gerät gespeichert (und lassen sich als Datei sichern). Ausgabe als PDF oder Excel.
// Die Hinweise sind eine Orientierung, keine Steuerberatung.
import { norm } from './suche.js';
import { kvLesen, kvSchreiben } from './quelle.js';
import { alsExcelMappe, herunterladen } from './export.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur = (c) => EUR.format(c / 100);
const dde = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// ---------------------------------------------------------------- Abschnitte und Posten
const ABSCHNITTE = [
  { id: 'wk', name: 'Werbungskosten', form: 'Anlage N',
    info: (j) => `Arbeitnehmer-Pauschbetrag ${eur(pausch(j))}: Nur der Betrag darüber wirkt sich aus.` },
  { id: 'vorsorge', name: 'Vorsorgeaufwendungen', form: 'Anlage Vorsorgeaufwand, Riester: Anlage AV',
    info: () => 'Abziehbar bis zu Höchstbeträgen; Basisbeiträge zur Kranken- und Pflegeversicherung voll. Sach- und Rechtsschutzversicherungen zählen privat nicht.' },
  { id: 'sonder', name: 'Sonderausgaben', form: 'Hauptvordruck, Anlage U, Anlage Kind',
    info: () => 'Unterhalt an den getrennt lebenden Ehegatten (Realsplitting) bis 13.805 € zzgl. übernommener Kranken-/Pflegeversicherung, nur mit ihrer Zustimmung (Anlage U). Schulgeld für Privatschulen: 30 %, höchstens 5.000 €.' },
  { id: 'agb', name: 'Außergewöhnliche Belastungen', form: 'Anlage Außergewöhnliche Belastungen',
    info: () => 'Krankheitskosten wirken erst über der zumutbaren Belastung (je nach Einkünften, Familienstand und Kinderzahl etwa 1–7 % der Einkünfte). Erstattungen der Krankenkasse werden abgezogen.' },
  { id: 'haushalt', name: 'Handwerker und haushaltsnahe Dienstleistungen', form: '§ 35a EStG, Anlage Haushaltsnahe Aufwendungen',
    info: () => '20 % der Arbeitskosten werden direkt von der Steuer abgezogen: Handwerker höchstens 1.200 €, haushaltsnahe Dienstleistungen höchstens 4.000 € im Jahr. Nur Arbeitskosten laut Rechnung und nur unbar bezahlt; Material und Verbrauch zählen nicht.' },
  { id: 'kinder', name: 'Kinder', form: 'Anlage Kind',
    info: (j) => (j >= 2025 ? 'Kinderbetreuung (Kinder unter 14): 80 % der Kosten, höchstens 4.800 € je Kind.' : 'Kinderbetreuung (Kinder unter 14): zwei Drittel der Kosten, höchstens 4.000 € je Kind.') },
  { id: 'einnahmen', name: 'Einnahmen (zur Kontrolle)', form: 'Info',
    info: () => 'Nicht abziehbar. Maßgeblich sind Lohnsteuerbescheinigung, Steuerbescheinigungen der Banken und der Kindergeldbescheid.' },
];
const pausch = (j) => (j >= 2023 ? 123000 : j >= 2022 ? 120000 : 100000);

const POSTEN = [
  ['wk-arbeitsmittel', 'wk', 'Arbeitsmittel', 'Arbeitsgeräte für den Beruf (Computer, Werkzeug, Fachbücher). Bis 952 € brutto im Jahr des Kaufs, teurere über die Nutzungsdauer; private Mitnutzung anteilig.'],
  ['wk-fortbildung', 'wk', 'Fortbildung, Seminare, Studium', 'Kurse, Seminare und Studium mit Bezug zum Beruf, einschließlich Fahrt- und Übernachtungskosten.'],
  ['wk-verbaende', 'wk', 'Berufsverbände, Gewerkschaft', 'Beiträge zu Gewerkschaft oder Berufsverband.'],
  ['wk-kleidung', 'wk', 'Berufskleidung', 'Nur typische Berufs- oder Schutzkleidung (Uniform, Sicherheitsschuhe), keine Alltagskleidung.'],
  ['wk-arbeitszimmer', 'wk', 'Arbeitszimmer, Homeoffice', 'Arbeitszimmer nur, wenn es der Mittelpunkt der Arbeit ist; sonst Homeoffice-Pauschale 6 € je Tag (höchstens 1.260 € im Jahr).'],
  ['wk-fahrten', 'wk', 'Fahrkarten, Reisekosten', 'Dienstliche Fahrten und Reisen. Der tägliche Weg zur Arbeit läuft über die Entfernungspauschale, nicht über Belege.'],
  ['wk-uebernachtung', 'wk', 'Übernachtungen (Dienstreisen)', 'Hotelkosten auf beruflichen Reisen, soweit der Arbeitgeber sie nicht erstattet. Essen zählt nur über Verpflegungspauschalen.'],
  ['wk-telefon', 'wk', 'Telefon und Internet (beruflicher Anteil)', 'Beruflicher Anteil von Telefon und Internet: ohne Nachweis 20 % der Rechnung, höchstens 20 € im Monat.'],
  ['wk-porto', 'wk', 'Porto, Büromaterial', 'Porto und Büromaterial für berufliche Zwecke, z. B. Bewerbungen.'],
  ['wk-rechtsschutz', 'wk', 'Berufsrechtsschutz, Rechts- und Beratungskosten', 'Berufsrechtsschutz (Anteil) und Anwaltskosten in beruflichen Angelegenheiten, z. B. Arbeitsrecht. Private Rechtsstreitigkeiten zählen nicht.'],
  ['wk-steuerberatung', 'wk', 'Steuerberatung', 'Der Anteil der Steuerberatung für die Einkünfte (z. B. Anlage N). Der private Teil ist nicht absetzbar.'],
  ['wk-umzug', 'wk', 'Umzugskosten (beruflich)', 'Nur bei beruflich veranlasstem Umzug (neue Stelle, Arbeitsweg deutlich kürzer): Wohnungssuche, Transport, Makler für eine Mietwohnung, Umzugspauschale.'],
  ['wk-sonstige', 'wk', 'Sonstige Werbungskosten', 'Weitere berufliche Kosten, z. B. Bewerbungen oder doppelte Haushaltsführung.'],
  ['vs-kv', 'vorsorge', 'Kranken- und Pflegeversicherung', 'Basisbeiträge zur Kranken- und Pflegeversicherung voll; Zusatzversicherungen nur begrenzt.'],
  ['vs-riester', 'vorsorge', 'Riester-Rente', 'Riester-Beiträge (Anlage AV): Zulagen oder Sonderausgabenabzug bis 2.100 € im Jahr.'],
  ['vs-leben', 'vorsorge', 'Lebensversicherungen', 'Nur Risikolebensversicherungen sowie Kapital-Lebensversicherungen mit Vertragsbeginn vor 2005; begrenzt abziehbar.'],
  ['vs-bu', 'vorsorge', 'Berufsunfähigkeitsversicherung', 'Sonstige Vorsorgeaufwendungen – begrenzt; der Rahmen ist oft schon durch die Krankenversicherung ausgeschöpft.'],
  ['vs-haftpflicht', 'vorsorge', 'Haftpflichtversicherungen', 'Privat-, Kfz- und Tierhalterhaftpflicht – sonstige Vorsorgeaufwendungen (begrenzt).'],
  ['vs-weitere', 'vorsorge', 'Unfall-, Kfz- und weitere Versicherungen', 'Unfallversicherung, Kfz-Haftpflichtanteil – begrenzt. Kasko, Hausrat, Glas und private Rechtsschutzversicherungen zählen nicht.'],
  ['sa-unterhalt', 'sonder', 'Unterhalt an den Ehegatten (Realsplitting)', 'Unterhalt an den getrennt lebenden oder geschiedenen Ehegatten (Anlage U), nur mit ihrer Zustimmung – sie versteuert ihn dann. Kindesunterhalt zählt nicht.'],
  ['sa-spenden', 'sonder', 'Spenden und Mitgliedsbeiträge', 'Spenden und Beiträge an gemeinnützige Organisationen; bis 300 € reicht der Kontoauszug als Nachweis.'],
  ['sa-schulgeld', 'sonder', 'Schulgeld', '30 % des Schulgelds für Privatschulen, höchstens 5.000 € – ohne Verpflegung und Betreuung.'],
  ['sa-kirchensteuer', 'sonder', 'Kirchensteuer', 'Selbst gezahlte Kirchensteuer, auch Nachzahlungen.'],
  ['agb-krankheit', 'agb', 'Krankheitskosten (Arzt, Zahnarzt, Brille, Medikamente)', 'Selbst getragene Krankheitskosten: Arzt, Zahnarzt, Brille, Medikamente mit Rezept, Physiotherapie. Wirken über der zumutbaren Belastung.'],
  ['agb-sonstige', 'agb', 'Sonstige außergewöhnliche Belastungen', 'Z. B. Pflegekosten, Beerdigung, Unterhalt an bedürftige Angehörige.'],
  ['ha-handwerker', 'haushalt', 'Handwerkerleistungen', 'Arbeitskosten von Handwerkern im eigenen Haushalt laut Rechnung, unbar bezahlt. Material zählt nicht.'],
  ['ha-dienstleistung', 'haushalt', 'Haushaltsnahe Dienstleistungen', 'Reinigung, Gartenpflege, privates Umzugsunternehmen, Pflegedienst im Haushalt – Arbeitskosten laut Rechnung.'],
  ['ha-nebenkosten', 'haushalt', 'Nebenkosten, Hausgeld (Abrechnung prüfen)', 'Nur die Arbeitsanteile aus der jährlichen Neben- oder Hausgeldabrechnung (Hausmeister, Treppenhausreinigung, Schornsteinfeger).'],
  ['ki-betreuung', 'kinder', 'Kinderbetreuung', 'Kita, Tagesmutter, Hort, Babysitter für Kinder unter 14, unbar bezahlt – ohne Verpflegung und Unterricht.'],
  ['ein-lohn', 'einnahmen', 'Arbeitslohn (Auszahlungen)', 'Zur Kontrolle; maßgeblich ist die Lohnsteuerbescheinigung.'],
  ['ein-kindergeld', 'einnahmen', 'Kindergeld', 'Zur Kontrolle; wird mit dem Kinderfreibetrag verglichen.'],
  ['ein-kapital', 'einnahmen', 'Kapitalerträge, Zinsen', 'Zur Kontrolle; maßgeblich sind die Steuerbescheinigungen der Banken.'],
  ['ein-miete', 'einnahmen', 'Mieteinnahmen', 'Mieteinnahmen gehören in die Anlage V.'],
  ['ein-sonstige', 'einnahmen', 'Weitere Einnahmen', 'Zur Kontrolle.'],
  ['ein-steuern', 'einnahmen', 'Zahlungen an das und Erstattungen vom Finanzamt', 'Vorauszahlungen und Nachzahlungen werden auf die Steuer angerechnet – wichtig für die Steuerberaterin.'],
].map(([id, abschnitt, name, info]) => ({ id, abschnitt, name, info }));
const POSTEN_ID = new Map(POSTEN.map((p) => [p.id, p]));

// Steuerkategorien aus WISO/Buhl → Posten
const BUHL = {
  Arbeitsmittel: 'wk-arbeitsmittel', Seminargebuehren: 'wk-fortbildung', Semesterbeitraege: 'wk-fortbildung', 'Beitraege zu Berufsverbaenden': 'wk-verbaende',
  Berufskleidung: 'wk-kleidung', Arbeitszimmer: 'wk-arbeitszimmer', Fahrkarten: 'wk-fahrten', 'Fahrkarten & Reisekosten': 'wk-fahrten', Uebernachtungskosten: 'wk-uebernachtung',
  'Telefon & Internet': 'wk-telefon', Porto: 'wk-porto', Berufsrechtschutzversicherungen: 'wk-rechtsschutz', 'Rechts- & Beratungskosten': 'wk-rechtsschutz',
  Steuerberatungskosten: 'wk-steuerberatung', Arbeitnehmer: 'wk-sonstige',
  'Kranken- & Pflegeversicherungen': 'vs-kv', Krankenkassen: 'vs-kv', 'Riester-Rentenversicherungen': 'vs-riester', Lebensversicherungen: 'vs-leben',
  Berufsunfaehigkeitsversicherungen: 'vs-bu', Haftpflichtversicherungen: 'vs-haftpflicht', 'Weitere Versicherungen': 'vs-weitere', 'Versicherungen & Altersvorsorge': 'vs-weitere',
  'Ehegatten-Unterhalt und Ausgleich': 'sa-unterhalt', 'Steuerbeguenstigte Vereine': 'sa-spenden', Schulgeld: 'sa-schulgeld',
  Arztrechnungen: 'agb-krankheit', 'Medikamente & andere Krankheitskosten': 'agb-krankheit', 'Krankheit & andere Besonderheiten': 'agb-krankheit', Krankenhauskosten: 'agb-krankheit',
  Handwerkerleistungen: 'ha-handwerker', Erhaltungsaufwendungen: 'ha-handwerker', Material: 'ha-handwerker',
  Nebenkosten: 'ha-nebenkosten', Hausgeld: 'ha-nebenkosten', Muellentsorgung: 'ha-nebenkosten', Wasser: 'ha-nebenkosten', Heizung: 'ha-nebenkosten', Strom: 'ha-nebenkosten',
  Kinderbetreuung: 'ki-betreuung',
  'Loehne, Betriebsrenten & Pensionen': 'ein-lohn', Kindergeld: 'ein-kindergeld', Kapitalanleger: 'ein-kapital', Mieteinnahmen: 'ein-miete', 'Weitere Einnahmen': 'ein-sonstige',
  Steuervorauszahlungen: 'ein-steuern',
};
// Vorschläge für Buchungen ohne Buhl-Kategorie: Finanzguru-Unterkategorie oder Suchwörter
const FG_VORSCHLAG = {
  'Aerztliche Behandlung': 'agb-krankheit', Apotheke: 'agb-krankheit', 'Sonstige Gesundheitsausgaben': 'agb-krankheit', Spende: 'sa-spenden',
  Riestervertrag: 'vs-riester', Lebensversicherung: 'vs-leben', Berufsunfaehigkeitsversicherung: 'vs-bu', Haftpflichtversicherung: 'vs-haftpflicht',
  Jagdhaftpflichtversicherung: 'vs-haftpflicht', Unfallversicherung: 'vs-weitere', 'KFZ-Versicherung': 'vs-weitere', 'Gesetzliche Krankenversicherung': 'vs-kv',
  'Private Krankenversicherung': 'vs-kv', Trennungsunterhalt: 'sa-unterhalt', Kinderbetreuung: 'ki-betreuung', 'Schule & Foerderung': 'sa-schulgeld', Bildung: 'wk-fortbildung',
  'Lohn / Gehalt': 'ein-lohn', Kindergeld: 'ein-kindergeld', Kapitalertraege: 'ein-kapital', Mobilfunk: 'wk-telefon', 'Internet & Telefon': 'wk-telefon',
};
const WORT_VORSCHLAG = [
  [/steuerberat/, 'wk-steuerberatung'], [/gewerkschaft|verdi|ig metall|berufsverband/, 'wk-verbaende'], [/kirchensteuer/, 'sa-kirchensteuer'],
  [/schornsteinfeger|kaminkehrer|handwerker|elektriker|sanitaer|installateur|malerbetrieb|dachdecker|fliesenleger|schreinerei/, 'ha-handwerker'],
  [/finanzamt|einkommensteuer/, 'ein-steuern'], [/zahnarzt|zahnaerzt|arztpraxis|facharzt|klinik|physiotherap|heilpraktiker|optiker|fielmann/, 'agb-krankheit'],
  [/spende|caritas|unicef|rotes kreuz|misereor|greenpeace/, 'sa-spenden'], [/kita\b|kindergarten|tagesmutter|kinderkrippe|\bhort\b|ferienbetreuung/, 'ki-betreuung'],
];
const RESTAURANT = /restaurant|gasthaus|gasthof|wirtshaus|pizz|sushi|imbiss|\bcafe|bistro|braeu|brauerei|grill|kebab|doener|burger|mcd|trattoria|osteria|biergarten|baeckerei|metzgerei|wok\b/;
const MARKT = /\bobi\b|hagebau|bauhaus|hornbach|toom|baywa|dehner|globus|hellweg|raiffeisen|gartencenter|\bikea\b/;

// Plausibilitätsprüfung: { art: 'pruefen' | 'info', text (Einschätzung), rat (Empfehlung), aktionen: [{ t, p ('x' = ausschließen), notiz }] }
const AUS = { t: '✕ Ausschließen – nicht absetzbar', p: 'x' };
function pruefung(r, p) {
  const t = norm(`${r.g} ${r.z}`);
  if (p === 'wk-uebernachtung' && (RESTAURANT.test(t) || r.kat === 'Essen & Trinken')) return { art: 'pruefen',
    text: 'Das ist ein Restaurantbesuch, keine Übernachtung. Essen ist steuerlich fast nie absetzbar – auch auf Dienstreisen gibt es dafür nur Verpflegungspauschalen, keine Belege.',
    rat: 'Privates Essen → ausschließen. Nur eine Hotelrechnung auf beruflicher Reise gehört hierher.', aktionen: [AUS, { t: 'Ist eine Hotelrechnung (Dienstreise) – behalten', p: 'wk-uebernachtung' }] };
  if ((p === 'ha-handwerker' || p === 'ha-dienstleistung') && MARKT.test(norm(r.g))) return { art: 'pruefen',
    text: 'Einkauf im Bau- oder Gartenmarkt = Material. Nach § 35a zählen nur die Arbeitskosten eines Handwerkers laut Rechnung, nicht selbst gekauftes Material.',
    rat: 'Ausschließen.', aktionen: [AUS] };
  if (p === 'ha-nebenkosten') return { art: 'pruefen',
    text: 'Abschläge für Strom, Gas, Wasser, Heizung oder Müll sind selbst nicht absetzbar. Absetzbar sind nur Arbeitsanteile (Hausmeister, Treppenhausreinigung, Gartenpflege, Schornsteinfeger) aus der jährlichen Neben- oder Hausgeldabrechnung.',
    rat: 'Monatliche Abschläge → ausschließen. Die Jahresabrechnung (mit § 35a-Ausweis) direkt der Steuerberaterin geben.', aktionen: [AUS, { t: 'Ist eine Jahresabrechnung – behalten', p: 'ha-nebenkosten' }] };
  if (p === 'sa-unterhalt' && (/kind|gesamt/.test(norm(r.z)) || r.ukat === 'Kindesunterhalt')) return { art: 'pruefen',
    text: 'Die Zahlung enthält Kindes- und Ehegattenunterhalt. Absetzbar (Realsplitting, Anlage U) ist nur der Unterhalt für den Ehegatten, Kindesunterhalt nicht.',
    rat: 'Behalten und in der Notiz den Ehegattenanteil angeben, z. B. „davon 1.360 € Ehegattenunterhalt“.', aktionen: [{ t: 'Behalten und Ehegattenanteil notieren', p: 'sa-unterhalt', notiz: true }, AUS] };
  if (p === 'wk-arbeitszimmer' && /immobilienscout|immowelt|wohnungsboerse/.test(t)) return { art: 'pruefen',
    text: 'Das ist Wohnungssuche, kein Arbeitszimmer. Kosten der Wohnungssuche sind nur absetzbar, wenn der Umzug beruflich veranlasst war (neue Stelle, Arbeitsweg deutlich kürzer) – dann als Umzugskosten. Privat veranlasst sind sie nicht absetzbar.',
    rat: 'Privater Umzug → ausschließen. Beruflicher Umzug → als Umzugskosten übernehmen.', aktionen: [AUS, { t: 'Beruflicher Umzug – als Umzugskosten übernehmen', p: 'wk-umzug' }] };
  if (p === 'sa-schulgeld') return { art: 'pruefen',
    text: 'Schulgeld ist nur für Privatschulen absetzbar (30 %, höchstens 5.000 €). Bei einer staatlichen Schule sind es meist Klassenfahrt, Kopiergeld oder Material – das ist nicht absetzbar.',
    rat: 'Staatliche Schule → ausschließen. Privatschule → behalten.', aktionen: [AUS, { t: 'Privatschule – als Schulgeld behalten', p: 'sa-schulgeld' }] };
  if (p === 'ki-betreuung' && /urlaub|reise|ferien(?!betreuung)/.test(t)) return { art: 'pruefen',
    text: 'Urlaubs- oder Reisekosten sind keine Kinderbetreuung und nicht absetzbar.', rat: 'Ausschließen.', aktionen: [AUS] };
  if (p === 'vs-weitere' && /hausrat|glasvers|reise|rechtsschutz/.test(norm(`${r.ukat} ${r.z}`))) return { art: 'pruefen',
    text: 'Hausrat-, Glas-, Reise- und private Rechtsschutzversicherungen sind nicht absetzbar. Ausnahme: Berufsrechtsschutz (anteilig als Werbungskosten).',
    rat: 'Privat → ausschließen. Berufsrechtsschutz → dort übernehmen.', aktionen: [AUS, { t: 'Ist Berufsrechtsschutz – übernehmen', p: 'wk-rechtsschutz' }] };
  if (p === 'wk-arbeitsmittel' && r.c < -80000) return { art: 'pruefen',
    text: 'Über 952 € brutto wird über die Nutzungsdauer abgeschrieben (Computer und Software im Jahr des Kaufs komplett). Absetzbar ist es trotzdem, wenn es beruflich genutzt wird.',
    rat: 'Beruflich genutzt → behalten, die Steuerberaterin rechnet die Abschreibung. Privat → ausschließen.', aktionen: [{ t: 'Beruflich genutzt – behalten', p: 'wk-arbeitsmittel' }, AUS] };
  if (p === 'wk-telefon') return { art: 'info', text: 'Absetzbar ist nur der berufliche Anteil: ohne Nachweis pauschal 20 % der Rechnung, höchstens 20 € im Monat. Die Steuerberaterin rechnet den Anteil.', rat: '', aktionen: [] };
  if (p === 'wk-steuerberatung') return { art: 'info', text: 'Absetzbar ist nur der Anteil für die Einkünfte (z. B. Anlage N), der private Teil nicht. Die Steuerberaterin teilt die Rechnung auf.', rat: '', aktionen: [] };
  return null;
}

// ---------------------------------------------------------------- Zustand
let D = null, ctx = null;
let jahr = 0, filter = 'zu', offen = new Set(['wk', 'vorsorge', 'sonder', 'agb', 'haushalt', 'kinder']);
const detailOffen = new Set();
let entscheidungen = {};          // Schlüssel → { p (Posten-ID) | x (ausgeschlossen), ok (bestätigt), n (Notiz) }
let geladen = false;
const KV = 'steuer-entscheidungen';

export async function steuerDaten(d) {
  D = d;
  if (!geladen) { entscheidungen = (await kvLesen(KV)) || {}; geladen = true; }
  // stabile Schlüssel je Buchung (Datum|Konto|Betrag|Empfänger|laufende Nr. bei Gleichen)
  const zaehler = new Map();
  for (const r of D.rows) {
    const k = `${r.d}|${D.konten[r.k].name}|${r.c}|${norm(r.g).slice(0, 24)}`;
    const n = (zaehler.get(k) || 0) + 1; zaehler.set(k, n);
    r.skey = n > 1 ? `${k}|${n}` : k;
  }
}
const speichern = () => kvSchreiben(KV, entscheidungen).catch(() => {});

// Automatische Einordnung einer Buchung (ohne deine Entscheidungen): { p, quelle: 'buhl'|'vorschlag', hinweis }
function automatisch(r) {
  if (r.art === 'Umbuchung' || r.art === 'Sparen') return null;
  let p = r.st ? BUHL[r.st] : null, quelle = 'buhl', grund = r.st ? `Steuerkategorie in WISO/Buhl: „${r.st}“` : '';
  if (!p) {
    quelle = 'vorschlag';
    p = FG_VORSCHLAG[r.ukat] || null;
    grund = p ? `Finanzguru-Kategorie „${r.ukat}“` : '';
    const t = norm(`${r.g} ${r.z}`);
    if (!p) { const w = WORT_VORSCHLAG.find(([re]) => re.test(t)); if (w) { p = w[1]; grund = `Stichwort im Empfänger oder Verwendungszweck (${(t.match(w[0]) || [''])[0]})`; } }
    // Tierarzt, Tierbedarf: nicht absetzbar
    if (p === 'agb-krankheit' && (/tierarzt|tieraerzt|tierklinik|veterinaer/.test(t) || r.kat === 'Haustiere')) p = null;
    if (p && POSTEN_ID.get(p).abschnitt === 'einnahmen' && r.c < 0 && p !== 'ein-steuern') p = null;
  }
  return p ? { p, quelle, grund } : null;
}

// Alle Buchungen eines Jahres mit Posten, Status und Hinweis
function einordnen(j) {
  const out = [];
  for (const r of D.rows) {
    if (r.y !== j) continue;
    const e = entscheidungen[r.skey];
    const a = automatisch(r);
    if (!a && !e?.p) continue;
    if (e?.x) { out.push({ r, p: e.p || a?.p, status: 'ausgeschlossen', hinweis: '', notiz: e.n || '', grund: 'von dir ausgeschlossen' }); continue; }
    const p = e?.p || a.p;
    const pr = pruefung(r, p);
    let status = e?.ok || e?.p ? 'bestaetigt' : a.quelle === 'buhl' ? 'uebernommen' : 'vorschlag';
    if (status !== 'bestaetigt' && pr?.art === 'pruefen') status = 'pruefen';
    let hinweis = pr?.text || '', rat = pr?.rat || '', aktionen = status === 'bestaetigt' ? [] : pr?.aktionen || [];
    if (status === 'vorschlag' && !hinweis) {
      hinweis = `In WISO/Buhl nicht markiert – vorgeschlagen wegen: ${a.grund}. ${POSTEN_ID.get(p).info}`;
      rat = 'Passt das, übernehmen. Sonst anderen Posten wählen oder ausschließen.';
      aktionen = [{ t: `✓ Als „${POSTEN_ID.get(p).name}“ übernehmen`, p }, { t: '✕ Nicht steuerlich relevant', p: 'x' }];
    }
    out.push({ r, p, status, hinweis, rat, aktionen, notiz: e?.n || '', quelle: a?.quelle || 'manuell',
      grund: e?.p && e.p !== a?.p ? `von dir zugeordnet${a ? ` (automatisch wäre: ${POSTEN_ID.get(a.p).name})` : ''}` : a?.grund || 'von dir zugeordnet' });
  }
  return out;
}

const STATUS = {
  uebernommen: ['aus WISO/Buhl – noch bestätigen', 'st-buhl'], bestaetigt: ['✓ bestätigt', 'st-ok'], vorschlag: ['Vorschlag', 'st-vor'],
  pruefen: ['prüfen', 'st-pruef'], ausgeschlossen: ['ausgeschlossen', 'st-aus'],
};

// ---------------------------------------------------------------- Anzeige
export function steuerZeigen(el, c) {
  ctx = c;
  const jahre = [...new Set(D.rows.map((r) => r.y))].sort((a, b) => b - a).slice(0, 8);
  if (!jahr) jahr = ctx.einJahr() || Math.min(jahre[0], +D.bis.slice(0, 4) - (D.bis.slice(5, 7) < '12' ? 1 : 0));
  const alle = einordnen(jahr);
  const zahl = (s) => alle.filter((x) => x.status === s).length;
  const ZU = ['pruefen', 'vorschlag', 'uebernommen'];
  const sichtbar = alle.filter((x) => (filter === 'alle' ? x.status !== 'ausgeschlossen' : filter === 'zu' ? ZU.includes(x.status) : x.status === filter));
  const wirksam = alle.filter((x) => x.status !== 'ausgeschlossen');
  const summe = (liste) => liste.reduce((s, x) => s + x.r.c, 0);

  const knopf = (v, t) => `<button data-sfilter="${v}" class="${filter === v ? 'an' : ''}">${t}</button>`;
  let h = `<div class="st-kopf">
    <div class="st-jahre">${jahre.map((y) => `<button data-sjahr="${y}" class="${y === jahr ? 'an' : ''}">${y}</button>`).join('')}</div>
    <div class="st-aktionen">
      ${zahl('pruefen') + zahl('vorschlag') ? `<button class="btn sm primary" id="st-pruefen">Offene Punkte prüfen (${zahl('pruefen') + zahl('vorschlag')})</button>` : ''}
      <button class="btn sm${zahl('pruefen') + zahl('vorschlag') ? '' : ' primary'}" id="st-pdf">PDF für die Steuerberaterin</button>
      <button class="btn sm" id="st-xlsx">Excel</button>
      <button class="btn sm" id="st-sichern" title="Deine Zuordnungen als Datei sichern">Zuordnungen sichern</button>
      <button class="btn sm" id="st-laden" title="Gesicherte Zuordnungen laden">laden</button>
    </div>
    <div class="seg st-filter">${knopf('zu', `Zu bearbeiten (${zahl('pruefen') + zahl('vorschlag') + zahl('uebernommen')})`)}${knopf('pruefen', `davon prüfen (${zahl('pruefen')})`)}${knopf('vorschlag', `Vorschläge (${zahl('vorschlag')})`)}${knopf('uebernommen', `aus WISO/Buhl (${zahl('uebernommen')})`)}${knopf('bestaetigt', `✓ Bestätigt (${zahl('bestaetigt')})`)}${knopf('ausgeschlossen', `Ausgeschlossen (${zahl('ausgeschlossen')})`)}${knopf('alle', `Alle (${wirksam.length})`)}</div>
    <div class="muted klein">„Zu bearbeiten“ zeigt nur, was noch eine Entscheidung braucht. Bestätigte (✓) und ausgeschlossene (✕) Buchungen verschwinden hier und stehen unter „Bestätigt“ bzw. „Ausgeschlossen“. PDF und Excel enthalten alle nicht ausgeschlossenen. Orientierung, keine Steuerberatung.</div>
  </div>`;

  // Übersichtskarten je Abschnitt
  h += '<div class="st-karten">';
  for (const a of ABSCHNITTE) {
    const xs = wirksam.filter((x) => POSTEN_ID.get(x.p).abschnitt === a.id);
    if (!xs.length) continue;
    const s = summe(xs), betrag = a.id === 'einnahmen' ? s : -s;
    let bewertung = '';
    if (a.id === 'wk') { const d = betrag - pausch(jahr); bewertung = d > 0 ? `<span class="pos">${eur(d)} über dem Pauschbetrag</span>` : `<span class="muted">unter dem Pauschbetrag (${eur(pausch(jahr))}), wirkt sich vermutlich nicht aus</span>`; }
    const offenN = xs.filter((x) => ['pruefen', 'vorschlag'].includes(x.status)).length;
    h += `<button class="st-karte" data-sabschnitt="${a.id}"><span class="l">${esc(a.name)}</span><b>${eur(betrag)}</b>
      <span class="muted klein">${xs.length} Buchungen${offenN ? ` · <span class="st-pruef-t">${offenN} offen</span>` : ''}</span>${bewertung ? `<span class="klein">${bewertung}</span>` : ''}</button>`;
  }
  h += '</div>';

  if (!sichtbar.length) {
    const fertig = filter === 'zu' && wirksam.length;
    return (el.innerHTML = h + `<div class="leer">${fertig ? `Alles bearbeitet – ${zahl('bestaetigt')} Buchungen bestätigt. Jetzt „PDF für die Steuerberaterin“ oder „Excel“ erstellen.` : 'Keine Buchungen in dieser Auswahl.'}</div>`), binden(el);
  }

  // Liste: Abschnitt → Posten → Buchungen
  h += '<div class="st-liste">';
  for (const a of ABSCHNITTE) {
    const xs = sichtbar.filter((x) => POSTEN_ID.get(x.p).abschnitt === a.id);
    if (!xs.length) continue;
    const auf = offen.has(a.id) || filter !== 'alle';
    const s = summe(xs.filter((x) => x.status !== 'ausgeschlossen'));
    h += `<div class="st-abschnitt${auf ? ' offen' : ''}"><button class="st-abschnitt-kopf" data-sauf="${a.id}">
        <svg class="pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        <span class="name">${esc(a.name)} <small class="muted">${esc(a.form)}</small></span><span class="betrag">${eur(a.id === 'einnahmen' ? s : -s)}</span></button>`;
    if (auf) {
      h += `<div class="st-info klein">${esc(a.info(jahr))}</div>`;
      for (const p of POSTEN.filter((q) => q.abschnitt === a.id)) {
        const ps = xs.filter((x) => x.p === p.id).sort((m, n) => (m.r.d < n.r.d ? -1 : 1));
        if (!ps.length) continue;
        const psum = summe(ps.filter((x) => x.status !== 'ausgeschlossen'));
        const offenP = ps.filter((x) => ['vorschlag', 'uebernommen'].includes(x.status)).length;
        h += `<div class="st-posten"><div class="st-posten-kopf"><b>${esc(p.name)}</b><span class="muted klein">${ps.length} Buchungen</span>
          ${offenP ? `<button class="link klein" data-salle="${p.id}">alle ${offenP} bestätigen</button>` : ''}<span class="betrag">${eur(a.id === 'einnahmen' ? psum : -psum)}</span></div>`;
        for (const x of ps) {
          const [st, stc] = STATUS[x.status];
          h += `<div class="st-zeile${x.status === 'ausgeschlossen' ? ' aus' : ''}" data-skey="${esc(x.r.skey)}">
            <div class="st-datum">${dde(x.r.d)}</div>
            <div class="st-text" data-sdetail title="Klicken für alle Details"><div class="titel">${detailOffen.has(x.r.skey) ? '▾' : '▸'} ${esc(x.r.g || x.r.z || '–')}</div><div class="unter">${esc(x.r.g ? x.r.z : '')}${x.r.st ? ` · Buhl: ${esc(x.r.st)}` : ''} · ${esc(D.konten[x.r.k].name)}</div>
              ${hinweisHtml(x)}
              ${x.notiz ? `<div class="st-notiz">Notiz: ${esc(x.notiz)}</div>` : ''}</div>
            <div class="st-rechts"><div class="betrag ${x.r.c > 0 ? 'pos' : ''}">${eur(x.r.c)}</div><span class="st-badge ${stc}">${st}</span>
              <div class="st-knoepfe"><select data-sposten title="Posten ändern">${postenOptionen(x.status === 'ausgeschlossen' ? 'x' : x.p)}</select>
                <button class="icon-btn sm" data-sok title="Bestätigen">✓</button><button class="icon-btn sm" data-sx title="Nicht steuerlich relevant">✕</button>
                <button class="icon-btn sm" data-snotiz title="Notiz">✎</button></div></div>
            ${detailOffen.has(x.r.skey) ? `<div class="st-detail">${detailHtml(x)}</div>` : ''}</div>`;
        }
        h += '</div>';
      }
    }
    h += '</div>';
  }
  h += '</div>';
  el.innerHTML = h;
  binden(el);
}

// Auswahlliste der Posten (auch für die Buchungsdetails im Dashboard)
export function postenOptionen(aktuell, mitLeer = false) {
  let h = mitLeer ? `<option value="">– nicht zugeordnet –</option>` : '';
  for (const a of ABSCHNITTE) {
    h += `<optgroup label="${esc(a.name)}">${POSTEN.filter((p) => p.abschnitt === a.id).map((p) => `<option value="${p.id}"${p.id === aktuell ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`;
  }
  return h + `<option value="x"${aktuell === 'x' ? ' selected' : ''}>✕ nicht steuerlich relevant</option>`;
}

// aktuelle Zuordnung einer Buchung (für die Buchungsdetails)
export function steuerPosten(r) {
  const e = entscheidungen[r.skey];
  if (e?.x) return 'x';
  return e?.p || automatisch(r)?.p || '';
}

export function steuerZuordnen(r, wert) {
  const e = entscheidungen[r.skey] || {};
  if (wert === 'x') entscheidungen[r.skey] = { ...e, x: 1 };
  else if (!wert) delete entscheidungen[r.skey];
  else entscheidungen[r.skey] = { p: wert, ok: 1, ...(e.n ? { n: e.n } : {}) };
  speichern();
}

function binden(el) {
  const neu = () => ctx.neuZeichnen();
  el.querySelectorAll('[data-sjahr]').forEach((b) => b.onclick = () => { jahr = +b.dataset.sjahr; neu(); });
  el.querySelectorAll('[data-sfilter]').forEach((b) => b.onclick = () => { filter = b.dataset.sfilter; neu(); });
  el.querySelectorAll('[data-sauf]').forEach((b) => b.onclick = () => { const a = b.dataset.sauf; offen.has(a) ? offen.delete(a) : offen.add(a); neu(); });
  el.querySelectorAll('[data-sabschnitt]').forEach((b) => b.onclick = () => {
    offen.add(b.dataset.sabschnitt); filter = 'alle'; neu();
    el.querySelector(`[data-sauf="${b.dataset.sabschnitt}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const zeile = (x) => x.closest('[data-skey]');
  const buchungVon = (z) => D.rows.find((r) => r.skey === z.dataset.skey);
  el.querySelectorAll('[data-saktion]').forEach((b) => b.onclick = () => {
    const r = buchungVon(zeile(b)), v = vorherVon(r.skey);
    aktionAusfuehren(r, b.dataset.saktion, !!b.dataset.snotizfrage); neu();
    rueckgaengig(`${b.dataset.saktion === 'x' ? 'Ausgeschlossen' : 'Bestätigt'}: ${kurzName(r)}`, [v]);
  });
  el.querySelectorAll('[data-sdetail]').forEach((t) => t.onclick = () => { const k = zeile(t).dataset.skey; detailOffen.has(k) ? detailOffen.delete(k) : detailOffen.add(k); neu(); });
  el.querySelectorAll('[data-sdashboard]').forEach((b) => b.onclick = () => ctx.setze({ q: `"${b.dataset.sdashboard}"`, tab: 'buchungen', jahr: '', monat: '' }));
  el.querySelector('#st-pruefen')?.addEventListener('click', () => pruefModus(0));
  const buchung = (z) => D.rows.find((r) => r.skey === z.dataset.skey);
  el.querySelectorAll('[data-sposten]').forEach((s) => s.onchange = () => {
    const r = buchung(zeile(s)), v = vorherVon(r.skey);
    steuerZuordnen(r, s.value); neu();
    rueckgaengig(s.value === 'x' ? `Ausgeschlossen: ${kurzName(r)}` : `Bestätigt als „${POSTEN_ID.get(s.value).name}“: ${kurzName(r)}`, [v]);
  });
  el.querySelectorAll('[data-sok]').forEach((b) => b.onclick = () => {
    const r = buchung(zeile(b)); const e = entscheidungen[r.skey] || {}; const v = vorherVon(r.skey);
    entscheidungen[r.skey] = { ...e, p: e.p || automatisch(r)?.p, ok: 1 }; delete entscheidungen[r.skey].x; speichern(); neu();
    rueckgaengig(`Bestätigt: ${kurzName(r)}`, [v]);
  });
  el.querySelectorAll('[data-sx]').forEach((b) => b.onclick = () => {
    const r = buchung(zeile(b)); const e = entscheidungen[r.skey] || {}; const v = vorherVon(r.skey);
    if (e.x) { delete e.x; entscheidungen[r.skey] = e; } else entscheidungen[r.skey] = { ...e, x: 1 };
    speichern(); neu();
    rueckgaengig(`${v[1]?.x ? 'Wieder aufgenommen' : 'Ausgeschlossen'}: ${kurzName(r)}`, [v]);
  });
  el.querySelectorAll('[data-snotiz]').forEach((b) => b.onclick = () => {
    const r = buchung(zeile(b)); const e = entscheidungen[r.skey] || {};
    const t = prompt('Notiz zu dieser Buchung (erscheint im PDF und in Excel):', e.n || '');
    if (t === null) return;
    entscheidungen[r.skey] = { ...e, ...(t.trim() ? { n: t.trim() } : {}) };
    if (!t.trim()) delete entscheidungen[r.skey].n;
    speichern(); neu();
  });
  el.querySelectorAll('[data-salle]').forEach((b) => b.onclick = () => {
    const vorher = [];
    for (const x of einordnen(jahr)) if (x.p === b.dataset.salle && ['vorschlag', 'uebernommen'].includes(x.status)) {
      vorher.push(vorherVon(x.r.skey));
      entscheidungen[x.r.skey] = { ...(entscheidungen[x.r.skey] || {}), p: x.p, ok: 1 };
    }
    setTimeout(() => rueckgaengig(`${vorher.length} Buchungen als „${POSTEN_ID.get(b.dataset.salle).name}“ bestätigt`, vorher), 0);
    speichern(); neu();
  });
  el.querySelector('#st-pdf').onclick = () => pdf();
  el.querySelector('#st-xlsx').onclick = () => excel().catch((e) => ctx.toast(e.message));
  el.querySelector('#st-sichern').onclick = () => herunterladen(new Blob([JSON.stringify(entscheidungen, null, 1)], { type: 'application/json' }), 'Steuer-Zuordnungen.json');
  el.querySelector('#st-laden').onclick = () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
    inp.onchange = async () => {
      try { const j = JSON.parse(await inp.files[0].text()); Object.assign(entscheidungen, j); speichern(); ctx.toast(`${Object.keys(j).length} Zuordnungen geladen.`); neu(); }
      catch { ctx.toast('Die Datei konnte nicht gelesen werden.'); }
    };
    inp.click();
  };
}

// Einschätzung + Empfehlung + Knöpfe (Liste und Prüffenster)
function hinweisHtml(x) {
  if (!x.hinweis) return '';
  const pr = x.status === 'pruefen' || x.status === 'vorschlag';
  return `<div class="st-rat${x.status === 'pruefen' ? ' pruef' : ''}">
    <div><b>${pr ? 'Einschätzung' : 'Hinweis'}:</b> ${esc(x.hinweis)}</div>
    ${x.rat ? `<div><b>Empfehlung:</b> ${esc(x.rat)}</div>` : ''}
    ${x.aktionen?.length ? `<div class="st-rat-knoepfe">${x.aktionen.map((a) => `<button class="btn sm${a.p === 'x' ? ' danger' : ''}" data-saktion="${a.p}"${a.notiz ? ' data-snotizfrage="1"' : ''}>${esc(a.t)}</button>`).join('')}</div>` : ''}
  </div>`;
}

// Knopf aus der Empfehlung ausführen
function aktionAusfuehren(r, wert, mitNotiz) {
  const e = entscheidungen[r.skey] || {};
  if (wert === 'x') entscheidungen[r.skey] = { ...e, x: 1 };
  else { entscheidungen[r.skey] = { ...e, p: wert, ok: 1 }; delete entscheidungen[r.skey].x; }
  if (mitNotiz) {
    const t = prompt('Notiz zu dieser Buchung (erscheint im PDF und in Excel):', e.n || '');
    if (t && t.trim()) entscheidungen[r.skey].n = t.trim();
  }
  speichern();
}

// Kurze Leiste unten: was gerade entschieden wurde, mit „Rückgängig“
let rueckT;
function rueckgaengig(text, vorher) {
  let bar = document.querySelector('#st-rueck');
  if (!bar) { bar = Object.assign(document.createElement('div'), { id: 'st-rueck', className: 'toast st-rueck' }); document.body.append(bar); }
  bar.innerHTML = `<span>${esc(text)}</span><button class="link">Rückgängig</button>`;
  bar.hidden = false;
  bar.querySelector('button').onclick = () => {
    for (const [k, v] of vorher) { if (v === undefined) delete entscheidungen[k]; else entscheidungen[k] = v; }
    speichern(); bar.hidden = true; ctx.neuZeichnen();
  };
  clearTimeout(rueckT); rueckT = setTimeout(() => (bar.hidden = true), 7000);
}
const vorherVon = (k) => [k, entscheidungen[k] ? { ...entscheidungen[k] } : undefined];
const kurzName = (r) => (r.g || r.z || '').slice(0, 40);

// ---------------------------------------------------------------- Details einer Buchung
const empfKey = (g) => norm(g).replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim();

function detailHtml(x, gross = false) {
  const r = x.r, p = POSTEN_ID.get(x.p);
  const felder = [
    ['Datum', dde(r.d)], ['Betrag', eur(r.c)], ['Konto', D.konten[r.k].name], ['Empfänger / Auftraggeber', r.g || '–'],
    ['Verwendungszweck', r.z || '–'], ['Kategorie (Finanzguru)', `${r.kat}${r.ukat ? ' · ' + r.ukat : ''}`], ['Art', r.art],
    ['Steuerkategorie (WISO/Buhl)', r.st || '–'], ['Steuerposten', p ? `${ABSCHNITTE.find((a) => a.id === p.abschnitt).name} → ${p.name}` : '–'],
    ['Was zählt hier', p?.info || '–'], ['Warum so eingeordnet', x.grund || '–'], ...(r.v ? [['Vertrag', r.v]] : []), ...(r.t ? [['Tags', r.t]] : []), ...(r.n ? [['Notiz (Finanzguru)', r.n]] : []),
  ];
  let h = `<dl class="st-felder">${felder.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  if (gross) h = hinweisHtml(x) + h;
  // weitere Zahlungen an denselben Empfänger (alle Jahre)
  const key = empfKey(r.g);
  if (key) {
    const weitere = D.rows.filter((q) => q !== r && q.g && empfKey(q.g) === key).sort((a, b) => (a.d < b.d ? 1 : -1));
    if (weitere.length) {
      const zeigen = weitere.slice(0, gross ? 12 : 6);
      const zugeordnet = weitere.filter((q) => steuerPosten(q) && steuerPosten(q) !== 'x').length;
      h += `<div class="st-verlauf"><div class="klein"><b>Weitere Zahlungen an „${esc(r.g)}“:</b> ${weitere.length}, davon ${zugeordnet} steuerlich zugeordnet</div>
        <table class="st-vtab">${zeigen.map((q) => { const sp = steuerPosten(q); return `<tr><td>${dde(q.d)}</td><td class="r">${eur(q.c)}</td><td class="z">${esc(q.z)}</td><td class="muted">${sp === 'x' ? 'ausgeschlossen' : sp ? esc(POSTEN_ID.get(sp).name) : '–'}</td></tr>`; }).join('')}</table>
        <button class="link klein" data-sdashboard="${esc(r.g)}">Alle Buchungen von „${esc(r.g)}“ im Dashboard öffnen</button></div>`;
    }
  }
  return h;
}

// ---------------------------------------------------------------- Prüfmodus: offene Buchungen nacheinander
let pruefListe = [], pruefI = 0;
function pruefModus(start) {
  pruefListe = einordnen(jahr).filter((x) => ['pruefen', 'vorschlag'].includes(x.status)).map((x) => x.r.skey);
  pruefI = Math.min(start, pruefListe.length - 1);
  let dlg = document.querySelector('#st-pruef');
  if (!dlg) {
    dlg = Object.assign(document.createElement('dialog'), { id: 'st-pruef', className: 'dlg st-dlg' });
    document.body.append(dlg);
    dlg.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('[data-p="ok"]')?.click(); }
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') { e.preventDefault(); dlg.querySelector('[data-p="x"]')?.click(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); dlg.querySelector('[data-p="weiter"]')?.click(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); dlg.querySelector('[data-p="zurueck"]')?.click(); }
    });
    // Esc: selbst schließen und die Liste neu zeichnen (das close-Ereignis kommt nicht in jedem Browser an)
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); pruefSchliessen(); });
  }
  pruefZeigen();
  if (!dlg.open) dlg.showModal();
}

function pruefSchliessen() {
  const dlg = document.querySelector('#st-pruef');
  if (dlg?.open) dlg.close();
  ctx.neuZeichnen();
}

function pruefZeigen() {
  const dlg = document.querySelector('#st-pruef');
  const offene = einordnen(jahr);
  const x = offene.find((y) => y.r.skey === pruefListe[pruefI]);
  const nochOffen = pruefListe.filter((k) => ['pruefen', 'vorschlag'].includes(offene.find((y) => y.r.skey === k)?.status)).length;
  if (!x) {
    dlg.innerHTML = `<div class="st-dlg-haupt"><h2>Fertig</h2><p>Alle offenen Punkte für ${jahr} sind durchgesehen.</p><button class="btn primary" data-p="fertig">Schließen</button></div>`;
    dlg.querySelector('[data-p="fertig"]').onclick = pruefSchliessen;
    return;
  }
  const [st, stc] = STATUS[x.status];
  dlg.innerHTML = `<div class="st-dlg-kopf"><b>Prüfung ${pruefI + 1} von ${pruefListe.length}</b><span class="muted klein">${nochOffen} noch offen · Steuerjahr ${jahr}</span>
      <button class="icon-btn sm" data-p="zu" title="Schließen (Esc)">✕</button></div>
    <div class="st-dlg-haupt">
      <div class="st-dlg-betrag"><span class="betrag ${x.r.c > 0 ? 'pos' : ''}">${eur(x.r.c)}</span><span class="st-badge ${stc}">${st}</span></div>
      <div class="st-dlg-titel">${esc(x.r.g || '–')}</div>
      <div class="st-dlg-zweck">${esc(x.r.z || '')}</div>
      ${detailHtml(x, true)}
      ${x.notiz ? `<div class="st-notiz">Deine Notiz: ${esc(x.notiz)}</div>` : ''}
    </div>
    <div class="st-dlg-fuss">
      <label class="klein">Steuerposten <select data-p="posten">${postenOptionen(x.status === 'ausgeschlossen' ? 'x' : x.p)}</select></label>
      <div class="st-posten-info klein" data-p="info">${esc(POSTEN_ID.get(x.p)?.info || '')}</div>
      <div class="st-dlg-knoepfe">
        <button class="btn" data-p="zurueck" title="← Pfeiltaste">← Zurück</button>
        <button class="btn" data-p="notiz">Notiz</button>
        <button class="btn danger" data-p="x" title="Taste X">✕ Nicht relevant</button>
        <button class="btn primary" data-p="ok" title="Enter">✓ Bestätigen</button>
        <button class="btn" data-p="weiter" title="→ Pfeiltaste">Überspringen →</button>
      </div>
      <div class="muted klein">Tasten: Enter = bestätigen · X = nicht relevant · → überspringen · ← zurück · Esc = schließen</div>
    </div>`;
  const r = x.r;
  const weiter = () => { if (pruefI < pruefListe.length - 1) pruefI++; else pruefListe = []; pruefZeigen(); };
  dlg.querySelector('[data-p="zu"]').onclick = pruefSchliessen;
  dlg.querySelector('[data-p="posten"]').onchange = (e) => { dlg.querySelector('[data-p="info"]').textContent = e.target.value === 'x' ? 'Wird nicht in die Steuerunterlagen übernommen.' : POSTEN_ID.get(e.target.value)?.info || ''; };
  dlg.querySelectorAll('[data-saktion]').forEach((b) => b.onclick = () => { aktionAusfuehren(r, b.dataset.saktion, !!b.dataset.snotizfrage); weiter(); });
  dlg.querySelector('[data-p="weiter"]').onclick = weiter;
  dlg.querySelector('[data-p="zurueck"]').onclick = () => { if (pruefI > 0) pruefI--; pruefZeigen(); };
  dlg.querySelector('[data-p="ok"]').onclick = () => {
    const wert = dlg.querySelector('[data-p="posten"]').value;
    if (wert === 'x') entscheidungen[r.skey] = { ...(entscheidungen[r.skey] || {}), x: 1 };
    else { const e = entscheidungen[r.skey] || {}; entscheidungen[r.skey] = { ...e, p: wert, ok: 1 }; delete entscheidungen[r.skey].x; }
    speichern(); weiter();
  };
  dlg.querySelector('[data-p="x"]').onclick = () => { entscheidungen[r.skey] = { ...(entscheidungen[r.skey] || {}), x: 1 }; speichern(); weiter(); };
  dlg.querySelector('[data-p="notiz"]').onclick = () => {
    const e = entscheidungen[r.skey] || {};
    const t = prompt('Notiz zu dieser Buchung (erscheint im PDF und in Excel):', e.n || '');
    if (t === null) return;
    entscheidungen[r.skey] = { ...e, ...(t.trim() ? { n: t.trim() } : {}) };
    if (!t.trim()) delete entscheidungen[r.skey].n;
    speichern(); pruefZeigen();
  };
  dlg.querySelectorAll('[data-sdashboard]').forEach((b) => b.onclick = () => { if (dlg.open) dlg.close(); ctx.setze({ q: `"${b.dataset.sdashboard}"`, tab: 'buchungen', jahr: '', monat: '' }); });
  dlg.querySelector('[data-p="ok"]').focus();
}

// ---------------------------------------------------------------- Ausgabe
function berichtDaten() {
  const liste = einordnen(jahr).filter((x) => x.status !== 'ausgeschlossen');
  const abschnitte = ABSCHNITTE.map((a) => {
    const posten = POSTEN.filter((p) => p.abschnitt === a.id).map((p) => {
      const xs = liste.filter((x) => x.p === p.id).sort((m, n) => (m.r.d < n.r.d ? -1 : 1));
      const s = xs.reduce((t, x) => t + x.r.c, 0);
      return { p, xs, betrag: a.id === 'einnahmen' ? s : -s };
    }).filter((q) => q.xs.length);
    return { a, posten, betrag: posten.reduce((t, q) => t + q.betrag, 0) };
  }).filter((b) => b.posten.length);
  return { liste, abschnitte, offen: liste.filter((x) => ['pruefen', 'vorschlag'].includes(x.status)) };
}
const statusText = (x) => STATUS[x.status][0];

function pdf() {
  const { abschnitte, offen: off } = berichtDaten();
  const heute = new Date().toLocaleDateString('de-DE');
  let h = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Steuerunterlagen ${jahr}</title><style>
    @page { size: A4; margin: 16mm 14mm; }
    body { font: 10pt/1.4 system-ui, "Segoe UI", Arial, sans-serif; color: #111; }
    h1 { font-size: 17pt; margin: 0 0 2mm; } h2 { font-size: 12.5pt; margin: 7mm 0 1mm; border-bottom: 1.5px solid #111; padding-bottom: 1mm; }
    h3 { font-size: 10.5pt; margin: 4mm 0 1mm; } .klein { font-size: 8.5pt; color: #555; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 1.2mm 1.5mm; border-bottom: 0.3px solid #ccc; vertical-align: top; }
    th { font-size: 8.5pt; color: #555; } .r { text-align: right; white-space: nowrap; } .sum td { font-weight: 700; border-top: 1px solid #111; }
    .pruef { color: #a0480d; } tr { page-break-inside: avoid; } .info { font-size: 8.5pt; color: #444; margin: 0 0 2mm; }
  </style></head><body>
  <h1>Steuerunterlagen ${jahr}</h1>
  <div class="klein">Zusammenstellung der steuerlich relevanten Kontoumsätze · erstellt am ${heute} · Datenstand ${dde(D.bis)}.
  Grundlage: Kontoauszüge aller Konten; Einordnung vorgeprüft, Belege liegen vor bzw. werden nachgereicht.</div>
  <h2>Übersicht</h2><table><tr><th>Abschnitt / Posten</th><th class="r">Buchungen</th><th class="r">Betrag</th></tr>`;
  for (const b of abschnitte) {
    h += `<tr class="sum"><td>${esc(b.a.name)} <span class="klein">(${esc(b.a.form)})</span></td><td class="r">${b.posten.reduce((t, q) => t + q.xs.length, 0)}</td><td class="r">${eur(b.betrag)}</td></tr>`;
    for (const q of b.posten) h += `<tr><td style="padding-left:6mm">${esc(q.p.name)}</td><td class="r">${q.xs.length}</td><td class="r">${eur(q.betrag)}</td></tr>`;
  }
  h += '</table>';
  if (off.length) h += `<p class="klein pruef">${off.length} Buchungen sind noch als „prüfen“ oder „Vorschlag“ markiert – siehe Hinweise in den Einzelaufstellungen.</p>`;
  for (const b of abschnitte) {
    h += `<h2>${esc(b.a.name)} <span class="klein">${esc(b.a.form)}</span></h2><div class="info">${esc(b.a.info(jahr))}</div>`;
    for (const q of b.posten) {
      h += `<h3>${esc(q.p.name)} – ${eur(q.betrag)}</h3><table><tr><th style="width:17mm">Datum</th><th>Empfänger / Verwendungszweck</th><th style="width:28mm">Konto</th><th class="r" style="width:22mm">Betrag</th><th style="width:22mm">Status</th></tr>`;
      for (const x of q.xs) {
        h += `<tr><td>${dde(x.r.d)}</td><td>${esc(x.r.g)}<div class="klein">${esc(x.r.z)}</div>${x.hinweis ? `<div class="klein ${x.status === 'pruefen' ? 'pruef' : ''}">${esc(x.hinweis)}</div>` : ''}${x.notiz ? `<div class="klein"><b>Notiz:</b> ${esc(x.notiz)}</div>` : ''}</td>
          <td class="klein">${esc(D.konten[x.r.k].name)}</td><td class="r">${eur(x.r.c)}</td><td class="klein ${x.status === 'pruefen' ? 'pruef' : ''}">${statusText(x)}</td></tr>`;
      }
      h += '</table>';
    }
  }
  h += `<p class="klein" style="margin-top:8mm">Die Hinweise sind eine Orientierung und ersetzen keine Steuerberatung. Beträge laut Kontoauszug (Ausgaben negativ, Erstattungen positiv).</p>
  <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return ctx.toast('Das Fenster für das PDF wurde blockiert – bitte Pop-ups für diese Seite erlauben.');
  w.document.write(h); w.document.close();
}

async function excel() {
  const { liste, abschnitte } = berichtDaten();
  const ueb = [];
  for (const b of abschnitte) {
    ueb.push([b.a.name, '', b.posten.reduce((t, q) => t + q.xs.length, 0), b.betrag / 100, b.a.info(jahr)]);
    for (const q of b.posten) ueb.push(['', q.p.name, q.xs.length, q.betrag / 100, '']);
  }
  const buch = liste.slice().sort((m, n) => POSTEN.indexOf(POSTEN_ID.get(m.p)) - POSTEN.indexOf(POSTEN_ID.get(n.p)) || (m.r.d < n.r.d ? -1 : 1))
    .map((x) => { const p = POSTEN_ID.get(x.p); return [ABSCHNITTE.find((a) => a.id === p.abschnitt).name, p.name, x.r.d, D.konten[x.r.k].name, x.r.g, x.r.z, x.r.c / 100, statusText(x), x.hinweis, x.notiz, x.r.st]; });
  await alsExcelMappe(`Steuerunterlagen ${jahr}`, [
    { blatt: 'Übersicht', spalten: [{ titel: 'Abschnitt', typ: 'text', breite: 40 }, { titel: 'Posten', typ: 'text', breite: 44 }, { titel: 'Buchungen', typ: 'zahl', breite: 11 }, { titel: 'Betrag', typ: 'euro', breite: 14 }, { titel: 'Hinweis', typ: 'text', breite: 90 }], zeilen: ueb },
    { blatt: 'Buchungen', spalten: [{ titel: 'Abschnitt', typ: 'text', breite: 34 }, { titel: 'Posten', typ: 'text', breite: 38 }, { titel: 'Datum', typ: 'datum', breite: 11 }, { titel: 'Konto', typ: 'text', breite: 20 },
      { titel: 'Empfänger', typ: 'text', breite: 30 }, { titel: 'Verwendungszweck', typ: 'text', breite: 50 }, { titel: 'Betrag', typ: 'euro', breite: 13 }, { titel: 'Status', typ: 'text', breite: 14 },
      { titel: 'Hinweis', typ: 'text', breite: 60 }, { titel: 'Notiz', typ: 'text', breite: 30 }, { titel: 'Steuerkategorie (Buhl)', typ: 'text', breite: 26 }], zeilen: buch },
  ]);
}
