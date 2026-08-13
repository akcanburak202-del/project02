/**
 * Motor giris noktasi: ay kaydini alir, cizelge uretir veya mevcut cizelgeyi
 * degerlendirir.
 */

import { buildSlots, validateTemplates, CATEGORIES, CATEGORY_KEYS, emptyCategoryVector, vectorTotal } from './slots.js';
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
import { parseMonthId, monthLabel, prevMonthId } from './calendar.js';

export {
  CATEGORIES,
  CATEGORY_KEYS,
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
export function buildContext({ month, doctors = {}, settings = {}, ledger = {}, carryOver = [] }) {
  const { year, month: mm } = parseMonthId(month.id);
  const cfg = resolveSettings(settings, month.settings || {});
  const built = buildSlots({
    year,
    month: mm,
    shiftTemplates: cfg.shiftTemplates,
    weekendDays: cfg.weekendDays,
    holidays: cfg.holidays,
  });

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
  });

  return { ...built, ctx, config: cfg, year, month: mm };
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
