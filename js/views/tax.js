import { store } from '../store.js';
import { esc, money, fmtDate, todayISO, toCSV, download, debounce, norm } from '../util.js';
import { icon } from '../icons.js';
import { bindActions, rerender, toast, taxOptions } from '../ui.js';
import { openTaxItemForm, openTxForm } from '../forms.js';
import { TAX_CATEGORIES, taxRates, TAX_CHECKLIST, taxCat } from '../defaults.js';
import { resizeCharts } from '../charts.js';

export const title = 'Steuer';
let year = String(new Date().getFullYear() - 1);

// Kategorien, deren Buchungen oft steuerlich absetzbar sind
const HINT_CATS = { 'cat-versicherung': 'so_vorsorge', 'cat-gesundheit': 'ag_krank', 'cat-geschenke': 'so_spenden', 'cat-bildung': 'wk_fortbildung' };

// Vorschlag aus Kategorie-Namen (auch importierte, z. B. Finanzguru) oder Tag „Steuer“.
// null = kein Hinweis, '' = Tag „Steuer“ ohne erkennbare Art
function hintFor(t, cm) {
  if (HINT_CATS[t.categoryId]) return HINT_CATS[t.categoryId];
  const n = norm(cm.get(t.categoryId)?.name);
  if (/riester|rürup|ruerup|altersvorsorge|basisrente/.test(n)) return 'so_rente';
  if (/versicherung/.test(n) && !/hausrat|rechtsschutz|brillen/.test(n)) return 'so_vorsorge';
  if (/apotheke|ärzt|aerzt|arzt|zahn|krankheit/.test(n)) return 'ag_krank';
  if (/spende/.test(n)) return 'so_spenden';
  if (/fortbildung|weiterbildung/.test(n)) return 'wk_fortbildung';
  if (/kinderbetreuung|kita|kindergarten|hort/.test(n)) return 'so_kinder';
  if (/steuerberat/.test(n)) return 'wk_sonstige';
  if ((t.tags || []).some((g) => norm(g) === 'steuer')) return '';
  return null;
}

export function taxData(y) {
  const txs = store.all('transactions').filter((t) => t.taxCategory && t.date.startsWith(y));
  const items = store.all('taxItems').filter((i) => i.year === y);
  const cfg = store.all('taxYears').find((t) => t.id === 'tax-' + y) || { id: 'tax-' + y };
  const R = taxRates(y);
  const byCat = new Map(TAX_CATEGORIES.map((c) => [c.id, { cat: c, rows: [], sum: 0 }]));
  for (const t of txs) {
    const e = byCat.get(t.taxCategory); if (!e) continue;
    // Ausgaben zählen positiv; bei Kapitalerträgen die Einnahmen
    const amt = t.taxCategory === 'kap' ? t.amount : -t.amount;
    e.rows.push({ date: t.date, text: t.payee || t.purpose, sub: t.purpose && t.payee ? t.purpose : '', amount: amt, tx: t.id });
    e.sum += amt;
  }
  for (const i of items) {
    const e = byCat.get(i.taxCategory); if (!e) continue;
    e.rows.push({ date: i.date, text: i.description, sub: i.receipt ? `Beleg: ${i.receipt}` : 'manueller Posten', amount: i.amount, item: i.id });
    e.sum += i.amount;
  }
  for (const e of byCat.values()) e.rows.sort((a, b) => a.date.localeCompare(b.date));

  // Pauschalen
  const km = Number(cfg.commuteKm) || 0, days = Number(cfg.commuteDays) || 0, ho = Number(cfg.homeofficeDays) || 0;
  const pendler = Math.round(days * (Math.min(km, 20) * R.pendlerFirst20 + Math.max(0, km - 20) * R.pendlerAbove20));
  const homeoffice = Math.min(R.homeofficeMax, ho * R.homeofficeDay);
  const wkBookings = ['wk_fahrt', 'wk_arbeitsmittel', 'wk_fortbildung', 'wk_sonstige'].reduce((s, k) => s + byCat.get(k).sum, 0);
  const wkTotal = wkBookings + pendler + homeoffice;
  const hhDienst = Math.min(R.hhDienstMax, Math.round(byCat.get('hh_dienst').sum * R.hhDienstRate));
  const hhHandw = Math.min(R.hhHandwerkerMax, Math.round(byCat.get('hh_handwerker').sum * R.hhHandwerkerRate));
  return { y, txs, items, cfg, R, byCat, km, days, ho, pendler, homeoffice, wkBookings, wkTotal, hhDienst, hhHandw };
}

export function render(root) {
  const d = taxData(year);
  const years = [...new Set([String(new Date().getFullYear()), String(new Date().getFullYear() - 1), ...store.all('transactions').map((t) => t.date.slice(0, 4))])].sort().reverse();
  const groups = new Map();
  for (const e of d.byCat.values()) { if (!groups.has(e.cat.group)) groups.set(e.cat.group, []); groups.get(e.cat.group).push(e); }
  const checklist = d.cfg.checklist || {};
  const checked = TAX_CHECKLIST.filter(([k]) => checklist[k]).length;
  const cmap = store.byId('categories');
  const hints = new Map(); // Vorschläge nur hier merken, nicht an den gespeicherten Buchungen
  const suggestions = store.all('transactions')
    .filter((t) => {
      if (!t.date.startsWith(year) || t.taxCategory || t.amount >= 0 || t.transfer) return false;
      const h = hintFor(t, cmap);
      if (h === null) return false;
      hints.set(t.id, h);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  root.innerHTML = `
    <div class="page-head no-print">
      <div><h1>Steuererklärung ${year}</h1><p class="sub">Absetzbare Posten sammeln, Pauschalen berechnen, Belege abhaken</p></div>
      <div class="actions no-print">
        <select data-year aria-label="Steuerjahr">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <button class="btn" data-action="csv">${icon('download')}<span>CSV</span></button>
        <button class="btn" data-action="print">${icon('printer')}<span>PDF</span></button>
        <button class="btn btn-primary" data-action="addItem">${icon('plus')}<span>Posten</span></button>
      </div>
    </div>
    <div class="print-only print-head"><h1>Steuerunterlagen ${year}</h1><p>Erstellt am ${fmtDate(todayISO())}</p></div>

    <section class="stats">
      <div class="card stat"><div class="stat-label">Werbungskosten</div><div class="stat-value">${money(d.wkTotal)}</div>
        <div class="small ${d.wkTotal > d.R.anPausch ? 'text-good' : 'muted'}">${d.wkTotal > d.R.anPausch ? `${icon('check')} ${money(d.wkTotal - d.R.anPausch)} über Pauschbetrag` : `Pauschbetrag ${money(d.R.anPausch)} greift automatisch`}</div></div>
      <div class="card stat"><div class="stat-label">Vorsorge und Sonderausgaben</div><div class="stat-value">${money(['so_vorsorge', 'so_rente', 'so_kirche', 'so_spenden', 'so_kinder'].reduce((s, k) => s + d.byCat.get(k).sum, 0))}</div><div class="muted small">Versicherungen, Spenden, Kirchensteuer …</div></div>
      <div class="card stat"><div class="stat-label">Steuerermäßigung §35a</div><div class="stat-value">${money(d.hhDienst + d.hhHandw)}</div><div class="muted small">geschätzt, direkt von der Steuer</div></div>
      <div class="card stat"><div class="stat-label">Checkliste</div><div class="stat-value">${checked} / ${TAX_CHECKLIST.length}</div><div class="muted small">Unterlagen beisammen</div></div>
    </section>

    <div class="grid">
      <section class="card span-6">
        <div class="card-h"><h2>Pauschalen ${year}</h2></div>
        <div class="form-grid tax-inputs">
          <label class="field"><span class="field-label">Entfernung zur Arbeit (km, einfach)</span><input data-cfg="commuteKm" inputmode="decimal" value="${esc(d.cfg.commuteKm ?? '')}"></label>
          <label class="field"><span class="field-label">Arbeitstage vor Ort</span><input data-cfg="commuteDays" inputmode="numeric" value="${esc(d.cfg.commuteDays ?? '')}"></label>
          <label class="field"><span class="field-label">Homeoffice-Tage</span><input data-cfg="homeofficeDays" inputmode="numeric" value="${esc(d.cfg.homeofficeDays ?? '')}"></label>
        </div>
        <table class="table compact"><tbody>
          <tr><td>Entfernungspauschale <span class="muted small">(${d.R.pendlerFirst20} ct bis 20 km, ${d.R.pendlerAbove20} ct ab km 21)</span></td><td class="num">${money(d.pendler)}</td></tr>
          <tr><td>Homeoffice-Pauschale <span class="muted small">(${money(d.R.homeofficeDay)}/Tag, max. ${money(d.R.homeofficeMax)})</span></td><td class="num">${money(d.homeoffice)}</td></tr>
          <tr><td>Werbungskosten aus Buchungen und Posten</td><td class="num">${money(d.wkBookings)}</td></tr>
          <tr class="total"><td>Werbungskosten gesamt</td><td class="num">${money(d.wkTotal)}</td></tr>
          <tr><td class="muted">Arbeitnehmer-Pauschbetrag</td><td class="num muted">${money(d.R.anPausch)}</td></tr>
        </tbody></table>
      </section>

      <section class="card span-6">
        <div class="card-h"><h2>Checkliste Unterlagen</h2></div>
        <ul class="checklist">${TAX_CHECKLIST.map(([k, l]) => `<li><label class="check"><input type="checkbox" data-check="${k}" ${checklist[k] ? 'checked' : ''}> ${esc(l)}</label></li>`).join('')}</ul>
        <label class="field"><span class="field-label">Notizen</span><textarea data-cfg="notes" rows="3" placeholder="z. B. Termin Steuerberater, offene Fragen">${esc(d.cfg.notes || '')}</textarea></label>
      </section>

      ${[...groups.entries()].map(([g, list]) => {
        const sum = list.reduce((s, e) => s + e.sum, 0);
        return `<section class="card span-12 tax-group">
          <div class="card-h"><h2>${esc(g)}</h2><b>${money(sum)}</b></div>
          ${list.map((e) => `
            <div class="tax-cat">
              <div class="row-between"><h3>${esc(e.cat.label)}</h3><span>${money(e.sum)}</span></div>
              ${e.rows.length ? `<table class="table compact"><tbody>${e.rows.map((r) => `
                <tr class="clickable" data-action="${r.tx ? 'editTx' : 'editItem'}" data-id="${r.tx || r.item}">
                  <td class="nowrap muted">${fmtDate(r.date)}</td>
                  <td class="grow">${esc(r.text)}${r.sub ? `<div class="tx-sub">${esc(r.sub)}</div>` : ''}</td>
                  <td class="num">${money(r.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small no-print">Keine Einträge</p>'}
            </div>`).join('')}
          ${g.includes('35a') ? `<p class="small muted">Geschätzte Ermäßigung: Dienstleistungen ${money(d.hhDienst)} · Handwerker ${money(d.hhHandw)} (je 20 %, gedeckelt)</p>` : ''}
        </section>`;
      }).join('')}

      ${suggestions.length ? `<section class="card span-12 no-print">
        <div class="card-h"><h2>${icon('wand')} Vielleicht absetzbar</h2><span class="muted small">${suggestions.length} Buchungen aus ${year} ohne Steuer-Zuordnung</span></div>
        <div class="table-wrap"><table class="table compact"><tbody>${suggestions.slice(0, 40).map((t) => `
          <tr><td class="nowrap muted">${fmtDate(t.date)}</td>
            <td class="grow">${esc(t.payee || t.purpose)}<div class="tx-sub">${esc(t.purpose)}</div></td>
            <td class="num">${money(-t.amount)}</td>
            <td><select data-assign="${t.id}" class="inline-select">${taxOptions(null, { none: hints.get(t.id) ? `Zuordnen … (Vorschlag: ${taxCat(hints.get(t.id))?.short})` : 'Zuordnen … (Tag „Steuer“)' })}</select></td>
          </tr>`).join('')}</tbody></table></div>
        <p class="small muted">Auswählen ordnet die Buchung zu. Tipp: Regeln (Einstellungen) können das künftig automatisch erledigen.</p>
      </section>` : ''}
    </div>
    <p class="muted small help">Hinweis: Das ist eine Sammel- und Rechenhilfe, keine Steuerberatung. Pauschalen und Höchstbeträge sind hinterlegt, aber ohne Gewähr. Bitte in ELSTER bzw. beim Steuerberater prüfen.</p>`;

  let pending = {};
  const saveCfg = debounce(() => {
    const cur = store.all('taxYears').find((t) => t.id === 'tax-' + year) || { id: 'tax-' + year };
    const patch = pending;
    pending = {};
    store.put('taxYears', { ...cur, ...patch });
  }, 500);
  root.querySelectorAll('[data-cfg]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.cfg;
      pending[k] = k === 'notes' ? el.value : el.value.replace(',', '.');
      saveCfg();
    });
  });
  root.querySelectorAll('[data-check]').forEach((el) => el.addEventListener('change', () => {
    const cur = store.all('taxYears').find((t) => t.id === 'tax-' + year) || { id: 'tax-' + year };
    store.put('taxYears', { ...cur, checklist: { ...(cur.checklist || {}), [el.dataset.check]: el.checked } });
  }));
  root.querySelector('[data-year]').addEventListener('change', (e) => { year = e.target.value; rerender(); });
  root.addEventListener('change', (e) => {
    const id = e.target.dataset?.assign;
    if (!id || !e.target.value) return;
    const t = store.get('transactions', id);
    store.put('transactions', { ...t, taxCategory: e.target.value });
    toast(`Zugeordnet: ${taxCat(e.target.value)?.short}`, 'success');
  });

  bindActions(root, {
    addItem: () => openTaxItemForm(year),
    editItem: (el) => openTaxItemForm(year, store.get('taxItems', el.dataset.id)),
    editTx: (el) => openTxForm(store.get('transactions', el.dataset.id)),
    print: () => { resizeCharts(); window.print(); },
    csv: () => {
      const rows = [['Bereich', 'Art', 'Datum', 'Beschreibung', 'Betrag']];
      for (const e of d.byCat.values()) for (const r of e.rows) rows.push([e.cat.group, e.cat.label, fmtDate(r.date), r.text, (r.amount / 100).toFixed(2).replace('.', ',')]);
      rows.push([], ['Pauschalen', 'Entfernungspauschale', '', `${d.km} km × ${d.days} Tage`, (d.pendler / 100).toFixed(2).replace('.', ',')]);
      rows.push(['Pauschalen', 'Homeoffice-Pauschale', '', `${d.ho} Tage`, (d.homeoffice / 100).toFixed(2).replace('.', ',')]);
      download(`steuer-${year}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
    },
  });
}

