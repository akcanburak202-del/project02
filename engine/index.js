/**
 * Motor giris noktasi: ay kaydini alir, cizelge uretir veya mevcut cizelgeyi
 * degerlendirir.
 */

import {
  buildSlots, buildSlotsFromPlan, validateTemplates,
  CATEGORIES, CATEGORY_KEYS, emptyCategoryVector, vectorTotal,
} from './slots.js';
import {
  DEFAULT_SHIFT_POLICY, createPlan, isDayValid, normalizePolicy, patternForDay, validatePolicy,
} from './shiftplan.js';
import { DEFAULT_PATTERNS, normalizePatterns, previewPattern } from './patterns.js';
import { buildBalanceReport, computeActuals, computeTargets, computeWeights, updateLedger } from './fairness.js';
import {
  DEFAULT_OPTIMIZER,
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
  auditAssignments,
  candidatesForSlot,
  prepare,
  solve,
} from './scheduler.js';
import { parseMonthId, monthLabel, monthDays, prevMonthId } from './calendar.js';
import { monthRhythm } from './rhythm.js';

export {
  CATEGORIES,
  CATEGORY_KEYS,
  DEFAULT_SHIFT_POLICY,
  DEFAULT_PATTERNS,
  normalizePatterns,
  normalizePolicy,
  patternForDay,
  previewPattern,
  validatePolicy,
  DEFAULT_OPTIMIZER,
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
  buildSlots,
  candidatesForSlot,
  emptyCategoryVector,
  monthLabel,
  updateLedger,
  validateTemplates,
  vectorTotal,
};

export const DEFAULT_SHIFT_TEMPLATES = {
  weekday: [
    { id: 'gunduz', label: 'Gündüz', start: '09:00', end: '24:00', color: '#2563eb' },
    { id: 'gece', label: 'Akşam/Gece', start: '15:00', end: '09:00+1', color: '#7c3aed' },
  ],
  weekend: [
    { id: 'gunduz', label: 'Gündüz', start: '09:00', end: '24:00', color: '#2563eb' },
    { id: 'gece', label: 'Akşam/Gece', start: '15:00', end: '09:00+1', color: '#7c3aed' },
  ],
};

/** Ay bazli ayar gecersiz kilmalarini genel ayarlarla birlestirir. */
export function resolveSettings(global = {}, override = {}) {
  return {
    weekendDays: override.weekendDays || global.weekendDays || [0, 6],
    holidays: [...new Set([...(global.holidays || []), ...(override.holidays || [])])].sort(),
    shiftTemplates: override.shiftTemplates || global.shiftTemplates || DEFAULT_SHIFT_TEMPLATES,
    shiftPolicy: normalizePolicy({
      ...DEFAULT_SHIFT_POLICY,
      ...(global.shiftPolicy || {}),
      ...(override.shiftPolicy || {}),
    }),
    rules: { ...DEFAULT_RULES, ...(global.rules || {}), ...(override.rules || {}) },
    weights: {
      ...DEFAULT_WEIGHTS,
      ...(global.weights || {}),
      ...(override.weights || {}),
      categoryWeights: {
        ...DEFAULT_WEIGHTS.categoryWeights,
        ...(global.weights?.categoryWeights || {}),
        ...(override.weights?.categoryWeights || {}),
      },
    },
    optimizer: { ...DEFAULT_OPTIMIZER, ...(global.optimizer || {}), ...(override.optimizer || {}) },
  };
}

/**
 * Ay icin slot yapisini ve cozucu baglamini kurar.
 *
 * @param month     { id, participants, preferences, assignments, lockedThrough, pinned, settings }
 * @param doctors   { doctorId: { name, ... } }
 * @param settings  genel ayarlar
 * @param ledger    { doctorId: kategori vektoru }
 * @param carryOver onceki aydan tasan nobetler
 */
export function buildContext({ month, doctors = {}, settings = {}, ledger = {}, carryOver = [], history = null }) {
  const { year, month: mm } = parseMonthId(month.id);
  const cfg = resolveSettings(settings, month.settings || {});
  const calendarOpts = { year, month: mm, weekendDays: cfg.weekendDays, holidays: cfg.holidays };

  // Esnek modda giris/cikis saatleri karar degiskenidir; sabit modda
  // yoneticinin tanimladigi vardiya sablonlari aynen kullanilir.
  let built;
  if (cfg.shiftPolicy.mode === 'flexible') {
    const days = monthDays(year, mm, { weekendDays: cfg.weekendDays, holidays: cfg.holidays });
    const plan = adoptPlan(month.plan, cfg.shiftPolicy, days, month.dayPatterns || {});
    built = buildSlotsFromPlan({
      year, month: mm, days, plan,
      weekendDays: cfg.weekendDays, holidays: cfg.holidays,
    });
  } else {
    built = buildSlots({
      year,
      month: mm,
      shiftTemplates: cfg.shiftTemplates,
      weekendDays: cfg.weekendDays,
      holidays: cfg.holidays,
    });
  }

  const ctx = prepare({
    slots: built.slots,
    days: built.days,
    totals: built.totals,
    participants: month.participants || [],
    preferences: month.preferences || {},
    ledger,
    rules: cfg.rules,
    weights: cfg.weights,
    carryOver,
    doctorsById: doctors,
    built,
    calendarOpts,
    history,
  });

  return { ...built, ctx, config: cfg, year, month: mm };
}

/**
 * Kaydedilmis saat planini mevcut ayarlarla birlestirir.
 * Gun desenleri ay kaydindan gelir; saatler sinirlarin disindaysa
 * tercih edilen degerlere donulur.
 */
function adoptPlan(saved, policy, days, dayPatterns) {
  const plan = createPlan(policy, days, dayPatterns);
  if (!saved) return plan;
  try {
    if (Array.isArray(saved.handover)) {
      for (let d = 0; d < plan.handover.length && d < saved.handover.length; d += 1) {
        plan.handover[d] = saved.handover[d];
      }
    }
    (saved.days || []).forEach((dp, i) => {
      if (!plan.days[i]) return;
      // Kaydedilmis saatler yalnizca desen ayni kaldiysa gecerlidir
      if (dp.patternId && dp.patternId !== plan.days[i].patternId) return;
      (dp.times || []).forEach((v, j) => { if (j < plan.days[i].times.length) plan.days[i].times[j] = v; });
    });
    for (let d = 0; d < days.length; d += 1) {
      if (!isDayValid(plan, days, d)) return createPlan(policy, days, dayPatterns);
    }
  } catch {
    return createPlan(policy, days, dayPatterns);
  }
  return plan;
}

/** Plani JSON'a yazilabilir hale getirir. */
export function serializePlan(plan) {
  if (!plan) return null;
  return {
    handover: Array.from(plan.handover),
    days: plan.days.map((d) => ({ patternId: d.patternId, times: Array.from(d.times) })),
  };
}

/** Kilitli (donmus) ve sabitlenmis slotlarin atamalarini toplar. */
export function collectFixed(month, slots) {
  const fixed = {};
  const lockedThrough = month.lockedThrough || null;
  const pinned = new Set(month.pinned || []);
  for (const slot of slots) {
    const assigned = month.assignments?.[slot.id];
    if (!assigned) continue;
    if ((lockedThrough && slot.date <= lockedThrough) || pinned.has(slot.id)) {
      fixed[slot.id] = assigned;
    }
  }
  return fixed;
}

/**
 * Cizelge uretir. lockedThrough tarihine kadar olan atamalar aynen korunur,
 * yalnizca sonrasi yeniden planlanir.
 */
export function generateSchedule(input, options = {}) {
  const built = buildContext(input);
  const { ctx, slots, config } = built;

  const fixed = { ...collectFixed(input.month, slots), ...(options.extraFixed || {}) };
  const seed = Number.isFinite(options.seed) ? options.seed : input.seed;
  const result = solve(ctx, {
    fixed,
    seed,
    optimizer: { ...config.optimizer, ...(options.optimizer || {}) },
  });

  const report = analyzeAssignments(built, result.assignments, input.ledger || {});
  return {
    assignments: result.assignments,
    // Esnek modda uretilen giris/cikis saatleri de cizelgenin parcasidir;
    // kaydedilmezse ay yeniden acildiginda saatler tercih degerine doner.
    plan: serializePlan(built.ctx.plan),
    warnings: [...built.warnings, ...result.warnings],
    report,
    seed: result.seed,
    cost: result.cost,
    slots,
    days: built.days,
    config,
  };
}

/** Mevcut atamalari degerlendirir (denge tablosu + kural denetimi). */
export function analyzeAssignments(built, assignments, ledger = {}) {
  const { ctx, slots, totals } = built;
  const actuals = computeActuals(assignments, slots, ctx.doctorIds);
  const report = buildBalanceReport({
    totals,
    weights: ctx.weightMap,
    targets: ctx.targetMap,
    actuals,
    ledger,
    slots,
  });
  report.issues = auditAssignments(ctx, assignments);
  report.unassigned = slots.filter((s) => !assignments[s.id]).map((s) => s.id);
  return report;
}

/** Onceki aydan bu aya tasan nobetleri cikarir (dinlenme kontrolu icin). */
export function extractCarryOver(prevMonthRecord, prevBuilt) {
  if (!prevMonthRecord || !prevBuilt) return [];
  const lastDate = prevBuilt.days[prevBuilt.days.length - 1]?.iso;
  if (!lastDate) return [];
  const out = [];
  for (const slot of prevBuilt.slots) {
    if (slot.date !== lastDate) continue;
    const doctorId = prevMonthRecord.assignments?.[slot.id];
    if (!doctorId) continue;
    out.push({
      doctorId,
      date: slot.date,
      startMin: slot.startMin - (prevBuilt.totalDays - 1) * 1440,
      endMin: slot.endMin - (prevBuilt.totalDays - 1) * 1440,
    });
  }
  return out;
}

export { prevMonthId, parseMonthId, computeTargets, computeWeights, computeActuals, auditAssignments };
export { mergeRhythm, rhythmBias } from './rhythm.js';
export { monthRhythm };

/**
 * Bir ayin cizelgesinden ritim kaydini cikarir (haftagunu dagilimi + yogun
 * hafta yuku). Sonraki aylarin cozumunde `history` olarak kullanilir.
 */
export function extractRhythm(built, assignments) {
  const { ctx, slots } = built;
  const actuals = computeActuals(assignments || {}, slots, ctx.doctorIds);
  const out = {};
  ctx.doctorIds.forEach((id, d) => {
    const row = actuals.get(id);
    if (!row) return;
    // Ayni gunde birden fazla nobet olamaz; yine de tekrarlari eleyelim.
    out[id] = monthRhythm([...new Set(row.dates)], ctx.weekAllow[d]);
  });
  return out;
}
