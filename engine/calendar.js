/**
 * Takvim yardimcilari: ay gunleri, hafta sonu / resmi tatil tespiti.
 *
 * Tarihler her yerde "YYYY-AA-GG" metni olarak tasinir; zaman dilimi
 * kaymalarindan kacinmak icin tum hesaplar UTC uzerinden yapilir.
 */

export const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** Ay kimligi: 2026 + 8 -> "2026-08". */
export function monthId(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonthId(id) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(id || ''));
  if (!m) throw new Error(`Geçersiz ay kimliği: ${id}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Geçersiz ay: ${id}`);
  return { year, month };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Ay icindeki gun numarasini (1..n) ISO tarihe cevirir. */
export function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Ay basina gore kaydirilmis gun indeksini ISO tarihe cevirir.
 * dayIndex 0 => ayin 1'i, -1 => onceki ayin son gunu, n => sonraki aya tasar.
 */
export function isoFromIndex(year, month, dayIndex) {
  const d = new Date(Date.UTC(year, month - 1, 1 + dayIndex));
  return d.toISOString().slice(0, 10);
}

/** ISO tarihin haftanin hangi gunu oldugunu dondurur (0 = Pazar). */
export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** iso1 - iso2 farkini gun olarak dondurur. */
export function diffDays(iso1, iso2) {
  const a = Date.parse(`${iso1}T00:00:00Z`);
  const b = Date.parse(`${iso2}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

export function prevMonthId(id) {
  const { year, month } = parseMonthId(id);
  return month === 1 ? monthId(year - 1, 12) : monthId(year, month - 1);
}

export function nextMonthId(id) {
  const { year, month } = parseMonthId(id);
  return month === 12 ? monthId(year + 1, 1) : monthId(year, month + 1);
}

export function monthLabel(id) {
  const { year, month } = parseMonthId(id);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Bir gunun tipi: 'weekend' (hafta sonu veya resmi tatil) ya da 'weekday'.
 * Tatil listesi ISO tarih dizisidir ve hafta sonu gibi degerlendirilir.
 */
export function dayTypeOf(iso, { weekendDays = [0, 6], holidays = [] } = {}) {
  if (holidays.includes(iso)) return 'weekend';
  return weekendDays.includes(weekdayOf(iso)) ? 'weekend' : 'weekday';
}

/**
 * Ay icindeki tum gunleri meta bilgisiyle dondurur.
 *
 * Ilk gune bir onceki ayin son gunu, son gune de bir sonraki ayin ilk gunu
 * eklenir (prevIso / nextIso). Gece nobetleri ay sinirini astigi icin
 * kesisim hesabinda bu komsu gunlere ihtiyac duyulur.
 */
export function monthDays(year, month, calendarOpts) {
  const total = daysInMonth(year, month);
  const out = [];
  for (let day = 1; day <= total; day += 1) {
    const iso = isoDate(year, month, day);
    out.push({
      day,
      index: day - 1,
      iso,
      weekday: weekdayOf(iso),
      dayName: DAY_NAMES[weekdayOf(iso)],
      shortName: DAY_SHORT[weekdayOf(iso)],
      type: dayTypeOf(iso, calendarOpts),
      isHoliday: (calendarOpts?.holidays || []).includes(iso),
    });
  }
  if (out.length) {
    const prevIso = addDays(out[0].iso, -1);
    const nextIso = addDays(out[out.length - 1].iso, 1);
    out[0].prevIso = prevIso;
    out[0].prevType = dayTypeOf(prevIso, calendarOpts);
    out[out.length - 1].nextIso = nextIso;
    out[out.length - 1].nextType = dayTypeOf(nextIso, calendarOpts);
  }
  return out;
}
