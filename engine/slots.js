/**
 * Vardiya slotlarinin uretilmesi ve saat etiketlerinin hesaplanmasi.
 *
 * TEMEL FIKIR
 * -----------
 * Bir slotun kac saatinin "paylasimli" (ayni anda baska bir doktor da
 * hastanede) kac saatinin "paylasimsiz" (tek basina) oldugu, o slota KIMIN
 * atandigina bagli degildir; sadece vardiya saatlerinin birbiriyle
 * kesismesine baglidir. Cunku her slot mutlaka bir doktorla dolar ve ayni
 * doktor kesisen iki slota atanamaz.
 *
 * Bu yuzden 4 etiketin (haftaici/haftasonu x paylasimli/paylasimsiz) saat
 * dagilimi her slot icin bir kez, tarama (sweep-line) ile hesaplanir. Sonuc
 * her slot icin sabit bir 4'lu vektordur. Optimizasyon asamasi bu sabit
 * vektorleri doktorlara dagitma problemine indirgenir: hem cok hizli hem de
 * hesabi birebir dogru olur.
 *
 * Saat etiketi, saatin gercek takvim damgasina gore verilir. Ornek: Cuma
 * 15:00'te baslayip Cumartesi 09:00'da biten nobetin 15:00-24:00 araligi
 * haftaici, 00:00-09:00 araligi haftasonu saati sayilir.
 */

import { MIN_PER_DAY, formatRange, parseTime, toHours } from './time.js';
import { daysInMonth, dayTypeOf, isoFromIndex, weekdayOf, DAY_SHORT, DAY_NAMES } from './calendar.js';

export const CATEGORIES = [
  { key: 'wdSolo', label: 'Hafta içi paylaşımsız', short: 'Hİ tek' },
  { key: 'wdShared', label: 'Hafta içi paylaşımlı', short: 'Hİ ort' },
  { key: 'weSolo', label: 'Hafta sonu paylaşımsız', short: 'HS tek' },
  { key: 'weShared', label: 'Hafta sonu paylaşımlı', short: 'HS ort' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function emptyCategoryVector() {
  return { wdSolo: 0, wdShared: 0, weSolo: 0, weShared: 0 };
}

export function addVector(target, source, factor = 1) {
  for (const key of CATEGORY_KEYS) target[key] += (source[key] || 0) * factor;
  return target;
}

export function vectorTotal(vec) {
  return CATEGORY_KEYS.reduce((sum, key) => sum + (vec[key] || 0), 0);
}

/** Sablonlari normalize eder ve mantik hatalarini yakalar. */
export function normalizeTemplates(templates, dayTypeLabel) {
  const list = (templates || []).map((tpl, i) => {
    const startMin = parseTime(tpl.start);
    const endMin = parseTime(tpl.end);
    if (endMin <= startMin) {
      throw new Error(
        `${dayTypeLabel} "${tpl.label || tpl.id || i}" vardiyasının bitişi başlangıcından sonra olmalı.`,
      );
    }
    return {
      id: String(tpl.id || `v${i + 1}`),
      label: String(tpl.label || `Vardiya ${i + 1}`),
      start: tpl.start,
      end: tpl.end,
      startMin,
      endMin,
      durationMin: endMin - startMin,
      crossesMidnight: endMin > MIN_PER_DAY,
      color: tpl.color || null,
    };
  });
  const ids = new Set();
  for (const tpl of list) {
    if (ids.has(tpl.id)) throw new Error(`${dayTypeLabel} içinde tekrar eden vardiya kimliği: ${tpl.id}`);
    ids.add(tpl.id);
  }
  return list.sort((a, b) => a.startMin - b.startMin);
}

/**
 * Sablon setinin gunluk 24 saati kesintisiz kapsayip kapsamadigini ve giris
 * saatlerinin makul olup olmadigini denetler.
 */
export function validateTemplates(templates, dayTypeLabel, rules = {}) {
  const problems = [];
  const list = normalizeTemplates(templates, dayTypeLabel);
  if (!list.length) {
    problems.push({ level: 'error', message: `${dayTypeLabel} için en az bir vardiya tanımlanmalı.` });
    return problems;
  }

  // Sonsuz tekrar eden gunluk desende kapsama denetimi: bir gunun her dakikasi
  // ya ayni gunun ya da bir onceki gunun vardiyalariyla dolmali.
  const covered = new Array(MIN_PER_DAY).fill(0);
  for (const tpl of list) {
    for (let offsetDays = -2; offsetDays <= 0; offsetDays += 1) {
      const s = tpl.startMin + offsetDays * MIN_PER_DAY;
      const e = tpl.endMin + offsetDays * MIN_PER_DAY;
      for (let t = Math.max(0, s); t < Math.min(MIN_PER_DAY, e); t += 1) covered[t] += 1;
    }
  }
  const gaps = [];
  let gapStart = null;
  for (let t = 0; t <= MIN_PER_DAY; t += 1) {
    const isGap = t < MIN_PER_DAY && covered[t] === 0;
    if (isGap && gapStart === null) gapStart = t;
    if (!isGap && gapStart !== null) {
      gaps.push([gapStart, t]);
      gapStart = null;
    }
  }
  for (const [s, e] of gaps) {
    problems.push({
      level: 'error',
      message: `${dayTypeLabel}: ${formatRange(s, e)} aralığında hastanede doktor kalmıyor (kapsama boşluğu).`,
    });
  }

  const earliest = parseTime(rules.earliestStart || '06:00');
  const latest = parseTime(rules.latestStart || '22:00');
  const maxShiftHours = Number(rules.maxShiftHours || 24);
  for (const tpl of list) {
    const startOfDay = tpl.startMin % MIN_PER_DAY;
    if (startOfDay < earliest || startOfDay > latest) {
      problems.push({
        level: 'warn',
        message: `${dayTypeLabel}: "${tpl.label}" vardiyası ${formatRange(tpl.startMin, tpl.endMin)} — giriş saati alışılmadık (önerilen aralık ${rules.earliestStart || '06:00'}–${rules.latestStart || '22:00'}).`,
      });
    }
    if (tpl.durationMin > maxShiftHours * 60) {
      problems.push({
        level: 'warn',
        message: `${dayTypeLabel}: "${tpl.label}" vardiyası ${toHours(tpl.durationMin)} saat — üst sınır ${maxShiftHours} saat.`,
      });
    }
  }
  return problems;
}

/**
 * Ay icin slotlari uretir ve her slotun 4 etiketli saat dagilimini hesaplar.
 *
 * @returns {{slots: Array, days: Array, totals: object, warnings: Array}}
 */
export function buildSlots({ year, month, shiftTemplates, weekendDays = [0, 6], holidays = [] }) {
  const calOpts = { weekendDays, holidays };
  const total = daysInMonth(year, month);
  const weekdayTpl = normalizeTemplates(shiftTemplates?.weekday, 'Hafta içi');
  const weekendTpl = normalizeTemplates(shiftTemplates?.weekend, 'Hafta sonu');

  const dayMeta = (dayIndex) => {
    const iso = isoFromIndex(year, month, dayIndex);
    const type = dayTypeOf(iso, calOpts);
    return { dayIndex, iso, type, templates: type === 'weekend' ? weekendTpl : weekdayTpl };
  };

  // Ay icindeki slotlar + kesisim hesabi icin onceki ayin son gunu ve sonraki
  // ayin ilk gunu (hayalet slotlar). Hayalet slotlar atanmaz, yalnizca
  // es zamanlilik sayimina katilir.
  const all = [];
  for (let dayIndex = -1; dayIndex <= total; dayIndex += 1) {
    const meta = dayMeta(dayIndex);
    for (const tpl of meta.templates) {
      all.push({
        id: `${meta.iso}#${tpl.id}`,
        date: meta.iso,
        dayIndex,
        day: dayIndex + 1,
        dayType: meta.type,
        weekday: weekdayOf(meta.iso),
        dayName: DAY_NAMES[weekdayOf(meta.iso)],
        dayShort: DAY_SHORT[weekdayOf(meta.iso)],
        templateId: tpl.id,
        label: tpl.label,
        color: tpl.color,
        startMin: dayIndex * MIN_PER_DAY + tpl.startMin,
        endMin: dayIndex * MIN_PER_DAY + tpl.endMin,
        durationMin: tpl.durationMin,
        crossesMidnight: tpl.crossesMidnight,
        timeLabel: formatRange(tpl.startMin, tpl.endMin),
        inMonth: dayIndex >= 0 && dayIndex < total,
        cat: emptyCategoryVector(),
        soloMin: 0,
        sharedMin: 0,
      });
    }
  }

  // --- Tarama (sweep-line) ---
  // Tum sinir noktalari + gun sinirlari elementer araliklari olusturur.
  const points = new Set();
  for (const slot of all) {
    points.add(slot.startMin);
    points.add(slot.endMin);
  }
  const minPoint = Math.min(...points);
  const maxPoint = Math.max(...points);
  for (let t = Math.floor(minPoint / MIN_PER_DAY) * MIN_PER_DAY; t <= maxPoint; t += MIN_PER_DAY) {
    points.add(t);
  }
  const sorted = [...points].sort((a, b) => a - b);

  const gapsInMonth = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const span = to - from;
    if (span <= 0) continue;
    const covering = all.filter((s) => s.startMin <= from && s.endMin >= to);
    const dayIndex = Math.floor(from / MIN_PER_DAY);
    const iso = isoFromIndex(year, month, dayIndex);
    const isWeekend = dayTypeOf(iso, calOpts) === 'weekend';
    const shared = covering.length > 1;
    const key = isWeekend ? (shared ? 'weShared' : 'weSolo') : shared ? 'wdShared' : 'wdSolo';

    if (covering.length === 0 && dayIndex >= 0 && dayIndex < total) {
      gapsInMonth.push({ iso, from, to });
      continue;
    }
    for (const slot of covering) {
      slot.cat[key] += span / 60;
      if (shared) slot.sharedMin += span;
      else slot.soloMin += span;
    }
  }

  const slots = all.filter((s) => s.inMonth);
  for (const slot of slots) {
    slot.hours = slot.durationMin / 60;
    slot.soloHours = slot.soloMin / 60;
    slot.sharedHours = slot.sharedMin / 60;
    slot.isNight = slot.crossesMidnight;
    delete slot.soloMin;
    delete slot.sharedMin;
    delete slot.inMonth;
  }
  slots.sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));

  const totals = emptyCategoryVector();
  for (const slot of slots) addVector(totals, slot.cat);

  const warnings = [];
  for (const gap of gapsInMonth) {
    warnings.push({
      level: 'error',
      message: `${gap.iso} gününde ${formatRange(gap.from % MIN_PER_DAY, gap.to % MIN_PER_DAY)} aralığında kapsama boşluğu var.`,
    });
  }

  const days = [];
  for (let d = 0; d < total; d += 1) {
    const meta = dayMeta(d);
    days.push({
      day: d + 1,
      iso: meta.iso,
      type: meta.type,
      weekday: weekdayOf(meta.iso),
      dayName: DAY_NAMES[weekdayOf(meta.iso)],
      shortName: DAY_SHORT[weekdayOf(meta.iso)],
      isHoliday: holidays.includes(meta.iso),
      slotIds: slots.filter((s) => s.date === meta.iso).map((s) => s.id),
    });
  }

  return { slots, days, totals, warnings, totalDays: total };
}
