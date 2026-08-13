/**
 * Cizelge cozucusu.
 *
 * Problem: her slot (gun + vardiya) tam olarak bir doktora atanacak. Sert
 * kurallar (musaitlik, dinlenme, ust uste gun siniri) mutlaka saglanacak;
 * yumusak hedefler (4 etiketli saatlerin esit dagilimi, tercihler, nobetlerin
 * aya dengeli yayilmasi) olabildigince iyilestirilecek.
 *
 * Yontem: en kisitli slottan baslayan acgozlu bir ilk cozum + tohumlanmis
 * (deterministik) tavlama benzetimi ile yerel arama.
 *
 * HIZ NOTU: sicak dongude tarih metinleri, nesne ayirma ve Date islemleri
 * kullanilmaz; her sey onceden hesaplanmis tipli dizilere indirgenmistir.
 * Bu sayede bir aylik cizelge yuz binlerce iterasyonla saniyenin altinda
 * cozulur ve arayuz aninda yanit verir.
 *
 * Ayni girdi + ayni tohum her zaman ayni cizelgeyi uretir; cizelgenin
 * denetlenebilir ve tekrar uretilebilir olmasi icin bilincli bir tercihtir.
 */

import { CATEGORY_KEYS } from './slots.js';
import { availableDates, computeActuals, computeTargets, computeWeights } from './fairness.js';
import { MIN_PER_DAY } from './time.js';
import { addDays, diffDays } from './calendar.js';

export const DEFAULT_WEIGHTS = {
  fairness: 1,
  categoryWeights: { wdSolo: 1, wdShared: 1, weSolo: 1.4, weShared: 1.4 },
  shiftCount: 2,
  nightCount: 1,
  weekendCount: 1.5,
  avoidDay: 40,
  wantDay: 15,
  wantMissed: 3,
  spacing: 1,
  consecutiveDays: 25,
  shiftTypePref: 5,
  softViolation: 1000,
};

export const DEFAULT_RULES = {
  minRestHours: 12,
  maxConsecutiveDays: 2,
  maxShiftsPerMonth: null,
  earliestStart: '06:00',
  latestStart: '22:00',
  maxShiftHours: 24,
  maxCarryRatio: 0.4,
};

export const DEFAULT_OPTIMIZER = {
  iterations: 30000,
  restarts: 4,
  seed: 20260801,
  startTemp: 18,
  endTemp: 0.05,
};

/** Deterministik sozde-rastgele uretec (mulberry32). */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIOLATION_LABELS = {
  unavailable: 'Bu tarihte görevli değil / izinli',
  overnightBeyondEnd: 'Gece nöbeti görev bitiş tarihini aşıyor',
  overlap: 'Aynı saatlerde başka nöbeti var',
  rest: 'Dinlenme süresi yetersiz',
  consecutive: 'Üst üste gün sınırı aşılıyor',
  maxShifts: 'Aylık nöbet üst sınırı dolu',
  notParticipant: 'Bu ay listede değil',
};

export function describeViolation(code) {
  return VIOLATION_LABELS[code] || code;
}

/** Cozucunun ihtiyac duydugu tum sabit verileri hazirlar. */
export function prepare({
  slots,
  days,
  totals,
  participants,
  preferences = {},
  ledger = {},
  rules = {},
  weights = {},
  carryOver = [],
  doctorsById = {},
}) {
  const R = { ...DEFAULT_RULES, ...rules };
  const W = {
    ...DEFAULT_WEIGHTS,
    ...weights,
    categoryWeights: { ...DEFAULT_WEIGHTS.categoryWeights, ...(weights.categoryWeights || {}) },
  };

  const active = participants.filter((p) => p.active !== false);
  const doctorIds = active.map((p) => p.doctorId);
  const indexById = new Map(doctorIds.map((id, i) => [id, i]));
  const nDoctors = doctorIds.length;
  const nSlots = slots.length;
  const totalDays = days.length;

  const weightMap = computeWeights(active, days, preferences);
  const targetMap = computeTargets(totals, weightMap, ledger, { maxCarryRatio: R.maxCarryRatio });

  // --- Slot bazli sabit diziler ---
  const slotStart = new Float64Array(nSlots);
  const slotEnd = new Float64Array(nSlots);
  const slotDay = new Int32Array(nSlots);
  const slotIsNight = new Uint8Array(nSlots);
  const slotIsWeekend = new Uint8Array(nSlots);
  const slotCat = new Float64Array(nSlots * 4);
  const slotIndexById = new Map();
  const dayIndexByIso = new Map(days.map((d, i) => [d.iso, i]));

  slots.forEach((slot, i) => {
    slotIndexById.set(slot.id, i);
    slotStart[i] = slot.startMin;
    slotEnd[i] = slot.endMin;
    slotDay[i] = dayIndexByIso.get(slot.date) ?? 0;
    slotIsNight[i] = slot.crossesMidnight ? 1 : 0;
    slotIsWeekend[i] = slot.dayType === 'weekend' ? 1 : 0;
    for (let c = 0; c < 4; c += 1) slotCat[i * 4 + c] = slot.cat[CATEGORY_KEYS[c]] || 0;
  });

  // --- Doktor bazli sabit veriler ---
  const availSets = active.map((p) => availableDates(p, days, preferences[p.doctorId]));
  const targets = new Float64Array(nDoctors * 4);
  doctorIds.forEach((id, d) => {
    const entry = targetMap.get(id);
    for (let c = 0; c < 4; c += 1) targets[d * 4 + c] = entry.target[CATEGORY_KEYS[c]];
  });

  const sumWeight = doctorIds.reduce((s, id) => s + weightMap.get(id).weight, 0) || 1;
  const nightSlots = slots.filter((s) => s.crossesMidnight).length;
  const weekendSlots = slots.filter((s) => s.dayType === 'weekend').length;
  const expShifts = new Float64Array(nDoctors);
  const expNight = new Float64Array(nDoctors);
  const expWeekend = new Float64Array(nDoctors);
  doctorIds.forEach((id, d) => {
    const share = weightMap.get(id).weight / sumWeight;
    expShifts[d] = nSlots * share;
    expNight[d] = nightSlots * share;
    expWeekend[d] = weekendSlots * share;
  });

  const maxShifts = new Float64Array(nDoctors);
  active.forEach((p, d) => {
    const own = Number(p.maxShifts);
    const global = Number(R.maxShiftsPerMonth);
    if (Number.isFinite(own) && own > 0) maxShifts[d] = own;
    else if (Number.isFinite(global) && global > 0) maxShifts[d] = global;
    else maxShifts[d] = Infinity;
  });

  // --- Sert kural on-hesabi: musaitlik / gorev bitisi ---
  const staticOk = new Uint8Array(nDoctors * nSlots);
  const staticReasonCode = new Array(nDoctors * nSlots).fill(null);
  for (let d = 0; d < nDoctors; d += 1) {
    for (let si = 0; si < nSlots; si += 1) {
      const slot = slots[si];
      let reason = null;
      if (!availSets[d].has(slot.date)) {
        reason = 'unavailable';
      } else if (slot.crossesMidnight) {
        const next = addDays(slot.date, 1);
        const inMonthNext = dayIndexByIso.has(next);
        if (inMonthNext && !availSets[d].has(next)) reason = 'overnightBeyondEnd';
        else if (!inMonthNext && active[d].to && next > active[d].to) reason = 'overnightBeyondEnd';
      }
      staticOk[d * nSlots + si] = reason ? 0 : 1;
      staticReasonCode[d * nSlots + si] = reason;
    }
  }

  // --- Tercih maliyetleri on-hesabi ---
  const prefCost = new Float64Array(nDoctors * nSlots);
  const wantHit = new Uint8Array(nDoctors * nSlots);
  const wantTotal = new Int32Array(nDoctors);
  active.forEach((p, d) => {
    const prefs = preferences[p.doctorId] || {};
    const typePref = p.shiftPreference || 'any';
    const wantDates = new Set();
    for (const [iso, value] of Object.entries(prefs)) {
      if (value === 'want' && dayIndexByIso.has(iso)) wantDates.add(iso);
    }
    wantTotal[d] = wantDates.size;
    for (let si = 0; si < nSlots; si += 1) {
      const slot = slots[si];
      let cost = 0;
      const p2 = prefs[slot.date];
      if (p2 === 'avoid') cost += W.avoidDay;
      else if (p2 === 'want') {
        cost -= W.wantDay;
        wantHit[d * nSlots + si] = 1;
      }
      if (typePref === 'night' && !slot.crossesMidnight) cost += W.shiftTypePref;
      if (typePref === 'day' && slot.crossesMidnight) cost += W.shiftTypePref;
      prefCost[d * nSlots + si] = cost;
    }
  });

  // --- Onceki aydan devreden nobetler (dinlenme kontrolu icin) ---
  const carryByDoctor = Array.from({ length: nDoctors }, () => []);
  for (const item of carryOver || []) {
    const d = indexById.get(item.doctorId);
    if (d === undefined) continue;
    const offsetDays = diffDays(item.date, days[0].iso);
    carryByDoctor[d].push({
      start: offsetDays * MIN_PER_DAY + item.startMin,
      end: offsetDays * MIN_PER_DAY + item.endMin,
      dayIndex: offsetDays,
    });
  }

  const minRestMin = Math.max(0, Number(R.minRestHours || 0)) * 60;
  const maxConsecutive = Math.max(1, Number(R.maxConsecutiveDays || 1));

  const catW = new Float64Array(4);
  for (let c = 0; c < 4; c += 1) catW[c] = (W.categoryWeights[CATEGORY_KEYS[c]] ?? 1) * W.fairness;

  // Statik uygunluk listesi (aday havuzlari)
  const eligibility = [];
  for (let si = 0; si < nSlots; si += 1) {
    const list = [];
    for (let d = 0; d < nDoctors; d += 1) if (staticOk[d * nSlots + si]) list.push(d);
    eligibility.push(list);
  }

  return {
    slots, days, totals, participants: active, doctorIds, doctorsById, indexById,
    nDoctors, nSlots, totalDays,
    slotStart, slotEnd, slotDay, slotIsNight, slotIsWeekend, slotCat, slotIndexById, dayIndexByIso,
    targets, expShifts, expNight, expWeekend, maxShifts,
    staticOk, staticReasonCode, prefCost, wantHit, wantTotal,
    carryByDoctor, minRestMin, maxConsecutive, catW,
    eligibility, availSets,
    rules: R, weights: W, weightMap, targetMap,
  };
}

/** Bos bir cozum durumu olusturur. */
export function createState(ctx) {
  return {
    assign: new Int32Array(ctx.nSlots).fill(-1),
    byDoctor: Array.from({ length: ctx.nDoctors }, () => []),
    // dayCount[d][dayIndex + 1]: doktorun o gun kac nobeti var (uc uste gun kontrolu)
    dayCount: Array.from({ length: ctx.nDoctors }, () => new Int16Array(ctx.totalDays + 2)),
  };
}

export function place(ctx, state, si, d) {
  const prev = state.assign[si];
  if (prev === d) return;
  if (prev >= 0) {
    const arr = state.byDoctor[prev];
    const at = arr.indexOf(si);
    if (at >= 0) arr.splice(at, 1);
    state.dayCount[prev][ctx.slotDay[si] + 1] -= 1;
  }
  state.assign[si] = d;
  if (d >= 0) {
    state.byDoctor[d].push(si);
    state.dayCount[d][ctx.slotDay[si] + 1] += 1;
  }
}

/**
 * Hizli uygunluk kontrolu. si slotunun d doktoruna ATANMADIGI varsayilir.
 * Tahsis yapmaz, nesne ayirmaz.
 */
export function feasible(ctx, state, d, si) {
  if (!ctx.staticOk[d * ctx.nSlots + si]) return false;

  const mine = state.byDoctor[d];
  if (mine.length + 1 > ctx.maxShifts[d]) return false;

  const start = ctx.slotStart[si];
  const end = ctx.slotEnd[si];
  const rest = ctx.minRestMin;

  for (let k = 0; k < mine.length; k += 1) {
    const o = mine[k];
    if (o === si) continue;
    const os = ctx.slotStart[o];
    const oe = ctx.slotEnd[o];
    if (start < oe && os < end) return false; // cakisma
    const gap = start >= oe ? start - oe : os - end;
    if (gap < rest) return false; // dinlenme
  }
  const carry = ctx.carryByDoctor[d];
  for (let k = 0; k < carry.length; k += 1) {
    const c = carry[k];
    if (start < c.end && c.start < end) return false;
    const gap = start >= c.end ? start - c.end : c.start - end;
    if (gap < rest) return false;
  }

  // Ust uste gun siniri
  const dc = state.dayCount[d];
  const di = ctx.slotDay[si];
  let run = 1;
  for (let k = di; k >= 1 && dc[k] > 0; k -= 1) run += 1;
  for (let k = di + 2; k <= ctx.totalDays && dc[k] > 0; k += 1) run += 1;
  return run <= ctx.maxConsecutive;
}

/**
 * Ihlal listesini okunabilir kodlarla dondurur (rapor ve arayuz icin).
 * si slotunun d doktoruna atanmadigi varsayilir.
 */
export function violations(ctx, state, d, si) {
  const reasons = [];
  const staticCode = ctx.staticReasonCode[d * ctx.nSlots + si];
  if (staticCode) return [staticCode];

  const mine = state.byDoctor[d];
  const start = ctx.slotStart[si];
  const end = ctx.slotEnd[si];
  let overlap = false;
  let restIssue = false;

  const check = (os, oe) => {
    if (start < oe && os < end) overlap = true;
    else {
      const gap = start >= oe ? start - oe : os - end;
      if (gap < ctx.minRestMin) restIssue = true;
    }
  };
  for (const o of mine) {
    if (o === si) continue;
    check(ctx.slotStart[o], ctx.slotEnd[o]);
  }
  for (const c of ctx.carryByDoctor[d]) check(c.start, c.end);

  if (overlap) reasons.push('overlap');
  if (restIssue) reasons.push('rest');
  if (mine.filter((o) => o !== si).length + 1 > ctx.maxShifts[d]) reasons.push('maxShifts');

  const dc = state.dayCount[d];
  const di = ctx.slotDay[si];
  let run = 1;
  for (let k = di; k >= 1 && dc[k] > 0; k -= 1) run += 1;
  for (let k = di + 2; k <= ctx.totalDays && dc[k] > 0; k += 1) run += 1;
  if (run > ctx.maxConsecutive) reasons.push('consecutive');

  return reasons;
}

// Sicak dongude yeniden kullanilan tampon (tahsis yapmamak icin)
const dayScratch = new Int32Array(64);

/** Tek bir doktorun mevcut atamalarindan dogan maliyet. */
export function doctorCost(ctx, state, d) {
  const W = ctx.weights;
  const mine = state.byDoctor[d];
  const n = mine.length;

  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  let night = 0;
  let weekend = 0;
  let pref = 0;
  let wantMatched = 0;
  const base = d * ctx.nSlots;
  const days = n <= dayScratch.length ? dayScratch : new Int32Array(n);

  for (let k = 0; k < n; k += 1) {
    const si = mine[k];
    const o = si * 4;
    c0 += ctx.slotCat[o];
    c1 += ctx.slotCat[o + 1];
    c2 += ctx.slotCat[o + 2];
    c3 += ctx.slotCat[o + 3];
    night += ctx.slotIsNight[si];
    weekend += ctx.slotIsWeekend[si];
    pref += ctx.prefCost[base + si];
    wantMatched += ctx.wantHit[base + si];
    days[k] = ctx.slotDay[si];
  }

  if (ctx.wantTotal[d] > wantMatched) pref += (ctx.wantTotal[d] - wantMatched) * W.wantMissed;

  const t = d * 4;
  const d0 = c0 - ctx.targets[t];
  const d1 = c1 - ctx.targets[t + 1];
  const d2 = c2 - ctx.targets[t + 2];
  const d3 = c3 - ctx.targets[t + 3];
  let cost =
    ctx.catW[0] * d0 * d0 +
    ctx.catW[1] * d1 * d1 +
    ctx.catW[2] * d2 * d2 +
    ctx.catW[3] * d3 * d3;

  const ds = n - ctx.expShifts[d];
  const dn = night - ctx.expNight[d];
  const dw = weekend - ctx.expWeekend[d];
  cost += W.shiftCount * ds * ds + W.nightCount * dn * dn + W.weekendCount * dw * dw;
  cost += pref;

  // Nobetlerin aya yayilmasi: cok yakin tarihler cezalandirilir.
  for (let i = 1; i < n; i += 1) {
    const key = days[i];
    let j = i - 1;
    while (j >= 0 && days[j] > key) {
      days[j + 1] = days[j];
      j -= 1;
    }
    days[j + 1] = key;
  }
  for (let i = 1; i < n; i += 1) {
    const gap = days[i] - days[i - 1];
    if (gap === 1) cost += W.consecutiveDays;
    else if (gap === 2) cost += 5 * W.spacing;
    else if (gap === 3) cost += 2 * W.spacing;
    else if (gap === 4) cost += 0.5 * W.spacing;
  }

  return cost;
}

export function totalCost(ctx, state) {
  let sum = 0;
  for (let d = 0; d < ctx.nDoctors; d += 1) sum += doctorCost(ctx, state, d);
  for (let si = 0; si < ctx.nSlots; si += 1) {
    if (state.assign[si] < 0) sum += ctx.weights.softViolation;
  }
  return sum;
}

/** Acgozlu ilk cozum: en az adayi olan slottan baslanir. */
function greedyFill(ctx, state, rng, unassigned) {
  const pending = [...unassigned];
  const warnings = [];

  while (pending.length) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < pending.length; i += 1) {
      const si = pending[i];
      let candidates = 0;
      for (const d of ctx.eligibility[si]) if (feasible(ctx, state, d, si)) candidates += 1;
      const score = candidates * 100 + rng();
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const si = pending.splice(bestIdx, 1)[0];

    let chosen = -1;
    let chosenCost = Infinity;
    for (const d of ctx.eligibility[si]) {
      if (!feasible(ctx, state, d, si)) continue;
      const before = doctorCost(ctx, state, d);
      place(ctx, state, si, d);
      const delta = doctorCost(ctx, state, d) - before + rng() * 0.001;
      place(ctx, state, si, -1);
      if (delta < chosenCost) {
        chosenCost = delta;
        chosen = d;
      }
    }

    if (chosen >= 0) {
      place(ctx, state, si, chosen);
      continue;
    }

    // Sert kurallarla doldurulamiyor: dinlenme / ust uste gun kurallarini
    // gevseterek doldur, ama mutlaka uyari uret. Musaitlik asla gevsetilmez.
    let fallback = -1;
    let fallbackCost = Infinity;
    let fallbackReasons = [];
    for (const d of ctx.eligibility[si]) {
      const reasons = violations(ctx, state, d, si);
      if (reasons.some((r) => r === 'unavailable' || r === 'overnightBeyondEnd' || r === 'overlap')) continue;
      const before = doctorCost(ctx, state, d);
      place(ctx, state, si, d);
      const cost = doctorCost(ctx, state, d) - before + reasons.length * 1000;
      place(ctx, state, si, -1);
      if (cost < fallbackCost) {
        fallbackCost = cost;
        fallback = d;
        fallbackReasons = reasons;
      }
    }
    if (fallback >= 0) {
      place(ctx, state, si, fallback);
      warnings.push({
        level: 'warn',
        slotId: ctx.slots[si].id,
        doctorId: ctx.doctorIds[fallback],
        message: `${ctx.slots[si].date} ${ctx.slots[si].label}: kural gevşetildi (${fallbackReasons
          .map(describeViolation)
          .join(', ')}). Kadro bu kurallar için dar olabilir.`,
      });
    } else {
      warnings.push({
        level: 'error',
        slotId: ctx.slots[si].id,
        message: `${ctx.slots[si].date} ${ctx.slots[si].label}: atanabilecek müsait doktor yok.`,
      });
    }
  }
  return warnings;
}

/** Tavlama benzetimi ile yerel arama. */
function anneal(ctx, state, rng, movable, opts) {
  if (movable.length < 2) return;
  const iterations = Math.max(0, opts.iterations | 0);
  const t0 = Math.max(1e-6, opts.startTemp);
  const t1 = Math.max(1e-6, opts.endTemp);
  const decay = iterations > 0 ? (t1 / t0) ** (1 / iterations) : 1;
  let temp = t0;

  for (let it = 0; it < iterations; it += 1) {
    temp *= decay;
    const si = movable[(rng() * movable.length) | 0];
    const a = state.assign[si];

    if (rng() < 0.55) {
      // Tasima: slotu baska bir doktora ver
      const pool = ctx.eligibility[si];
      if (pool.length < 2) continue;
      const d = pool[(rng() * pool.length) | 0];
      if (d === a) continue;
      const before = doctorCost(ctx, state, d) + (a >= 0 ? doctorCost(ctx, state, a) : 0);
      place(ctx, state, si, -1);
      if (!feasible(ctx, state, d, si)) {
        place(ctx, state, si, a);
        continue;
      }
      place(ctx, state, si, d);
      const delta = doctorCost(ctx, state, d) + (a >= 0 ? doctorCost(ctx, state, a) : 0) - before;
      if (delta <= 0 || rng() < Math.exp(-delta / temp)) continue;
      place(ctx, state, si, a);
    } else {
      // Takas: iki slotun doktorlarini degistir
      const sj = movable[(rng() * movable.length) | 0];
      if (sj === si) continue;
      const b = state.assign[sj];
      if (a === b || a < 0 || b < 0) continue;
      const before = doctorCost(ctx, state, a) + doctorCost(ctx, state, b);
      place(ctx, state, si, -1);
      place(ctx, state, sj, -1);
      if (!feasible(ctx, state, b, si) || !feasible(ctx, state, a, sj)) {
        place(ctx, state, si, a);
        place(ctx, state, sj, b);
        continue;
      }
      place(ctx, state, si, b);
      place(ctx, state, sj, a);
      const delta = doctorCost(ctx, state, a) + doctorCost(ctx, state, b) - before;
      if (delta <= 0 || rng() < Math.exp(-delta / temp)) continue;
      place(ctx, state, si, -1);
      place(ctx, state, sj, -1);
      place(ctx, state, si, a);
      place(ctx, state, sj, b);
    }
  }
}

/**
 * Cizelgeyi uretir.
 *
 * @param ctx           prepare() ciktisi
 * @param options.fixed { slotId: doctorId } degistirilemez atamalar
 * @param options.seed  tekrar uretilebilirlik icin tohum
 */
export function solve(ctx, options = {}) {
  const opt = { ...DEFAULT_OPTIMIZER, ...(options.optimizer || {}) };
  const seed = Number.isFinite(options.seed) ? options.seed : opt.seed;
  const fixed = options.fixed || {};

  const fixedPairs = [];
  const fixedWarnings = [];
  for (const [slotId, doctorId] of Object.entries(fixed)) {
    const si = ctx.slotIndexById.get(slotId);
    if (si === undefined) continue;
    const d = ctx.indexById.get(doctorId);
    if (d === undefined) {
      fixedWarnings.push({
        level: 'warn',
        slotId,
        message: `${slotId}: korunacak atamadaki doktor bu ayın listesinde değil, slot yeniden planlandı.`,
      });
      continue;
    }
    fixedPairs.push([si, d]);
  }
  const fixedSlots = new Set(fixedPairs.map(([si]) => si));
  const movable = [];
  for (let si = 0; si < ctx.nSlots; si += 1) if (!fixedSlots.has(si)) movable.push(si);

  let best = null;
  let bestCost = Infinity;
  let bestWarnings = [];

  const restarts = Math.max(1, opt.restarts | 0);
  for (let r = 0; r < restarts; r += 1) {
    const rng = makeRng(seed + r * 7919);
    const state = createState(ctx);
    for (const [si, d] of fixedPairs) place(ctx, state, si, d);
    const warnings = greedyFill(ctx, state, rng, movable);
    anneal(ctx, state, rng, movable, opt);
    const cost = totalCost(ctx, state);
    if (cost < bestCost) {
      bestCost = cost;
      best = state;
      bestWarnings = warnings;
    }
  }

  const assignments = {};
  for (let si = 0; si < ctx.nSlots; si += 1) {
    const d = best.assign[si];
    assignments[ctx.slots[si].id] = d >= 0 ? ctx.doctorIds[d] : null;
  }

  const finalWarnings = [...fixedWarnings, ...bestWarnings, ...auditState(ctx, best, fixedSlots)];
  return { assignments, cost: bestCost, warnings: dedupeWarnings(finalWarnings), seed };
}

function auditState(ctx, state, fixedSlots = new Set()) {
  const out = [];
  for (let si = 0; si < ctx.nSlots; si += 1) {
    const d = state.assign[si];
    if (d < 0) continue;
    const prev = state.assign[si];
    place(ctx, state, si, -1);
    const reasons = violations(ctx, state, d, si);
    place(ctx, state, si, prev);
    if (!reasons.length) continue;
    const name = ctx.doctorsById[ctx.doctorIds[d]]?.name || ctx.doctorIds[d];
    out.push({
      level: fixedSlots.has(si) ? 'info' : 'warn',
      slotId: ctx.slots[si].id,
      doctorId: ctx.doctorIds[d],
      message: `${ctx.slots[si].date} ${ctx.slots[si].label} — ${name}: ${reasons.map(describeViolation).join(', ')}`,
    });
  }
  return out;
}

function dedupeWarnings(list) {
  const seen = new Set();
  const out = [];
  for (const w of list) {
    const key = `${w.level}|${w.slotId || ''}|${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** Atamalari bir cozum durumuna yukler. */
export function stateFromAssignments(ctx, assignments) {
  const state = createState(ctx);
  for (const [slotId, doctorId] of Object.entries(assignments || {})) {
    const si = ctx.slotIndexById.get(slotId);
    const d = ctx.indexById.get(doctorId);
    if (si === undefined || d === undefined) continue;
    place(ctx, state, si, d);
  }
  return state;
}

/**
 * Elle duzenleme ekrani icin: bir slota atanabilecek doktorlarin listesi,
 * uygunluk durumu ve dengeye etkisi (costDelta negatifse denge iyilesir).
 */
export function candidatesForSlot(ctx, assignments, slotId) {
  const si = ctx.slotIndexById.get(slotId);
  if (si === undefined) return [];

  const state = stateFromAssignments(ctx, assignments);
  const current = state.assign[si];
  const baseline = totalCost(ctx, state);
  const out = [];

  // Doktorun toplam hedefi (4 kategorinin toplami) — arayuzde "hedeften sapma"
  // olarak gosterilir; ham maliyet degerinden cok daha anlasilirdir.
  const targetTotal = (d) => {
    let sum = 0;
    for (let c = 0; c < 4; c += 1) sum += ctx.targets[d * 4 + c];
    return sum;
  };
  const actualTotal = (d) => {
    let sum = 0;
    for (const s of state.byDoctor[d]) sum += (ctx.slotEnd[s] - ctx.slotStart[s]) / 60;
    return sum;
  };

  for (let d = 0; d < ctx.nDoctors; d += 1) {
    place(ctx, state, si, -1);
    const reasons = violations(ctx, state, d, si);
    const deviationBefore = actualTotal(d) - targetTotal(d);
    place(ctx, state, si, d);
    const cost = totalCost(ctx, state);
    const deviationAfter = actualTotal(d) - targetTotal(d);
    const shiftsAfter = state.byDoctor[d].length;
    out.push({
      doctorId: ctx.doctorIds[d],
      name: ctx.doctorsById[ctx.doctorIds[d]]?.name || ctx.doctorIds[d],
      current: d === current,
      feasible: reasons.length === 0,
      reasons: reasons.map((code) => ({ code, message: describeViolation(code) })),
      costDelta: cost - baseline,
      deviationBefore,
      deviationAfter,
      shiftsAfter,
    });
  }
  place(ctx, state, si, current);

  out.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return a.costDelta - b.costDelta;
  });
  return out;
}

/** Iki slotun doktorlarinin takasinin gecerli olup olmadigini denetler. */
export function checkSwap(ctx, assignments, slotIdA, slotIdB) {
  const si = ctx.slotIndexById.get(slotIdA);
  const sj = ctx.slotIndexById.get(slotIdB);
  if (si === undefined || sj === undefined) return { ok: false, reasons: ['Slot bulunamadı'] };

  const state = stateFromAssignments(ctx, assignments);
  const a = state.assign[si];
  const b = state.assign[sj];
  if (a < 0 || b < 0) return { ok: false, reasons: ['Boş slot takas edilemez'] };
  if (a === b) return { ok: false, reasons: ['Aynı doktor'] };

  const before = totalCost(ctx, state);
  place(ctx, state, si, -1);
  place(ctx, state, sj, -1);
  const ra = violations(ctx, state, b, si);
  const rb = violations(ctx, state, a, sj);
  place(ctx, state, si, b);
  place(ctx, state, sj, a);
  const after = totalCost(ctx, state);

  const reasons = [...ra, ...rb].map(describeViolation);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], costDelta: after - before };
}

/** Verilen atamalarin tum sert kural ihlallerini dondurur. */
export function auditAssignments(ctx, assignments) {
  const state = stateFromAssignments(ctx, assignments);
  const issues = [];
  for (let si = 0; si < ctx.nSlots; si += 1) {
    const slot = ctx.slots[si];
    const d = state.assign[si];
    if (d < 0) {
      issues.push({ level: 'error', slotId: slot.id, message: `${slot.date} ${slot.label}: boş slot.` });
      continue;
    }
    place(ctx, state, si, -1);
    const reasons = violations(ctx, state, d, si);
    place(ctx, state, si, d);
    const name = ctx.doctorsById[ctx.doctorIds[d]]?.name || ctx.doctorIds[d];
    for (const code of reasons) {
      issues.push({
        level: 'warn',
        slotId: slot.id,
        doctorId: ctx.doctorIds[d],
        code,
        message: `${slot.date} ${slot.label} — ${name}: ${describeViolation(code)}`,
      });
    }
  }
  return issues;
}

export { computeActuals };
