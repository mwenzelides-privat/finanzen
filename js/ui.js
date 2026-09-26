// UI-Bausteine: Toasts, Dialoge, Auswahllisten
import { icon } from './icons.js';
import { esc } from './util.js';
import { store } from './store.js';
import { TAX_CATEGORIES, ACCOUNT_TYPES } from './defaults.js';
import { catSlot } from './calc.js';

export function toast(msg, type = 'info', ms = 3800) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = { error: 'alert', warn: 'alert', success: 'check', info: 'info' }[type] || 'info';
  el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

export function formValues(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

export function modal({ title, body, submit = 'Speichern', cancel = 'Abbrechen', danger = false, wide = false, onSubmit, onOpen, extraFooter = '' }) {
  const d = document.createElement('dialog');
  d.className = 'modal' + (wide ? ' wide' : '');
  d.innerHTML = `<form novalidate>
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">${icon('x')}</button></header>
    <div class="modal-body">${body}</div>
    <footer>${extraFooter}<span class="spacer"></span>
      ${cancel ? `<button type="button" class="btn" data-close>${esc(cancel)}</button>` : ''}
      ${submit ? `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submit)}</button>` : ''}
    </footer></form>`;
  document.body.appendChild(d);
  const form = d.querySelector('form');
  d.addEventListener('close', () => d.remove());
  d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => d.close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return d.close();
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      const r = await onSubmit(formValues(form), form, d);
      if (r !== false) d.close();
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  d.showModal();
  const first = form.querySelector('[autofocus]') || form.querySelector('.modal-body input:not([type=hidden]):not([type=radio]):not([type=checkbox]), .modal-body select, .modal-body textarea');
  first?.focus();
  onOpen?.(d, form);
  return d;
}

export function confirmDialog(message, { title = 'Bitte bestätigen', ok = 'OK', danger = true } = {}) {
  return new Promise((res) => {
    let done = false;
    const d = modal({ title, body: `<p>${esc(message)}</p>`, submit: ok, danger, onSubmit: () => { done = true; res(true); } });
    d.addEventListener('close', () => { if (!done) res(false); });
  });
}

export function promptDialog({ title, label, type = 'text', value = '', ok = 'OK', hint = '', cancel = 'Abbrechen' }) {
  return new Promise((res) => {
    let done = false;
    const d = modal({
      title, submit: ok, cancel,
      body: field(label, `<input name="v" type="${type}" value="${esc(value)}" autocomplete="${type === 'password' ? 'current-password' : 'off'}" autofocus>`, hint),
      onSubmit: (v) => { done = true; res(v.v); },
    });
    d.addEventListener('close', () => { if (!done) res(null); });
  });
}

export const field = (label, input, hint = '', cls = '') =>
  `<label class="field ${cls}"><span class="field-label">${esc(label)}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;

export function emptyState(ic, title, text, actions = '') {
  return `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${text}</p>${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
}

// Aktuelle Seite komplett neu aufbauen (App hört auf dieses Ereignis)
export const rerender = () => window.dispatchEvent(new CustomEvent('fv:rerender'));

// Delegierte Klick-Handler: <button data-action="foo">
export function bindActions(root, handlers) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
}

// ---------- Auswahllisten ----------
export function catOptions(selected, { none = '– ohne Kategorie –', types = null, withNone = true } = {}) {
  const groups = new Map();
  for (const c of store.all('categories').sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name))) {
    if (types && !types.includes(c.type)) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  let html = withNone ? `<option value="">${esc(none)}</option>` : '';
  for (const [g, list] of groups) {
    html += `<optgroup label="${esc(g)}">${list.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
  }
  return html;
}

export function accountOptions(selected, { all = null, includeArchived = false } = {}) {
  const list = store.all('accounts').filter((a) => includeArchived || !a.archived || a.id === selected);
  return (all ? `<option value="">${esc(all)}</option>` : '') +
    list.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

export function taxOptions(selected, { none = '– nicht steuerrelevant –' } = {}) {
  const groups = new Map();
  for (const t of TAX_CATEGORIES) { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); }
  let html = `<option value="">${esc(none)}</option>`;
  for (const [g, list] of groups) html += `<optgroup label="${esc(g)}">${list.map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`;
  return html;
}

export function vacationOptions(selected, { none = '– keine –' } = {}) {
  return `<option value="">${esc(none)}</option>` +
    store.all('vacations').filter((v) => !v.archived || v.id === selected)
      .map((v) => `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
}

export const accountTypeOptions = (selected) =>
  Object.entries(ACCOUNT_TYPES).map(([k, l]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${l}</option>`).join('');

export function catChip(cat) {
  if (!cat) return '<span class="chip chip-none">Unkategorisiert</span>';
  return `<span class="chip"><i class="dot s${catSlot(cat)}"></i>${esc(cat.name)}</span>`;
}

export function amountCell(cents, kindName) {
  const cls = kindName === 'transfer' ? 'amt-transfer' : cents >= 0 ? 'amt-in' : 'amt-out';
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  const abs = Math.abs(cents) / 100;
  return `<span class="amt ${cls}">${sign}${abs.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>`;
}

export function progress(ratio, level = 'accent', label = '') {
  const w = Math.max(0, Math.min(1, ratio)) * 100;
  return `<div class="progress ${level}" role="progressbar" aria-valuenow="${Math.round(ratio * 100)}" aria-valuemin="0" aria-valuemax="100" ${label ? `aria-label="${esc(label)}"` : ''}><span style="width:${w}%"></span></div>`;
}

export function deltaBadge(cur, prev, upIsGood = true, suffix = 'vs. Vormonat') {
  if (!prev) return `<span class="delta muted">${esc(suffix === 'vs. Vormonat' ? 'kein Vormonat' : '')}</span>`;
  const d = (cur - prev) / Math.abs(prev);
  if (!Number.isFinite(d)) return '';
  const up = d > 0.0005, down = d < -0.0005;
  const good = (up && upIsGood) || (down && !upIsGood);
  const cls = !up && !down ? 'flat' : good ? 'good' : 'bad';
  const arrow = up ? icon('arrowUp') : down ? icon('arrowDown') : '';
  return `<span class="delta ${cls}">${arrow}${Math.abs(d * 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %</span> <span class="muted small">${esc(suffix)}</span>`;
}

// Sparquote lesbar: bei kaum Einnahmen keine absurden Prozentwerte
export const rateText = (r) => (r == null ? '–' : r < -1 ? '< −100 %' : r.toLocaleString('de-DE', { style: 'percent', maximumFractionDigits: 0 }));
