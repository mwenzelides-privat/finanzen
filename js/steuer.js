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
const EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur0 = (c) => EUR0.format(Math.round(c / 100));
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
    rat: 'Privates Essen → ausschließen. Nur eine Hotelrechnung auf beruflicher Reise gehört hierher.', klar: 'Restaurant', aktionen: [AUS, { t: 'Ist eine Hotelrechnung (Dienstreise) – behalten', p: 'wk-uebernachtung' }] };
  if ((p === 'ha-handwerker' || p === 'ha-dienstleistung') && MARKT.test(norm(r.g))) return { art: 'pruefen',
    text: 'Einkauf im Bau- oder Gartenmarkt = Material. Nach § 35a zählen nur die Arbeitskosten eines Handwerkers laut Rechnung, nicht selbst gekauftes Material.',
    rat: 'Ausschließen.', klar: 'Baumarkt', aktionen: [AUS] };
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
    text: 'Urlaubs- oder Reisekosten sind keine Kinderbetreuung und nicht absetzbar.', rat: 'Ausschließen.', klar: 'Urlaub', aktionen: [AUS] };
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
let jahr = 0, filter = 'zu', abschnittF = '', offen = new Set(['wk', 'vorsorge', 'sonder', 'agb', 'haushalt', 'kinder']);
const detailOffen = new Set(), gruppeOffen = new Set();
let entscheidungen = {};          // Schlüssel → { p (Posten-ID) | x (ausgeschlossen), ok (bestätigt), n (Notiz) }; „regel:…“ → { p | x } für einen Empfänger
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
  if (r.art === 'Umbuchung' || r.art === 'Sparen' || r.art === 'Kinderkonto') return null;
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

// ---------------------------------------------------------------- Offizielle Unterlagen
// Bescheide des Finanzamts und Erklärungen der Steuerberaterin (privat in den Finanzdaten: steuer_offiziell).
// Sie entscheiden überall dort, wo du selbst noch nichts entschieden hast; deine Entscheidungen gehen immer vor.
const OFF = () => D?.j?.steuer_offiziell?.jahre || {};
const offiziell = (j) => OFF()[j] || null;
const offJahre = () => Object.keys(OFF()).map(Number).sort((a, b) => a - b);
const offName = (O) => O.kurz || `${O.art} ${O.jahr}`;
// angesetzter Einzelposten zu einer Buchung: gleicher Betrag (±1 Cent), passendes Datum (falls bekannt) und gleicher Posten oder Empfänger
function offBeleg(O, r, p) {
  const b = Math.abs(r.c), t = norm(`${r.g} ${r.z}`), ab = POSTEN_ID.get(p)?.abschnitt;
  const empf = (x) => x.e && new RegExp(x.e, 'i').test(t);
  return (O.belege || []).find((x) => {
    if (x.p && x.p !== p) return false;
    if (x.a && x.a !== ab) return false;
    if (x.d && Math.abs(Date.parse(x.d) - Date.parse(r.d)) > 40 * 864e5) return false;
    if (x.b == null) return empf(x);
    const tol = Number.isInteger(x.b) ? 100 : 1;
    return Math.abs(Math.round(Math.abs(x.b) * 100) - b) <= tol && (!x.e || empf(x));
  });
}
// Was die Unterlagen zu einer Buchung sagen: { art: 'ja' | 'nein' | 'fehlt' | 'info' | 'vj-nein' | 'vj-ja', text }
function offEinordnung(r, p) {
  const O = offiziell(r.y);
  if (O) {
    const bl = offBeleg(O, r, p), ps = O.posten?.[p];
    if (bl) return { art: 'ja', text: `laut ${offName(O)} angesetzt${bl.t ? ` (${bl.t})` : ''}` };
    if (ps?.s === 'alle') return { art: 'ja', text: `laut ${offName(O)} angesetzt${ps.t ? `: ${ps.t}` : ''}` };
    if (ps?.s === 'nicht') return { art: 'nein', text: `laut ${offName(O)} nicht angesetzt${ps.t ? `: ${ps.t}` : ''}` };
    if (ps?.s === 'fehlt') return { art: 'fehlt', text: ps.t || `fehlt in der ${offName(O)}` };
    if (ps?.s === 'fertig') return { art: 'fertig', text: `${offName(O)}: ${ps.t}` };
    return ps?.t ? { art: 'info', text: `${offName(O)}: ${ps.t}` } : null;
  }
  // Jahre ohne Unterlagen: was in den Vorjahren nie bzw. immer angesetzt wurde
  const vj = offJahre().filter((y) => y < r.y);
  if (!vj.length) return null;
  const jt0 = vj.length > 1 ? `${vj[0]}–${vj.at(-1)}` : `${vj[0]}`, tx = norm(`${r.g} ${r.z}`);
  // derselbe Empfänger wurde in einem Vorjahr als Einzelposten angesetzt
  const frueher = vj.flatMap((y) => OFF()[y].belege || []).find((x) => (!x.p || x.p === p) && x.e && new RegExp(x.e, 'i').test(tx));
  if (frueher) return { art: 'vj-ja', text: `In den Steuererklärungen ${jt0} angesetzt${frueher.t ? ` (${frueher.t})` : ''}` };
  const st = vj.map((y) => OFF()[y].posten?.[p]).filter((x) => x?.s);
  if (!st.length || st.length < vj.length) return null;
  const jt = vj.length > 1 ? `${vj[0]}–${vj.at(-1)}` : `${vj[0]}`;
  if (st.every((x) => x.s === 'nicht')) return { art: 'vj-nein', text: `In den Steuererklärungen ${jt} nicht angesetzt${st.at(-1).t ? `: ${st.at(-1).t}` : ''}` };
  if (st.every((x) => x.s === 'alle')) return { art: 'vj-ja', text: `In den Steuererklärungen ${jt} jedes Mal angesetzt${st.at(-1).t ? ` (${st.at(-1).t})` : ''}` };
  return null;
}

// Regeln: eine Entscheidung für alle Zahlungen an denselben Empfänger mit derselben automatischen Einordnung – in allen Jahren.
// Eigene Entscheidungen zu einzelnen Buchungen gehen immer vor.
const empfName = (r) => r.g || r.z || '–';
const grpName = (r) => norm(empfName(r)).replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const regelKey = (r, p) => `regel:${grpName(r)}|${p}${pruefung(r, p)?.art === 'pruefen' ? '|pruefen' : ''}`;
const eigen = (e) => !!(e && (e.x || e.ok || e.p));

// Alle Buchungen eines Jahres mit Posten, Status und Hinweis
function einordnen(j) {
  const out = [];
  for (const r of D.rows) {
    if (r.y !== j) continue;
    const e = entscheidungen[r.skey];
    const a = automatisch(r);
    if (!a && !e?.p) continue;
    const rg = !eigen(e) && a ? entscheidungen[regelKey(r, a.p)] : null;
    const regelText = `Regel: alle Zahlungen an „${empfName(r)}“`;
    if (e?.x || rg?.x) { out.push({ r, p: e?.p || a?.p, status: 'ausgeschlossen', hinweis: '', notiz: e?.n || '', regel: !!rg, grund: rg ? `${regelText} ausschließen` : 'von dir ausgeschlossen' }); continue; }
    const p = e?.p || rg?.p || a.p;
    const of = !eigen(e) && !rg ? offEinordnung(r, p) : null;
    if (of?.art === 'ja') { out.push({ r, p, status: 'bestaetigt', hinweis: '', rat: '', aktionen: [], notiz: e?.n || '', quelle: 'offiziell', off: of.text, regel: false, grund: of.text }); continue; }
    if (of?.art === 'fertig') { out.push({ r, p, status: 'veranlagt', hinweis: '', rat: '', aktionen: [], notiz: e?.n || '', quelle: 'offiziell', off: of.text, regel: false, grund: of.text }); continue; }
    if (of?.art === 'nein') { out.push({ r, p, status: 'ausgeschlossen', hinweis: '', notiz: e?.n || '', regel: false, off: of.text, grund: of.text }); continue; }
    const pr = of?.art === 'fehlt'
      ? { art: 'pruefen', text: of.text, rat: 'Ist das absetzbar, der Steuerberaterin nachmelden – sonst ausschließen.', aktionen: [{ t: '✓ Absetzbar – nachmelden', p }, AUS] }
      : pruefung(r, p);
    let status = eigen(e) || rg ? 'bestaetigt' : a.quelle === 'buhl' ? 'uebernommen' : 'vorschlag';
    if (status !== 'bestaetigt' && pr?.art === 'pruefen') status = 'pruefen';
    // Einnahmen braucht niemand zu bestätigen – sie stehen nur zur Kontrolle da
    if ((status === 'uebernommen' || status === 'vorschlag') && POSTEN_ID.get(p).abschnitt === 'einnahmen') status = 'kontrolle';
    let hinweis = pr?.text || '', rat = pr?.rat || '', aktionen = status === 'bestaetigt' ? [] : pr?.aktionen || [];
    if (of && of.art !== 'fehlt' && status !== 'bestaetigt') hinweis = hinweis ? `${of.text}. ${hinweis}` : `${of.text}.`;
    if (status === 'vorschlag' && !hinweis) {
      hinweis = `In WISO/Buhl nicht markiert – vorgeschlagen wegen: ${a.grund}. ${POSTEN_ID.get(p).info}`;
      rat = 'Passt das, übernehmen. Sonst anderen Posten wählen oder ausschließen.';
      aktionen = [{ t: `✓ Als „${POSTEN_ID.get(p).name}“ übernehmen`, p }, { t: '✕ Nicht steuerlich relevant', p: 'x' }];
    }
    out.push({ r, p, status, hinweis, rat, aktionen, notiz: e?.n || '', quelle: a?.quelle || 'manuell', regel: !!rg, vj: of?.art?.startsWith('vj') ? of.text : '', offInfo: of?.art === 'info' ? of.text : '',
      klar: status === 'pruefen' && pr?.klar ? pr.klar : of?.art === 'vj-nein' && ZU.includes(status) ? 'in den Vorjahren nie angesetzt' : '',
      grund: rg ? `${regelText} → ${POSTEN_ID.get(p).name}` : e?.p && e.p !== a?.p ? `von dir zugeordnet${a ? ` (automatisch wäre: ${POSTEN_ID.get(a.p).name})` : ''}` : a?.grund || 'von dir zugeordnet' });
  }
  return out;
}

// Für den Chat und zur Kontrolle: die Einordnung eines Jahres als einfache Liste
export function steuerListe(j) {
  return einordnen(j).map((x) => ({ skey: x.r.skey, d: x.r.d, k: D.konten[x.r.k].name, c: x.r.c, g: x.r.g, z: x.r.z, kat: x.r.kat, ukat: x.r.ukat, st: x.r.st, p: x.p, status: x.status, regel: x.regel, grund: x.grund }));
}

// Gleicher Posten + gleicher Empfänger + gleicher Status = eine Gruppe (eine Entscheidung)
const gKey = (x) => `${x.p}|${grpName(x.r)}|${x.status}`;
function gruppieren(xs) {
  const m = new Map();
  for (const x of xs) { const k = gKey(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.values()].sort((a, b) => Math.abs(b.reduce((t, x) => t + x.r.c, 0)) - Math.abs(a.reduce((t, x) => t + x.r.c, 0)));
}
// in der Reihenfolge der Anzeige: Posten für Posten, große Beträge zuerst
const arbeitsGruppen = (xs) => POSTEN.flatMap((p) => gruppieren(xs.filter((x) => x.p === p.id)));
const ZU = ['pruefen', 'vorschlag', 'uebernommen'];

// Entscheidung für mehrere Buchungen auf einmal. Buchungen mit automatischer Einordnung bekommen eine Regel für den
// Empfänger (gilt auch in anderen Jahren), alle übrigen eine Einzelentscheidung. wert: Posten-ID | 'x' | 'ok' (Posten behalten)
function gruppeEntscheiden(keys, wert, mitNotiz, still) {
  const xs = einordnen(jahr).filter((x) => keys.includes(x.r.skey));
  if (!xs.length) return [];
  let notiz = '';
  if (mitNotiz) { const t = prompt(`Notiz für ${xs.length > 1 ? `alle ${xs.length} Zahlungen` : 'diese Buchung'} (erscheint im PDF und in Excel):`, xs[0].notiz || ''); if (t) notiz = t.trim(); }
  const vorher = [], regeln = new Set();
  for (const x of xs) {
    const r = x.r, a = automatisch(r), e = entscheidungen[r.skey];
    const ziel = wert === 'ok' ? x.p : wert;
    if (a && !eigen(e) && xs.length > 1) {
      const rk = regelKey(r, a.p);
      if (!regeln.has(rk)) { regeln.add(rk); vorher.push(vorherVon(rk)); entscheidungen[rk] = ziel === 'x' ? { x: 1 } : { p: ziel }; }
      if (notiz) { vorher.push(vorherVon(r.skey)); entscheidungen[r.skey] = { ...(e || {}), n: notiz }; }
    } else {
      vorher.push(vorherVon(r.skey));
      const n = { ...(e || {}) };
      if (ziel === 'x') n.x = 1; else { n.p = ziel; n.ok = 1; delete n.x; }
      if (notiz) n.n = notiz;
      entscheidungen[r.skey] = n;
    }
  }
  speichern();
  if (!still) {
    const ziel = wert === 'ok' ? xs[0].p : wert;
    const was = ziel === 'x' ? 'ausgeschlossen' : `bestätigt${wert !== 'ok' ? ` als „${POSTEN_ID.get(ziel).name}“` : ''}`;
    ctx.neuZeichnen();
    rueckgaengig(`${xs.length > 1 ? `${xs.length} Zahlungen an ` : ''}„${kurzName(xs[0].r)}“ ${was}${regeln.size ? ' – gilt auch in anderen Jahren' : ''}`, vorher);
  }
  return vorher;
}

const STATUS = {
  uebernommen: ['aus WISO/Buhl – noch bestätigen', 'st-buhl'], bestaetigt: ['✓ bestätigt', 'st-ok'], vorschlag: ['Vorschlag', 'st-vor'],
  pruefen: ['prüfen', 'st-pruef'], ausgeschlossen: ['ausgeschlossen', 'st-aus'], kontrolle: ['zur Kontrolle', 'st-aus'], veranlagt: ['laut Unterlagen erledigt', 'st-aus'],
};

// ---------------------------------------------------------------- Anzeige
export function steuerZeigen(el, c) {
  ctx = c;
  const jahre = [...new Set(D.rows.map((r) => r.y))].sort((a, b) => b - a).slice(0, 8);
  // Steuerjahr: das gewählte Jahr, solange es abgeschlossen ist – sonst das letzte volle Jahr (das laufende per Knopf)
  const vollesJahr = +D.bis.slice(0, 4) - (D.bis.slice(5, 7) < '12' ? 1 : 0), ej = ctx.einJahr();
  if (!jahr) jahr = ej && ej <= vollesJahr ? ej : Math.min(jahre[0], vollesJahr);
  const alle = einordnen(jahr);
  const istFertig = (x) => x.status === 'bestaetigt' || x.status === 'ausgeschlossen' || x.status === 'veranlagt';
  const wirksam = alle.filter((x) => x.status !== 'ausgeschlossen');
  const summe = (liste) => liste.reduce((t, x) => t + x.r.c, 0);
  const zu = alle.filter((x) => ZU.includes(x.status)), zuGruppen = arbeitsGruppen(zu).length;
  const fertigG = arbeitsGruppen(alle.filter(istFertig)).length, gesamtG = zuGruppen + fertigG;
  const klar = alle.filter((x) => x.klar);
  const imAbschnitt = (x) => !abschnittF || POSTEN_ID.get(x.p).abschnitt === abschnittF;
  const sichtbar = alle.filter((x) => imAbschnitt(x) && (filter === 'alle' || (filter === 'zu' ? ZU.includes(x.status) : istFertig(x))));

  // Fortschritt als Ring
  const anteil = gesamtG ? fertigG / gesamtG : 1, RR = 34, U = 2 * Math.PI * RR;
  const ring = `<svg class="st-ring" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${RR}" class="st-ring-spur"/>
    ${anteil > 0 ? `<circle cx="42" cy="42" r="${RR}" class="st-ring-wert" stroke-dasharray="${(U * anteil).toFixed(1)} ${U.toFixed(1)}" transform="rotate(-90 42 42)"/>` : ''}
    <text x="42" y="47" text-anchor="middle">${Math.round(anteil * 100)} %</text></svg>`;
  let h = `<div class="st-kopf">
    <div class="seg st-jahre">${jahre.map((y) => `<button data-sjahr="${y}" class="${y === jahr ? 'an' : ''}">${y}</button>`).join('')}</div>
    <div class="st-held">
      <div class="st-stand">${ring}<div><b>${zuGruppen ? `${zuGruppen} ${zuGruppen === 1 ? 'Entscheidung' : 'Entscheidungen'} offen` : 'Alles entschieden'}</b>
        <span class="muted">${fertigG} von ${gesamtG} erledigt · Zahlungen an denselben Empfänger sind eine Entscheidung und gelten für alle Jahre</span></div></div>
      <div class="st-held-knoepfe">
        ${zu.length ? `<button class="btn primary st-los" id="st-pruefen" title="Eine Entscheidung nach der anderen – Tastatur: Enter = ja, X = nein">Jetzt durchgehen →</button>` : ''}
        ${klar.length ? `<button class="btn" id="st-klar" title="Schließt aus, was eindeutig nicht absetzbar ist: Restaurants und Imbisse unter „Übernachtungen“, Einkäufe im Bau- oder Gartenmarkt unter „Handwerker“, Urlaub unter „Kinderbetreuung“. Mit Rückgängig.">${klar.length} eindeutige Fälle ausschließen</button>` : ''}
      </div>
      <div class="st-export"><span class="muted klein">Für die Steuerberaterin</span>
        <div class="st-export-k"><button class="btn sm${zu.length ? '' : ' primary'}" id="st-pdf">PDF</button><button class="btn sm" id="st-xlsx">Excel</button></div>
        <div class="klein muted"><button class="link" id="st-sichern" title="Deine Entscheidungen als Datei sichern">Sicherung speichern</button> · <button class="link" id="st-laden" title="Gesicherte Entscheidungen laden">laden</button></div></div>
    </div>
  </div>`;

  h += offKachel(jahr);
  // Was du geltend machen kannst: je Abschnitt ein Balken, bei den Werbungskosten mit dem Pauschbetrag als Marke
  const abs = ABSCHNITTE.filter((a) => a.id !== 'einnahmen').map((a) => {
    const xs = wirksam.filter((x) => POSTEN_ID.get(x.p).abschnitt === a.id);
    return { a, xs, betrag: -summe(xs), offen: arbeitsGruppen(xs.filter((x) => ZU.includes(x.status))).length };
  }).filter((x) => x.xs.length);
  if (abs.length) {
    const O = offiziell(jahr), offB = (id) => (O?.abschnitte?.[id]?.b != null ? Math.round(O.abschnitte[id].b * 100) : null);
    const maxB = Math.max(1, ...abs.map((x) => Math.max(x.betrag, offB(x.a.id) || 0)), abs.some((x) => x.a.id === 'wk') ? pausch(jahr) : 0);
    const w = (v) => (Math.max(0, v) / maxB) * 100;
    h += `<div class="st-geltend"><div class="st-geltend-t"><b>Was du ${jahr} geltend machen kannst</b> <span class="muted klein">· laut Kontoauszügen, Offenes mitgezählt${O ? ' · <i class="st-offmarke-i"></i> = Betrag laut Unterlagen' : ''} · anklicken: nur diesen Bereich zeigen</span></div>
      ${abs.map((x) => `<button class="st-ab${abschnittF === x.a.id ? ' an' : ''}" data-sabf="${abschnittF === x.a.id ? '' : x.a.id}">
        <span class="st-ab-n">${esc(x.a.name)}${x.offen ? ` <span class="st-offen">${x.offen} offen</span>` : ''}</span>
        <span class="st-ab-balken"><i style="width:${w(x.betrag)}%"></i>${x.a.id === 'wk' ? `<b class="st-pausch" style="left:${w(pausch(jahr))}%" title="Arbeitnehmer-Pauschbetrag ${eur(pausch(jahr))}"></b>` : ''}${offB(x.a.id) != null ? `<b class="st-offmarke" style="left:${w(offB(x.a.id))}%" title="laut ${esc(offName(O))}: ${eur(offB(x.a.id))}"></b>` : ''}</span>
        <span class="st-ab-b">${eur0(x.betrag)}</span>
        <span class="st-ab-w">${offB(x.a.id) != null ? `<span class="st-offiz">laut ${esc(offName(O))}: ${eur0(offB(x.a.id))}${O.abschnitte[x.a.id].t ? ` – ${esc(O.abschnitte[x.a.id].t)}` : ''}</span>` : wirkung(x)}</span></button>`).join('')}
    </div>`;
  }

  const knopf = (v, t) => `<button data-sfilter="${v}" class="${filter === v ? 'an' : ''}">${t}</button>`;
  const aName = abschnittF && ABSCHNITTE.find((x) => x.id === abschnittF)?.name;
  h += `<div class="st-leiste"><div class="seg st-filter">${knopf('zu', `Offen (${zuGruppen})`)}${knopf('erledigt', `Erledigt (${fertigG})`)}${knopf('alle', 'Alle')}</div>
    ${aName ? `<button class="chip" data-sabf="">nur ${esc(aName)}<span class="x">×</span></button>` : ''}
    <span class="muted klein st-leiste-hinweis">Orientierung, keine Steuerberatung.</span></div>`;

  if (!sichtbar.length) {
    const fertig = filter === 'zu' && wirksam.length;
    return (el.innerHTML = h + `<div class="leer">${fertig ? `Alles entschieden${aName ? ` in „${esc(aName)}“` : ''}. Jetzt „PDF“ oder „Excel“ für die Steuerberaterin erstellen.` : 'Keine Buchungen in dieser Auswahl.'}</div>`), binden(el);
  }

  // Liste: Abschnitt → Posten → Buchungen
  h += '<div class="st-liste">';
  for (const a of ABSCHNITTE) {
    const xs = sichtbar.filter((x) => POSTEN_ID.get(x.p).abschnitt === a.id);
    if (!xs.length) continue;
    const auf = offen.has(a.id) || filter !== 'alle' || !!abschnittF;
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
        const gr = gruppieren(ps);
        h += `<div class="st-posten"><div class="st-posten-kopf"><b>${esc(p.name)}</b><span class="muted klein">${ps.length} Buchungen${gr.length < ps.length ? ` · ${gr.length} Empfänger` : ''}</span>
          ${offenP ? `<button class="link klein" data-salle="${p.id}">alle ${offenP} bestätigen</button>` : ''}<span class="betrag">${eur(a.id === 'einnahmen' ? psum : -psum)}</span></div>`;
        for (const g of gr) {
          if (g.length === 1) { h += zeileHtml(g[0]); continue; }
          const auf = gruppeOffen.has(gKey(g[0]));
          h += gruppeHtml(g, auf);
          if (auf) h += `<div class="st-gruppe-einzeln">${g.map(zeileHtml).join('')}</div>`;
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

// Offizielle Zahlen eines Jahres: Ergebnis, Eckdaten, Hinweise des Finanzamts bzw. der Steuerberaterin; ohne Unterlagen: was die Vorjahre lehren
function offKachel(j) {
  const O = offiziell(j);
  const zahl = (b) => (b == null ? '–' : EUR0.format(b));
  if (!O) {
    const vj = offJahre().filter((y) => y < j);
    const L = D?.j?.steuer_offiziell?.kuenftig || [];
    if (!vj.length || !L.length) return '';
    return `<details class="st-off" open><summary><b>Was die Steuererklärungen ${vj[0]}–${vj.at(-1)} für ${j} bedeuten</b> <span class="muted klein">· ${L.length} Punkte</span></summary>
      <ul class="st-off-l">${L.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
  }
  const f = O.ergebnis || {};
  const kopf = [
    f.est != null ? `<div><span>Einkommensteuer</span><b>${zahl(f.est)}</b></div>` : '',
    f.erstattung != null ? `<div><span>${f.erstattung >= 0 ? 'Erstattung' : 'Nachzahlung'}</span><b class="${f.erstattung >= 0 ? 'pos' : 'neg'}">${zahl(Math.abs(f.erstattung))}</b></div>` : '',
    f.zve != null ? `<div><span>zu versteuerndes Einkommen</span><b>${zahl(f.zve)}</b></div>` : '',
    O.veranlagung ? `<div><span>Veranlagung</span><b class="klein-b">${esc(O.veranlagung)}</b></div>` : '',
  ].join('');
  return `<details class="st-off" open><summary><b>${esc(O.titel || offName(O))}</b> <span class="muted klein">· ${esc(O.untertitel || '')}</span></summary>
    <div class="st-off-kopf">${kopf}</div>
    ${O.zahlen?.length ? `<table class="st-off-t">${O.zahlen.map((z) => `<tr class="${z.sum ? 'sum' : ''}"><td>${esc(z.t)}</td><td class="r">${zahl(z.b)}</td><td class="muted">${esc(z.h || '')}</td></tr>`).join('')}</table>` : ''}
    ${O.hinweise?.length ? `<div class="st-off-h"><b>Was daraus folgt</b><ul class="st-off-l">${O.hinweise.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="muted klein">Quelle: ${esc(O.quelle || '')}. Buchungen, die zu den Unterlagen passen, sind automatisch entschieden (✓ angesetzt bzw. ✕ nicht angesetzt) – deine eigenen Entscheidungen gehen immer vor.</div>
  </details>`;
}

function zeileHtml(x) {
  const zweck = x.r.g ? x.r.z : '';
  return `<div class="st-zeile st-${x.status}${x.status === 'ausgeschlossen' ? ' aus' : ''}" data-skey="${esc(x.r.skey)}">
    <div class="st-datum">${dde(x.r.d)}</div>
    <div class="st-text" data-sdetail title="Klicken für alle Details"><div class="titel">${esc(x.r.g || x.r.z || '–')}</div><div class="unter">${esc(zweck)}${zweck ? ' · ' : ''}${esc(D.konten[x.r.k].name)}</div>
      ${hinweisKurz(x)}${x.notiz ? `<div class="st-notiz">Notiz: ${esc(x.notiz)}</div>` : ''}</div>
    <div class="st-betrag ${x.r.c > 0 ? 'pos' : ''}">${eur(x.r.c)}</div>
    <div class="st-knoepfe">${knoepfe(x, 1, false)}</div>
    ${detailOffen.has(x.r.skey) ? `<div class="st-detail">${detailHtml(x)}</div>` : ''}</div>`;
}

const jeBetrag = (g) => { const b = [...new Set(g.map((y) => y.r.c))]; return b.length === 1 ? `je ${eur(b[0])}` : `${b.length} verschiedene Beträge`; };

// Eine Zeile für mehrere Zahlungen an denselben Empfänger
function gruppeHtml(g, auf) {
  const x = g[0], s = g.reduce((t, y) => t + y.r.c, 0);
  return `<div class="st-zeile st-gruppe st-${x.status}${x.status === 'ausgeschlossen' ? ' aus' : ''}" data-sgruppe="${esc(gKey(x))}">
    <div class="st-datum"><span class="st-anzahl">${g.length}×</span></div>
    <div class="st-text" data-sgauf title="Klicken, um die einzelnen Zahlungen zu sehen"><div class="titel">${esc(empfName(x.r))} <span class="st-auf">${auf ? 'zuklappen ▴' : 'einzeln ▾'}</span></div>
      <div class="unter">${g.length} Zahlungen · ${dde(g[0].r.d)} – ${dde(g.at(-1).r.d)} · ${jeBetrag(g)}</div>
      ${hinweisKurz(x)}</div>
    <div class="st-betrag ${s > 0 ? 'pos' : ''}">${eur(s)}</div>
    <div class="st-knoepfe">${knoepfe(x, g.length, true)}</div></div>`;
}

// Eine Zeile Hinweis: wohin es gehört und warum (die ausführliche Einschätzung unter „Warum?“ bzw. in den Details)
function hinweisKurz(x) {
  const k = hinweisKurz1(x);
  return x.offInfo ? `${k}<div class="st-kurz"><span class="st-offiz">${esc(x.offInfo)}</span></div>` : k;
}
function hinweisKurz1(x) {
  const p = POSTEN_ID.get(x.p);
  const regel = x.regel ? ' <span class="muted">· gilt für alle Jahre</span>' : '';
  if (x.status === 'pruefen') return `<div class="st-kurz pruef"><b>Bitte prüfen:</b> ${esc(x.rat || x.hinweis)}${x.rat && x.hinweis ? `<details class="st-warum"><summary>Warum?</summary>${esc(x.hinweis)}</details>` : ''}</div>`;
  if (x.off && x.status === 'bestaetigt') return `<div class="st-kurz ok">✓ ${esc(p.name)} <span class="st-offiz">${esc(x.off)}</span></div>`;
  if (x.status === 'veranlagt') return `<div class="st-kurz muted">≈ <span class="st-offiz">${esc(x.off)}</span></div>`;
  if (x.off && x.status === 'ausgeschlossen') return `<div class="st-kurz muted">✕ <span class="st-offiz">${esc(x.off)}</span></div>`;
  if (x.vj) return `<div class="st-kurz">${x.status === 'pruefen' ? '<b>Bitte prüfen:</b> ' : ''}${esc(POSTEN_ID.get(x.p).name)} <span class="st-offiz">${esc(x.vj)}</span></div>`;
  if (x.status === 'vorschlag') return `<div class="st-kurz">Vorschlag: <b>${esc(p.name)}</b> <span class="muted">– ${esc(x.grund)}</span></div>`;
  if (x.status === 'uebernommen') return `<div class="st-kurz">Aus WISO/Buhl: <b>${esc(p.name)}</b></div>`;
  if (x.status === 'bestaetigt') return `<div class="st-kurz ok">✓ ${esc(p.name)}${regel}</div>`;
  if (x.status === 'ausgeschlossen') return `<div class="st-kurz muted">✕ nicht absetzbar${regel}</div>`;
  if (x.status === 'kontrolle') return `<div class="st-kurz muted">${esc(p.name)} – nur zur Kontrolle</div>`;
  return '';
}

// Knöpfe: Ja / Nein – bei „prüfen“ die passenden Antworten; Posten ändern und Notiz unter „⋯“. g: für eine ganze Gruppe
const kurzAktion = (a) => (a.p === 'x' ? '✕ Nein, nicht absetzbar' : `✓ ${a.t.replace(/^✓\s*/, '').replace(/\s+–\s+.*$/, '')}`);
function knoepfe(x, n, g) {
  const v = g ? 'g' : 's', alle = n > 1 ? ` – alle ${n}` : '';
  let h = '';
  if (ZU.includes(x.status) && x.status === 'pruefen' && x.aktionen?.length) {
    h += x.aktionen.map((a) => `<button class="btn sm ${a.p === 'x' ? 'st-nein' : 'st-ja'}" data-${v}aktion="${a.p}"${a.notiz ? ' data-snotizfrage="1"' : ''} title="${esc(a.t)}${alle}">${esc(kurzAktion(a))}</button>`).join('');
  } else if (ZU.includes(x.status)) {
    h += `<button class="btn sm st-ja" data-${v}ok title="Ja, absetzbar als „${esc(POSTEN_ID.get(x.p).name)}“${alle}">✓ Ja</button><button class="btn sm st-nein" data-${v}x title="Nicht steuerlich relevant${alle}">✕ Nein</button>`;
  } else if (x.status === 'ausgeschlossen') {
    h += `<button class="link klein" data-${v}x title="Wieder als steuerlich relevant aufnehmen${alle}">wieder aufnehmen</button>`;
  }
  return h + `<details class="st-mehr"><summary title="Steuerposten ändern, Notiz">⋯</summary><div class="st-mehr-box">
    <label class="klein">Steuerposten${n > 1 ? ` für alle ${n}` : ''}<select data-${v}posten>${postenOptionen(x.status === 'ausgeschlossen' ? 'x' : x.p)}</select></label>
    <button class="btn sm" data-${v}notiz>✎ Notiz${n > 1 ? ' für alle' : ''}</button></div></details>`;
}

// Was der Betrag eines Abschnitts steuerlich bewirkt – in einem Satz
function wirkung(x) {
  const v = x.betrag;
  if (x.a.id === 'wk') { const d = v - pausch(jahr); return d > 0 ? `<span class="pos">${eur0(d)} über dem Pauschbetrag – das zählt</span>` : `unter dem Pauschbetrag von ${eur0(pausch(jahr))} – bringt nichts zusätzlich`; }
  if (x.a.id === 'haushalt') return `bis ≈ ${eur0(Math.min(v * 0.2, 520000))} weniger Steuer, wenn alles Arbeitskosten sind (20 %)`;
  if (x.a.id === 'vorsorge') return 'begrenzt abziehbar – oft schon durch die Krankenversicherung ausgeschöpft';
  if (x.a.id === 'sonder') return 'Ehegattenunterhalt bis 13.805 €, nur mit Zustimmung (Anlage U)';
  if (x.a.id === 'agb') return 'zählt erst über der zumutbaren Belastung (≈ 1–7 % der Einkünfte)';
  if (x.a.id === 'kinder') return jahr >= 2025 ? '80 % absetzbar, höchstens 4.800 € je Kind' : 'zwei Drittel absetzbar, höchstens 4.000 € je Kind';
  return '';
}

// Für die Übersicht: offene Entscheidungen im letzten vollen Steuerjahr (null, solange die Entscheidungen noch laden)
export function steuerStand() {
  if (!D || !geladen) return null;
  const j = +D.bis.slice(0, 4) - (D.bis.slice(5, 7) < '12' ? 1 : 0);
  return { jahr: j, offen: arbeitsGruppen(einordnen(j).filter((x) => ZU.includes(x.status))).length };
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
  if (e?.p) return e.p;
  const a = automatisch(r);
  if (!a) return '';
  const rg = entscheidungen[regelKey(r, a.p)];
  return rg?.x ? 'x' : rg?.p || a.p;
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
  // nur ein „⋯“-Menü zugleich offen
  el.querySelectorAll('.st-mehr').forEach((d) => d.addEventListener('toggle', () => { if (d.open) el.querySelectorAll('.st-mehr[open]').forEach((o) => { if (o !== d) o.open = false; }); }));
  el.querySelectorAll('[data-sfilter]').forEach((b) => b.onclick = () => { filter = b.dataset.sfilter; neu(); });
  el.querySelectorAll('[data-sabf]').forEach((b) => b.onclick = () => {
    abschnittF = b.dataset.sabf;
    if (abschnittF) offen.add(abschnittF);
    neu();
    if (abschnittF) el.querySelector('.st-leiste')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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
  el.querySelectorAll('[data-sdetail]').forEach((t) => t.onclick = (ev) => { if (ev.target.closest('button, select, a, details')) return; const k = zeile(t).dataset.skey; detailOffen.has(k) ? detailOffen.delete(k) : detailOffen.add(k); neu(); });
  // Gruppen: aufklappen und für alle entscheiden
  const gruppeVon = (b) => { const k = b.closest('[data-sgruppe]').dataset.sgruppe; return einordnen(jahr).filter((x) => gKey(x) === k).map((x) => x.r.skey); };
  el.querySelectorAll('[data-sgauf]').forEach((t) => t.onclick = (ev) => {
    if (ev.target.closest('button, select, a, details')) return;
    const k = t.closest('[data-sgruppe]').dataset.sgruppe; gruppeOffen.has(k) ? gruppeOffen.delete(k) : gruppeOffen.add(k); neu();
  });
  el.querySelectorAll('[data-gaktion]').forEach((b) => b.onclick = () => gruppeEntscheiden(gruppeVon(b), b.dataset.gaktion, !!b.dataset.snotizfrage));
  el.querySelectorAll('[data-gok]').forEach((b) => b.onclick = () => gruppeEntscheiden(gruppeVon(b), 'ok'));
  el.querySelectorAll('[data-gx]').forEach((b) => b.onclick = () => gruppeEntscheiden(gruppeVon(b), b.closest('.aus') ? 'ok' : 'x'));
  el.querySelectorAll('[data-gposten]').forEach((s) => s.onchange = () => gruppeEntscheiden(gruppeVon(s), s.value));
  el.querySelectorAll('[data-gnotiz]').forEach((b) => b.onclick = () => {
    const keys = gruppeVon(b);
    const t = prompt(`Notiz für alle ${keys.length} Zahlungen (erscheint im PDF und in Excel):`, entscheidungen[keys[0]]?.n || '');
    if (t === null) return;
    for (const k of keys) { const e = { ...(entscheidungen[k] || {}) }; if (t.trim()) e.n = t.trim(); else delete e.n; entscheidungen[k] = e; }
    speichern(); neu();
  });
  el.querySelector('#st-klar')?.addEventListener('click', () => {
    const xs = einordnen(jahr).filter((x) => x.klar);
    const arten = [...new Set(xs.map((x) => x.klar))].join(', ');
    const vorher = [];
    for (const g of gruppieren(xs)) vorher.push(...gruppeEntscheiden(g.map((x) => x.r.skey), 'x', false, true));
    neu();
    rueckgaengig(`${xs.length} eindeutige Fälle ausgeschlossen (${arten})`, vorher);
  });
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
    const war = zeile(b).classList.contains('aus');
    if (war) { entscheidungen[r.skey] = { ...e, p: e.p || steuerPostenAuto(r), ok: 1 }; delete entscheidungen[r.skey].x; } else entscheidungen[r.skey] = { ...e, x: 1 };
    speichern(); neu();
    rueckgaengig(`${war ? 'Wieder aufgenommen' : 'Ausgeschlossen'}: ${kurzName(r)}`, [v]);
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

const steuerPostenAuto = (r) => automatisch(r)?.p;

// Einschätzung + Empfehlung + Knöpfe (Liste und Prüffenster); n > 1: gilt für eine ganze Gruppe
function hinweisHtml(x, n = 1) {
  if (!x.hinweis) return '';
  const pr = x.status === 'pruefen' || x.status === 'vorschlag';
  return `<div class="st-rat${x.status === 'pruefen' ? ' pruef' : ''}">
    <div><b>${pr ? 'Einschätzung' : 'Hinweis'}:</b> ${esc(x.hinweis)}</div>
    ${x.rat ? `<div><b>Empfehlung:</b> ${esc(x.rat)}</div>` : ''}
    ${x.aktionen?.length ? `<div class="st-rat-knoepfe">${x.aktionen.map((a) => `<button class="btn sm${a.p === 'x' ? ' danger' : ''}" data-${n > 1 ? 'g' : 's'}aktion="${a.p}"${a.notiz ? ' data-snotizfrage="1"' : ''}>${esc(a.t)}${n > 1 ? ` (alle ${n})` : ''}</button>`).join('')}</div>` : ''}
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

function detailHtml(x, gross = false, n = 1) {
  const r = x.r, p = POSTEN_ID.get(x.p);
  const felder = [
    ['Datum', dde(r.d)], ['Betrag', eur(r.c)], ['Konto', D.konten[r.k].name], ['Empfänger / Auftraggeber', r.g || '–'],
    ['Verwendungszweck', r.z || '–'], ['Kategorie (Finanzguru)', `${r.kat}${r.ukat ? ' · ' + r.ukat : ''}`], ['Art', r.art],
    ['Steuerkategorie (WISO/Buhl)', r.st || '–'], ['Steuerposten', p ? `${ABSCHNITTE.find((a) => a.id === p.abschnitt).name} → ${p.name}` : '–'],
    ['Was zählt hier', p?.info || '–'], ['Warum so eingeordnet', x.grund || '–'], ...(r.v ? [['Vertrag', r.v]] : []), ...(r.t ? [['Tags', r.t]] : []), ...(r.n ? [['Notiz (Finanzguru)', r.n]] : []),
  ];
  let h = `<dl class="st-felder">${felder.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  if (gross) h = hinweisHtml(x, n) + h;
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
  pruefListe = arbeitsGruppen(einordnen(jahr).filter((x) => ZU.includes(x.status))).map((g) => g.map((x) => x.r.skey));
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
  const offene = einordnen(jahr), nachKey = new Map(offene.map((y) => [y.r.skey, y]));
  const keys = pruefListe[pruefI] || [];
  const xs = keys.map((k) => nachKey.get(k)).filter(Boolean), x = xs[0];
  const nochOffen = pruefListe.filter((ks) => ks.some((k) => ZU.includes(nachKey.get(k)?.status))).length;
  if (!x) {
    dlg.innerHTML = `<div class="st-dlg-haupt"><h2>Fertig</h2><p>Alle offenen Punkte für ${jahr} sind durchgesehen.</p><button class="btn primary" data-p="fertig">Schließen</button></div>`;
    dlg.querySelector('[data-p="fertig"]').onclick = pruefSchliessen;
    return;
  }
  const [st, stc] = STATUS[x.status];
  const n = xs.length, gs = xs.reduce((t, y) => t + y.r.c, 0);
  const liste = n > 1 ? `<div class="st-verlauf"><div class="klein"><b>Die ${n} Zahlungen dieser Gruppe</b> – die Entscheidung gilt für alle und künftig auch in anderen Jahren:</div>
      <table class="st-vtab">${xs.map((y) => `<tr><td>${dde(y.r.d)}</td><td class="r">${eur(y.r.c)}</td><td class="z" colspan="2">${esc(y.r.z)}</td></tr>`).join('')}</table></div>` : '';
  dlg.innerHTML = `<div class="st-dlg-kopf"><b>Entscheidung ${pruefI + 1} von ${pruefListe.length}</b><span class="muted klein">${nochOffen} noch offen · Steuerjahr ${jahr}</span>
      <button class="icon-btn sm" data-p="zu" title="Schließen (Esc)">✕</button></div>
    <div class="st-dlg-haupt">
      <div class="st-dlg-betrag"><span class="betrag ${gs > 0 ? 'pos' : ''}">${eur(gs)}</span>${n > 1 ? `<span class="st-anzahl">${n} Zahlungen · ${jeBetrag(xs)}</span>` : ''}<span class="st-badge ${stc}">${st}</span></div>
      <div class="st-dlg-titel">${esc(x.r.g || '–')}</div>
      <div class="st-dlg-zweck">${esc(x.r.z || '')}</div>
      ${liste}
      ${detailHtml(x, true, n)}
      ${x.notiz ? `<div class="st-notiz">Deine Notiz: ${esc(x.notiz)}</div>` : ''}
    </div>
    <div class="st-dlg-fuss">
      <label class="klein">Steuerposten <select data-p="posten">${postenOptionen(x.status === 'ausgeschlossen' ? 'x' : x.p)}</select></label>
      <div class="st-posten-info klein" data-p="info">${esc(POSTEN_ID.get(x.p)?.info || '')}</div>
      <div class="st-dlg-knoepfe">
        <button class="btn" data-p="zurueck" title="← Pfeiltaste">← Zurück</button>
        <button class="btn" data-p="notiz">Notiz</button>
        <button class="btn danger" data-p="x" title="Taste X">✕ Nicht relevant${n > 1 ? ` (alle ${n})` : ''}</button>
        <button class="btn primary" data-p="ok" title="Enter">✓ Bestätigen${n > 1 ? ` (alle ${n})` : ''}</button>
        <button class="btn" data-p="weiter" title="→ Pfeiltaste">Überspringen →</button>
      </div>
      <div class="muted klein">Tasten: Enter = bestätigen · X = nicht relevant · → überspringen · ← zurück · Esc = schließen</div>
    </div>`;
  const r = x.r;
  const weiter = () => { if (pruefI < pruefListe.length - 1) pruefI++; else pruefListe = []; pruefZeigen(); };
  dlg.querySelector('[data-p="zu"]').onclick = pruefSchliessen;
  dlg.querySelector('[data-p="posten"]').onchange = (e) => { dlg.querySelector('[data-p="info"]').textContent = e.target.value === 'x' ? 'Wird nicht in die Steuerunterlagen übernommen.' : POSTEN_ID.get(e.target.value)?.info || ''; };
  dlg.querySelectorAll('[data-saktion], [data-gaktion]').forEach((b) => b.onclick = () => { gruppeEntscheiden(keys, b.dataset.saktion || b.dataset.gaktion, !!b.dataset.snotizfrage, true); weiter(); });
  dlg.querySelector('[data-p="weiter"]').onclick = weiter;
  dlg.querySelector('[data-p="zurueck"]').onclick = () => { if (pruefI > 0) pruefI--; pruefZeigen(); };
  dlg.querySelector('[data-p="ok"]').onclick = () => { gruppeEntscheiden(keys, dlg.querySelector('[data-p="posten"]').value, false, true); weiter(); };
  dlg.querySelector('[data-p="x"]').onclick = () => { gruppeEntscheiden(keys, 'x', false, true); weiter(); };
  dlg.querySelector('[data-p="notiz"]').onclick = () => {
    const t = prompt(`Notiz ${n > 1 ? `für alle ${n} Zahlungen` : 'zu dieser Buchung'} (erscheint im PDF und in Excel):`, entscheidungen[r.skey]?.n || '');
    if (t === null) return;
    for (const k of keys) { const e = { ...(entscheidungen[k] || {}) }; if (t.trim()) e.n = t.trim(); else delete e.n; entscheidungen[k] = e; }
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
