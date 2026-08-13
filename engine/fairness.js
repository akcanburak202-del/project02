/**
 * Adalet hesabi: musaitlik agirliklari, hedef saatler, devir defteri.
 *
 * Bir doktorun ay icindeki hedefi, o ay hastanede bulunabildigi gun sayisiyla
 * orantilidir. Ayin 15'ine kadar gorev alacak bir doktor, ayin tamamini
 * calisan bir doktorun yaklasik yarisi kadar saat alir.
 *
 * Devir defteri (ledger), gecmis aylarda hedefin uzerinde/altinda kalan
 * saatleri kategori bazinda biriktirir. Yeni ayin hedefi bu birikim kadar
 * ters yonde kaydirilir; boylece "bu ay tam esit dagitilamadi" durumu sonraki
 * aylarda kendiliginden dengelenir.
 */

import { CATEGORY_KEYS, addVector, emptyCategoryVector, vectorTotal } from './slots.js';

/** Bir katilimcinin ay icinde musait oldugu gunleri (ISO) dondurur. */
export function availableDates(participant, days, preferences = {}) {
  const set = new Set();
  const from = participant.from || null;
  const to = participant.to || null;
  const off = new Set(participant.offDates || []);
  for (const [iso, value] of Object.entries(preferences || {})) {
    if (value === 'off') off.add(iso);
  }
  for (const day of days) {
    if (from && day.iso < from) continue;
    if (to && day.iso > to) continue;
    if (off.has(day.iso)) continue;
    set.add(day.iso);
  }
  return set;
}

/**
 * Doktor basina agirlik: musait gun orani x yuk katsayisi.
 * Yuk katsayisi (loadFactor) yarim zamanli calisanlar icin kullanilir.
 */
export function computeWeights(participants, days, preferencesByDoctor = {}) {
  const totalDays = days.length || 1;
  const out = new Map();
  for (const p of participants) {
    const avail = availableDates(p, days, preferencesByDoctor[p.doctorId]);
    const load = Number.isFinite(p.loadFactor) && p.loadFactor > 0 ? p.loadFactor : 1;
    out.set(p.doctorId, {
      doctorId: p.doctorId,
      available: avail,
      availableDays: avail.size,
      loadFactor: load,
      weight: (avail.size / totalDays) * load,
    });
  }
  return out;
}

function clamp(value, limit) {
  if (limit <= 0) return 0;
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Kategori bazli hedef saatleri hesaplar.
 *
 * Iki deger uretilir:
 *   fair   -> devir dikkate alinmadan, sadece musaitlik oranina gore pay
 *   target -> devir defteriyle kaydirilmis, bu ay hedeflenecek deger
 *
 * Devir defteri her zaman "fair" degerine gore guncellenir; boylece bir ay
 * bilerek az/cok verilen saatler defterden dusulur ve borc kapanir.
 *
 * @param {object} totals    Ayin toplam kategori saatleri
 * @param {Map} weights      computeWeights ciktisi
 * @param {object} ledger    { doctorId: { wdSolo, ... } } birikmis fazla/eksik
 * @param {object} opts      { maxCarryRatio }
 */
export function computeTargets(totals, weights, ledger = {}, opts = {}) {
  const maxCarryRatio = Number.isFinite(opts.maxCarryRatio) ? opts.maxCarryRatio : 0.4;
  const ids = [...weights.keys()];
  const sumWeight = ids.reduce((s, id) => s + weights.get(id).weight, 0);
  const out = new Map();
  for (const id of ids) out.set(id, { fair: emptyCategoryVector(), target: emptyCategoryVector() });

  if (sumWeight <= 0) return out;

  for (const key of CATEGORY_KEYS) {
    const totalHours = totals[key] || 0;
    for (const id of ids) {
      out.get(id).fair[key] = (totalHours * weights.get(id).weight) / sumWeight;
    }
    // Devir duzeltmesi: gecmiste fazla calisan bu ay daha az alir.
    let residual = 0;
    const adjusted = new Map();
    for (const id of ids) {
      const carry = Number(ledger?.[id]?.[key] || 0);
      const limit = out.get(id).fair[key] * maxCarryRatio;
      const delta = -clamp(carry, limit);
      adjusted.set(id, out.get(id).fair[key] + delta);
      residual += delta;
    }
    // Toplam korunmali: kaydirmadan artan/eksilen kisim agirliklara gore geri dagitilir.
    for (const id of ids) {
      const share = weights.get(id).weight / sumWeight;
      out.get(id).target[key] = Math.max(0, adjusted.get(id) - residual * share);
    }
    const sum = ids.reduce((s, id) => s + out.get(id).target[key], 0);
    if (sum > 0 && Math.abs(sum - totalHours) > 1e-9) {
      const factor = totalHours / sum;
      for (const id of ids) out.get(id).target[key] *= factor;
    }
  }
  return out;
}

/** Atamalardan doktor bazli gercek saatleri ve sayaclari cikarir. */
export function computeActuals(assignments, slots, doctorIds = []) {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const out = new Map();
  const ensure = (id) => {
    if (!out.has(id)) {
      out.set(id, {
        doctorId: id,
        cat: emptyCategoryVector(),
        totalHours: 0,
        shifts: 0,
        nightShifts: 0,
        weekendShifts: 0,
        dates: [],
      });
    }
    return out.get(id);
  };
  for (const id of doctorIds) ensure(id);

  for (const [slotId, doctorId] of Object.entries(assignments || {})) {
    if (!doctorId) continue;
    const slot = slotById.get(slotId);
    if (!slot) continue;
    const row = ensure(doctorId);
    addVector(row.cat, slot.cat);
    row.totalHours += slot.hours;
    row.shifts += 1;
    if (slot.isNight) row.nightShifts += 1;
    if (slot.dayType === 'weekend') row.weekendShifts += 1;
    row.dates.push(slot.date);
  }
  for (const row of out.values()) row.dates.sort();
  return out;
}

/**
 * Kullaniciya gosterilecek denge tablosunu uretir.
 * Her satirda gercek, hedef ve sapma (gercek - hedef) yer alir.
 */
export function buildBalanceReport({ totals, weights, targets, actuals, ledger = {}, slots = [] }) {
  const ids = [...weights.keys()];
  const totalSlots = slots.length;
  const sumWeight = ids.reduce((s, id) => s + weights.get(id).weight, 0) || 1;
  const rows = ids.map((id) => {
    const w = weights.get(id);
    const entry = targets.get(id) || { fair: emptyCategoryVector(), target: emptyCategoryVector() };
    const target = entry.target;
    const fair = entry.fair;
    const actual = actuals.get(id) || {
      cat: emptyCategoryVector(), totalHours: 0, shifts: 0, nightShifts: 0, weekendShifts: 0, dates: [],
    };
    const deviation = emptyCategoryVector();
    const fairDeviation = emptyCategoryVector();
    for (const key of CATEGORY_KEYS) {
      deviation[key] = actual.cat[key] - target[key];
      fairDeviation[key] = actual.cat[key] - fair[key];
    }
    return {
      doctorId: id,
      availableDays: w.availableDays,
      loadFactor: w.loadFactor,
      weight: w.weight,
      expectedShifts: (totalSlots * w.weight) / sumWeight,
      shifts: actual.shifts,
      nightShifts: actual.nightShifts,
      weekendShifts: actual.weekendShifts,
      totalHours: actual.totalHours,
      targetTotalHours: vectorTotal(target),
      actual: actual.cat,
      target,
      fair,
      deviation,
      fairDeviation,
      ledger: ledger[id] || emptyCategoryVector(),
      dates: actual.dates,
    };
  });
  rows.sort((a, b) => String(a.doctorId).localeCompare(String(b.doctorId)));

  // Genel denge gostergesi: kategori bazli mutlak sapma ortalamasi.
  let absSum = 0;
  let maxAbs = 0;
  for (const row of rows) {
    for (const key of CATEGORY_KEYS) {
      const d = Math.abs(row.deviation[key]);
      absSum += d;
      maxAbs = Math.max(maxAbs, d);
    }
  }
  const count = rows.length * CATEGORY_KEYS.length || 1;
  return {
    rows,
    totals,
    meanAbsDeviation: absSum / count,
    maxAbsDeviation: maxAbs,
  };
}

/**
 * Ay kesinlestiginde devir defterini gunceller:
 *   yeni devir = eski devir + (gercek - adil pay)
 *
 * "adil pay" (fair) devirden bagimsiz oldugu icin, bir onceki aydan gelen borc
 * bu ay telafi edildiginde defter kendiliginden sifira yaklasir.
 * Ornek: defter +5 sa ise bu ayin hedefi adil paydan 5 sa dusuk belirlenir;
 * doktor hedefi tutturursa gercek = adil - 5 olur ve defter 5 + (-5) = 0 olur.
 */
export function updateLedger(previousLedger, report) {
  const next = { ...(previousLedger || {}) };
  for (const row of report.rows) {
    const current = next[row.doctorId] || emptyCategoryVector();
    const updated = emptyCategoryVector();
    for (const key of CATEGORY_KEYS) {
      updated[key] = (current[key] || 0) + row.fairDeviation[key];
    }
    next[row.doctorId] = updated;
  }
  return next;
}
