/**
 * Paylasilan uygulama durumu ve gorunumlerin ihtiyac duydugu ortak islemler.
 *
 * Gorunumler (views/*.js) yalnizca bu modulu ve core.js'i kullanir; kabuk
 * (app.js) ise hem bunu hem gorunumleri kullanir. Boylece bagimlilik tek
 * yonlu kalir:  app.js -> views -> state.js -> core.js
 *
 * Cizim islemi app.js'te tanimlanip setRenderer ile buraya baglanir; bu
 * dolayli baglanti sayesinde state.js gorunumleri tanimak zorunda kalmaz.
 */

import { api, toast } from './core.js';

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

let renderer = () => {};

/** Kabuk, gercek cizim islevini buraya baglar. */
export function setRenderer(fn) {
  renderer = fn;
}

export function render() {
  renderer();
}

export function isAdmin() {
  return state.me?.role === 'admin';
}

export function setLoading(value) {
  state.loading = value;
  const el = document.getElementById('busy');
  if (el) el.classList.toggle('hidden', !value);
}

/** Uzun surebilecek islemler icin: mesgul isareti, hata bildirimi. */
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

/**
 * Sunucudan donen ay verisini dogrudan uygular (ekstra istek olmadan).
 * null gecilirse yalnizca yeniden cizer.
 */
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
