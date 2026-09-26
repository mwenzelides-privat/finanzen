# Finanzen – private Finanzverwaltung

Modernes Finanz-Dashboard für alle Konten: Buchungen, Budgets, Urlaubskasse, Steuererklärung, Fixkosten und Finanzberichte (als PDF druckbar).
Die App läuft im Browser auf jedem Rechner, funktioniert **offline** und gleicht sich über **dein Google Drive** ab, sobald wieder Internet da ist.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Übersicht** | Gesamtvermögen mit Verlauf, Einnahmen/Ausgaben/Sparquote des Monats, 12-Monats-Diagramm, Top-Kategorien, Budgetstatus, letzte Buchungen |
| **Buchungen** | Filter nach Zeitraum, Konto, Kategorie, Art, Betrag, Steuer, Urlaubskasse, Tags und Freitext (auch Beträge). Kategorie direkt in der Liste ändern, Mehrfachauswahl, CSV-Export |
| **Konten** | Beliebig viele Konten (Giro, Tagesgeld, Kreditkarte, Bargeld, Depot, PayPal …), Saldo-Abgleich mit der Bank, Verlauf |
| **Budgets** | Monatslimits je Kategorie, Ampel, Hinweis „schneller als geplant“, Budget und Ist über 6 Monate, Vorschläge aus dem Durchschnitt |
| **Urlaubskasse** | Mehrere Kassen mit Sparziel, Reisedatum und Sparrate, nötige Rate pro Monat, Einzahlungen/Ausgaben, Bankbuchungen einer Reise zuordnen |
| **Steuer** | Posten nach Anlage N, Vorsorge, Sonderausgaben, außergewöhnliche Belastungen, §35a, KAP. Entfernungs- und Homeoffice-Pauschale, Vergleich mit dem Pauschbetrag, Checkliste, Vorschläge, PDF- und CSV-Export |
| **Berichte** | Frei wählbarer Zeitraum und Konto, Vergleich zur Vorperiode, Kategorien mit Anteil und Veränderung, Top-Empfänger, **automatisch erkannte Fixkosten und Abos**, PDF/Drucken |
| **Import** | CSV aller gängigen deutschen Banken (Sparkasse, Volksbank, ING, DKB, comdirect, Postbank …) und Excel. Spalten werden erkannt, Duplikate übersprungen, Kontostand übernommen, automatische Kategorisierung per Regeln, Import rückgängig machen |
| **Einstellungen** | Google-Drive-Sync, optionale Verschlüsselung mit Passwort, Kategorien, Regeln, Backup herunterladen/einspielen, Hell/Dunkel |

## Datenschutz: wer sieht was?

- **Das Programm** (diese Dateien) liegt öffentlich auf GitHub Pages. Es enthält **keine Daten**.
- **Deine Daten** liegen nur (1) im Browser des jeweiligen Geräts und (2) in deinem Google Drive im Ordner `Finanzverwaltung`.
- Die App nutzt die Berechtigung `drive.file`: Sie sieht **nur die Dateien, die sie selbst angelegt hat**, nicht den Rest deines Drives.
- Solange die Google-App im Status „Testen“ ist und nur du als Testnutzer eingetragen bist, kann sich **niemand außer dir** anmelden.
- Optional **Verschlüsselung** (Einstellungen → Sicherheit): AES-256, Schlüssel aus deinem Passwort. Dann ist die Datei in Drive ohne Passwort unlesbar, und auf jedem Gerät wird beim Öffnen danach gefragt. **Das Passwort lässt sich nicht wiederherstellen.**
- An fremden Rechnern: Einstellungen → „Dieses Gerät leeren“.
- Jeden Tag wird automatisch ein Backup in `Finanzverwaltung/Backups` abgelegt (die letzten 30 bleiben).

---

## Einrichtung (einmalig, ca. 20 Minuten)

### Schritt 1 – App auf GitHub Pages veröffentlichen

1. Auf [github.com](https://github.com) anmelden (oder kostenloses Konto anlegen).
2. **New repository** → Name z. B. `finanzen` → *Public* → Create.
   (Pages für private Repos braucht GitHub Pro. Öffentlich ist unkritisch, im Code stehen keine Daten.)
3. **Add file → Upload files** → den kompletten Inhalt dieses Ordners hochladen (`index.html`, `config.js`, `sw.js`, `manifest.webmanifest`, `.nojekyll` und die Ordner `css`, `js`, `icons`) → Commit.
4. **Settings → Pages** → *Source: Deploy from a branch* → Branch `main`, Ordner `/ (root)` → Save.
5. Nach 1–2 Minuten läuft die App unter `https://<dein-github-name>.github.io/finanzen/`.

### Schritt 2 – Google Drive anbinden

1. [console.cloud.google.com](https://console.cloud.google.com) öffnen (mit **deinem privaten Google-Konto**) → oben **Projekt auswählen → Neues Projekt** → Name `Finanzverwaltung` → Erstellen.
2. **APIs & Dienste → Bibliothek** → „Google Drive API“ suchen → **Aktivieren**.
3. **Google Auth Platform** (bzw. „OAuth-Zustimmungsbildschirm“):
   - *Branding*: App-Name `Finanzen`, Support-E-Mail = deine Adresse.
   - *Zielgruppe*: **Extern**, Veröffentlichungsstatus **Testen** lassen, unter *Testnutzer* **deine eigene Gmail-Adresse** hinzufügen.
   - *Datenzugriff*: Bereich hinzufügen → `https://www.googleapis.com/auth/drive.file`.
4. **Clients → Client erstellen** → Anwendungstyp **Webanwendung** → unter *Autorisierte JavaScript-Quellen* eintragen:
   - `https://<dein-github-name>.github.io`
   - `http://localhost:8080` (nur für lokale Tests)
   → Erstellen → **Client-ID kopieren** (endet auf `.apps.googleusercontent.com`).
5. Die Client-ID in `config.js` bei `googleClientId: '…'` eintragen und die Datei auf GitHub aktualisieren.
   (Alternativ in der App unter Einstellungen → Google Drive → Client-ID. Das gilt dann aber nur für dieses Gerät.)
6. App öffnen → **Einstellungen → Mit Google Drive verbinden** → Google-Konto wählen. Google zeigt einen Hinweis „App nicht überprüft“, weil es deine eigene Test-App ist → *Weiter*.

### Schritt 3 – auf weiteren Rechnern

Einfach die Adresse öffnen → **„Verbinden & Daten laden“** → fertig. Im Browsermenü „App installieren“ wählen, dann startet sie wie ein normales Programm, auch offline.

---

## Wie Offline und Synchronisierung funktionieren

- Jede Änderung wird **sofort lokal** gespeichert. Die App funktioniert komplett ohne Internet.
- Online wird automatisch abgeglichen: ein paar Sekunden nach jeder Änderung, beim Wieder-online-Gehen, beim Zurückkehren in den Tab und alle 5 Minuten.
- Wurde auf zwei Geräten offline gearbeitet, werden die Daten **datensatzweise zusammengeführt**. Pro Buchung gewinnt die neuere Änderung, Löschungen werden übernommen.
- Die Google-Anmeldung gilt aus Sicherheitsgründen ca. 1 Stunde. Danach zeigt die Statusanzeige unten links „Anmelden & synchronisieren“: ein Klick genügt.

## Kontoauszüge importieren

Im Online-Banking die Umsätze als **CSV** exportieren (Sparkasse: Format „CSV-CAMT“) und auf der Seite **Import** ablegen.
- Die Spalten werden automatisch erkannt. Die Zuordnung wird pro Bank-Format gemerkt.
- Bereits importierte Buchungen werden erkannt und übersprungen. Überlappende Zeiträume sind also kein Problem.
- „Vorgemerkte“ Umsätze werden übersprungen (sie kommen später gebucht wieder).
- Enthält die Datei einen Kontostand (ING, Volksbank, DKB …), wird er für den Saldo übernommen.
- Neue Buchungen werden über **Regeln** kategorisiert. Beim Bearbeiten einer Buchung „für ähnliche merken“ anhaken, dann lernt die App dazu.

**Direkte Bankschnittstelle (automatischer Abruf):** Braucht einen PSD2-Dienst wie Enable Banking, finAPI oder Tink und einen kleinen Server, der die Zugangsschlüssel sicher verwahrt. Das ist als Ausbaustufe möglich. Der CSV-Import deckt alle Banken ohne Zusatzkosten ab.

## Updates einspielen

Nach Änderungen an den Dateien in `sw.js` die Zeile `const VERSION = 'v1.0.0'` hochzählen und hochladen. Alle Geräte zeigen dann „Neue Version verfügbar → Aktualisieren“.

## Lokal testen

```bash
python -m http.server 8080 --bind 127.0.0.1
```
Dann `http://localhost:8080` öffnen. Über „Beispieldaten laden“ lässt sich alles ausprobieren. Die Beispieldaten sind in den Einstellungen mit einem Klick wieder entfernt.

## Hinweise

- Steuer-Pauschalen (Entfernungspauschale ab 2026: 38 ct ab dem 1. km, Homeoffice 6 €/Tag, max. 1.260 €, Arbeitnehmer-Pauschbetrag 1.230 €) sind hinterlegt, aber **ohne Gewähr**. Das ist eine Sammel- und Rechenhilfe, keine Steuerberatung. Anpassen in `js/defaults.js` → `taxRates`.
- Technik: reines HTML/CSS/JavaScript ohne Build-Schritt. Chart.js und SheetJS kommen per CDN und werden für offline zwischengespeichert. Daten in IndexedDB, Sync über die Google Drive API v3.

## Projektstruktur

```
index.html            App-Seite
config.js             Google-Client-ID
sw.js                 Offline-Cache (Service Worker)
manifest.webmanifest  Installierbare App
css/app.css           Design (hell/dunkel, mobil, Druck)
js/app.js             Start, Navigation, Sperrbildschirm
js/store.js           Datenspeicher (IndexedDB), Zusammenführen
js/sync.js, drive.js  Google-Drive-Abgleich
js/crypto.js          Verschlüsselung
js/importer.js        CSV/Excel-Import
js/calc.js            Auswertungen
js/views/*.js         Die einzelnen Seiten
```
