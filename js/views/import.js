import { store } from '../store.js';
import { esc, fmtDate, money, ls, norm } from '../util.js';
import { icon } from '../icons.js';
import { bindActions, toast, confirmDialog, catChip, amountCell, rerender } from '../ui.js';
import {
  readFile, findHeaderRow, guessMapping, buildItems, markDuplicates, commitImport, undoImport,
  FIELDS, headerSignature, metaIban, guessCategory,
} from '../importer.js';
import { compileRules } from '../categorize.js';

export const title = 'Import';

// Zustand des laufenden Imports (bleibt bei Neuaufbau der Seite erhalten)
let job = null;

export function render(root, { params }) {
  const presetAccount = params?.get('account') || '';
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Import</h1><p class="sub">Kontoauszüge als CSV oder Excel – Duplikate werden automatisch erkannt</p></div>
    </div>
    ${job ? '' : `
    <section class="card">
      <label class="dropzone" id="drop">
        <input type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm,.ods" hidden>
        ${icon('upload')}
        <b>Datei hierher ziehen oder klicken</b>
        <span class="muted small">CSV-Export deiner Bank (Sparkasse, Volksbank, ING, DKB, comdirect, Postbank …) oder eine Excel-Liste</span>
      </label>
    </section>
    <section class="card">
      <details class="help-box"><summary>${icon('info')} So bekommst du die CSV-Datei aus deinem Online-Banking</summary>
        <ul>
          <li><b>Sparkasse:</b> Umsätze → Zeitraum wählen → Export → „CSV-CAMT“.</li>
          <li><b>Volksbank / Raiffeisen:</b> Umsätze → Exportieren → CSV.</li>
          <li><b>ING:</b> Umsätze → Zeitraum → „Exportieren“ (CSV).</li>
          <li><b>DKB:</b> Umsätze → Download-Symbol → CSV.</li>
          <li><b>comdirect:</b> Umsätze → „Umsätze exportieren“ → CSV.</li>
          <li><b>Eigene Excel-Liste:</b> Spalten wie Datum, Betrag, Beschreibung, Kategorie, Konto werden erkannt. Fehlende Kategorien und Konten werden angelegt.</li>
        </ul>
        <p class="small muted">Die Datei wird nur in deinem Browser gelesen und nirgendwohin hochgeladen. Mehrfach importierte Zeiträume sind kein Problem, bereits vorhandene Buchungen werden übersprungen.</p>
      </details>
    </section>`}
    <div id="job"></div>
    ${history()}`;

  if (!job) {
    const drop = root.querySelector('#drop');
    const input = drop.querySelector('input');
    input.addEventListener('change', () => input.files[0] && start(input.files[0], presetAccount));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) start(f, presetAccount); });
  } else {
    renderJob(root.querySelector('#job'));
  }

  bindActions(root, {
    undo: async (el) => {
      const imp = store.get('imports', el.dataset.id);
      if (!(await confirmDialog(`Import „${imp?.fileName}“ rückgängig machen? ${imp?.count} Buchungen werden gelöscht.`, { ok: 'Rückgängig machen' }))) return;
      toast(`${undoImport(el.dataset.id)} Buchungen entfernt`);
    },
    cancel: () => { job = null; rerender(); },
    commit: () => {
      const res = commitImport(job.items, {
        accountId: job.accountId === '_new' ? null : job.accountId,
        newAccount: job.accountId === '_new' ? { name: job.newName.trim() || job.fileName, iban: job.iban, bank: job.bank || '' } : null,
        fileName: job.fileName, autoCat: job.autoCat, rows: job.rows, headerIdx: job.headerIdx, map: job.map,
      });
      const presets = ls.json('fv.importPresets', {});
      const acc = store.all('accounts').find((a) => a.id === job.accountId) || store.all('accounts').find((a) => a.name === (job.newName.trim() || job.fileName));
      presets[job.sig] = { map: job.map, invert: job.invert, accountId: acc?.id || null };
      ls.setJSON('fv.importPresets', presets);
      job = null;
      toast(`${res.imported} Buchungen importiert${res.dup ? `, ${res.dup} Duplikate übersprungen` : ''}`, 'success', 5000);
      location.hash = res.imported ? `#/buchungen?batch=${res.batchId}&period=all` : '#/import';
    },
  });
}

async function start(file, presetAccount) {
  try {
    const data = await readFile(file);
    const sheet = data.sheets[0];
    if (!sheet || !sheet.rows.length) throw new Error('Die Datei enthält keine lesbaren Zeilen.');
    const headerIdx = findHeaderRow(sheet.rows);
    const header = sheet.rows[headerIdx] || [];
    const sig = headerSignature(header);
    const preset = ls.json('fv.importPresets', {})[sig];
    const iban = metaIban(sheet.rows, headerIdx);
    const byIban = iban && store.all('accounts').find((a) => a.iban === iban);
    const accountId = presetAccount || byIban?.id || (preset?.accountId && store.get('accounts', preset.accountId) ? preset.accountId : '') || store.all('accounts').find((a) => !a.archived)?.id || '_new';
    job = {
      fileName: file.name, data, sheet: 0, rows: sheet.rows, headerIdx, sig, iban,
      map: preset?.map || guessMapping(header), invert: !!preset?.invert, autoCat: true,
      accountId, newName: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40),
    };
    rerender();
  } catch (e) {
    console.error(e);
    toast(e.message || 'Datei konnte nicht gelesen werden', 'error', 6000);
  }
}

function computeItems() {
  job.items = buildItems(job.rows, job.headerIdx, job.map, { invert: job.invert });
  const accByName = new Map(store.all('accounts').map((a) => [norm(a.name), a.id]));
  const target = job.accountId === '_new' ? '_new' : job.accountId;
  markDuplicates(job.items, (it) => (it.account ? accByName.get(norm(it.account)) || '_new:' + it.account : target));
  const compiled = compileRules();
  const catByName = new Map(store.all('categories').map((c) => [norm(c.name), c]));
  for (const it of job.items) if (it.valid) it.guess = job.autoCat || it.category ? guessCategory(it, compiled, catByName) : null;
}

function renderJob(host) {
  computeItems();
  const header = job.rows[job.headerIdx] || [];
  const colOpts = (sel) => `<option value="">–</option>` + header.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(String(h || `Spalte ${i + 1}`))}</option>`).join('');
  const valid = job.items.filter((i) => i.valid);
  const fresh = valid.filter((i) => !i.dup);
  const dups = valid.length - fresh.length;
  const invalid = job.items.length - valid.length;
  const cm = store.byId('categories');
  const hasAmount = job.map.amount != null || job.map.debit != null || job.map.credit != null;
  const ready = job.map.date != null && hasAmount && fresh.length > 0 && (job.accountId !== '_new' || job.newName.trim() || job.map.account != null);
  const sumIn = fresh.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const sumOut = fresh.filter((i) => i.amount < 0).reduce((s, i) => s - i.amount, 0);

  host.innerHTML = `
    <section class="card">
      <div class="card-h"><h2>${icon('file')} ${esc(job.fileName)}</h2><button class="btn btn-ghost btn-sm" data-action="cancel">${icon('x')} Abbrechen</button></div>
      <div class="form-grid cols-3">
        ${job.data.sheets.length > 1 ? `<label class="field"><span class="field-label">Tabellenblatt</span><select data-j="sheet">${job.data.sheets.map((s, i) => `<option value="${i}" ${i === job.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span class="field-label">Zielkonto</span>
          <select data-j="accountId">${store.all('accounts').filter((a) => !a.archived).map((a) => `<option value="${a.id}" ${a.id === job.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="_new" ${job.accountId === '_new' ? 'selected' : ''}>+ Neues Konto anlegen …</option></select></label>
        ${job.accountId === '_new' ? `<label class="field"><span class="field-label">Name des neuen Kontos</span><input data-j="newName" value="${esc(job.newName)}"></label>` : ''}
        <label class="field"><span class="field-label">Kopfzeile ist Zeile</span><input type="number" min="1" max="${job.rows.length}" data-j="headerIdx" value="${job.headerIdx + 1}"></label>
      </div>
      <details class="mapping" ${job.map.date == null || !hasAmount ? 'open' : ''}>
        <summary>Spaltenzuordnung ${job.map.date != null && hasAmount ? `<span class="badge good">${icon('check')} erkannt</span>` : '<span class="badge bad">bitte prüfen</span>'}</summary>
        <div class="form-grid cols-4">${FIELDS.map((f) => `<label class="field"><span class="field-label">${esc(f.label)}${f.required ? ' *' : ''}</span><select data-map="${f.key}">${colOpts(job.map[f.key])}</select></label>`).join('')}</div>
        <p class="small muted">Betrag entweder als eine Spalte (mit Vorzeichen) oder als getrennte Soll/Haben-Spalten.</p>
      </details>
      <div class="check-row">
        <label class="check"><input type="checkbox" data-j="autoCat" ${job.autoCat ? 'checked' : ''}> Automatisch kategorisieren (Regeln)</label>
        <label class="check"><input type="checkbox" data-j="invert" ${job.invert ? 'checked' : ''}> Vorzeichen umkehren (z. B. bei Kreditkarten-Exporten)</label>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Vorschau</h2>
        <div class="import-stats">
          <span class="badge good">${fresh.length} neu</span>
          ${dups ? `<span class="badge">${dups} schon vorhanden</span>` : ''}
          ${invalid ? `<span class="badge bad" title="Ohne gültiges Datum/Betrag oder vorgemerkt">${invalid} übersprungen</span>` : ''}
        </div>
      </div>
      <div class="table-wrap preview"><table class="table compact">
        <thead><tr><th>Datum</th><th>Empfänger / Zweck</th><th class="hide-sm">Kategorie</th><th class="num">Betrag</th><th>Status</th></tr></thead>
        <tbody>${job.items.slice(0, 60).map((it) => `<tr class="${!it.valid ? 'row-invalid' : it.dup ? 'row-dup' : ''}">
          <td class="nowrap">${it.date ? fmtDate(it.date) : '<span class="muted">?</span>'}</td>
          <td class="grow"><div class="tx-main">${esc(it.payee || it.purpose || it.text || '–')}</div><div class="tx-sub">${esc(it.payee ? it.purpose : '')}</div></td>
          <td class="hide-sm">${it.guess?.categoryId ? catChip(cm.get(it.guess.categoryId)) : it.category ? `<span class="chip">${esc(it.category)} (neu)</span>` : '<span class="muted small">–</span>'}</td>
          <td class="num">${it.amount != null ? amountCell(it.amount) : '<span class="muted">?</span>'}</td>
          <td>${!it.valid ? `<span class="badge bad">${it.pending ? 'vorgemerkt' : 'ungültig'}</span>` : it.dup ? '<span class="badge">vorhanden</span>' : '<span class="badge good">neu</span>'}</td>
        </tr>`).join('')}</tbody></table>
        ${job.items.length > 60 ? `<p class="muted small center">… und ${job.items.length - 60} weitere Zeilen</p>` : ''}
      </div>
      <div class="row-between import-foot">
        <span class="small muted">Neu: Eingänge <b class="amt-in">${money(sumIn)}</b> · Ausgänge <b class="amt-out">${money(sumOut)}</b></span>
        <button class="btn btn-primary" data-action="commit" ${ready ? '' : 'disabled'}>${icon('check')} ${fresh.length} Buchungen importieren</button>
      </div>
    </section>`;

  host.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.map) {
      if (el.value === '') delete job.map[el.dataset.map]; else job.map[el.dataset.map] = +el.value;
    } else if (el.dataset.j) {
      const k = el.dataset.j;
      if (k === 'autoCat' || k === 'invert') job[k] = el.checked;
      else if (k === 'headerIdx') { job.headerIdx = Math.max(0, Math.min(job.rows.length - 1, (+el.value || 1) - 1)); job.map = guessMapping(job.rows[job.headerIdx] || []); }
      else if (k === 'sheet') { job.sheet = +el.value; job.rows = job.data.sheets[job.sheet].rows; job.headerIdx = findHeaderRow(job.rows); job.map = guessMapping(job.rows[job.headerIdx] || []); }
      else job[k] = el.value;
    } else return;
    rerender();
  });
}

function history() {
  const imps = store.all('imports').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 15);
  if (!imps.length) return '';
  const acc = store.byId('accounts');
  return `<section class="card">
    <div class="card-h"><h2>Letzte Importe</h2></div>
    <div class="table-wrap"><table class="table compact"><tbody>${imps.map((i) => `
      <tr><td class="nowrap muted">${fmtDate(i.date)}</td>
        <td class="grow">${esc(i.fileName)}<div class="tx-sub">${esc(acc.get(i.accountId)?.name || '')}</div></td>
        <td class="num">${i.count} neu${i.dup ? ` · ${i.dup} dopp.` : ''}</td>
        <td class="nowrap"><a class="btn btn-sm btn-ghost" href="#/buchungen?batch=${i.id}&period=all">Ansehen</a>
          <button class="btn btn-sm btn-ghost danger" data-action="undo" data-id="${i.id}">Rückgängig</button></td></tr>`).join('')}</tbody></table></div>
  </section>`;
}
