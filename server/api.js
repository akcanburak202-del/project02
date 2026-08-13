/**
 * REST API katmani.
 *
 * Yetki modeli:
 *   admin  -> her seyi gorur ve degistirir
 *   doktor -> yalnizca kendi tercihlerini duzenler, yayinlanmis cizelgeyi gorur
 */

import {
  DEFAULT_OPTIMIZER,
  DEFAULT_RULES,
  DEFAULT_SHIFT_TEMPLATES,
  DEFAULT_WEIGHTS,
  analyzeAssignments,
  buildContext,
  collectFixed,
  extractCarryOver,
  generateSchedule,
  monthLabel,
  parseMonthId,
  prevMonthId,
  resolveSettings,
  updateLedger,
  validateTemplates,
} from '../engine/index.js';
import { CATEGORIES, CATEGORY_KEYS, emptyCategoryVector } from '../engine/slots.js';
import { candidatesForSlot, checkSwap, stateFromAssignments } from '../engine/scheduler.js';
import { addDays, monthId as makeMonthId } from '../engine/calendar.js';
import { load, logAction, update } from './store.js';
import {
  COOKIE_NAME,
  clearCookie,
  createSession,
  destroySession,
  destroySessionsForUser,
  hashPassword,
  sessionCookie,
  verifyPassword,
} from './auth.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);
const forbidden = (msg = 'Bu işlem için yetkiniz yok.') => new HttpError(403, msg);

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function defaultSettings() {
  return {
    hospitalName: 'Acil Servis',
    weekendDays: [0, 6],
    holidays: [],
    shiftTemplates: structuredClone(DEFAULT_SHIFT_TEMPLATES),
    rules: { ...DEFAULT_RULES },
    weights: { ...DEFAULT_WEIGHTS, categoryWeights: { ...DEFAULT_WEIGHTS.categoryWeights } },
    optimizer: { ...DEFAULT_OPTIMIZER },
  };
}

export function getSettings(db) {
  if (!db.settings) db.settings = defaultSettings();
  const base = defaultSettings();
  return {
    ...base,
    ...db.settings,
    rules: { ...base.rules, ...(db.settings.rules || {}) },
    weights: {
      ...base.weights,
      ...(db.settings.weights || {}),
      categoryWeights: { ...base.weights.categoryWeights, ...(db.settings.weights?.categoryWeights || {}) },
    },
    optimizer: { ...base.optimizer, ...(db.settings.optimizer || {}) },
  };
}

/** Nobet listesine giren aktif kullanicilar. */
export function scheduledDoctors(db) {
  return Object.values(db.users)
    .filter((u) => u.active !== false && u.scheduled !== false)
    .sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.name.localeCompare(b.name, 'tr'));
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    code: u.code,
    role: u.role,
    scheduled: u.scheduled !== false,
    active: u.active !== false,
    title: u.title || '',
    shiftPreference: u.shiftPreference || 'any',
    mustChangePassword: !!u.mustChangePassword,
    openingLedger: u.openingLedger || emptyCategoryVector(),
  };
}

/* ------------------------------------------------------------------ */
/* Ay kayitlari                                                        */
/* ------------------------------------------------------------------ */

export function createMonthRecord(db, id) {
  parseMonthId(id);
  const doctors = scheduledDoctors(db);
  return {
    id,
    status: 'draft',
    participants: doctors.map((d) => ({
      doctorId: d.id,
      active: true,
      from: null,
      to: null,
      offDates: [],
      loadFactor: 1,
      maxShifts: null,
      shiftPreference: d.shiftPreference || 'any',
    })),
    preferences: {},
    assignments: {},
    pinned: [],
    lockedThrough: null,
    prefWindowOpen: true,
    prefDeadline: null,
    settings: {},
    seed: null,
    generatedAt: null,
    warnings: [],
    notes: '',
    ledgerDelta: null,
  };
}

export function getMonth(db, id, { create = false } = {}) {
  if (!db.months[id]) {
    if (!create) throw notFound(`${id} ayı bulunamadı.`);
    db.months[id] = createMonthRecord(db, id);
  }
  return db.months[id];
}

/**
 * Bir ay icin gecerli devir defteri:
 *   acilis bakiyesi + o aydan onceki KESINLESMIS aylarin farklari
 * Bu sekilde hesaplandigi icin gecmis bir ay yeniden acildiginda hedefler
 * kaymaz ve "kesinlestirmeyi geri al" islemi guvenle yapilabilir.
 */
export function ledgerFor(db, monthIdValue) {
  const ledger = {};
  for (const user of Object.values(db.users)) {
    const opening = user.openingLedger;
    if (opening) ledger[user.id] = { ...emptyCategoryVector(), ...opening };
  }
  const ids = Object.keys(db.months).filter((id) => id < monthIdValue).sort();
  for (const id of ids) {
    const m = db.months[id];
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

function doctorsMap(db) {
  const out = {};
  for (const u of Object.values(db.users)) out[u.id] = publicUser(u);
  return out;
}

/** Onceki aydan tasan nobetler (dinlenme kurali icin). */
function carryOverFor(db, id, settings) {
  const prevId = prevMonthId(id);
  const prev = db.months[prevId];
  if (!prev) return [];
  try {
    const prevBuilt = buildContext({
      month: prev,
      doctors: doctorsMap(db),
      settings,
      ledger: {},
      carryOver: [],
    });
    return extractCarryOver(prev, prevBuilt);
  } catch {
    return [];
  }
}

export function buildMonthContext(db, id) {
  const month = getMonth(db, id);
  const settings = getSettings(db);
  const ledger = ledgerFor(db, id);
  const carryOver = carryOverFor(db, id, settings);
  const built = buildContext({ month, doctors: doctorsMap(db), settings, ledger, carryOver });
  return { month, settings, ledger, carryOver, built };
}

/** Arayuzun ihtiyac duydugu tum ay verisi. */
export function monthWorkspace(db, id) {
  const { month, settings, ledger, built } = buildMonthContext(db, id);
  const report = analyzeAssignments(built, month.assignments || {}, ledger);
  const templateProblems = [
    ...validateTemplates(built.config.shiftTemplates.weekday, 'Hafta içi', built.config.rules),
    ...validateTemplates(built.config.shiftTemplates.weekend, 'Hafta sonu', built.config.rules),
  ];

  return {
    month: {
      id: month.id,
      label: monthLabel(month.id),
      status: month.status,
      lockedThrough: month.lockedThrough,
      prefWindowOpen: month.prefWindowOpen !== false,
      prefDeadline: month.prefDeadline || null,
      pinned: month.pinned || [],
      seed: month.seed,
      generatedAt: month.generatedAt,
      notes: month.notes || '',
      settings: month.settings || {},
      isFinal: month.status === 'final',
    },
    days: built.days,
    slots: built.slots.map((s) => ({
      id: s.id, date: s.date, day: s.day, label: s.label, templateId: s.templateId,
      timeLabel: s.timeLabel, hours: s.hours, isNight: s.isNight, dayType: s.dayType,
      color: s.color, cat: s.cat,
    })),
    totals: built.totals,
    assignments: month.assignments || {},
    participants: month.participants || [],
    preferences: month.preferences || {},
    doctors: doctorsMap(db),
    report,
    ledger,
    config: built.config,
    categories: CATEGORIES,
    warnings: [...built.warnings, ...(month.warnings || []), ...templateProblems],
  };
}

/* ------------------------------------------------------------------ */
/* Yardimcilar                                                         */
/* ------------------------------------------------------------------ */

function requireAdmin(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Giriş yapmalısınız.');
  if (ctx.user.role !== 'admin') throw forbidden();
}

function requireAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Giriş yapmalısınız.');
}

function assertEditable(month) {
  if (month.status === 'final') {
    throw bad('Bu ay kesinleştirilmiş. Önce "Kesinleştirmeyi geri al" demeniz gerekir.');
  }
}

function assertNotLocked(month, slotDate) {
  if (month.lockedThrough && slotDate <= month.lockedThrough) {
    throw bad(`${slotDate} tarihi ${month.lockedThrough} tarihine kadar dondurulmuş. Önce dondurmayı kaldırın.`);
  }
}

function sanitizeParticipants(list, db) {
  if (!Array.isArray(list)) throw bad('Katılımcı listesi dizi olmalı.');
  return list.map((p) => {
    if (!db.users[p.doctorId]) throw bad(`Bilinmeyen doktor: ${p.doctorId}`);
    return {
      doctorId: p.doctorId,
      active: p.active !== false,
      from: p.from || null,
      to: p.to || null,
      offDates: Array.isArray(p.offDates) ? [...new Set(p.offDates)].sort() : [],
      loadFactor: Number(p.loadFactor) > 0 ? Number(p.loadFactor) : 1,
      maxShifts: Number(p.maxShifts) > 0 ? Math.floor(Number(p.maxShifts)) : null,
      shiftPreference: ['any', 'day', 'night'].includes(p.shiftPreference) ? p.shiftPreference : 'any',
    };
  });
}

const PREF_VALUES = new Set(['want', 'avoid', 'off']);

function sanitizePreferences(prefs) {
  const out = {};
  for (const [iso, value] of Object.entries(prefs || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (!PREF_VALUES.has(value)) continue;
    out[iso] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Yonlendirme                                                         */
/* ------------------------------------------------------------------ */

export const routes = [];

function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/:([A-Za-z]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, regex, keys, handler, opts });
}

export function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1]);
    });
    return { ...r, params };
  }
  return null;
}

/* ---------------------------- Oturum ------------------------------ */

route('POST', '/api/login', (ctx) => {
  const { username, password } = ctx.body || {};
  const db = load();
  const user = Object.values(db.users).find(
    (u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase(),
  );
  if (!user || user.active === false || !verifyPassword(password || '', user.salt, user.passwordHash)) {
    throw new HttpError(401, 'Kullanıcı adı veya parola hatalı.');
  }
  const token = createSession(user.id);
  ctx.setCookie(sessionCookie(token, { secure: ctx.secure }));
  return { user: publicUser(user) };
});

route('POST', '/api/logout', (ctx) => {
  destroySession(ctx.cookies[COOKIE_NAME]);
  ctx.setCookie(clearCookie());
  return { ok: true };
});

route('GET', '/api/me', (ctx) => {
  const db = load();
  return {
    user: publicUser(ctx.user),
    hospitalName: getSettings(db).hospitalName,
    months: Object.keys(db.months).sort().reverse().map((id) => ({
      id,
      label: monthLabel(id),
      status: db.months[id].status,
      prefWindowOpen: db.months[id].prefWindowOpen !== false,
    })),
  };
});

route('POST', '/api/password', (ctx) => {
  requireAuth(ctx);
  const { current, next } = ctx.body || {};
  if (!next || String(next).length < 6) throw bad('Yeni parola en az 6 karakter olmalı.');
  return update((db) => {
    const user = db.users[ctx.user.id];
    if (!verifyPassword(current || '', user.salt, user.passwordHash)) {
      throw new HttpError(401, 'Mevcut parola hatalı.');
    }
    const { salt, hash } = hashPassword(next);
    user.salt = salt;
    user.passwordHash = hash;
    user.mustChangePassword = false;
    logAction(db, { userId: user.id, userName: user.name, action: 'parola-degistirildi' });
    return { ok: true };
  });
});

/* ---------------------------- Doktorlar --------------------------- */

route('GET', '/api/doctors', (ctx) => {
  requireAuth(ctx);
  const db = load();
  const list = Object.values(db.users)
    .map(publicUser)
    .sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.name.localeCompare(b.name, 'tr'));
  if (ctx.user.role !== 'admin') {
    return { doctors: list.filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, code: d.code })) };
  }
  return { doctors: list };
});

route('POST', '/api/doctors', (ctx) => {
  requireAdmin(ctx);
  const { name, code, username, password, role, scheduled, title, shiftPreference } = ctx.body || {};
  if (!name || !String(name).trim()) throw bad('Ad soyad zorunlu.');
  if (!username || !String(username).trim()) throw bad('Kullanıcı adı zorunlu.');
  if (!password || String(password).length < 6) throw bad('Parola en az 6 karakter olmalı.');
  return update((db) => {
    const uname = String(username).trim().toLowerCase();
    if (Object.values(db.users).some((u) => u.username.toLowerCase() === uname)) {
      throw bad('Bu kullanıcı adı zaten kullanılıyor.');
    }
    const id = newId('doc');
    const { salt, hash } = hashPassword(password);
    db.users[id] = {
      id,
      name: String(name).trim(),
      code: String(code || '').trim() || null,
      title: String(title || '').trim(),
      username: uname,
      salt,
      passwordHash: hash,
      role: role === 'admin' ? 'admin' : 'doctor',
      scheduled: scheduled !== false,
      shiftPreference: ['any', 'day', 'night'].includes(shiftPreference) ? shiftPreference : 'any',
      active: true,
      mustChangePassword: true,
      openingLedger: emptyCategoryVector(),
      createdAt: new Date().toISOString(),
    };
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'doktor-eklendi', detail: name });
    return { doctor: publicUser(db.users[id]) };
  });
});

route('PATCH', '/api/doctors/:id', (ctx) => {
  requireAdmin(ctx);
  const body = ctx.body || {};
  return update((db) => {
    const user = db.users[ctx.params.id];
    if (!user) throw notFound('Doktor bulunamadı.');
    if (body.name !== undefined) user.name = String(body.name).trim() || user.name;
    if (body.code !== undefined) user.code = String(body.code).trim() || null;
    if (body.title !== undefined) user.title = String(body.title).trim();
    if (body.scheduled !== undefined) user.scheduled = !!body.scheduled;
    if (body.shiftPreference !== undefined && ['any', 'day', 'night'].includes(body.shiftPreference)) {
      user.shiftPreference = body.shiftPreference;
    }
    if (body.role !== undefined) {
      if (user.role === 'admin' && body.role !== 'admin') {
        const admins = Object.values(db.users).filter((u) => u.role === 'admin' && u.active !== false);
        if (admins.length <= 1) throw bad('Sistemde en az bir yönetici kalmalı.');
      }
      user.role = body.role === 'admin' ? 'admin' : 'doctor';
    }
    if (body.active !== undefined) {
      if (!body.active && user.role === 'admin') {
        const admins = Object.values(db.users).filter((u) => u.role === 'admin' && u.active !== false);
        if (admins.length <= 1) throw bad('Sistemde en az bir aktif yönetici kalmalı.');
      }
      user.active = !!body.active;
      if (!body.active) destroySessionsForUser(user.id);
    }
    if (body.openingLedger !== undefined) {
      const vec = emptyCategoryVector();
      for (const key of CATEGORY_KEYS) vec[key] = Number(body.openingLedger[key]) || 0;
      user.openingLedger = vec;
    }
    if (body.username !== undefined) {
      const uname = String(body.username).trim().toLowerCase();
      if (!uname) throw bad('Kullanıcı adı boş olamaz.');
      if (Object.values(db.users).some((u) => u.id !== user.id && u.username.toLowerCase() === uname)) {
        throw bad('Bu kullanıcı adı zaten kullanılıyor.');
      }
      user.username = uname;
    }
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'doktor-guncellendi', detail: user.name });
    return { doctor: publicUser(user) };
  });
});

route('POST', '/api/doctors/:id/password', (ctx) => {
  requireAdmin(ctx);
  const { password } = ctx.body || {};
  if (!password || String(password).length < 6) throw bad('Parola en az 6 karakter olmalı.');
  return update((db) => {
    const user = db.users[ctx.params.id];
    if (!user) throw notFound('Doktor bulunamadı.');
    const { salt, hash } = hashPassword(password);
    user.salt = salt;
    user.passwordHash = hash;
    user.mustChangePassword = true;
    destroySessionsForUser(user.id);
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'parola-sifirlandi', detail: user.name });
    return { ok: true };
  });
});

/* ---------------------------- Ayarlar ----------------------------- */

route('GET', '/api/settings', (ctx) => {
  requireAdmin(ctx);
  const db = load();
  return { settings: getSettings(db), categories: CATEGORIES };
});

route('PUT', '/api/settings', (ctx) => {
  requireAdmin(ctx);
  const body = ctx.body || {};
  // Sablonlar kaydedilmeden once dogrulanir: kapsama boslugu olan bir sablon
  // ile ay uretilirse hastane bos kalir.
  if (body.shiftTemplates) {
    const rules = { ...DEFAULT_RULES, ...(body.rules || {}) };
    const problems = [
      ...validateTemplates(body.shiftTemplates.weekday, 'Hafta içi', rules),
      ...validateTemplates(body.shiftTemplates.weekend, 'Hafta sonu', rules),
    ];
    const errors = problems.filter((p) => p.level === 'error');
    if (errors.length) throw bad(errors.map((e) => e.message).join(' '));
  }
  return update((db) => {
    const current = getSettings(db);
    db.settings = {
      ...current,
      ...body,
      rules: { ...current.rules, ...(body.rules || {}) },
      weights: {
        ...current.weights,
        ...(body.weights || {}),
        categoryWeights: { ...current.weights.categoryWeights, ...(body.weights?.categoryWeights || {}) },
      },
      optimizer: { ...current.optimizer, ...(body.optimizer || {}) },
    };
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'ayarlar-guncellendi' });
    return { settings: getSettings(db) };
  });
});

/* ------------------------------ Aylar ----------------------------- */

route('GET', '/api/months', (ctx) => {
  requireAuth(ctx);
  const db = load();
  return {
    months: Object.keys(db.months).sort().reverse().map((id) => ({
      id,
      label: monthLabel(id),
      status: db.months[id].status,
      lockedThrough: db.months[id].lockedThrough,
      generatedAt: db.months[id].generatedAt,
      prefWindowOpen: db.months[id].prefWindowOpen !== false,
      participantCount: (db.months[id].participants || []).filter((p) => p.active !== false).length,
    })),
  };
});

route('POST', '/api/months', (ctx) => {
  requireAdmin(ctx);
  const { id, copyFrom } = ctx.body || {};
  parseMonthId(id);
  return update((db) => {
    if (db.months[id]) throw bad(`${monthLabel(id)} zaten oluşturulmuş.`);
    const record = createMonthRecord(db, id);
    if (copyFrom && db.months[copyFrom]) {
      const src = db.months[copyFrom];
      record.participants = structuredClone(src.participants).map((p) => ({
        ...p,
        from: null,
        to: null,
        offDates: [],
      }));
      record.settings = structuredClone(src.settings || {});
    }
    db.months[id] = record;
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'ay-olusturuldu', detail: id });
    return { month: { id, label: monthLabel(id), status: record.status } };
  });
});

route('GET', '/api/months/:id', (ctx) => {
  requireAuth(ctx);
  const db = load();
  const ws = monthWorkspace(db, ctx.params.id);
  if (ctx.user.role === 'admin') return { ...ws, scheduleVisible: true, viewerId: ctx.user.id };

  // Doktor gorunumu: yayinlanmamis cizelge gizlenir, baskalarinin tercihleri gizlenir.
  const visible = ws.month.status !== 'draft';
  return {
    ...ws,
    assignments: visible ? ws.assignments : {},
    report: visible ? ws.report : { rows: [], issues: [], unassigned: [] },
    preferences: { [ctx.user.id]: ws.preferences[ctx.user.id] || {} },
    warnings: [],
    viewerId: ctx.user.id,
    scheduleVisible: visible,
  };
});

route('PUT', '/api/months/:id/participants', (ctx) => {
  requireAdmin(ctx);
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    assertEditable(month);
    month.participants = sanitizeParticipants(ctx.body?.participants, db);
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'katilimcilar-guncellendi', detail: month.id });
    return monthWorkspace(db, month.id);
  });
});

route('PUT', '/api/months/:id/config', (ctx) => {
  requireAdmin(ctx);
  const body = ctx.body || {};
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    if (body.lockedThrough !== undefined) {
      const v = body.lockedThrough;
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Geçersiz tarih.');
      month.lockedThrough = v || null;
    }
    if (body.prefWindowOpen !== undefined) month.prefWindowOpen = !!body.prefWindowOpen;
    if (body.prefDeadline !== undefined) month.prefDeadline = body.prefDeadline || null;
    if (body.notes !== undefined) month.notes = String(body.notes).slice(0, 2000);
    if (body.settings !== undefined) {
      if (body.settings.shiftTemplates) {
        const merged = resolveSettings(getSettings(db), body.settings);
        const problems = [
          ...validateTemplates(merged.shiftTemplates.weekday, 'Hafta içi', merged.rules),
          ...validateTemplates(merged.shiftTemplates.weekend, 'Hafta sonu', merged.rules),
        ].filter((p) => p.level === 'error');
        if (problems.length) throw bad(problems.map((p) => p.message).join(' '));
      }
      month.settings = body.settings;
    }
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'ay-ayari', detail: month.id });
    return monthWorkspace(db, month.id);
  });
});

route('POST', '/api/months/:id/status', (ctx) => {
  requireAdmin(ctx);
  const status = ctx.body?.status;
  if (!['draft', 'published'].includes(status)) throw bad('Geçersiz durum.');
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    if (month.status === 'final') throw bad('Kesinleşmiş ayın durumu değiştirilemez.');
    month.status = status;
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: `ay-${status}`, detail: month.id });
    return monthWorkspace(db, month.id);
  });
});

/* --------------------------- Cizelge uretimi ---------------------- */

route('POST', '/api/months/:id/generate', (ctx) => {
  requireAdmin(ctx);
  const { fromDate, seed, iterations, keepPinned = true } = ctx.body || {};
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    assertEditable(month);
    const settings = getSettings(db);
    const ledger = ledgerFor(db, month.id);
    const carryOver = carryOverFor(db, month.id, settings);

    // "fromDate tarihinden itibaren yeniden planla": oncesi aynen korunur.
    const extraFixed = {};
    if (fromDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw bad('Geçersiz başlangıç tarihi.');
      for (const [slotId, doctorId] of Object.entries(month.assignments || {})) {
        if (!doctorId) continue;
        const date = slotId.split('#')[0];
        if (date < fromDate) extraFixed[slotId] = doctorId;
      }
    }
    if (!keepPinned) month.pinned = [];

    const out = generateSchedule(
      { month, doctors: doctorsMap(db), settings, ledger, carryOver },
      {
        seed: Number.isFinite(Number(seed)) && seed !== '' && seed !== null ? Number(seed) : undefined,
        extraFixed,
        optimizer: Number(iterations) > 0 ? { iterations: Math.min(400000, Number(iterations)) } : undefined,
      },
    );

    month.assignments = out.assignments;
    month.warnings = out.warnings;
    month.seed = out.seed;
    month.generatedAt = new Date().toISOString();
    logAction(db, {
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: fromDate ? 'cizelge-revize' : 'cizelge-uretildi',
      detail: `${month.id}${fromDate ? ` (${fromDate} sonrasi)` : ''}`,
    });
    return monthWorkspace(db, month.id);
  });
});

route('POST', '/api/months/:id/assign', (ctx) => {
  requireAdmin(ctx);
  const { slotId, doctorId } = ctx.body || {};
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    assertEditable(month);
    const date = String(slotId || '').split('#')[0];
    assertNotLocked(month, date);
    if (doctorId && !db.users[doctorId]) throw notFound('Doktor bulunamadı.');
    month.assignments = { ...month.assignments };
    if (doctorId) month.assignments[slotId] = doctorId;
    else delete month.assignments[slotId];
    logAction(db, {
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: 'elle-atama',
      detail: `${slotId} -> ${doctorId ? db.users[doctorId].name : 'bos'}`,
    });
    return monthWorkspace(db, month.id);
  });
});

route('POST', '/api/months/:id/swap', (ctx) => {
  requireAdmin(ctx);
  const { slotA, slotB } = ctx.body || {};
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    assertEditable(month);
    assertNotLocked(month, String(slotA || '').split('#')[0]);
    assertNotLocked(month, String(slotB || '').split('#')[0]);
    const a = month.assignments?.[slotA];
    const b = month.assignments?.[slotB];
    if (!a || !b) throw bad('Takas için iki slot da dolu olmalı.');
    month.assignments = { ...month.assignments, [slotA]: b, [slotB]: a };
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'takas', detail: `${slotA} <-> ${slotB}` });
    return monthWorkspace(db, month.id);
  });
});

route('POST', '/api/months/:id/pin', (ctx) => {
  requireAdmin(ctx);
  const { slotId, pinned } = ctx.body || {};
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    assertEditable(month);
    const set = new Set(month.pinned || []);
    if (pinned) set.add(slotId);
    else set.delete(slotId);
    month.pinned = [...set].sort();
    return monthWorkspace(db, month.id);
  });
});

route('GET', '/api/months/:id/candidates', (ctx) => {
  requireAdmin(ctx);
  const slotId = ctx.query.get('slot');
  if (!slotId) throw bad('slot parametresi gerekli.');
  const db = load();
  const { month, built } = buildMonthContext(db, ctx.params.id);
  return { candidates: candidatesForSlot(built.ctx, month.assignments || {}, slotId) };
});

route('GET', '/api/months/:id/swap-check', (ctx) => {
  requireAdmin(ctx);
  const a = ctx.query.get('a');
  const b = ctx.query.get('b');
  if (!a || !b) throw bad('a ve b parametreleri gerekli.');
  const db = load();
  const { month, built } = buildMonthContext(db, ctx.params.id);
  return { result: checkSwap(built.ctx, month.assignments || {}, a, b) };
});

/* --------------------------- Kesinlestirme ------------------------ */

route('POST', '/api/months/:id/finalize', (ctx) => {
  requireAdmin(ctx);
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    if (month.status === 'final') throw bad('Bu ay zaten kesinleştirilmiş.');
    const ws = monthWorkspace(db, month.id);
    if (ws.report.unassigned.length) throw bad('Boş slot varken ay kesinleştirilemez.');

    const delta = {};
    for (const row of ws.report.rows) {
      const vec = emptyCategoryVector();
      for (const key of CATEGORY_KEYS) vec[key] = row.fairDeviation[key];
      delta[row.doctorId] = vec;
    }
    month.ledgerDelta = delta;
    month.status = 'final';
    month.finalizedAt = new Date().toISOString();
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'ay-kesinlestirildi', detail: month.id });
    return monthWorkspace(db, month.id);
  });
});

route('POST', '/api/months/:id/unfinalize', (ctx) => {
  requireAdmin(ctx);
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    if (month.status !== 'final') throw bad('Bu ay kesinleştirilmemiş.');
    month.ledgerDelta = null;
    month.status = 'published';
    delete month.finalizedAt;
    logAction(db, { userId: ctx.user.id, userName: ctx.user.name, action: 'kesinlestirme-geri-alindi', detail: month.id });
    return monthWorkspace(db, month.id);
  });
});

route('GET', '/api/ledger', (ctx) => {
  requireAuth(ctx);
  const db = load();
  const upcoming = ctx.query.get('month') || makeMonthId(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
  const ledger = ledgerFor(db, upcoming);
  return { ledger, doctors: doctorsMap(db), categories: CATEGORIES };
});

/* ---------------------------- Tercihler --------------------------- */

route('PUT', '/api/months/:id/preferences', (ctx) => {
  requireAuth(ctx);
  const body = ctx.body || {};
  const targetId = body.doctorId && ctx.user.role === 'admin' ? body.doctorId : ctx.user.id;
  return update((db) => {
    const month = getMonth(db, ctx.params.id);
    if (ctx.user.role !== 'admin') {
      if (month.prefWindowOpen === false) throw bad('Tercih girişi bu ay için kapatıldı.');
      if (month.status === 'final') throw bad('Bu ay kesinleştirildi, tercih değiştirilemez.');
    }
    month.preferences = { ...(month.preferences || {}) };
    month.preferences[targetId] = sanitizePreferences(body.preferences);
    logAction(db, {
      userId: ctx.user.id,
      userName: ctx.user.name,
      action: 'tercih-kaydedildi',
      detail: `${month.id} / ${db.users[targetId]?.name || targetId}`,
    });
    return {
      ok: true,
      preferences: month.preferences[targetId],
      warning: month.assignments && Object.keys(month.assignments).length
        ? 'Çizelge zaten üretilmiş. Tercihin dikkate alınması için yöneticinin listeyi yeniden üretmesi gerekir.'
        : null,
    };
  });
});

/* ------------------------------ Disa aktarim ---------------------- */

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

route('GET', '/api/months/:id/export', (ctx) => {
  requireAuth(ctx);
  const db = load();
  const ws = monthWorkspace(db, ctx.params.id);
  if (ctx.user.role !== 'admin' && ws.month.status === 'draft') throw forbidden('Çizelge henüz yayınlanmadı.');
  const doctors = doctorsMap(db);
  const kind = ctx.query.get('kind') || 'schedule';
  const rows = [];

  if (kind === 'summary') {
    rows.push(['Kod', 'Doktor', 'Nöbet', 'Gece', 'Hafta sonu', ...CATEGORIES.map((c) => c.label), 'Toplam saat', 'Hedef saat', 'Fark']);
    for (const row of ws.report.rows) {
      const d = doctors[row.doctorId];
      rows.push([
        d?.code || '', d?.name || row.doctorId, row.shifts, row.nightShifts, row.weekendShifts,
        ...CATEGORY_KEYS.map((k) => row.actual[k].toFixed(1)),
        row.totalHours.toFixed(1), row.targetTotalHours.toFixed(1),
        (row.totalHours - row.targetTotalHours).toFixed(1),
      ]);
    }
  } else {
    rows.push(['Tarih', 'Gün', 'Gün tipi', 'Vardiya', 'Saat', 'Kod', 'Doktor', 'Süre (sa)', ...CATEGORIES.map((c) => c.label)]);
    for (const slot of ws.slots) {
      const day = ws.days.find((d) => d.iso === slot.date);
      const doctorId = ws.assignments[slot.id];
      const d = doctors[doctorId];
      rows.push([
        slot.date, day?.dayName || '', slot.dayType === 'weekend' ? 'Hafta sonu/Tatil' : 'Hafta içi',
        slot.label, slot.timeLabel, d?.code || '', d?.name || '(boş)', slot.hours,
        ...CATEGORY_KEYS.map((k) => slot.cat[k]),
      ]);
    }
  }

  const csv = `﻿${rows.map((r) => r.map(csvEscape).join(';')).join('\r\n')}`;
  ctx.setHeader('Content-Type', 'text/csv; charset=utf-8');
  ctx.setHeader('Content-Disposition', `attachment; filename="nobet-${ctx.params.id}-${kind}.csv"`);
  return { __raw: csv };
});

route('GET', '/api/audit', (ctx) => {
  requireAdmin(ctx);
  const db = load();
  return { log: (db.auditLog || []).slice(0, 100) };
});

