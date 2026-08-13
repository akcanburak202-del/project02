/**
 * GUN DESENLERI — esnekligi ongorulebilir kilan yapi.
 *
 * SORUN
 * -----
 * Cizelge ne kadar esnek olursa fiili mesai o kadar iyi esitlenir; ama
 * sinirsiz esneklik, listeyi hazirlayanin sonucu ongorememesi demektir.
 * "Bugun kac kisi olacak, saat kacta gelecekler?" sorusunun cevabi her ay
 * surprize donusurse arac guvenilir olmaz.
 *
 * COZUM
 * -----
 * Esneklik serbest degil, ADLANDIRILMIS bir kume icinden secilir. Yonetici
 * gun desenlerinden olusan bir kutuphane tanimlar; arac her gun icin bu
 * kutuphaneden birini secer. Boylece:
 *
 *   - Kutuphanede olmayan bir duzen asla ortaya cikmaz.
 *   - Her desenin ne oldugu ayarlar ekraninda gorsel olarak gorunur.
 *   - Takvimde her gun, kullanilan desenin adiyla etiketlenir.
 *   - Kutuphane tek desene indirilirse sonuc tamamen ongorulebilir olur.
 *
 * Yani esneklik "arac ne yaparsa" degil, "yoneticinin izin verdigi seçenekler"
 * kadardir.
 *
 * DESEN TANIMI
 * ------------
 * Bir desen, gunun devir saatinden ertesi gunun devir saatine kadar olan
 * dongusunu kapsayan vardiya listesidir. Her vardiyanin baslangici ve bitisi
 * su uclerden biridir:
 *
 *   'devir'    -> o gunun devir saati (dongunun basi)
 *   'devir+1'  -> ertesi gunun devir saati (dongunun sonu)
 *   {min, preferred, max} -> esnek saat penceresi
 *
 * Ornekler:
 *   Klasik ikili   : [devir → 24:00] , [15:00 → devir+1]
 *   Tek nobetci    : [devir → devir+1]
 *   Tam paylasimli : [devir → devir+1] , [devir → devir+1]
 *   Gunduz destekli: [devir → devir+1] , [10:00 → 18:00]
 */

import { MIN_PER_DAY, formatRange, parseTime } from './time.js';

export const HANDOVER = 'devir';
export const NEXT_HANDOVER = 'devir+1';

/**
 * Varsayilan desen kutuphanesi.
 * `enabled` alani, aracin o deseni kullanip kullanamayacagini belirler.
 */
export const DEFAULT_PATTERNS = [
  {
    id: 'ikili-klasik',
    name: 'Klasik ikili',
    note: 'Gündüz ekibi devirden gece yarısına, akşam ekibi öğleden sonra gelip ertesi devre kadar.',
    enabled: true,
    shifts: [
      { label: 'Gündüz', start: HANDOVER, end: { min: '22:00', preferred: '24:00', max: '24:00' } },
      { label: 'Akşam/Gece', start: { min: '14:00', preferred: '15:00', max: '17:00' }, end: NEXT_HANDOVER },
    ],
  },
  {
    id: 'ikili-tam',
    name: 'İki kişi tam gün',
    note: 'İki doktor da devirden ertesi devre kadar birlikte. Fiilî mesai ikiye bölünür.',
    enabled: true,
    shifts: [
      { label: 'Tam gün A', start: HANDOVER, end: NEXT_HANDOVER },
      { label: 'Tam gün B', start: HANDOVER, end: NEXT_HANDOVER },
    ],
  },
  {
    id: 'tekli-24',
    name: 'Tek nöbetçi 24 saat',
    note: 'Tek doktor devirden ertesi devre kadar. En ağır gün: 24 saat fiilî mesai.',
    enabled: false,
    shifts: [
      { label: '24 saat', start: HANDOVER, end: NEXT_HANDOVER },
    ],
  },
  {
    id: 'tam-destek',
    name: 'Tam gün + gündüz desteği',
    note: 'Bir doktor 24 saat, ikinci doktor yoğun saatlerde destek verir.',
    enabled: false,
    shifts: [
      { label: '24 saat', start: HANDOVER, end: NEXT_HANDOVER },
      {
        label: 'Gündüz desteği',
        start: { min: '09:00', preferred: '10:00', max: '12:00' },
        end: { min: '17:00', preferred: '19:00', max: '21:00' },
      },
    ],
  },
  {
    id: 'uclu',
    name: 'Üçlü kademeli',
    note: 'Yoğun servisler için üç katmanlı düzen.',
    enabled: false,
    shifts: [
      { label: 'Sabah', start: HANDOVER, end: { min: '18:00', preferred: '20:00', max: '21:00' } },
      {
        label: 'İkindi',
        start: { min: '13:00', preferred: '14:00', max: '15:00' },
        end: { min: '23:00', preferred: '24:00', max: '24:00' },
      },
      { label: 'Gece', start: { min: '19:00', preferred: '20:00', max: '21:00' }, end: NEXT_HANDOVER },
    ],
  },
];

function endpoint(value, fallback) {
  if (value === HANDOVER) return { kind: 'handover' };
  if (value === NEXT_HANDOVER) return { kind: 'nextHandover' };
  // Zaten normalize edilmis deger: oldugu gibi gecer.
  // (normalizePatterns birden fazla kez cagrilabildigi icin bu sart sart:
  //  aksi halde 'devir' isaretcileri sabit saate donusur ve gunun sonu
  //  kapanmadigi icin sahte "kapsama boslugu" hatalari uretilir.)
  if (value && typeof value === 'object' && value.kind) {
    if (value.kind === 'handover' || value.kind === 'nextHandover') return { kind: value.kind };
    return { kind: 'time', min: value.min, max: value.max, preferred: value.preferred };
  }
  const src = value && typeof value === 'object' ? value : { preferred: value ?? fallback };
  const min = parseTime(src.min ?? src.preferred ?? fallback);
  const max = parseTime(src.max ?? src.preferred ?? fallback);
  const preferred = parseTime(src.preferred ?? fallback);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return { kind: 'time', min: lo, max: hi, preferred: Math.min(Math.max(preferred, lo), hi) };
}

/** Desen kutuphanesini sayisal, dogrulanmis bicime cevirir. */
export function normalizePatterns(list) {
  const source = Array.isArray(list) && list.length ? list : DEFAULT_PATTERNS;
  return source.map((raw, i) => {
    const shifts = (raw.shifts || []).map((sh, j) => ({
      label: String(sh.label || `Vardiya ${j + 1}`),
      start: endpoint(sh.start, '09:00'),
      end: endpoint(sh.end, '24:00'),
    }));
    const vars = [];
    shifts.forEach((sh, j) => {
      if (sh.start.kind === 'time') vars.push({ shift: j, edge: 'start', ...sh.start });
      if (sh.end.kind === 'time') vars.push({ shift: j, edge: 'end', ...sh.end });
    });
    return {
      id: String(raw.id || `desen${i + 1}`),
      name: String(raw.name || `Desen ${i + 1}`),
      note: String(raw.note || ''),
      enabled: raw.enabled !== false,
      shifts,
      vars,
      doctorsPerDay: shifts.length,
    };
  });
}

/**
 * Bir desenin belirli saatlerle olusturdugu araliklar.
 * Sonuc, dongunun basindan (0) itibaren dakika cinsindendir.
 *
 * @param handover      o gunun devir saati (gun ici dakika)
 * @param nextHandover  ertesi gunun devir saati (gun ici dakika)
 * @param values        esnek degiskenlerin degerleri (pattern.vars sirasinda)
 */
export function patternIntervals(pattern, handover, nextHandover, values) {
  const cycleEnd = MIN_PER_DAY + nextHandover;
  let v = 0;
  const resolve = (ep) => {
    if (ep.kind === 'handover') return handover;
    if (ep.kind === 'nextHandover') return cycleEnd;
    const value = values && values.length > v ? values[v] : ep.preferred;
    v += 1;
    return value;
  };
  return pattern.shifts.map((sh) => {
    const start = resolve(sh.start);
    const end = resolve(sh.end);
    return { label: sh.label, start, end };
  });
}

/**
 * Desenin gun dongusunu bosluksuz kapsayip kapsamadigini denetler.
 * En olumsuz saat kombinasyonuyla (kapsama en dar hali) sinanir.
 */
export function validatePattern(pattern, { handover = 9 * 60, minShiftHours = 4, maxShiftHours = 24 } = {}) {
  const problems = [];
  if (!pattern.shifts.length) {
    problems.push({ level: 'error', message: `"${pattern.name}": en az bir vardiya olmalı.` });
    return problems;
  }

  // Kapsamanin en dar hali: baslangiclar en gec, bitisler en erken
  const worst = pattern.shifts.map((sh) => ({
    start: sh.start.kind === 'handover' ? handover
      : sh.start.kind === 'nextHandover' ? MIN_PER_DAY + handover
        : sh.start.max,
    end: sh.end.kind === 'handover' ? handover
      : sh.end.kind === 'nextHandover' ? MIN_PER_DAY + handover
        : sh.end.min,
  }));

  const cycleStart = handover;
  const cycleEnd = MIN_PER_DAY + handover;
  const covered = new Array(cycleEnd - cycleStart).fill(0);
  for (const w of worst) {
    for (let t = Math.max(cycleStart, w.start); t < Math.min(cycleEnd, w.end); t += 1) {
      covered[t - cycleStart] += 1;
    }
  }
  let gapStart = null;
  for (let t = 0; t <= covered.length; t += 1) {
    const gap = t < covered.length && covered[t] === 0;
    if (gap && gapStart === null) gapStart = t;
    if (!gap && gapStart !== null) {
      problems.push({
        level: 'error',
        message: `"${pattern.name}": ${formatRange(cycleStart + gapStart, cycleStart + t)} aralığında serviste doktor kalmayabilir.`,
      });
      gapStart = null;
    }
  }

  for (const [i, sh] of pattern.shifts.entries()) {
    const w = worst[i];
    if (w.end <= w.start) {
      problems.push({
        level: 'error',
        message: `"${pattern.name}" / ${sh.label}: bitiş saati başlangıçtan önce olabiliyor.`,
      });
      continue;
    }
    const shortest = (w.end - w.start) / 60;
    if (shortest < minShiftHours) {
      problems.push({
        level: 'warn',
        message: `"${pattern.name}" / ${sh.label}: en kısa hâlinde ${shortest} saat — alt sınır ${minShiftHours} saat.`,
      });
    }
    const longest = (
      (sh.end.kind === 'time' ? sh.end.max : sh.end.kind === 'nextHandover' ? MIN_PER_DAY + handover : handover)
      - (sh.start.kind === 'time' ? sh.start.min : handover)
    ) / 60;
    if (longest > maxShiftHours) {
      problems.push({
        level: 'warn',
        message: `"${pattern.name}" / ${sh.label}: en uzun hâlinde ${longest} saat — üst sınır ${maxShiftHours} saat.`,
      });
    }
    if (sh.start.kind === 'time' && (sh.start.min < 6 * 60 || sh.start.max > 22 * 60)) {
      problems.push({
        level: 'warn',
        message: `"${pattern.name}" / ${sh.label}: giriş aralığı ${formatRange(sh.start.min, sh.start.max)} — alışılmadık.`,
      });
    }
  }
  return problems;
}

/**
 * Desenin tercih edilen saatlerle olusan onizlemesi: her vardiyanin
 * saat araligi, bulunma suresi ve fiili mesaisi.
 *
 * Ayarlar ekraninda gosterilir; yoneticinin deseni secmeden once ne
 * anlama geldigini gormesini saglar.
 */
export function previewPattern(pattern, handover = 9 * 60) {
  const intervals = patternIntervals(pattern, handover, handover, null);
  const points = new Set();
  for (const it of intervals) {
    points.add(it.start);
    points.add(it.end);
  }
  const sorted = [...points].sort((a, b) => a - b);

  const presence = intervals.map((it) => (it.end - it.start) / 60);
  const effective = intervals.map(() => 0);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const inside = [];
    intervals.forEach((it, j) => {
      if (it.start <= from && it.end >= to) inside.push(j);
    });
    if (!inside.length) continue;
    const share = (to - from) / 60 / inside.length;
    for (const j of inside) effective[j] += share;
  }

  return intervals.map((it, i) => ({
    label: it.label,
    timeLabel: formatRange(it.start, it.end),
    presenceHours: presence[i],
    effectiveHours: Math.round(effective[i] * 100) / 100,
  }));
}
