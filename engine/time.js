/**
 * Zaman yardimcilari.
 *
 * Cizelge motoru boyunca tum zamanlar "ayin baslangicindan itibaren gecen
 * dakika" (absolute minute / absMin) olarak tutulur. Boylece gece yarisini
 * asan vardiyalar (ornegin 15:00 -> ertesi sabah 09:00) hicbir ozel duruma
 * ihtiyac duymadan tek bir sayi ekseninde ifade edilir.
 */

export const MIN_PER_DAY = 1440;

/**
 * "09:00", "24:00", "09:00+1" gibi bir saat ifadesini gun basindan itibaren
 * dakikaya cevirir. "+1" ertesi gune tasan saati belirtir.
 */
export function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') throw new Error(`Geçersiz saat değeri: ${value}`);
  const m = /^(\d{1,2}):(\d{2})(?:\s*\+\s*(\d))?$/.exec(value.trim());
  if (!m) throw new Error(`Geçersiz saat formatı: "${value}" (beklenen "HH:MM" veya "HH:MM+1")`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const plusDays = m[3] ? Number(m[3]) : 0;
  if (mm > 59) throw new Error(`Geçersiz dakika: "${value}"`);
  if (hh > 24) throw new Error(`Geçersiz saat: "${value}"`);
  return hh * 60 + mm + plusDays * MIN_PER_DAY;
}

/** Dakika degerini "HH:MM" olarak bicimler; 24 saati asan degerler sarmalanir. */
export function formatTime(minutes) {
  const m = ((minutes % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * "09:00–24:00" veya "15:00–09:00 (+1)" seklinde okunabilir aralik metni.
 * Gun sonunda biten vardiya "24:00" olarak gosterilir, ertesi gune tasan
 * vardiya "(+1)" ile isaretlenir.
 */
export function formatRange(startMin, endMin) {
  const startDay = Math.floor(startMin / MIN_PER_DAY);
  const midnight = (startDay + 1) * MIN_PER_DAY;
  if (endMin === midnight) return `${formatTime(startMin)}–24:00`;
  const crosses = endMin > midnight;
  return `${formatTime(startMin)}–${formatTime(endMin)}${crosses ? ' (+1)' : ''}`;
}

/** Dakikayi saate cevirir (ondalikli). */
export function toHours(minutes) {
  return minutes / 60;
}

/** Saat degerini kullaniciya gosterilecek sekilde yuvarlar. */
export function roundHours(hours, digits = 1) {
  const f = 10 ** digits;
  return Math.round(hours * f) / f;
}
