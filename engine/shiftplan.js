/**
 * Gunluk vardiya iskeleti — giris/cikis saatlerini ARACIN KENDISI secer.
 *
 * NEDEN
 * -----
 * Saatler sabitlenirse (orn. hep 09:00–24:00 ve 15:00–09:00) her nobetin
 * dort etikete katkisi da sabitlenir. O zaman bir doktorun "haftaici
 * paylasimli" toplami ancak 9'un katlari olabilir; hedef 47,3 sa ise
 * tutturulamaz ve esitlik yapisal olarak imkansiz hale gelir.
 *
 * Bu yuzden devir ve gelis/cikis saatleri birer KARAR DEGISKENIDIR.
 * Yonetici makul araliklari ve tercih edilen saati tanimlar; arac bu
 * araliklar icinde gun gun oynayarak dort etiketi esitler.
 *
 * MODEL
 * -----
 * Bir gunde k doktor gorev alir. Gunun iskeleti su degiskenlerle tanimlanir:
 *
 *   h[d]        sabah devri — gunduz ekibi gelir, gece ekibi cikar
 *   arrivals[i] i+2'nci vardiyanin gelis saati
 *   exits[i]    i+1'inci vardiyanin cikis saati
 *
 * Vardiyalar:
 *   1. vardiya : [ h[d]          , exits[0]        ]
 *   i. vardiya : [ arrivals[i-2] , exits[i-1]      ]
 *   k. vardiya : [ arrivals[k-2] , h[d+1] + 24 sa  ]   (ertesi sabaha tasar)
 *
 * Son vardiya ertesi gunun sabah devrine kadar surdugu icin 24 saat
 * kesintisiz kapanir; ardisik vardiyalar arasindaki kesisim de paylasimli
 * saatleri olusturur.
 *
 * Ornek (varsayilan tercih degerleri): h=09:00, gelis=15:00, cikis=24:00
 *   Gunduz 09:00–24:00, Gece 15:00–09:00(+1), kesisim 15:00–24:00.
 * Yani kullanicinin tarif ettigi duzen, aracin cikis noktasidir; arac
 * yalnizca esitlik icin gerektigi kadar bu saatlerden sapar.
 */

import { MIN_PER_DAY, formatRange, parseTime } from './time.js';
import { DEFAULT_PATTERNS, normalizePatterns, patternIntervals, validatePattern } from './patterns.js';

export const DEFAULT_SHIFT_POLICY = {
  mode: 'flexible',
  stepMinutes: 30,
  /** Tercih edilen saatten sapmanin bedeli: kapali / az / olculu / serbest */
  flexibility: 'moderate',
  minShiftHours: 8,
  maxShiftHours: 24,
  /** Sabah devri — gunun dongusunun basladigi an */
  handover: { min: '08:00', max: '10:00', preferred: '09:00' },
  /** Kullanilabilir gun desenleri (bkz. patterns.js) */
  patterns: DEFAULT_PATTERNS,
  /** Gun tipine gore varsayilan desen */
  defaultPattern: { weekday: 'ikili-klasik', weekend: 'ikili-klasik' },
};

export const FLEXIBILITY_WEIGHTS = {
  off: Infinity,   // saatler tercih edilen degerde sabit kalir
  tight: 3.0,
  moderate: 0.6,
  free: 0.08,
};

function win(w, fallbackPreferred) {
  const min = parseTime(w?.min ?? fallbackPreferred);
  const max = parseTime(w?.max ?? fallbackPreferred);
  const preferred = parseTime(w?.preferred ?? fallbackPreferred);
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
    preferred: Math.min(Math.max(preferred, Math.min(min, max)), Math.max(min, max)),
  };
}

/** Ayarlari sayisal, dogrulanmis bicime cevirir. */
export function normalizePolicy(policy = {}) {
  // Zaten normalize edilmis politika tekrar isleme sokulmaz.
  if (policy && policy.patternById instanceof Map) return policy;
  const p = { ...DEFAULT_SHIFT_POLICY, ...policy };
  const patterns = normalizePatterns(p.patterns);
  const byId = new Map(patterns.map((x) => [x.id, x]));
  const enabled = patterns.filter((x) => x.enabled);
  const fallback = enabled[0] || patterns[0];

  const pick = (key) => {
    const wanted = p.defaultPattern?.[key];
    const found = wanted && byId.get(wanted);
    return found && found.enabled ? found.id : fallback?.id;
  };

  return {
    mode: p.mode === 'fixed' ? 'fixed' : 'flexible',
    stepMinutes: Math.max(5, Math.round(Number(p.stepMinutes) || 30)),
    flexibility: FLEXIBILITY_WEIGHTS[p.flexibility] !== undefined ? p.flexibility : 'moderate',
    minShiftHours: Number(p.minShiftHours) > 0 ? Number(p.minShiftHours) : 8,
    maxShiftHours: Number(p.maxShiftHours) > 0 ? Number(p.maxShiftHours) : 24,
    handover: win(p.handover, '09:00'),
    patterns,
    patternById: byId,
    enabledPatterns: enabled,
    defaultPattern: { weekday: pick('weekday'), weekend: pick('weekend') },
  };
}

/** Bir gunun kullanacagi desen: ay kaydindaki secim, yoksa varsayilan. */
export function patternForDay(policy, day, dayPatterns = {}) {
  const wanted = dayPatterns?.[day.iso];
  const found = wanted && policy.patternById.get(wanted);
  if (found) return found;
  const fallbackId = policy.defaultPattern[day.type === 'weekend' ? 'weekend' : 'weekday'];
  return policy.patternById.get(fallbackId) || policy.patterns[0];
}

/** Ayarlarin mantikli olup olmadigini denetler. */
export function validatePolicy(policy) {
  const P = normalizePolicy(policy);
  const problems = [];

  if (P.handover.min < parseTime('05:00') || P.handover.max > parseTime('12:00')) {
    problems.push({
      level: 'warn',
      message: `Sabah devri ${formatRange(P.handover.min, P.handover.max)} — alışılmadık bir aralık.`,
    });
  }
  if (!P.enabledPatterns.length) {
    problems.push({ level: 'error', message: 'En az bir gün deseni açık olmalı.' });
  }
  for (const pattern of P.enabledPatterns) {
    problems.push(...validatePattern(pattern, {
      handover: P.handover.preferred,
      minShiftHours: P.minShiftHours,
      maxShiftHours: P.maxShiftHours,
    }));
  }
  return problems;
}

const round = (value, step) => Math.round(value / step) * step;

/**
 * Baslangic plani: her gun icin desen secimi (ay kaydindan ya da varsayilan)
 * ve tercih edilen saatler.
 */
export function createPlan(policy, days, dayPatterns = {}) {
  const P = policy.patternById ? policy : normalizePolicy(policy);
  const n = days.length;

  const handover = new Int32Array(n + 1);
  for (let d = 0; d <= n; d += 1) handover[d] = P.handover.preferred;

  const dayPlans = days.map((day) => {
    const pattern = patternForDay(P, day, dayPatterns);
    return {
      patternId: pattern.id,
      pattern,
      k: pattern.shifts.length,
      times: Int32Array.from(pattern.vars.map((v) => v.preferred)),
    };
  });
  return { handover, days: dayPlans, policy: P };
}

export function clonePlan(plan) {
  return {
    handover: Int32Array.from(plan.handover),
    days: plan.days.map((d) => ({
      patternId: d.patternId,
      pattern: d.pattern,
      k: d.k,
      times: Int32Array.from(d.times),
    })),
    policy: plan.policy,
  };
}

/** Bir gunun degiskenleri gecerli mi (pencere sinirlari + vardiya sureleri). */
export function isDayValid(plan, days, d) {
  const P = plan.policy;
  const n = days.length;
  if (d < 0 || d >= n) return true;
  const dp = plan.days[d];
  const h = plan.handover[d];
  if (h < P.handover.min || h > P.handover.max) return false;

  for (let i = 0; i < dp.pattern.vars.length; i += 1) {
    const v = dp.pattern.vars[i];
    if (dp.times[i] < v.min || dp.times[i] > v.max) return false;
  }

  const intervals = patternIntervals(dp.pattern, h, plan.handover[d + 1], dp.times);
  const minLen = P.minShiftHours * 60;
  const maxLen = P.maxShiftHours * 60;
  for (const it of intervals) {
    const len = it.end - it.start;
    if (len < minLen || len > maxLen) return false;
  }
  return true;
}

/** h[d] degisimi hem d-1'inci hem d'inci gunu etkiler. */
export function affectedDays(kind, dayIndex, total) {
  if (kind === 'handover') return [dayIndex - 1, dayIndex].filter((d) => d >= 0 && d < total);
  return [dayIndex];
}

/** Optimize edilebilir saat degiskenleri. */
export function timeVariables(plan, days) {
  const P = plan.policy;
  const out = [];
  const n = days.length;

  // Ayin ILK ve SON devir saati sabit tutulur.
  // Aksi halde ayin kapsadigi toplam sure 24 x gun sayisindan sapar
  // (toplam = 24n + son devir - ilk devir) ve "fiili mesai havuzu sabittir"
  // ozelligi bozulur. Bu ozellik hem adalet hesabinin hem de aciklanabilirligin
  // temeli oldugu icin iki uc gun degisken birakilmaz.
  for (let d = 1; d < n; d += 1) {
    if (P.handover.min !== P.handover.max) {
      out.push({ kind: 'handover', day: d, index: 0, ...P.handover });
    }
  }
  for (let d = 0; d < n; d += 1) {
    plan.days[d].pattern.vars.forEach((v, i) => {
      if (v.min !== v.max) out.push({ kind: 'time', day: d, index: i, min: v.min, max: v.max, preferred: v.preferred });
    });
  }
  return out;
}

export function readVariable(plan, v) {
  if (v.kind === 'handover') return plan.handover[v.day];
  return plan.days[v.day].times[v.index];
}

export function writeVariable(plan, v, value) {
  if (v.kind === 'handover') plan.handover[v.day] = value;
  else plan.days[v.day].times[v.index] = value;
}

/** Tercih edilen saatten sapmanin toplam bedeli (saat cinsinden mutlak sapma). */
export function planDeviationHours(plan, vars) {
  let sum = 0;
  for (let i = 0; i < vars.length; i += 1) {
    sum += Math.abs(readVariable(plan, vars[i]) - vars[i].preferred) / 60;
  }
  return sum;
}

/**
 * Plani zaman araliklarina cevirir. Ay basindan itibaren dakika cinsinden.
 * Kesisim hesabi icin komsu aylarin sinir gunleri de eklenir.
 */
export function planIntervals(plan, days) {
  const P = plan.policy;
  const n = days.length;
  const out = [];

  const emit = (dayIndex, iso, dayType, pattern, h, hNext, times, inMonth) => {
    const intervals = patternIntervals(pattern, h, hNext, times);
    intervals.forEach((it, i) => {
      out.push({
        id: `${iso}#v${i + 1}`,
        date: iso,
        dayIndex,
        dayType,
        templateId: `v${i + 1}`,
        patternId: pattern.id,
        patternName: pattern.name,
        label: it.label,
        startMin: dayIndex * MIN_PER_DAY + it.start,
        endMin: dayIndex * MIN_PER_DAY + it.end,
        inMonth,
      });
    });
  };

  // Onceki ayin son gunu (yalnizca kesisim hesabi icin)
  const first = plan.days[0];
  emit(-1, days[0].prevIso, days[0].prevType || 'weekday', first.pattern,
    P.handover.preferred, plan.handover[0],
    Int32Array.from(first.pattern.vars.map((v) => v.preferred)), false);

  for (let d = 0; d < n; d += 1) {
    const dp = plan.days[d];
    emit(d, days[d].iso, days[d].type, dp.pattern, plan.handover[d], plan.handover[d + 1], dp.times, true);
  }

  // Sonraki ayin ilk gunu
  const last = plan.days[n - 1];
  emit(n, days[n - 1].nextIso, days[n - 1].nextType || 'weekday', last.pattern,
    plan.handover[n], P.handover.preferred,
    Int32Array.from(last.pattern.vars.map((v) => v.preferred)), false);

  return out;
}

export { round };
