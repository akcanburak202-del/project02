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

import { CATEGORY_KEYS, EFFECTIVE_KEYS, PRESENCE_KEYS, refreshPlanSlots, refreshPlanWindow } from './slots.js';

const NCAT = CATEGORY_KEYS.length;
import {
  FLEXIBILITY_WEIGHTS, affectedDays, isDayValid, planDeviationHours,
  readVariable, timeVariables, writeVariable,
} from './shiftplan.js';
import { availableDates, computeActuals, computeTargets, computeWeights } from './fairness.js';
import { MIN_PER_DAY } from './time.js';
import { addDays, diffDays } from './calendar.js';
import { rhythmBias } from './rhythm.js';
import { clonePlan } from './shiftplan.js';

export const DEFAULT_WEIGHTS = {
  fairness: 1,
  // Fiili mesai birincil olcuttur: havuzu sabit (gunde 24 sa) oldugu icin
  // gercekten esitlenebilir. Bulunma saatleri ikincil olarak gozetilir.
  categoryWeights: {
    effWd: 3, effWe: 4,
    wdSolo: 0.4, wdShared: 0.4, weSolo: 0.5, weShared: 0.5,
  },
  shiftCount: 2,
  // Kategoriler tek tek dengelense bile sapmalar ayni doktorda ayni yonde
  // birikebilir; bu terimler dogrudan TOPLAMI hedefe cekerek bunu onler.
  totalEffective: 6,
  totalHours: 1,
  // Beklenen nobet sayisinin taban/tavan araligi disina cikma cezasi.
  // Kacinilabilir her durumda uyulacak kadar buyuk, cikmaza sokmayacak kadar yumusak.
  shiftCountBand: 250,
  nightCount: 1,
  weekendCount: 1.5,
  avoidDay: 40,
  wantDay: 15,
  wantMissed: 3,
  spacing: 1,
  // Gecmis aylarin ritmi (bkz. rhythm.js): ayni haftagunune / yogun haftaya
  // tekrar tekrar denk gelmeyi yumusak bicimde onler.
  weekdayHistory: 3,
  densityHistory: 1,
  // Yogun hafta cezasi: 7 gunluk kayan pencerede adil paydan fazla nobet.
  // "spacing" komsu iki nobet arasina bakar, bu ise HAFTANIN TAMAMINA bakar;
  // ikisi ayni sey degildir (bkz. asagidaki aciklama).
  weekDensity: 12,
  consecutiveDays: 25,
  shiftTypePref: 5,
  softViolation: 1000,
};

export const DEFAULT_RULES = {
  minRestHours: 12,
  // 1 = ust uste gun yok; iki nobet arasinda en az bir tam bos gun kalir.
  maxConsecutiveDays: 1,
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
  built = null,
  calendarOpts = {},
  history = null,
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
  const slotCat = new Float64Array(nSlots * NCAT);
  const slotIndexById = new Map();
  const dayIndexByIso = new Map(days.map((d, i) => [d.iso, i]));

  slots.forEach((slot, i) => {
    slotIndexById.set(slot.id, i);
    slotStart[i] = slot.startMin;
    slotEnd[i] = slot.endMin;
    slotDay[i] = dayIndexByIso.get(slot.date) ?? 0;
    slotIsNight[i] = slot.crossesMidnight ? 1 : 0;
    slotIsWeekend[i] = slot.dayType === 'weekend' ? 1 : 0;
    for (let c = 0; c < NCAT; c += 1) slotCat[i * NCAT + c] = slot.cat[CATEGORY_KEYS[c]] || 0;
  });

  // --- Doktor bazli sabit veriler ---
  const availSets = active.map((p) => availableDates(p, days, preferences[p.doctorId]));
  const targets = new Float64Array(nDoctors * NCAT);
  doctorIds.forEach((id, d) => {
    const entry = targetMap.get(id);
    for (let c = 0; c < NCAT; c += 1) targets[d * NCAT + c] = entry.target[CATEGORY_KEYS[c]];
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

  // --- Nobet sayisi siniri ---
  // 62 nobet 8 doktora bolunmuyorsa kimse 7 veya 8'den baska bir sayi almamali.
  //
  // Bu sinir SERT DEGIL, cok guclu bir yumusak kisittir. Sert yapilirsa cozucu
  // cikmaza girebilir: acgozlu asama birini tavana dayadiginda o slotu baska
  // kimse alamaz ve tavlama da oradan cikamaz (her ara adim gecersiz olur).
  // Guclu ceza, ara adimlardan gecerek onarim yapmaya izin verirken cezanin
  // buyuklugu sayesinde kacinilabilir her durumda sinira uyulmasini saglar.
  // Yoneticinin elle girdigi aylik ust sinir ise sert kalir.
  const countCap = new Float64Array(nDoctors);
  const countFloor = new Float64Array(nDoctors);
  const EPS = 1e-9;
  doctorIds.forEach((id, d) => {
    countCap[d] = Math.ceil(expShifts[d] - EPS);
    countFloor[d] = Math.floor(expShifts[d] + EPS);
  });

  // --- Gecmis aylarin ritmi ---
  // "Hep bana denk geliyor" sorunu tek ay icinde gorulemez; olcu aylardir.
  // Gecmiste ortalamanin uzerinde belirli bir haftagunu ya da yogun hafta
  // yuku almis doktor icin ayni yonde nobet almak biraz daha pahalidir.
  const bias = rhythmBias(history, doctorIds);
  const slotWeekday = new Int8Array(nSlots);
  for (let si = 0; si < nSlots; si += 1) {
    const t = Date.parse(`${slots[si].date}T00:00:00Z`);
    slotWeekday[si] = Number.isNaN(t) ? 0 : new Date(t).getUTCDay();
  }

  // --- Haftalik yogunluk payi ---
  // Bir doktorun 7 gunluk herhangi bir pencerede kac nobeti olabilecegi.
  // Kisinin kendi aylik payindan turetilir: yarim zamanli calisan icin de
  // dogru olsun diye sabit bir sayi degil, oranin karsiligi kullanilir.
  const weekAllow = new Float64Array(nDoctors);
  doctorIds.forEach((id, d) => {
    weekAllow[d] = Math.max(1, Math.ceil((expShifts[d] * 7) / (totalDays || 1) - EPS));
  });

  // Gecmiste ortalamanin ustunde yogun hafta yasamis doktorun bu ayki yogun
  // hafta cezasi agirlasir; az yasamis olanınki hafifler. Yuk boylece
  // aylar icinde sirayla dolasir, hep ayni kiside kalmaz.
  const densityW = new Float64Array(nDoctors);
  doctorIds.forEach((id, d) => {
    densityW[d] = W.weekDensity * (1 + W.densityHistory * (bias.empty ? 0 : bias.dense.get(id)));
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
      // Gecmiste bu haftagununu fazla almissa +, az almissa - (yumusak yon verir).
      //
      // KISININ KENDI TERCIHI HER ZAMAN ONCE GELIR: o gun icin acik bir tercih
      // (istiyorum / istemiyorum) girilmisse ritim yonlendirmesi devre disi
      // kalir. Aksi halde ritim, tercihi sessizce iptal edebiliyordu — olcumde
      // "hep carsamba tuttum" gecmisi olan bir doktorun acikca istedigi dort
      // carsambanin dordu de elinden aliniyordu.
      if (!bias.empty && p2 !== 'want' && p2 !== 'avoid') {
        cost += W.weekdayHistory * bias.weekday.get(p.doctorId)[slotWeekday[si]];
      }
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

  const catW = new Float64Array(NCAT);
  for (let c = 0; c < NCAT; c += 1) catW[c] = (W.categoryWeights[CATEGORY_KEYS[c]] ?? 1) * W.fairness;
  // Hangi indeksler fiili mesai, hangileri bulunma saati
  const effIdx = EFFECTIVE_KEYS.map((k) => CATEGORY_KEYS.indexOf(k));
  const presIdx = PRESENCE_KEYS.map((k) => CATEGORY_KEYS.indexOf(k));

  // Statik uygunluk listesi (aday havuzlari)
  const eligibility = [];
  for (let si = 0; si < nSlots; si += 1) {
    const list = [];
    for (let d = 0; d < nDoctors; d += 1) if (staticOk[d * nSlots + si]) list.push(d);
    eligibility.push(list);
  }

  const ctx = {
    slots, days, totals, participants: active, doctorIds, doctorsById, indexById,
    nDoctors, nSlots, totalDays,
    slotStart, slotEnd, slotDay, slotIsNight, slotIsWeekend, slotCat, slotIndexById, dayIndexByIso,
    targets, expShifts, expNight, expWeekend, maxShifts, countCap, countFloor, weekAllow, densityW,
    staticOk, staticReasonCode, prefCost, wantHit, wantTotal,
    carryByDoctor, minRestMin, maxConsecutive, catW, effIdx, presIdx, NCAT,
    eligibility, availSets,
    rules: R, weights: W, weightMap, targetMap,
    ledger, weightSum: sumWeight,
    plan: null, timeVars: null,
    planCost: (state) => totalCost(ctx, state),
    syncPlan: () => {},
  };

  // --- Esnek saat modu ---
  // Giris/cikis saatleri karar degiskeniyse, saatler degistikce slotlarin
  // kategori dagilimi ve ayin toplamlari da degisir. Asagidaki syncPlan bu
  // turevleri (slot dizileri + hedefler) yeniden hesaplar.
  if (built && built.plan) {
    ctx.plan = built.plan;
    ctx.timeVars = timeVariables(built.plan, days);
    ctx.flexWeight = FLEXIBILITY_WEIGHTS[built.plan.policy.flexibility] ?? FLEXIBILITY_WEIGHTS.moderate;
    if (!Number.isFinite(ctx.flexWeight)) {
      ctx.timeVars = []; // 'off' — saatler tercih edilen degerde sabit
      ctx.flexWeight = 0;
    }

    // Yalnizca etkilenen gunler yeniden hesaplanir (fromDay..toDay verilirse).
    ctx.syncPlan = (fromDay, toDay) => {
      if (fromDay === undefined) refreshPlanSlots(built, calendarOpts);
      else refreshPlanWindow(built, calendarOpts, fromDay, toDay);

      const first = fromDay === undefined ? 0 : ctx.firstSlotOfDay[Math.max(0, fromDay - 1)] ?? 0;
      const last = fromDay === undefined ? nSlots : ctx.lastSlotOfDay[Math.min(totalDays - 1, toDay + 1)] ?? nSlots;
      for (let i = first; i < last; i += 1) {
        const slot = slots[i];
        ctx.slotStart[i] = slot.startMin;
        ctx.slotEnd[i] = slot.endMin;
        for (let c = 0; c < NCAT; c += 1) ctx.slotCat[i * NCAT + c] = slot.cat[CATEGORY_KEYS[c]] || 0;
      }
      // Toplamlar degisti -> herkesin hedefi yeniden hesaplanir
      const nextTargets = computeTargets(built.totals, weightMap, ledger, { maxCarryRatio: R.maxCarryRatio });
      ctx.targetMap = nextTargets;
      doctorIds.forEach((id, d) => {
        const entry = nextTargets.get(id);
        for (let c = 0; c < NCAT; c += 1) ctx.targets[d * NCAT + c] = entry.target[CATEGORY_KEYS[c]];
      });
      ctx.totals = built.totals;
    };

    // Tercih edilen saatlerden sapmanin bedeli maliyete eklenir; boylece
    // saatler yalnizca esitlik icin gerektigi kadar oynar.
    // Gun -> slot indeksi araliklari (yerel guncelleme icin)
    ctx.firstSlotOfDay = new Int32Array(totalDays).fill(nSlots);
    ctx.lastSlotOfDay = new Int32Array(totalDays);
    for (let i = 0; i < nSlots; i += 1) {
      const d = slotDay[i];
      if (i < ctx.firstSlotOfDay[d]) ctx.firstSlotOfDay[d] = i;
      if (i + 1 > ctx.lastSlotOfDay[d]) ctx.lastSlotOfDay[d] = i + 1;
    }

    ctx.planCost = (state) => totalCost(ctx, state) + ctx.flexWeight * planDeviationHours(ctx.plan, ctx.timeVars);
  }

  return ctx;
}

/** Plani tercih edilen saatlere dondurur (yeniden baslatmalar icin). */
function resetPlan(ctx) {
  for (let d = 0; d < ctx.plan.handover.length; d += 1) {
    ctx.plan.handover[d] = ctx.plan.policy.handover.preferred;
  }
  for (const dp of ctx.plan.days) {
    dp.pattern.vars.forEach((v, i) => { dp.times[i] = v.preferred; });
  }
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

// Sicak dongude yeniden kullanilan tamponlar (tahsis yapmamak icin)
const dayScratch = new Int32Array(64);
const catScratch = new Float64Array(NCAT);

/** Tek bir doktorun mevcut atamalarindan dogan maliyet. */
export function doctorCost(ctx, state, d) {
  const W = ctx.weights;
  const mine = state.byDoctor[d];
  const n = mine.length;

  const acc = catScratch;
  acc.fill(0);
  let night = 0;
  let weekend = 0;
  let pref = 0;
  let wantMatched = 0;
  const base = d * ctx.nSlots;
  const days = n <= dayScratch.length ? dayScratch : new Int32Array(n);

  for (let k = 0; k < n; k += 1) {
    const si = mine[k];
    const o = si * NCAT;
    for (let c = 0; c < NCAT; c += 1) acc[c] += ctx.slotCat[o + c];
    night += ctx.slotIsNight[si];
    weekend += ctx.slotIsWeekend[si];
    pref += ctx.prefCost[base + si];
    wantMatched += ctx.wantHit[base + si];
    days[k] = ctx.slotDay[si];
  }

  if (ctx.wantTotal[d] > wantMatched) pref += (ctx.wantTotal[d] - wantMatched) * W.wantMissed;

  const t = d * NCAT;
  let cost = 0;
  for (let c = 0; c < NCAT; c += 1) {
    const diff = acc[c] - ctx.targets[t + c];
    cost += ctx.catW[c] * diff * diff;
  }

  const ds = n - ctx.expShifts[d];
  const dn = night - ctx.expNight[d];
  const dw = weekend - ctx.expWeekend[d];
  cost += W.shiftCount * ds * ds + W.nightCount * dn * dn + W.weekendCount * dw * dw;

  // Toplamlar: kategori sapmalari ayni yonde birikmesin.
  // Fiili mesai toplami birincil, bulunma saati toplami ikincil.
  let effA = 0;
  let effT = 0;
  for (const c of ctx.effIdx) { effA += acc[c]; effT += ctx.targets[t + c]; }
  const de = effA - effT;
  cost += W.totalEffective * de * de;

  let presA = 0;
  let presT = 0;
  for (const c of ctx.presIdx) { presA += acc[c]; presT += ctx.targets[t + c]; }
  const dp = presA - presT;
  cost += W.totalHours * dp * dp;

  // Beklenen nobet sayisinin taban/tavan araligi disina cikmak agir cezali
  if (n < ctx.countFloor[d]) {
    const eksik = ctx.countFloor[d] - n;
    cost += W.shiftCountBand * eksik * eksik;
  } else if (n > ctx.countCap[d]) {
    const fazla = n - ctx.countCap[d];
    cost += W.shiftCountBand * fazla * fazla;
  }

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

  // Yogun hafta: 7 gunluk kayan pencerede adil paydan fazla nobet.
  //
  // NEDEN AYRI BIR TERIM
  // Yukaridaki "aralik" cezasi yalnizca KOMSU iki nobete bakar; haftanin
  // tamamini gormez. 8 doktorlu bir ayda 2-2-2 gunluk araliklar (bir haftada
  // dort nobet) ile 2-6-2 araliklari arasindaki fark buradan kucuk gorunur,
  // oysa yasanan yuk cok farklidir. Bu terim dogrudan "bir haftaya kac nobet
  // dustu" sorusunu cezalandirir.
  //
  // Pay kisinin kendi aylik payindan turetilir; boylece yarim zamanli calisan
  // haksiz yere cezalanmaz. Ceza kareseldir: 3 nobetlik bir hafta katlanilir,
  // 4 nobetlik hafta cok pahalidir.
  let w = 0;
  for (let i = 0; i < n; i += 1) {
    if (w < i) w = i;
    while (w < n && days[w] < days[i] + 7) w += 1;
    const fazla = (w - i) - ctx.weekAllow[d];
    if (fazla > 0) cost += ctx.densityW[d] * fazla * fazla;
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

/**
 * Saat degiskeni hamlesi: bir gunun devir/gelis/cikis saatini oynatir.
 *
 * Saatler degisince slotlarin kategori dagilimi ve ayin toplamlari — dolayisiyla
 * herkesin hedefi — degisir. Bu yuzden hamle sonrasi tam maliyet yeniden
 * hesaplanir. Atamalarin sert kurallara uygunlugu da yeniden denetlenir:
 * saat oynatmak dinlenme suresini kisaltmis olabilir.
 */
function timeMove(ctx, state, rng, temp) {
  const vars = ctx.timeVars;
  if (!vars || !vars.length) return;

  const v = vars[(rng() * vars.length) | 0];
  const step = ctx.plan.policy.stepMinutes;
  const current = readVariable(ctx.plan, v);

  // Kucuk bir adim ya da alan icinde rastgele bir deger
  let next;
  if (rng() < 0.7) {
    next = current + (rng() < 0.5 ? -step : step);
  } else {
    const slots = Math.floor((v.max - v.min) / step);
    next = v.min + ((rng() * (slots + 1)) | 0) * step;
  }
  if (next < v.min || next > v.max || next === current) return;

  const before = ctx.planCost(state);
  writeVariable(ctx.plan, v, next);

  const touched = affectedDays(v.kind, v.day, ctx.totalDays);
  let ok = true;
  for (const d of touched) if (!isDayValid(ctx.plan, ctx.days, d)) { ok = false; break; }
  if (v.kind === 'handover' && v.day === ctx.totalDays) ok = ok && isDayValid(ctx.plan, ctx.days, ctx.totalDays - 1);
  if (!ok) {
    writeVariable(ctx.plan, v, current);
    return;
  }

  const lo = Math.max(0, Math.min(...touched, v.day) - 1);
  const hi = Math.min(ctx.totalDays - 1, Math.max(...touched, v.day));
  ctx.syncPlan(lo, hi);

  if (!allAssignmentsFeasible(ctx, state)) {
    writeVariable(ctx.plan, v, current);
    ctx.syncPlan(lo, hi);
    return;
  }

  const after = ctx.planCost(state);
  if (after <= before || rng() < Math.exp(-(after - before) / temp)) return;

  writeVariable(ctx.plan, v, current);
  ctx.syncPlan(lo, hi);
}

/** Mevcut atamalarin tamami sert kurallara uyuyor mu. */
function allAssignmentsFeasible(ctx, state) {
  for (let d = 0; d < ctx.nDoctors; d += 1) {
    const mine = state.byDoctor[d];
    for (let i = 0; i < mine.length; i += 1) {
      const si = mine[i];
      const start = ctx.slotStart[si];
      const end = ctx.slotEnd[si];
      for (let j = i + 1; j < mine.length; j += 1) {
        const o = mine[j];
        const os = ctx.slotStart[o];
        const oe = ctx.slotEnd[o];
        if (start < oe && os < end) return false;
        const gap = start >= oe ? start - oe : os - end;
        if (gap < ctx.minRestMin) return false;
      }
      const carry = ctx.carryByDoctor[d];
      for (let k = 0; k < carry.length; k += 1) {
        const c = carry[k];
        if (start < c.end && c.start < end) return false;
        const gap = start >= c.end ? start - c.end : c.start - end;
        if (gap < ctx.minRestMin) return false;
      }
    }
  }
  return true;
}

/** Tavlama benzetimi ile yerel arama. */
function anneal(ctx, state, rng, movable, opts) {
  if (movable.length < 2) return;
  const iterations = Math.max(0, opts.iterations | 0);
  const t0 = Math.max(1e-6, opts.startTemp);
  const t1 = Math.max(1e-6, opts.endTemp);
  const decay = iterations > 0 ? (t1 / t0) ** (1 / iterations) : 1;
  let temp = t0;
  const timeShare = ctx.timeVars?.length ? (opts.timeMoveShare ?? 0.25) : 0;

  for (let it = 0; it < iterations; it += 1) {
    temp *= decay;

    if (timeShare > 0 && rng() < timeShare) {
      timeMove(ctx, state, rng, temp);
      continue;
    }

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
  let bestPlan = null;

  const restarts = Math.max(1, opt.restarts | 0);
  for (let r = 0; r < restarts; r += 1) {
    const rng = makeRng(seed + r * 7919);
    // Her yeniden baslatma tercih edilen saatlerden baslar.
    if (ctx.plan) {
      resetPlan(ctx);
      ctx.syncPlan();
    }
    const state = createState(ctx);
    for (const [si, d] of fixedPairs) place(ctx, state, si, d);
    // Acgozlu asamada gevsetilen kurallar cogunlukla tavlama sirasinda
    // onarilir; bu yuzden uyarilar oradan degil, TESLIM EDILEN cozumden
    // uretilir (asagidaki auditState). Aksi halde temiz bir cizelge icin
    // gecersiz uyarilar gosterilirdi.
    greedyFill(ctx, state, rng, movable);
    anneal(ctx, state, rng, movable, opt);
    const cost = ctx.planCost(state);
    if (cost < bestCost) {
      bestCost = cost;
      best = state;
      bestPlan = ctx.plan ? clonePlan(ctx.plan) : null;
    }
  }

  // En iyi plani geri yukle ki cikti ile maliyet tutarli olsun.
  if (bestPlan) {
    ctx.plan.handover.set(bestPlan.handover);
    bestPlan.days.forEach((dp, i) => { ctx.plan.days[i].times.set(dp.times); });
    ctx.syncPlan();
  }

  const assignments = {};
  for (let si = 0; si < ctx.nSlots; si += 1) {
    const d = best.assign[si];
    assignments[ctx.slots[si].id] = d >= 0 ? ctx.doctorIds[d] : null;
  }

  const finalWarnings = [...fixedWarnings, ...auditState(ctx, best, fixedSlots)];
  for (let si = 0; si < ctx.nSlots; si += 1) {
    if (best.assign[si] >= 0) continue;
    finalWarnings.push({
      level: 'error',
      slotId: ctx.slots[si].id,
      message: `${ctx.slots[si].date} ${ctx.slots[si].label}: atanabilecek müsait doktor yok.`,
    });
  }
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
    for (const c of ctx.presIdx) sum += ctx.targets[d * NCAT + c];
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
