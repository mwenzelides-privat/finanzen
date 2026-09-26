// Chart.js-Wrapper mit einheitlichem, ruhigem Stil (Farben kommen aus den CSS-Tokens)
import { money } from './util.js';

let live = [];
export function destroyCharts() { live.forEach((c) => c.destroy()); live = []; }
export function resizeCharts() { live.forEach((c) => { c.resize(); }); }

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const series = (i) => css(`--s${i}`);
export const token = css;

export function alpha(color, a) {
  const c = color.trim();
  if (c.startsWith('#') && c.length === 7) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return c;
}

const eurTick = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio. €';
  if (a >= 1000) return (v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Tsd. €';
  return v.toLocaleString('de-DE') + ' €';
};

function base() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4, right: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'),
        titleColor: css('--text'),
        bodyColor: css('--text-2'),
        borderColor: css('--border-strong'),
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { weight: '600' },
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(Math.round(ctx.raw * 100))}` },
      },
    },
  };
}

function valueAxis(extra = {}) {
  return {
    grid: { color: css('--grid'), drawTicks: false },
    border: { display: false },
    ticks: { color: css('--muted'), font: { size: 11 }, padding: 8, maxTicksLimit: 6, callback: eurTick },
    ...extra,
  };
}
function categoryAxis(extra = {}) {
  return {
    grid: { display: false },
    border: { color: css('--axis') },
    ticks: { color: css('--text-2'), font: { size: 11 } },
    ...extra,
  };
}

function guard(canvas) {
  if (window.Chart) return true;
  canvas.parentElement.innerHTML = '<p class="muted small">Diagramm-Bibliothek nicht geladen – einmal online öffnen, danach funktioniert es auch offline.</p>';
  return false;
}

export function bar(canvas, { labels, datasets, horizontal = false, stacked = false, onClick }) {
  if (!guard(canvas)) return null;
  const opts = base();
  opts.indexAxis = horizontal ? 'y' : 'x';
  const v = valueAxis({ beginAtZero: true, stacked });
  const c = categoryAxis({ stacked, ticks: { color: css('--text-2'), font: { size: 11 }, autoSkip: !horizontal } });
  opts.scales = horizontal ? { x: v, y: c } : { x: c, y: v };
  if (horizontal) opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
  if (onClick) {
    opts.onClick = (e, els) => { if (els[0]) onClick(els[0].index, els[0].datasetIndex); };
    opts.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  }
  const ds = datasets.map((d) => ({
    borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24,
    categoryPercentage: horizontal ? 0.8 : 0.72, barPercentage: 0.92,
    hoverBackgroundColor: d.backgroundColor, ...d,
  }));
  const chart = new Chart(canvas, { type: 'bar', data: { labels, datasets: ds }, options: opts });
  live.push(chart);
  return chart;
}

export function line(canvas, { labels, datasets, fill = true, zero = false }) {
  if (!guard(canvas)) return null;
  const opts = base();
  opts.scales = { x: categoryAxis({ ticks: { color: css('--text-2'), font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 } }), y: valueAxis({ beginAtZero: zero }) };
  const ds = datasets.map((d) => ({
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
    pointHoverBorderColor: css('--surface'), pointBackgroundColor: d.borderColor,
    tension: 0.3, fill: fill ? 'origin' : false, backgroundColor: alpha(d.borderColor, 0.1),
    borderCapStyle: 'round', borderJoinStyle: 'round', ...d,
  }));
  const chart = new Chart(canvas, { type: 'line', data: { labels, datasets: ds }, options: opts });
  live.push(chart);
  return chart;
}

// Mini-Sparkline ohne Achsen
export function spark(canvas, values, color) {
  if (!window.Chart) return null;
  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels: values.map((_, i) => i), datasets: [{ data: values, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.35, fill: 'origin', backgroundColor: alpha(color, 0.1) }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, events: [] },
  });
  live.push(chart);
  return chart;
}
