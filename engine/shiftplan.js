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

export const DEFAULT_SHIFT_POLICY = {
  mode: 'flexible',
  stepMinutes: 30,
  /** Tercih edilen saatten sapmanin bedeli: kapali / olculu / serbest */
  flexibility: 'moderate',
  minShiftHours: 8,
  maxShiftHours: 24,
  weekday: {
    doctorsPerDay: 2,
    labels: ['Gündüz', 'Akşam/Gece'],
    handover: { min: '08:00', max: '10:00', preferred: '09:00' },
    arrivals: [{ min: '14:00', max: '17:00', preferred: '15:00' }],
    exits: [{ min: '22:00', max: '24:00', preferred: '24:00' }],
  },
  weekend: {
    doctorsPerDay: 2,
    labels: ['Gündüz', 'Akşam/Gece'],
    handover: { min: '08:00', max: '10:00', preferred: '09:00' },
    arrivals: [{ min: '14:00', max: '17:00', preferred: '15:00' }],
    exits: [{ min: '22:00', max: '24:00', preferred: '24:00' }],
  },
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
  const p = { ...DEFAULT_SHIFT_POLICY, ...policy };
  const step = Math.max(5, Math.round(Number(p.stepMinutes) || 30));

  const side = (key) => {
    const raw = { ...DEFAULT_SHIFT_POLICY[key], ...(policy?.[key] || {}) };
    const k = Math.max(1, Math.round(Number(raw.doctorsPerDay) || 2));
    const arrivals = [];
    const exits = [];
    for (let i = 0; i < k - 1; i += 1) {
      arrivals.push(win(raw.arrivals?.[i], raw.arrivals?.[0]?.preferred ?? '15:00'));
      exits.push(win(raw.exits?.[i], raw.exits?.[0]?.preferred ?? '24:00'));
    }
    const labels = [];
    for (let i = 0; i < k; i += 1) {
      labels.push(raw.labels?.[i] || (i === 0 ? 'Gündüz' : i === k - 1 ? 'Akşam/Gece' : `Vardiya ${i + 1}`));
    }
    return { doctorsPerDay: k, labels, handover: win(raw.handover, '09:00'), arrivals, exits };
  };

  return {
    mode: p.mode === 'fixed' ? 'fixed' : 'flexible',
    stepMinutes: step,
    flexibility: FLEXIBILITY_WEIGHTS[p.flexibility] !== undefined ? p.flexibility : 'moderate',
    minShiftHours: Number(p.minShiftHours) > 0 ? Number(p.minShiftHours) : 8,
    maxShiftHours: Number(p.maxShiftHours) > 0 ? Number(p.maxShiftHours) : 24,
    weekday: side('weekday'),
    weekend: side('weekend'),
  };
}

/** Ayarlarin mantikli olup olmadigini denetler. */
export function validatePolicy(policy) {
  const P = normalizePolicy(policy);
  const problems = [];
  const label = { weekday: 'Hafta içi', weekend: 'Hafta sonu' };

  for (const key of ['weekday', 'weekend']) {
    const s = P[key];
    const name = label[key];

    if (s.handover.min < parseTime('05:00') || s.handover.max > parseTime('12:00')) {
      problems.push({
        level: 'warn',
        message: `${name}: sabah devri ${formatRange(s.handover.min, s.handover.max)} — alışılmadık bir aralık.`,
      });
    }
    for (let i = 0; i < s.arrivals.length; i += 1) {
      const a = s.arrivals[i];
      const e = s.exits[i];
      if (a.min < parseTime('06:00') || a.max > parseTime('22:00')) {
        problems.push({
          level: 'warn',
          message: `${name}: ${i + 2}. vardiyanın geliş aralığı ${formatRange(a.min, a.max)} — gece yarısına yakın girişler mantıklı değildir.`,
        });
      }
      if (e.min < a.min) {
        problems.push({
          level: 'error',
          message: `${name}: ${i + 1}. vardiyanın çıkışı, ${i + 2}. vardiyanın gelişinden önce olabiliyor — bu saatlerde serviste doktor kalmaz.`,
        });
      }
      if (i > 0 && a.min < s.arrivals[i - 1].min) {
        problems.push({
          level: 'error',
          message: `${name}: vardiyaların geliş saatleri sıralı olmalı.`,
        });
      }
    }

    // En kisa/uzun vardiya suresi, en olumsuz kombinasyonla denetlenir.
    const k = s.doctorsPerDay;
    if (k >= 2) {
      const firstMin = (s.exits[0].min - s.handover.max) / 60;
      const firstMax = (s.exits[0].max - s.handover.min) / 60;
      const lastMin = (MIN_PER_DAY + s.handover.min - s.arrivals[k - 2].max) / 60;
      const lastMax = (MIN_PER_DAY + s.handover.max - s.arrivals[k - 2].min) / 60;
      for (const [len, what] of [[firstMin, 'en kısa'], [firstMax, 'en uzun']]) {
        if (len < P.minShiftHours) problems.push({ level: 'warn', message: `${name}: 1. vardiya ${what} hâlinde ${len} saat — alt sınır ${P.minShiftHours} saat.` });
        if (len > P.maxShiftHours) problems.push({ level: 'warn', message: `${name}: 1. vardiya ${what} hâlinde ${len} saat — üst sınır ${P.maxShiftHours} saat.` });
      }
      for (const [len, what] of [[lastMin, 'en kısa'], [lastMax, 'en uzun']]) {
        if (len < P.minShiftHours) problems.push({ level: 'warn', message: `${name}: son vardiya ${what} hâlinde ${len} saat — alt sınır ${P.minShiftHours} saat.` });
        if (len > P.maxShiftHours) problems.push({ level: 'warn', message: `${name}: son vardiya ${what} hâlinde ${len} saat — üst sınır ${P.maxShiftHours} saat.` });
      }
    }
  }
  return problems;
}

const round = (value, step) => Math.round(value / step) * step;

/** Tercih edilen saatlerden olusan baslangic planini uretir. */
export function createPlan(policy, days) {
  const P = normalizePolicy(policy);
  const n = days.length;
  const sideOf = (i) => (days[Math.min(Math.max(i, 0), n - 1)].type === 'weekend' ? P.weekend : P.weekday);

  const handover = new Int32Array(n + 1);
  for (let d = 0; d <= n; d += 1) handover[d] = sideOf(d).handover.preferred;

  const dayPlans = [];
  for (let d = 0; d < n; d += 1) {
    const s = sideOf(d);
    dayPlans.push({
      k: s.doctorsPerDay,
      arrivals: Int32Array.from(s.arrivals.map((a) => a.preferred)),
      exits: Int32Array.from(s.exits.map((e) => e.preferred)),
    });
  }
  return { handover, days: dayPlans, policy: P };
}

export function clonePlan(plan) {
  return {
    handover: Int32Array.from(plan.handover),
    days: plan.days.map((d) => ({
      k: d.k,
      arrivals: Int32Array.from(d.arrivals),
      exits: Int32Array.from(d.exits),
    })),
    policy: plan.policy,
  };
}

/** Bir gunun degiskenlerinin gecerli olup olmadigi. */
export function isDayValid(plan, days, d) {
  const P = plan.policy;
  const n = days.length;
  if (d < 0 || d >= n) return true;
  const side = days[d].type === 'weekend' ? P.weekend : P.weekday;
  const dp = plan.days[d];
  const k = dp.k;
  const h = plan.handover[d];
  const hNext = plan.handover[d + 1];

  if (h < side.handover.min || h > side.handover.max) return false;

  let prevStart = h;
  let prevEnd = null;
  for (let i = 0; i < k - 1; i += 1) {
    const a = dp.arrivals[i];
    const e = dp.exits[i];
    if (a < side.arrivals[i].min || a > side.arrivals[i].max) return false;
    if (e < side.exits[i].min || e > side.exits[i].max) return false;
    if (a < prevStart) return false;          // gelisler sirali
    if (e < a) return false;                  // cikis, sonraki gelisten once olamaz (bosluk olur)
    if (prevEnd !== null && e < prevEnd) return false; // cikislar sirali
    prevStart = a;
    prevEnd = e;
  }

  // Vardiya sureleri
  const minLen = P.minShiftHours * 60;
  const maxLen = P.maxShiftHours * 60;
  for (let i = 0; i < k; i += 1) {
    const start = i === 0 ? h : dp.arrivals[i - 1];
    const end = i === k - 1 ? MIN_PER_DAY + hNext : dp.exits[i];
    const len = end - start;
    if (len < minLen || len > maxLen) return false;
  }
  return true;
}

/** h[d] degisimi hem d-1'inci hem d'inci gunu etkiler. */
export function affectedDays(kind, dayIndex, total) {
  if (kind === 'handover') return [dayIndex - 1, dayIndex].filter((d) => d >= 0 && d < total);
  return [dayIndex];
}

/**
 * Optimize edilebilir saat degiskenlerinin listesi.
 * Her degisken: { kind, day, index, min, max, preferred }
 */
export function timeVariables(plan, days) {
  const P = plan.policy;
  const out = [];
  const n = days.length;
  const sideOf = (i) => (days[Math.min(Math.max(i, 0), n - 1)].type === 'weekend' ? P.weekend : P.weekday);

  for (let d = 0; d <= n; d += 1) {
    const s = sideOf(d);
    if (s.handover.min !== s.handover.max) {
      out.push({ kind: 'handover', day: d, index: 0, ...s.handover });
    }
  }
  for (let d = 0; d < n; d += 1) {
    const s = sideOf(d);
    for (let i = 0; i < plan.days[d].k - 1; i += 1) {
      if (s.arrivals[i].min !== s.arrivals[i].max) out.push({ kind: 'arrival', day: d, index: i, ...s.arrivals[i] });
      if (s.exits[i].min !== s.exits[i].max) out.push({ kind: 'exit', day: d, index: i, ...s.exits[i] });
    }
  }
  return out;
}

export function readVariable(plan, v) {
  if (v.kind === 'handover') return plan.handover[v.day];
  if (v.kind === 'arrival') return plan.days[v.day].arrivals[v.index];
  return plan.days[v.day].exits[v.index];
}

export function writeVariable(plan, v, value) {
  if (v.kind === 'handover') plan.handover[v.day] = value;
  else if (v.kind === 'arrival') plan.days[v.day].arrivals[v.index] = value;
  else plan.days[v.day].exits[v.index] = value;
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
 * Plani, ay icindeki (ve kesisim hesabi icin komsu gunlerdeki) zaman
 * araliklarina cevirir. Donen her ogede baslangic/bitis, ayin basindan
 * itibaren dakika cinsindendir.
 */
export function planIntervals(plan, days) {
  const P = plan.policy;
  const n = days.length;
  const out = [];
  const sideOf = (i) => (days[Math.min(Math.max(i, 0), n - 1)].type === 'weekend' ? P.weekend : P.weekday);

  const emit = (dayIndex, iso, dayType, k, h, hNext, arrivals, exits, labels, inMonth) => {
    for (let i = 0; i < k; i += 1) {
      const start = dayIndex * MIN_PER_DAY + (i === 0 ? h : arrivals[i - 1]);
      const end = i === k - 1
        ? (dayIndex + 1) * MIN_PER_DAY + hNext
        : dayIndex * MIN_PER_DAY + exits[i];
      out.push({
        id: `${iso}#v${i + 1}`,
        date: iso,
        dayIndex,
        dayType,
        templateId: `v${i + 1}`,
        label: labels[i],
        startMin: start,
        endMin: end,
        inMonth,
      });
    }
  };

  // Onceki ayin son gunu (yalnizca kesisim hesabi icin)
  {
    const s = sideOf(0);
    emit(-1, days[0].prevIso, days[0].prevType || 'weekday', s.doctorsPerDay,
      s.handover.preferred, plan.handover[0],
      s.arrivals.map((a) => a.preferred), s.exits.map((e) => e.preferred), s.labels, false);
  }

  for (let d = 0; d < n; d += 1) {
    const s = sideOf(d);
    const dp = plan.days[d];
    emit(d, days[d].iso, days[d].type, dp.k, plan.handover[d], plan.handover[d + 1],
      dp.arrivals, dp.exits, s.labels, true);
  }

  // Sonraki ayin ilk gunu (yalnizca kesisim hesabi icin)
  {
    const s = sideOf(n - 1);
    emit(n, days[n - 1].nextIso, days[n - 1].nextType || 'weekday', s.doctorsPerDay,
      plan.handover[n], s.handover.preferred,
      s.arrivals.map((a) => a.preferred), s.exits.map((e) => e.preferred), s.labels, false);
  }

  return out;
}

export { round };
