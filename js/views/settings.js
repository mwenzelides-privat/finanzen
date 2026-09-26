import { store, getCrypto, setCrypto, kvSet, kvDel, kvClear, kvGet, mergeStates, emptyState as blankState, COLLECTIONS, stopPersisting } from '../store.js';
import { esc, todayISO, download, ls } from '../util.js';
import { icon } from '../icons.js';
import { bindActions, toast, confirmDialog, promptDialog, catChip, rerender, field, modal } from '../ui.js';
import { openCategoryForm, openRuleForm } from '../forms.js';
import * as drive from '../drive.js';
import * as sync from '../sync.js';
import { newSalt, deriveKey } from '../crypto.js';
import { taxCat } from '../defaults.js';
import { applyRules } from '../categorize.js';
import { hasDemo, removeDemo, loadDemo } from '../demo.js';

export const title = 'Einstellungen';

export async function render(root) {
  const st = sync.getStatus();
  const last = sync.lastSync();
  const encrypted = !!store.settings().encrypted;
  const trusted = encrypted ? !!(await kvGet('trustedKey').catch(() => null)) : false;
  const cats = store.all('categories').sort((a, b) => a.group.localeCompare(b.group) || (a.order ?? 999) - (b.order ?? 999));
  const rules = store.all('rules').sort((a, b) => (b.prio || 0) - (a.prio || 0) || a.match.localeCompare(b.match));
  const counts = new Map();
  for (const t of store.all('transactions')) if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
  const usage = await navigator.storage?.estimate?.().catch(() => null);

  root.innerHTML = `
    <div class="page-head"><div><h1>Einstellungen</h1><p class="sub">Synchronisierung, Sicherheit, Kategorien und Regeln</p></div></div>
    <div class="grid">
      <section class="card span-6" id="sync">
        <div class="card-h"><h2>${icon('cloud')} Google Drive</h2><span class="badge ${st.state === 'synced' ? 'good' : st.state === 'error' ? 'bad' : ''}">${esc(statusText(st))}</span></div>
        ${drive.isConfigured() ? `
          ${drive.wasConnected() ? `
            <dl class="kv">
              <div><dt>Konto</dt><dd>${esc(drive.email() || 'verbunden')}</dd></div>
              <div><dt>Letzter Abgleich</dt><dd>${last ? new Date(last).toLocaleString('de-DE') : 'noch nie'}</dd></div>
              <div><dt>Ablage</dt><dd>${drive.folderLink() ? `<a class="link" href="${drive.folderLink()}" target="_blank" rel="noopener">Ordner „Finanzverwaltung“ öffnen ${icon('link')}</a>` : 'Ordner „Finanzverwaltung“'}</dd></div>
              <div><dt>Backups</dt><dd>täglich, die letzten 30 im Unterordner „Backups“</dd></div>
            </dl>
            ${st.state === 'error' ? `<p class="small text-bad">${esc(st.message)}</p>` : ''}
            <div class="btn-row">
              <button class="btn btn-primary" data-action="syncNow">${icon('refresh')} Jetzt synchronisieren</button>
              <button class="btn btn-ghost" data-action="disconnect">${icon('logout')} Trennen</button>
            </div>` : `
            <p>Verbinde dein Google-Konto. Die App legt in deinem Drive einen Ordner „Finanzverwaltung“ an und darf <b>nur ihre eigenen Dateien</b> sehen, sonst nichts.</p>
            <button class="btn btn-primary" data-action="syncNow">${icon('cloud')} Mit Google Drive verbinden</button>`}
          <details class="small-details"><summary>Client-ID ändern</summary>${clientIdForm()}</details>
        ` : `
          <p>Für die Synchronisierung braucht die App eine eigene <b>Google-OAuth-Client-ID</b>. Die Einrichtung dauert einmalig ca. 10 Minuten, die Schritte stehen in der <b>README.md</b> („Google Drive einrichten“).</p>
          ${clientIdForm()}
          <p class="small muted">Tipp: Trag die ID in <code>config.js</code> ein, dann gilt sie automatisch auf allen Geräten.</p>`}
        <p class="small muted">Offline arbeitest du ganz normal weiter. Änderungen werden lokal gespeichert und beim nächsten Online-Abgleich zusammengeführt.</p>
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>${icon('shield')} Sicherheit</h2><span class="badge ${encrypted ? 'good' : ''}">${encrypted ? 'verschlüsselt' : 'unverschlüsselt'}</span></div>
        ${encrypted ? `
          <p>Deine Daten sind mit deinem Passwort verschlüsselt, auf diesem Gerät und in Google Drive. Ohne Passwort kann niemand sie lesen, auch Google nicht.</p>
          <label class="check"><input type="checkbox" data-trust ${trusted ? 'checked' : ''}> Diesem Gerät vertrauen (Passwort nicht bei jedem Start abfragen)</label>
          <div class="btn-row">
            <button class="btn" data-action="lock">${icon('lock')} Jetzt sperren</button>
            <button class="btn" data-action="changePass">Passwort ändern</button>
            <button class="btn btn-ghost danger" data-action="disableEnc">Verschlüsselung aus</button>
          </div>` : `
          <p>Optional: Verschlüssle alle Daten mit einem Passwort. Dann ist die Datei in Google Drive ohne dein Passwort unlesbar, und auf fremden Rechnern wird beim Öffnen danach gefragt.</p>
          <p class="small text-warn">${icon('alert')} Das Passwort lässt sich nicht wiederherstellen. Bitte gut aufbewahren, z. B. im Passwort-Manager.</p>
          <button class="btn btn-primary" data-action="enableEnc">${icon('lock')} Verschlüsselung einschalten</button>`}
        <hr>
        <h3 class="mini-title">Auf fremden Rechnern</h3>
        <p class="small muted">Nach der Nutzung an einem fremden Rechner: „Dieses Gerät leeren“ entfernt alle lokalen Daten und die Anmeldung. Deine Daten in Google Drive bleiben erhalten.</p>
        <button class="btn btn-ghost danger" data-action="wipe">${icon('trash')} Dieses Gerät leeren</button>
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>Kategorien</h2><button class="btn btn-sm" data-action="addCat">${icon('plus')} Kategorie</button></div>
        <div class="table-wrap scroll-y"><table class="table compact"><tbody>${cats.map((c) => `
          <tr class="clickable" data-action="editCat" data-id="${c.id}">
            <td>${catChip(c)}</td><td class="muted small">${esc(c.group)}</td>
            <td class="small">${c.type === 'income' ? 'Einnahme' : c.type === 'transfer' ? 'Umbuchung' : 'Ausgabe'}</td>
            <td class="num muted small">${counts.get(c.id) || 0}</td></tr>`).join('')}</tbody></table></div>
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>Regeln für die Kategorisierung</h2>
          <div class="actions"><button class="btn btn-sm btn-ghost" data-action="applyAll" title="Auf alle Buchungen ohne Kategorie anwenden">${icon('wand')} Anwenden</button><button class="btn btn-sm" data-action="addRule">${icon('plus')} Regel</button></div></div>
        <div class="table-wrap scroll-y"><table class="table compact"><tbody>${rules.map((r) => `
          <tr class="clickable" data-action="editRule" data-id="${r.id}">
            <td class="grow"><code class="rule-match">${esc(r.match.length > 60 ? r.match.slice(0, 60) + '…' : r.match)}</code>
              <div class="tx-sub">${r.field === 'payee' ? 'Empfänger' : r.field === 'purpose' ? 'Zweck' : 'überall'} · ${r.sign === 'in' ? 'nur Eingänge' : r.sign === 'out' ? 'nur Ausgaben' : 'alle'}${r.taxCategory ? ' · ' + esc(taxCat(r.taxCategory)?.short || '') : ''}</div></td>
            <td>${catChip(store.get('categories', r.categoryId))}</td></tr>`).join('')}</tbody></table></div>
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>${icon('database')} Daten</h2></div>
        <dl class="kv">
          <div><dt>Buchungen</dt><dd>${store.all('transactions').length.toLocaleString('de-DE')}</dd></div>
          <div><dt>Konten</dt><dd>${store.all('accounts').length}</dd></div>
          ${usage ? `<div><dt>Speicher auf diesem Gerät</dt><dd>${(usage.usage / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB</dd></div>` : ''}
        </dl>
        <div class="btn-row">
          <button class="btn" data-action="export">${icon('download')} Backup herunterladen</button>
          <label class="btn">${icon('upload')} Backup einspielen<input type="file" accept=".json" hidden data-restore></label>
        </div>
        ${hasDemo() ? `<button class="btn btn-ghost danger" data-action="removeDemo">${icon('trash')} Beispieldaten entfernen</button>` : `<button class="btn btn-ghost" data-action="demo">Beispieldaten laden</button>`}
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>Darstellung</h2></div>
        <div class="seg">
          ${[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => `<label><input type="radio" name="theme" value="${k}" ${(ls.get('fv.theme') || 'auto') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        <p class="small muted">App installieren: Im Browser-Menü „App installieren“ bzw. „Zum Startbildschirm“ wählen. Dann startet sie wie ein normales Programm, auch offline.</p>
      </section>
    </div>`;

  root.querySelectorAll('input[name=theme]').forEach((el) => el.addEventListener('change', () => {
    window.dispatchEvent(new CustomEvent('fv:theme', { detail: el.value }));
  }));
  root.querySelector('[data-trust]')?.addEventListener('change', async (e) => {
    if (e.target.checked) await kvSet('trustedKey', getCrypto().key); else await kvDel('trustedKey');
    toast(e.target.checked ? 'Dieses Gerät merkt sich den Schlüssel' : 'Passwort wird beim nächsten Start abgefragt');
  });
  root.querySelector('[data-restore]')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const data = j.data || j;
      if (!Array.isArray(data.transactions)) throw new Error('Keine gültige Backup-Datei.');
      const mode = await chooseRestore();
      if (!mode) return;
      if (mode === 'merge') store.replace(mergeStates(store.state, data), { dirty: true });
      else {
        // Ersetzen: Backup-Datensätze als neuesten Stand markieren, alles andere löschen –
        // so gewinnt das Backup auch beim nächsten Abgleich mit Drive.
        const t = Date.now();
        const next = blankState();
        for (const c of COLLECTIONS) {
          const incoming = (data[c] || []).map((r) => ({ ...r, updatedAt: t }));
          const ids = new Set(incoming.map((r) => r.id));
          next[c] = [...incoming, ...store.state[c].filter((r) => !ids.has(r.id)).map((r) => ({ id: r.id, deleted: true, updatedAt: t }))];
        }
        const cur = store.settings();
        next.settings = { ...(data.settings || {}), encrypted: cur.encrypted, encSalt: cur.encSalt, updatedAt: t };
        store.replace(next, { dirty: true });
      }
      toast('Backup eingespielt', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  root.querySelector('[data-cid]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    drive.setClientId(e.target.cid.value.trim());
    toast('Client-ID gespeichert', 'success');
    drive.preload();
    sync.refreshIdle();
    rerender();
  });

  bindActions(root, {
    syncNow: () => sync.syncNow({ interactive: true }).then(rerender),
    disconnect: async () => {
      if (!(await confirmDialog('Google Drive trennen? Die Daten bleiben lokal und in Drive erhalten.', { ok: 'Trennen', danger: false }))) return;
      drive.disconnect(); sync.refreshIdle(); rerender();
    },
    enableEnc: async () => {
      const p1 = await promptDialog({ title: 'Verschlüsselung einschalten', label: 'Neues Passwort (mind. 8 Zeichen)', type: 'password', ok: 'Weiter' });
      if (!p1) return;
      if (p1.length < 8) return toast('Bitte mindestens 8 Zeichen verwenden.', 'warn');
      const p2 = await promptDialog({ title: 'Passwort bestätigen', label: 'Passwort wiederholen', type: 'password', ok: 'Verschlüsseln' });
      if (p1 !== p2) return toast('Die Passwörter stimmen nicht überein.', 'error');
      const salt = newSalt();
      setCrypto({ key: await deriveKey(p1, salt), salt });
      store.setSettings({ encrypted: true, encSalt: salt });
      await kvSet('trustedKey', getCrypto().key);
      toast('Verschlüsselung aktiv', 'success');
      rerender();
    },
    changePass: async () => {
      const p1 = await promptDialog({ title: 'Passwort ändern', label: 'Neues Passwort (mind. 8 Zeichen)', type: 'password', ok: 'Weiter' });
      if (!p1) return;
      if (p1.length < 8) return toast('Bitte mindestens 8 Zeichen verwenden.', 'warn');
      const p2 = await promptDialog({ title: 'Passwort bestätigen', label: 'Neues Passwort wiederholen', type: 'password', ok: 'Ändern' });
      if (p1 !== p2) return toast('Die Passwörter stimmen nicht überein.', 'error');
      const salt = newSalt();
      setCrypto({ key: await deriveKey(p1, salt), salt });
      store.setSettings({ encrypted: true, encSalt: salt });
      if (await kvGet('trustedKey')) await kvSet('trustedKey', getCrypto().key);
      toast('Passwort geändert. Andere Geräte fragen beim nächsten Abgleich nach dem neuen Passwort.', 'success', 6000);
    },
    disableEnc: async () => {
      if (!(await confirmDialog('Verschlüsselung ausschalten? Die Daten liegen danach lesbar in Google Drive.', { ok: 'Ausschalten' }))) return;
      setCrypto(null);
      store.setSettings({ encrypted: false, encSalt: null });
      await kvDel('trustedKey');
      rerender();
    },
    lock: async () => { await kvDel('trustedKey'); await store.flush(); location.reload(); },
    wipe: async () => {
      if (!(await confirmDialog(`Alle lokalen Daten und die Anmeldung auf diesem Gerät löschen?${drive.wasConnected() ? ' Deine Daten in Google Drive bleiben erhalten.' : ' ACHTUNG: Ohne Google-Drive-Sync sind die Daten danach weg.'}`, { ok: 'Gerät leeren' }))) return;
      drive.disconnect();
      stopPersisting();
      await kvClear();
      Object.keys(localStorage).filter((k) => k.startsWith('fv.') && k !== 'fv.clientId' && k !== 'fv.theme').forEach((k) => ls.del(k));
      location.hash = '#/';
      location.reload();
    },
    addCat: () => openCategoryForm(),
    editCat: (el) => openCategoryForm(store.get('categories', el.dataset.id)),
    addRule: () => openRuleForm(),
    editRule: (el) => openRuleForm(store.get('rules', el.dataset.id)),
    applyAll: () => toast(`${applyRules({ onlyUncategorized: true })} Buchungen kategorisiert`, 'success'),
    export: () => download(`finanzen-backup-${todayISO()}.json`, JSON.stringify({ app: 'finanzverwaltung', exportedAt: new Date().toISOString(), data: store.state }, null, 1), 'application/json'),
    removeDemo: async () => { if (await confirmDialog('Alle Beispieldaten entfernen? Eigene Daten bleiben erhalten.', { ok: 'Entfernen' })) removeDemo(); },
    demo: () => loadDemo(),
  });
}

function clientIdForm() {
  return `<form data-cid class="inline-form">
    ${field('Google OAuth Client-ID', `<input name="cid" value="${esc(drive.clientId())}" placeholder="1234567890-abc….apps.googleusercontent.com" autocomplete="off">`)}
    <button class="btn" type="submit">Speichern</button></form>`;
}

function chooseRestore() {
  return new Promise((res) => {
    let done = false;
    const d = modal({
      title: 'Backup einspielen', submit: 'Einspielen',
      body: `<div class="radio-list">
        <label class="check"><input type="radio" name="mode" value="merge" checked> <span><b>Zusammenführen</b><br><span class="small muted">Fehlende Datensätze ergänzen, neuere Änderungen gewinnen</span></span></label>
        <label class="check"><input type="radio" name="mode" value="replace"> <span><b>Ersetzen</b><br><span class="small muted">Aktuellen Stand komplett durch das Backup ersetzen</span></span></label></div>`,
      onSubmit: (v) => { done = true; res(v.mode); },
    });
    d.addEventListener('close', () => { if (!done) res(null); });
  });
}

export function statusText(st) {
  return {
    unconfigured: 'nicht eingerichtet', disconnected: 'nicht verbunden', offline: 'offline',
    'needs-auth': 'Anmeldung nötig', 'needs-pass': 'Passwort nötig', syncing: 'synchronisiere …',
    synced: 'synchronisiert', pending: 'Änderungen ausstehend', error: 'Fehler', idle: '…',
  }[st.state] || st.state;
}

