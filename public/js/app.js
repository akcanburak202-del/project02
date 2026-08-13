/**
 * Uygulama kabugu: giris, gezinme, ay secimi ve gorunum yonlendirme.
 */

import { api, clear, currentMonthId, h, mount, openModal, toast, trMonthLabel } from './core.js';
import { renderSchedule } from './views/schedule.js';
import { renderRoster } from './views/roster.js';
import { renderPreferencesAdmin } from './views/preferences.js';
import { renderBalance } from './views/balance.js';
import { renderDoctors } from './views/doctors.js';
import { renderSettings } from './views/settings.js';
import { renderDoctorHome } from './views/doctor-home.js';

export const state = {
  me: null,
  hospitalName: 'Acil Servis',
  months: [],
  monthId: null,
  ws: null,
  tab: 'schedule',
  loading: false,
  selection: null, // takas modu icin secili slot
};

const ADMIN_TABS = [
  { id: 'schedule', label: 'Çizelge' },
  { id: 'roster', label: 'Katılım' },
  { id: 'prefs', label: 'Tercihler' },
  { id: 'balance', label: 'Denge' },
  { id: 'doctors', label: 'Doktorlar' },
  { id: 'settings', label: 'Ayarlar' },
];

const DOCTOR_TABS = [{ id: 'mine', label: 'Nöbetlerim ve Tercihlerim' }];

const root = document.getElementById('app');

export function isAdmin() {
  return state.me?.role === 'admin';
}

/* ------------------------------ Veri ------------------------------ */

export async function reloadWorkspace() {
  if (!state.monthId) {
    state.ws = null;
    return;
  }
  try {
    state.ws = await api.get(`/api/months/${state.monthId}`);
  } catch (err) {
    state.ws = null;
    toast(err.message, 'error');
  }
}

/** Sunucudan donen ay verisini dogrudan uygular (ekstra istek olmadan). */
export function applyWorkspace(ws) {
  if (ws && ws.month) {
    state.ws = { ...state.ws, ...ws };
    const entry = state.months.find((m) => m.id === ws.month.id);
    if (entry) entry.status = ws.month.status;
  }
  render();
}

export async function refreshMonths() {
  const data = await api.get('/api/months');
  state.months = data.months;
}

export async function selectMonth(id) {
  state.monthId = id;
  state.selection = null;
  location.hash = `#/${state.tab}/${id}`;
  setLoading(true);
  await reloadWorkspace();
  setLoading(false);
  render();
}

export function setTab(tab) {
  state.tab = tab;
  location.hash = `#/${tab}/${state.monthId || ''}`;
  render();
}

export function setLoading(value) {
  state.loading = value;
  const el = document.getElementById('busy');
  if (el) el.classList.toggle('hidden', !value);
}

/** Uzun surebilecek islemler icin: butonlari kilitle, hatayi bildir. */
export async function withBusy(fn, { success } = {}) {
  setLoading(true);
  try {
    const out = await fn();
    if (success) toast(success, 'ok');
    return out;
  } catch (err) {
    toast(err.message, 'error', 6000);
    return null;
  } finally {
    setLoading(false);
  }
}

/* ---------------------------- Gorunum ----------------------------- */

function monthSelector() {
  const options = state.months.map((m) =>
    h('option', { value: m.id, selected: m.id === state.monthId }, `${trMonthLabel(m.id)}${statusSuffix(m.status)}`),
  );
  return h(
    'div',
    { class: 'row' },
    h(
      'select',
      {
        style: { width: 'auto', minWidth: '190px' },
        onChange: (e) => selectMonth(e.target.value),
      },
      state.months.length ? options : h('option', null, 'Ay yok'),
    ),
    isAdmin() && h('button', { class: 'btn btn-sm', onClick: newMonthDialog, title: 'Yeni ay olustur' }, '+ Ay'),
  );
}

function statusSuffix(status) {
  if (status === 'published') return ' · yayında';
  if (status === 'final') return ' · kesinleşti';
  return ' · taslak';
}

function newMonthDialog() {
  const now = new Date();
  let value = `${now.getFullYear()}-${String(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2).padStart(2, '0')}`;
  if (now.getMonth() + 2 > 12) value = `${now.getFullYear() + 1}-01`;

  openModal((close) => {
    const input = h('input', { type: 'month', value });
    const copySelect = h(
      'select',
      null,
      h('option', { value: '' }, 'Kopyalama'),
      state.months.map((m) => h('option', { value: m.id }, trMonthLabel(m.id))),
    );
    return h(
      'div',
      null,
      h('h3', null, 'Yeni ay oluştur'),
      h('p', { class: 'modal-text' }, 'Kadro listesi mevcut aktif doktorlardan hazırlanır. İstersen önceki bir ayın katılım ayarlarını kopyalayabilirsin.'),
      h('div', { class: 'col mt-16' },
        h('label', { class: 'field' }, 'Ay', input),
        h('label', { class: 'field' }, 'Katılım ayarlarını kopyala', copySelect)),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            const id = input.value;
            if (!id) return toast('Ay seçin', 'error');
            const ok = await withBusy(() => api.post('/api/months', { id, copyFrom: copySelect.value || null }));
            if (!ok) return;
            close();
            await refreshMonths();
            await selectMonth(id);
            toast(`${trMonthLabel(id)} oluşturuldu`, 'ok');
          },
        }, 'Oluştur')),
    );
  });
}

function passwordDialog(force = false) {
  openModal((close) => {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const next = h('input', { type: 'password', autocomplete: 'new-password' });
    const again = h('input', { type: 'password', autocomplete: 'new-password' });
    return h(
      'div',
      null,
      h('h3', null, 'Parola değiştir'),
      force && h('p', { class: 'modal-text' }, 'Güvenlik için ilk girişte parolanızı değiştirin.'),
      h('div', { class: 'col mt-16' },
        h('label', { class: 'field' }, 'Mevcut parola', cur),
        h('label', { class: 'field' }, 'Yeni parola (en az 6 karakter)', next),
        h('label', { class: 'field' }, 'Yeni parola (tekrar)', again)),
      h('div', { class: 'modal-actions' },
        !force && h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            if (next.value !== again.value) return toast('Yeni parolalar eşleşmiyor', 'error');
            const ok = await withBusy(() => api.post('/api/password', { current: cur.value, next: next.value }));
            if (!ok) return;
            state.me.mustChangePassword = false;
            close();
            toast('Parola güncellendi', 'ok');
          },
        }, 'Kaydet')),
    );
  });
}

function topbar() {
  const tabs = isAdmin() ? ADMIN_TABS : DOCTOR_TABS;
  const initials = (state.me.name || '?')
    .split(' ')
    .filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(w[0] || ''))
    .slice(-2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, 'Nöbet Çizelgesi', h('small', null, state.hospitalName)),
    h('div', { class: 'nav' },
      tabs.map((t) =>
        h('button', { class: t.id === state.tab ? 'active' : '', onClick: () => setTab(t.id) }, t.label))),
    monthSelector(),
    h('div', { id: 'busy', class: 'spinner hidden' }),
    h('div', { class: 'userbox' },
      h('div', { class: 'avatar', title: state.me.name }, initials || 'K'),
      h('div', { class: 'col', style: { gap: '0' } },
        h('div', { style: { fontWeight: 600, fontSize: '13px' } }, state.me.name),
        h('div', { class: 'small muted' }, isAdmin() ? 'Yönetici' : 'Doktor')),
      h('button', { class: 'btn btn-sm btn-ghost', onClick: () => passwordDialog(false) }, 'Parola'),
      h('button', {
        class: 'btn btn-sm',
        onClick: async () => {
          await api.post('/api/logout');
          location.reload();
        },
      }, 'Çıkış')),
  );
}

function currentView() {
  if (!isAdmin()) return renderDoctorHome();
  if (!state.monthId) {
    return h('div', { class: 'empty' },
      h('h3', null, 'Henüz ay oluşturulmamış'),
      h('p', null, 'Başlamak için üstteki "+ Ay" düğmesiyle bir çizelge ayı oluşturun.'),
      h('button', { class: 'btn btn-primary', onClick: newMonthDialog }, 'Yeni ay oluştur'));
  }
  switch (state.tab) {
    case 'roster': return renderRoster();
    case 'prefs': return renderPreferencesAdmin();
    case 'balance': return renderBalance();
    case 'doctors': return renderDoctors();
    case 'settings': return renderSettings();
    default: return renderSchedule();
  }
}

export function render() {
  if (!state.me) return;
  const needsMonth = ['schedule', 'roster', 'prefs', 'balance'].includes(state.tab);
  const view = state.loading && needsMonth && !state.ws
    ? h('div', { class: 'empty' }, 'Yükleniyor…')
    : currentView();
  mount(root, topbar(), h('main', { class: 'content' }, view));
}

/* ------------------------------ Giris ----------------------------- */

function renderLogin(message) {
  const user = h('input', { type: 'text', autocomplete: 'username', autofocus: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'banner banner-danger', style: { display: message ? 'flex' : 'none' } }, message || '');

  const submit = async (e) => {
    e?.preventDefault();
    try {
      const out = await api.post('/api/login', { username: user.value, password: pass.value });
      state.me = out.user;
      await boot();
    } catch (error) {
      err.textContent = error.message;
      err.style.display = 'flex';
      pass.value = '';
      pass.focus();
    }
  };

  mount(root, h('div', { class: 'login-wrap' },
    h('form', { class: 'login', onSubmit: submit },
      h('h1', null, 'Nöbet Çizelgesi'),
      h('div', { class: 'sub' }, 'Acil servis nöbet planlama sistemi'),
      err,
      h('div', { class: 'col' },
        h('label', { class: 'field' }, 'Kullanıcı adı', user),
        h('label', { class: 'field' }, 'Parola', pass),
        h('button', { class: 'btn btn-primary', type: 'submit', style: { justifyContent: 'center' } }, 'Giriş yap')))));
}

async function boot() {
  const me = await api.get('/api/me');
  if (!me.user) {
    renderLogin('');
    return;
  }
  state.me = me.user;
  state.hospitalName = me.hospitalName || 'Acil Servis';
  state.months = me.months || [];

  const hash = /^#\/([a-z-]+)\/?(\d{4}-\d{2})?/.exec(location.hash || '');
  const tabs = isAdmin() ? ADMIN_TABS : DOCTOR_TABS;
  state.tab = hash && tabs.some((t) => t.id === hash[1]) ? hash[1] : tabs[0].id;

  const preferred = hash?.[2] && state.months.some((m) => m.id === hash[2]) ? hash[2] : null;
  const current = state.months.find((m) => m.id === currentMonthId())?.id;
  const visible = isAdmin() ? state.months : state.months.filter((m) => m.status !== 'draft' || m.prefWindowOpen);
  state.monthId = preferred || current || visible[0]?.id || state.months[0]?.id || null;

  if (state.monthId) {
    setLoading(true);
    await reloadWorkspace();
    setLoading(false);
  }
  render();
  if (state.me.mustChangePassword) passwordDialog(true);
}

async function start() {
  try {
    await boot();
  } catch (err) {
    if (String(err.message).includes('Giris') || String(err.message).includes('401')) renderLogin('');
    else renderLogin(err.message);
  }
}

window.addEventListener('hashchange', () => {
  const hash = /^#\/([a-z-]+)\/?(\d{4}-\d{2})?/.exec(location.hash || '');
  if (!hash) return;
  const tabs = isAdmin() ? ADMIN_TABS : DOCTOR_TABS;
  if (tabs.some((t) => t.id === hash[1]) && hash[1] !== state.tab) {
    state.tab = hash[1];
    render();
  }
});

clear(root);
start();
