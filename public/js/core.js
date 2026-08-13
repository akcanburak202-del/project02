/**
 * Cekirdek arayuz yardimcilari: DOM olusturma, API istemcisi, bicimlendirme.
 * Derleme adimi yoktur; tarayici ES modullerini dogrudan yukler.
 */

/* ----------------------------- DOM -------------------------------- */

const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline']);

export function h(tag, props = null, ...children) {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'html') el.innerHTML = value;
      else if (key in el && !SVG_TAGS.has(tag) && typeof value !== 'object') {
        try {
          el[key] = value;
        } catch {
          el.setAttribute(key, value);
        }
      } else el.setAttribute(key, value === true ? '' : value);
    }
  }

  const add = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(add);
      return;
    }
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  };
  children.forEach(add);
  return el;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  children.forEach((c) => c && node.append(c));
  return node;
}

/* ----------------------------- API -------------------------------- */

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new Error(`Sunucu hatasi (${res.status})`);
    return res.text();
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Sunucu hatasi (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
};

/* -------------------------- Bicimlendirme ------------------------- */

export const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const DAY_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export function trMonthLabel(id) {
  const [y, m] = id.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function fmtHours(value, digits = 1) {
  if (!Number.isFinite(value)) return '–';
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return String(rounded).replace('.', ',');
}

export function fmtSigned(value, digits = 1) {
  const v = Math.round(value * 10 ** digits) / 10 ** digits;
  if (Math.abs(v) < 0.05) return '0';
  return `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}`;
}

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDateShort(iso) {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonthId() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function nextMonthId(id = currentMonthId()) {
  const [y, m] = id.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/* ------------------------- Geri bildirim -------------------------- */

let toastHost = null;

export function toast(message, kind = 'info', ms = 4000) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const node = h('div', { class: `toast toast-${kind}` }, message);
  toastHost.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 250);
  }, ms);
}

export function confirmDialog(message, { title = 'Onay', okLabel = 'Devam et', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    const overlay = h(
      'div',
      { class: 'modal-overlay', onClick: (e) => e.target === overlay && close(false) },
      h(
        'div',
        { class: 'modal modal-sm' },
        h('h3', null, title),
        h('p', { class: 'modal-text' }, message),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn', onClick: () => close(false) }, 'Vazgeç'),
          h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', onClick: () => close(true) }, okLabel),
        ),
      ),
    );
    document.body.append(overlay);
  });
}

export function openModal(render, { wide = false } = {}) {
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'modal-overlay', onClick: (e) => e.target === overlay && close() });
  const body = h('div', { class: `modal${wide ? ' modal-wide' : ''}` });
  overlay.append(body);
  document.body.append(overlay);
  mount(body, render(close));
  return { close, body, rerender: (r) => mount(body, r(close)) };
}

/** Anahtarli buton grubu (segment kontrol). */
export function segmented(options, value, onChange) {
  return h(
    'div',
    { class: 'segmented' },
    options.map((opt) =>
      h(
        'button',
        {
          class: `seg${opt.value === value ? ' active' : ''}`,
          type: 'button',
          onClick: () => onChange(opt.value),
          title: opt.title || '',
        },
        opt.label,
      ),
    ),
  );
}

/** Sapma cubugu: negatif sol, pozitif sag. */
export function deviationBar(value, scale = 12) {
  const pct = Math.max(-1, Math.min(1, value / scale)) * 50;
  const cls = Math.abs(value) < 0.05 ? 'ok' : value > 0 ? 'over' : 'under';
  return h(
    'div',
    { class: 'devbar', title: `${fmtSigned(value)} saat` },
    h('div', { class: 'devbar-axis' }),
    h('div', {
      class: `devbar-fill ${cls}`,
      style: pct >= 0 ? { left: '50%', width: `${pct}%` } : { left: `${50 + pct}%`, width: `${-pct}%` },
    }),
  );
}

export function icon(name) {
  const paths = {
    lock: 'M6 8V6a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h1Zm2 0h4V6a2 2 0 1 0-4 0v2Z',
    pin: 'M9 2h2v6l3 3v2h-4v5h-2v-5H4v-2l3-3V2h2Z',
    swap: 'M7 3 3 7h3v7h2V7h3L7 3Zm6 14 4-4h-3V6h-2v7H9l4 4Z',
    check: 'M8 13.2 4.8 10l-1.4 1.4L8 16 17 7l-1.4-1.4L8 13.2Z',
    warn: 'M10 2 1 18h18L10 2Zm1 12H9v2h2v-2Zm0-6H9v5h2V8Z',
  };
  return h('svg', { viewBox: '0 0 20 20', class: 'icon', width: 14, height: 14 }, h('path', { d: paths[name] || '' }));
}
