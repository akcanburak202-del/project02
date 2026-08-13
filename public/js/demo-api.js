/**
 * Tarayici ici demo arka ucu.
 *
 * Sunucu kurmadan denemek icin, REST API'nin aynisini tarayicida uygular.
 * Gercek hesaplamalarin tamami yine `engine/` altindaki asil motorla yapilir;
 * burada yalnizca depolama (localStorage) ve yetki katmani yer alir.
 *
 * DEMO SINIRLARI (bilerek):
 *   - Parolalar duz metin karsilastirilir, ozetleme yoktur.
 *   - Veri yalnizca bu tarayicida durur, kullanicilar arasi paylasilmaz.
 *   - CSV indirme kapalidir (onizleme ortami dosya indirmeye izin vermez).
 * Gercek kullanim icin `node server/index.js` ile calistirin.
 */

import {
  DEFAULT_OPTIMIZER, DEFAULT_RULES, DEFAULT_SHIFT_POLICY, DEFAULT_SHIFT_TEMPLATES, DEFAULT_WEIGHTS,
  analyzeAssignments, buildContext, extractCarryOver, generateSchedule,
  monthLabel, parseMonthId, prevMonthId, resolveSettings, validatePolicy, validateTemplates,
} from '../../engine/index.js';
import { CATEGORIES, CATEGORY_KEYS, emptyCategoryVector } from '../../engine/slots.js';
import { candidatesForSlot, checkSwap } from '../../engine/scheduler.js';
import { applyPreferenceUpdate } from '../../engine/policy.js';
import { monthId as makeMonthId } from '../../engine/calendar.js';

const STORAGE_KEY = 'nobet-demo-v1';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new ApiError(400, m);
const notFound = (m) => new ApiError(404, m);

/* ------------------------------ Veri ------------------------------ */

const DEMO_DOCTORS = [
  { code: 'D01', name: 'Dr. Elif Yılmaz', username: 'd01' },
  { code: 'D02', name: 'Dr. Mert Kaya', username: 'd02' },
  { code: 'D03', name: 'Dr. Zeynep Demir', username: 'd03' },
  { code: 'D04', name: 'Dr. Burak Şahin', username: 'd04' },
  { code: 'D05', name: 'Dr. Selin Öztürk', username: 'd05' },
  { code: 'D06', name: 'Dr. Can Aydın', username: 'd06' },
  { code: 'D07', name: 'Dr. Deniz Arslan', username: 'd07' },
  { code: 'D08', name: 'Dr. Ayşe Doğan', username: 'd08' },
];

function defaultSettings() {
  return {
    hospitalName: 'Acil Servis (demo)',
    weekendDays: [0, 6],
    holidays: [],
    shiftTemplates: structuredClone(DEFAULT_SHIFT_TEMPLATES),
    shiftPolicy: structuredClone(DEFAULT_SHIFT_POLICY),
    rules: { ...DEFAULT_RULES },
    weights: { ...DEFAULT_WEIGHTS, categoryWeights: { ...DEFAULT_WEIGHTS.categoryWeights } },
    optimizer: { ...DEFAULT_OPTIMIZER },
  };
}

function seedDb() {
  const users = {};
  users.admin = {
    id: 'admin', name: 'Sorumlu Hekim', code: null, title: 'Yönetici',
    username: 'admin', password: 'admin', role: 'admin', scheduled: false,
    shiftPreference: 'any', active: true, mustChangePassword: false,
    openingLedger: emptyCategoryVector(),
  };
  for (const d of DEMO_DOCTORS) {
    users[d.username] = {
      id: d.username, name: d.name, code: d.code, title: '',
      username: d.username, password: d.username, role: 'doctor', scheduled: true,
      shiftPreference: 'any', active: true, mustChangePassword: false,
      openingLedger: emptyCategoryVector(),
    };
  }
  const db = { users, settings: defaultSettings(), months: {}, auditLog: [] };
  const now = new Date();
  const id = makeMonthId(now.getUTCFullYear(), now.getUTCMonth() + 1);
  db.months[id] = createMonthRecord(db, id);
  return db;
}

let db = null;
let sessionUserId = null;

function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) db = JSON.parse(raw);
  } catch {
    db = null;
  }
  if (!db || !db.users) db = seedDb();
  return db;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* kota dolarsa demo yine calisir, sadece kalici olmaz */
  }
}

export function resetDemo() {
  db = seedDb();
  sessionUserId = null;
  save();
}

/* --------------------------- Yardimcilar -------------------------- */

function scheduledDoctors(d) {
  return Object.values(d.users)
    .filter((u) => u.active !== false && u.scheduled !== false)
    .sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.name.localeCompare(b.name, 'tr'));
}

function createMonthRecord(d, id) {
  parseMonthId(id);
  return {
    id,
    status: 'draft',
    participants: scheduledDoctors(d).map((doc) => ({
      doctorId: doc.id, active: true, from: null, to: null, offDates: [],
      loadFactor: 1, maxShifts: null, shiftPreference: 'any',
    })),
    preferences: {}, assignments: {}, pinned: [], lockedThrough: null,
    prefWindowOpen: true, prefDeadline: null, settings: {}, seed: null,
    generatedAt: null, warnings: [], notes: '', ledgerDelta: null, plan: null,
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, name: u.name, code: u.code, role: u.role,
    scheduled: u.scheduled !== false, active: u.active !== false, title: u.title || '',
    shiftPreference: u.shiftPreference || 'any', mustChangePassword: false,
    openingLedger: u.openingLedger || emptyCategoryVector(),
  };
}

function doctorsMap(d) {
  const out = {};
  for (const u of Object.values(d.users)) out[u.id] = publicUser(u);
  return out;
}

function getSettings(d) {
  const base = defaultSettings();
  const s = d.settings || {};
  return {
    ...base, ...s,
    shiftPolicy: { ...base.shiftPolicy, ...(s.shiftPolicy || {}) },
    rules: { ...base.rules, ...(s.rules || {}) },
    weights: {
      ...base.weights, ...(s.weights || {}),
      categoryWeights: { ...base.weights.categoryWeights, ...(s.weights?.categoryWeights || {}) },
    },
    optimizer: { ...base.optimizer, ...(s.optimizer || {}) },
  };
}

function getMonth(d, id) {
  if (!d.months[id]) throw notFound(`${id} ayı bulunamadı.`);
  return d.months[id];
}

function ledgerFor(d, monthIdValue) {
  const ledger = {};
  for (const u of Object.values(d.users)) {
    if (u.openingLedger) ledger[u.id] = { ...emptyCategoryVector(), ...u.openingLedger };
  }
  for (const id of Object.keys(d.months).filter((x) => x < monthIdValue).sort()) {
    const m = d.months[id];
    if (m.status !== 'final' || !m.ledgerDelta) continue;
    for (const [doctorId, vec] of Object.entries(m.ledgerDelta)) {
      const cur = ledger[doctorId] || emptyCategoryVector();
      const next = emptyCategoryVector();
      for (const key of CATEGORY_KEYS) next[key] = (cur[key] || 0) + (vec[key] || 0);
      ledger[doctorId] = next;
    }
  }
  return ledger;
}

function carryOverFor(d, id, settings) {
  const prev = d.months[prevMonthId(id)];
  if (!prev) return [];
  try {
    const built = buildContext({ month: prev, doctors: doctorsMap(d), settings, ledger: {}, carryOver: [] });
    return extractCarryOver(prev, built);
  } catch {
    return [];
  }
}

function buildMonthContext(d, id) {
  const month = getMonth(d, id);
  const settings = getSettings(d);
  const ledger = ledgerFor(d, id);
  const carryOver = carryOverFor(d, id, settings);
  return { month, settings, ledger, carryOver, built: buildContext({ month, doctors: doctorsMap(d), settings, ledger, carryOver }) };
}

function monthWorkspace(d, id) {
  const { month, ledger, built } = buildMonthContext(d, id);
  const report = analyzeAssignments(built, month.assignments || {}, ledger);
  const templateProblems = built.config.shiftPolicy.mode === 'flexible'
    ? validatePolicy(built.config.shiftPolicy)
    : [
      ...validateTemplates(built.config.shiftTemplates.weekday, 'Hafta içi', built.config.rules),
      ...validateTemplates(built.config.shiftTemplates.weekend, 'Hafta sonu', built.config.rules),
    ];
  return {
    month: {
      id: month.id, label: monthLabel(month.id), status: month.status,
      lockedThrough: month.lockedThrough, prefWindowOpen: month.prefWindowOpen !== false,
      prefDeadline: month.prefDeadline || null, pinned: month.pinned || [],
      seed: month.seed, generatedAt: month.generatedAt, notes: month.notes || '',
      settings: month.settings || {}, isFinal: month.status === 'final',
    },
    days: built.days,
    slots: built.slots.map((s) => ({
      id: s.id, date: s.date, day: s.day, label: s.label, templateId: s.templateId,
      timeLabel: s.timeLabel, hours: s.hours, effectiveHours: s.effectiveHours,
      isNight: s.isNight, dayType: s.dayType,
      color: s.color, cat: s.cat,
    })),
    totals: built.totals,
    assignments: month.assignments || {},
    participants: month.participants || [],
    preferences: month.preferences || {},
    doctors: doctorsMap(d),
    report, ledger,
    config: built.config,
    categories: CATEGORIES,
    warnings: [...built.warnings, ...(month.warnings || []), ...templateProblems],
  };
}

function me() {
  const d = load();
  return sessionUserId ? d.users[sessionUserId] : null;
}
function requireAuth() {
  const u = me();
  if (!u) throw new ApiError(401, 'Giriş yapmalısınız.');
  return u;
}
function requireAdmin() {
  const u = requireAuth();
  if (u.role !== 'admin') throw new ApiError(403, 'Bu işlem için yetkiniz yok.');
  return u;
}
function assertEditable(month) {
  if (month.status === 'final') throw bad('Bu ay kesinleştirilmiş. Önce "Kesinleştirmeyi geri al" demeniz gerekir.');
}
function assertNotLocked(month, date) {
  if (month.lockedThrough && date <= month.lockedThrough) {
    throw bad(`${date} tarihi ${month.lockedThrough} tarihine kadar dondurulmuş. Önce dondurmayı kaldırın.`);
  }
}

/* ----------------------------- Yollar ----------------------------- */

const ROUTES = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  ROUTES.push({ method, regex, keys, handler });
};

route('POST', '/api/login', ({ body }) => {
  const d = load();
  const user = Object.values(d.users).find(
    (u) => u.username.toLowerCase() === String(body?.username || '').trim().toLowerCase(),
  );
  if (!user || user.active === false || user.password !== body?.password) {
    throw new ApiError(401, 'Kullanıcı adı veya parola hatalı.');
  }
  sessionUserId = user.id;
  return { user: publicUser(user) };
});

route('POST', '/api/logout', () => {
  sessionUserId = null;
  return { ok: true };
});

route('GET', '/api/me', () => {
  const d = load();
  return {
    user: publicUser(me()),
    hospitalName: getSettings(d).hospitalName,
    months: Object.keys(d.months).sort().reverse().map((id) => ({
      id, label: monthLabel(id), status: d.months[id].status,
      prefWindowOpen: d.months[id].prefWindowOpen !== false,
    })),
  };
});

route('POST', '/api/password', ({ body }) => {
  const u = requireAuth();
  if (u.password !== body?.current) throw new ApiError(401, 'Mevcut parola hatalı.');
  if (!body?.next || String(body.next).length < 6) throw bad('Yeni parola en az 6 karakter olmalı.');
  u.password = body.next;
  save();
  return { ok: true };
});

route('GET', '/api/doctors', () => {
  const u = requireAuth();
  const d = load();
  const list = Object.values(d.users).map(publicUser)
    .sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.name.localeCompare(b.name, 'tr'));
  if (u.role !== 'admin') {
    return { doctors: list.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, code: x.code })) };
  }
  return { doctors: list };
});

route('POST', '/api/doctors', ({ body }) => {
  requireAdmin();
  const d = load();
  if (!body?.name?.trim()) throw bad('Ad soyad zorunlu.');
  const uname = String(body.username || '').trim().toLowerCase();
  if (!uname) throw bad('Kullanıcı adı zorunlu.');
  if (Object.values(d.users).some((u) => u.username.toLowerCase() === uname)) {
    throw bad('Bu kullanıcı adı zaten kullanılıyor.');
  }
  if (!body.password || String(body.password).length < 6) throw bad('Parola en az 6 karakter olmalı.');
  const id = `doc_${uname}`;
  d.users[id] = {
    id, name: body.name.trim(), code: (body.code || '').trim() || null, title: (body.title || '').trim(),
    username: uname, password: body.password, role: body.role === 'admin' ? 'admin' : 'doctor',
    scheduled: body.scheduled !== false, shiftPreference: 'any', active: true,
    mustChangePassword: false, openingLedger: emptyCategoryVector(),
  };
  save();
  return { doctor: publicUser(d.users[id]) };
});

route('PATCH', '/api/doctors/:id', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const u = d.users[params.id];
  if (!u) throw notFound('Doktor bulunamadı.');
  if (body.name !== undefined) u.name = String(body.name).trim() || u.name;
  if (body.code !== undefined) u.code = String(body.code).trim() || null;
  if (body.title !== undefined) u.title = String(body.title).trim();
  if (body.scheduled !== undefined) u.scheduled = !!body.scheduled;
  if (body.role !== undefined) u.role = body.role === 'admin' ? 'admin' : 'doctor';
  if (body.active !== undefined) u.active = !!body.active;
  if (body.username !== undefined) u.username = String(body.username).trim().toLowerCase();
  if (body.openingLedger !== undefined) {
    const vec = emptyCategoryVector();
    for (const k of CATEGORY_KEYS) vec[k] = Number(body.openingLedger[k]) || 0;
    u.openingLedger = vec;
  }
  save();
  return { doctor: publicUser(u) };
});

route('POST', '/api/doctors/:id/password', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const u = d.users[params.id];
  if (!u) throw notFound('Doktor bulunamadı.');
  if (!body?.password || String(body.password).length < 6) throw bad('Parola en az 6 karakter olmalı.');
  u.password = body.password;
  save();
  return { ok: true };
});

route('GET', '/api/settings', () => {
  requireAdmin();
  return { settings: getSettings(load()), categories: CATEGORIES };
});

route('PUT', '/api/settings', ({ body }) => {
  requireAdmin();
  const d = load();
  if (body.shiftPolicy) {
    const errors = validatePolicy(body.shiftPolicy).filter((p) => p.level === 'error');
    if (errors.length) throw bad(errors.map((e) => e.message).join(' '));
  }
  if (body.shiftTemplates) {
    const rules = { ...DEFAULT_RULES, ...(body.rules || {}) };
    const errors = [
      ...validateTemplates(body.shiftTemplates.weekday, 'Hafta içi', rules),
      ...validateTemplates(body.shiftTemplates.weekend, 'Hafta sonu', rules),
    ].filter((p) => p.level === 'error');
    if (errors.length) throw bad(errors.map((e) => e.message).join(' '));
  }
  const cur = getSettings(d);
  d.settings = {
    ...cur, ...body,
    rules: { ...cur.rules, ...(body.rules || {}) },
    weights: {
      ...cur.weights, ...(body.weights || {}),
      categoryWeights: { ...cur.weights.categoryWeights, ...(body.weights?.categoryWeights || {}) },
    },
    optimizer: { ...cur.optimizer, ...(body.optimizer || {}) },
  };
  // Vardiya duzeni degistiyse kaydedilmis saat planlari gecersizlesir.
  if (body.shiftPolicy || body.shiftTemplates) {
    for (const m of Object.values(d.months)) if (m.status !== 'final') m.plan = null;
  }
  save();
  return { settings: getSettings(d) };
});

route('GET', '/api/months', () => {
  requireAuth();
  const d = load();
  return {
    months: Object.keys(d.months).sort().reverse().map((id) => ({
      id, label: monthLabel(id), status: d.months[id].status,
      lockedThrough: d.months[id].lockedThrough, generatedAt: d.months[id].generatedAt,
      prefWindowOpen: d.months[id].prefWindowOpen !== false,
      participantCount: (d.months[id].participants || []).filter((p) => p.active !== false).length,
    })),
  };
});

route('POST', '/api/months', ({ body }) => {
  requireAdmin();
  const d = load();
  const id = body?.id;
  parseMonthId(id);
  if (d.months[id]) throw bad(`${monthLabel(id)} zaten oluşturulmuş.`);
  const record = createMonthRecord(d, id);
  if (body.copyFrom && d.months[body.copyFrom]) {
    record.participants = structuredClone(d.months[body.copyFrom].participants)
      .map((p) => ({ ...p, from: null, to: null, offDates: [] }));
    record.settings = structuredClone(d.months[body.copyFrom].settings || {});
  }
  d.months[id] = record;
  save();
  return { month: { id, label: monthLabel(id), status: record.status } };
});

route('GET', '/api/months/:id', ({ params }) => {
  const u = requireAuth();
  const d = load();
  const ws = monthWorkspace(d, params.id);
  if (u.role === 'admin') return { ...ws, scheduleVisible: true, viewerId: u.id };
  const visible = ws.month.status !== 'draft';
  return {
    ...ws,
    assignments: visible ? ws.assignments : {},
    report: visible ? ws.report : { rows: [], issues: [], unassigned: [] },
    preferences: { [u.id]: ws.preferences[u.id] || {} },
    warnings: [],
    viewerId: u.id,
    scheduleVisible: visible,
  };
});

route('PUT', '/api/months/:id/participants', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  assertEditable(month);
  month.participants = (body?.participants || []).map((p) => ({
    doctorId: p.doctorId,
    active: p.active !== false,
    from: p.from || null,
    to: p.to || null,
    offDates: Array.isArray(p.offDates) ? [...new Set(p.offDates)].sort() : [],
    loadFactor: Number(p.loadFactor) > 0 ? Number(p.loadFactor) : 1,
    maxShifts: Number(p.maxShifts) > 0 ? Math.floor(Number(p.maxShifts)) : null,
    shiftPreference: ['any', 'day', 'night'].includes(p.shiftPreference) ? p.shiftPreference : 'any',
  }));
  save();
  return monthWorkspace(d, month.id);
});

route('PUT', '/api/months/:id/config', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  if (body.lockedThrough !== undefined) month.lockedThrough = body.lockedThrough || null;
  if (body.prefWindowOpen !== undefined) month.prefWindowOpen = !!body.prefWindowOpen;
  if (body.prefDeadline !== undefined) month.prefDeadline = body.prefDeadline || null;
  if (body.notes !== undefined) month.notes = String(body.notes).slice(0, 2000);
  if (body.settings !== undefined) {
    if (body.settings.shiftTemplates) {
      const merged = resolveSettings(getSettings(d), body.settings);
      const errors = [
        ...validateTemplates(merged.shiftTemplates.weekday, 'Hafta içi', merged.rules),
        ...validateTemplates(merged.shiftTemplates.weekend, 'Hafta sonu', merged.rules),
      ].filter((p) => p.level === 'error');
      if (errors.length) throw bad(errors.map((e) => e.message).join(' '));
    }
    month.settings = body.settings;
  }
  save();
  return monthWorkspace(d, month.id);
});

route('POST', '/api/months/:id/status', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  if (!['draft', 'published'].includes(body?.status)) throw bad('Geçersiz durum.');
  if (month.status === 'final') throw bad('Kesinleşmiş ayın durumu değiştirilemez.');
  month.status = body.status;
  save();
  return monthWorkspace(d, month.id);
});

route('POST', '/api/months/:id/generate', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  assertEditable(month);
  const settings = getSettings(d);
  const extraFixed = {};
  if (body?.fromDate) {
    for (const [slotId, doctorId] of Object.entries(month.assignments || {})) {
      if (doctorId && slotId.split('#')[0] < body.fromDate) extraFixed[slotId] = doctorId;
    }
  }
  const out = generateSchedule(
    {
      month,
      doctors: doctorsMap(d),
      settings,
      ledger: ledgerFor(d, month.id),
      carryOver: carryOverFor(d, month.id, settings),
    },
    {
      seed: Number.isFinite(Number(body?.seed)) && body?.seed !== '' && body?.seed !== null ? Number(body.seed) : undefined,
      extraFixed,
    },
  );
  month.assignments = out.assignments;
  month.warnings = out.warnings;
  month.seed = out.seed;
  month.plan = out.plan;
  month.generatedAt = new Date().toISOString();
  save();
  return monthWorkspace(d, month.id);
});

route('POST', '/api/months/:id/assign', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  assertEditable(month);
  assertNotLocked(month, String(body?.slotId || '').split('#')[0]);
  month.assignments = { ...month.assignments };
  if (body.doctorId) month.assignments[body.slotId] = body.doctorId;
  else delete month.assignments[body.slotId];
  save();
  return monthWorkspace(d, month.id);
});

route('POST', '/api/months/:id/swap', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  assertEditable(month);
  assertNotLocked(month, String(body?.slotA || '').split('#')[0]);
  assertNotLocked(month, String(body?.slotB || '').split('#')[0]);
  const a = month.assignments?.[body.slotA];
  const b = month.assignments?.[body.slotB];
  if (!a || !b) throw bad('Takas için iki slot da dolu olmalı.');
  month.assignments = { ...month.assignments, [body.slotA]: b, [body.slotB]: a };
  save();
  return monthWorkspace(d, month.id);
});

route('POST', '/api/months/:id/pin', ({ body, params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  assertEditable(month);
  const set = new Set(month.pinned || []);
  if (body.pinned) set.add(body.slotId);
  else set.delete(body.slotId);
  month.pinned = [...set].sort();
  save();
  return monthWorkspace(d, month.id);
});

route('GET', '/api/months/:id/candidates', ({ params, query }) => {
  requireAdmin();
  const d = load();
  const { month, built } = buildMonthContext(d, params.id);
  return { candidates: candidatesForSlot(built.ctx, month.assignments || {}, query.get('slot')) };
});

route('GET', '/api/months/:id/swap-check', ({ params, query }) => {
  requireAdmin();
  const d = load();
  const { month, built } = buildMonthContext(d, params.id);
  return { result: checkSwap(built.ctx, month.assignments || {}, query.get('a'), query.get('b')) };
});

route('POST', '/api/months/:id/finalize', ({ params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  if (month.status === 'final') throw bad('Bu ay zaten kesinleştirilmiş.');
  const ws = monthWorkspace(d, month.id);
  if (ws.report.unassigned.length) throw bad('Boş slot varken ay kesinleştirilemez.');
  const delta = {};
  for (const row of ws.report.rows) {
    const vec = emptyCategoryVector();
    for (const k of CATEGORY_KEYS) vec[k] = row.fairDeviation[k];
    delta[row.doctorId] = vec;
  }
  month.ledgerDelta = delta;
  month.status = 'final';
  save();
  return monthWorkspace(d, month.id);
});

route('POST', '/api/months/:id/unfinalize', ({ params }) => {
  requireAdmin();
  const d = load();
  const month = getMonth(d, params.id);
  if (month.status !== 'final') throw bad('Bu ay kesinleştirilmemiş.');
  month.ledgerDelta = null;
  month.status = 'published';
  save();
  return monthWorkspace(d, month.id);
});

route('PUT', '/api/months/:id/preferences', ({ body, params }) => {
  const u = requireAuth();
  const d = load();
  const month = getMonth(d, params.id);
  const isAdmin = u.role === 'admin';
  const targetId = body?.doctorId && isAdmin ? body.doctorId : u.id;
  if (!isAdmin) {
    if (month.prefWindowOpen === false) throw bad('Tercih girişi bu ay için kapatıldı.');
    if (month.status === 'final') throw bad('Bu ay kesinleştirildi, tercih değiştirilemez.');
  }
  month.preferences = { ...(month.preferences || {}) };
  month.preferences[targetId] = applyPreferenceUpdate(month.preferences[targetId], body?.preferences, { isAdmin });
  save();
  return {
    ok: true,
    preferences: month.preferences[targetId],
    warning: Object.keys(month.assignments || {}).length
      ? 'Çizelge zaten üretilmiş. Tercihin dikkate alınması için yöneticinin listeyi yeniden üretmesi gerekir.'
      : null,
  };
});

route('GET', '/api/ledger', ({ query }) => {
  requireAuth();
  const d = load();
  const now = new Date();
  const id = query.get('month') || makeMonthId(now.getUTCFullYear(), now.getUTCMonth() + 1);
  return { ledger: ledgerFor(d, id), doctors: doctorsMap(d), categories: CATEGORIES };
});

route('GET', '/api/audit', () => {
  requireAdmin();
  return { log: [] };
});

route('GET', '/api/months/:id/export', () => {
  throw bad('Demo sürümünde CSV indirme kapalıdır. Gerçek kurulumda (node server/index.js) çalışır.');
});

/* --------------------------- Giris noktasi ------------------------ */

/**
 * core.js buradan gecer. Ag istegi yerine yukaridaki yollar calisir.
 * Gercek sunucu gibi davranmasi icin hatalar ayni bicimde firlatilir.
 */
export function demoRequest(method, path, body) {
  const url = new URL(path, 'http://demo.local');
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.regex.exec(url.pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return r.handler({ body, params, query: url.searchParams });
  }
  throw notFound('Bilinmeyen istek.');
}
