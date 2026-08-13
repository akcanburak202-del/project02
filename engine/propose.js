/**
 * GUN DESENI ONERISI — arac arar, insan onaylar.
 *
 * NEDEN OTOMATIK DEGIL
 * --------------------
 * Bir gunde kac doktor bulunacagi bir ADALET degil, BAKIM KALITESI ve
 * GUVENLIK kararidir. Arac hasta yogunlugunu bilmez; sirf saat dengesi
 * daha guzel ciksin diye yogun bir cumartesiyi tek doktora birakabilir.
 * Bu yuzden desen secimi sessizce degistirilmez.
 *
 * Buna karsilik aramanin gercek bir degeri var: desen secimi ayin TOPLAM
 * nobet sayisini degistirir, bu da nobetlerin doktorlara tam bolunup
 * bolunmedigini belirler. Olcum (8 doktor, Agustos 2026):
 *
 *   hepsi klasik ikili -> 62 nobet -> kisi basi 7,75 -> kimi 7 kimi 8
 *   2 gun uclu         -> 64 nobet -> kisi basi 8,00 -> HERKESE TAM 8
 *
 * Elle bulunmasi zor, savunmasi kolay bir kazanc. Ama ayni arama, sinir
 * konulmazsa "6 gun tek nobetci" gibi calisma kosullarini agirlastiran
 * cozumler de onerebilir (olcumde fiili sapma 0 -> 1,5 saate cikti).
 *
 * COZUM
 * -----
 * Arama, yoneticinin cizdigi sinirlar icinde yapilir ve sonuc bir ONERI
 * olarak sunulur:
 *   - yalnizca acik desenler kullanilir,
 *   - gun basina en az/en cok doktor sinirina uyulur,
 *   - dondurulmus ve elle sabitlenmis gunlere dokunulmaz,
 *   - basitlik odullendirilir: ayni sonucu veren daha az istisnali
 *     yapilandirma tercih edilir (ongorulebilirlik).
 *
 * ARAMA MALIYETI
 * --------------
 * Her adayin degerlendirilmesi tam bir cizelge cozumu gerektirir (~2 sn).
 * Bu yuzden iki asamali calisir: once dusuk iterasyonla eleme, sonra
 * finalistlerin tam cozumu.
 */

import { buildContext, generateSchedule } from './index.js';
import { EFFECTIVE_KEYS, PRESENCE_KEYS } from './slots.js';

const sumKeys = (vec, keys) => keys.reduce((a, k) => a + (vec[k] || 0), 0);

/** Bir cizelge sonucunu karsilastirilabilir olculere indirger. */
export function summarize(out, doctorCount) {
  const rows = out.report.rows;
  const eff = rows.map((r) => sumKeys(r.actual, EFFECTIVE_KEYS));
  const pres = rows.map((r) => sumKeys(r.actual, PRESENCE_KEYS));
  const counts = rows.map((r) => r.shifts);
  const slots = out.slots.length;
  const perDoctor = slots / (doctorCount || 1);

  return {
    slots,
    perDoctor,
    countSpread: Math.max(...counts) - Math.min(...counts),
    countsEqual: new Set(counts).size === 1,
    counts: [...counts].sort((a, b) => a - b),
    effSpread: Math.max(...eff) - Math.min(...eff),
    presSpread: Math.max(...pres) - Math.min(...pres),
    unassigned: out.report.unassigned.length,
    warnings: out.warnings.filter((w) => w.level !== 'info').length,
    issues: out.report.issues.length,
  };
}

/**
 * Aday siralamasi. Dusuk puan daha iyidir.
 *
 * Oncelik sirasi bilincli:
 *   1. Uygulanabilirlik (bos slot / kural ihlali kabul edilemez)
 *   2. Nobet sayisi esitligi — herkesin kabul ettigi, savunulabilir olcut
 *   3. Fiili mesai dengesi — birincil adalet olcutu
 *   4. Kadro degisikligi — asagiya bakiniz
 *   5. Bulunma saati dengesi
 *   6. Basitlik — istisna gun sayisi (ongorulebilirlik bedeli)
 *
 * KADRO DEGISIKLIGI NEDEN CEZALANDIRILIR
 * --------------------------------------
 * Gunluk toplam fiili mesai her zaman 24 saattir; desen ne olursa olsun
 * degismez. Dolayisiyla bir gune doktor eklemek IS YUKUNU AZALTMAZ, yalnizca
 * ayni isi daha cok kisiye ve daha cok nobete boler. Arama bunu serbestce
 * yapabilseydi hep "daha kalabalik" cozumleri secerdi: nobet sayisi doktor
 * sayisina bolunmesi kolaylastigi icin denge tablosu guzellesir, ama herkes
 * hastaneye daha sik gelir.
 *
 * Olcum (8 doktor, Agustos 2026): hafta sonlarini ucluye cevirmek nobet
 * sayisini 62 -> 72 yapiyor (kisi basi 7,75 -> 9,00) ve dengeyi bir miktar
 * iyilestiriyor. Bu bir ADALET kazanci degil, kadro kararidir.
 *
 * Bu yuzden kadro degisikligi "kisi basi nobet farki" olarak cezalandirilir.
 * Kucuk bir ekleme (orn. +2 nobet ile sayilarin tam bolunmesi) yine kazanabilir;
 * buyuk bir kadro artisi kazanamaz. Yonetici gercekten kadro degistirmek
 * istiyorsa bunu min/max doktor sinirlarindan acikca soyler.
 */
export function scoreCandidate(summary, exceptions, { basePerDoctor = null } = {}) {
  if (summary.unassigned || summary.issues) return Infinity;
  const staffingShift = basePerDoctor === null ? 0 : Math.abs(summary.perDoctor - basePerDoctor);
  return (
    summary.warnings * 1000
    + summary.countSpread * 40
    + summary.effSpread * 12
    + staffingShift * 50
    + summary.presSpread * 2
    + exceptions * 1.5
  );
}

/**
 * Aday yapilandirmalari uretir.
 *
 * Gunler buyuk olcude birbirinin yerine gecebildigi icin arama "hangi gun"
 * degil "kac gun" uzerinden yapilir: once gun tipine gore taban desen,
 * sonra toplam nobet sayisini doktor sayisina tam boldurecek kadar gun
 * istisna yapilir.
 */
function buildCandidates({ days, patterns, doctorCount, minDoctors, maxDoctors, lockedDates, lockedPatterns }) {
  const usable = patterns.filter((p) => p.doctorsPerDay >= minDoctors && p.doctorsPerDay <= maxDoctors);
  if (!usable.length) return [];

  const free = days.filter((d) => !lockedDates.has(d.iso));
  const weekdays = free.filter((d) => d.type !== 'weekend');
  const weekends = free.filter((d) => d.type === 'weekend');
  const lockedSlots = days
    .filter((d) => lockedDates.has(d.iso))
    .reduce((a, d) => a + (d.lockedDoctors || 0), 0);

  const out = [];
  const seen = new Set();

  const push = (label, map, exceptions) => {
    const key = JSON.stringify(map);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, dayPatterns: map, exceptions });
  };

  for (const wd of usable) {
    for (const we of usable) {
      // Dokunulmayan gunlerin deseni aynen tasinir; aksi halde varsayilana
      // doner ve dondurulmus gunlerin yapisi sessizce degisir.
      const base = { ...lockedPatterns };
      for (const d of weekdays) base[d.iso] = wd.id;
      for (const d of weekends) base[d.iso] = we.id;
      const baseSlots = lockedSlots + weekdays.length * wd.doctorsPerDay + weekends.length * we.doctorsPerDay;

      push(
        wd.id === we.id ? `Tüm ay: ${wd.name}` : `Hafta içi: ${wd.name} · Hafta sonu: ${we.name}`,
        base,
        0,
      );

      // Toplam nobet sayisini doktor sayisina tam boldurmek icin
      // birkac gunu farkli bir desene cevir.
      for (const alt of usable) {
        for (const [pool, poolName] of [[weekdays, 'hafta içi'], [weekends, 'hafta sonu']]) {
          const current = pool === weekdays ? wd : we;
          const delta = alt.doctorsPerDay - current.doctorsPerDay;
          if (delta === 0 || !pool.length) continue;

          for (let k = 1; k <= Math.min(6, pool.length); k += 1) {
            const total = baseSlots + delta * k;
            if (total <= 0 || total % doctorCount !== 0) continue;
            const map = { ...base };
            // Aya dengeli dagitilmis gunler secilir (kume olusmasin)
            const step = pool.length / k;
            for (let i = 0; i < k; i += 1) map[pool[Math.floor(i * step + step / 2)].iso] = alt.id;
            push(
              `${wd.name}${we.id !== wd.id ? ` + ${we.name}` : ''} · ${k} ${poolName} günü: ${alt.name}`,
              map,
              k,
            );
            break; // her (alt, pool) icin en kucuk k yeterli
          }
        }
      }
    }
  }
  return out;
}

/**
 * Gun deseni onerisi uretir.
 *
 * @returns {{ current, candidates, best }} — hicbir sey degistirilmez;
 *          sonuclar karsilastirma icin dondurulur.
 */
export function proposeDayPatterns(input, options = {}) {
  const {
    minDoctors = 2,
    maxDoctors = 3,
    screenIterations = 2500,
    finalIterations = 30000,
    finalists = 3,
    onProgress = null,
  } = options;

  const built = options.built || buildContext(input);
  const days = built.days;
  const policy = built.config.shiftPolicy;
  if (policy.mode !== 'flexible') {
    return { current: null, candidates: [], best: null, unavailable: 'Öneri yalnızca esnek modda çalışır.' };
  }

  const doctorCount = (input.month.participants || []).filter((p) => p.active !== false).length;
  if (!doctorCount) return { current: null, candidates: [], best: null, unavailable: 'Bu ayda görevli doktor yok.' };

  // Dokunulmayacak gunler: dondurulmus + elle desen secilmis + sabitlenmis
  const lockedDates = new Set();
  const lockedPatterns = {};
  const lockedThrough = input.month.lockedThrough;
  const keepManual = options.keepManual !== false;
  const existing = input.month.dayPatterns || {};
  for (const d of days) {
    if (lockedThrough && d.iso <= lockedThrough) lockedDates.add(d.iso);
    if (keepManual && existing[d.iso]) lockedDates.add(d.iso);
  }
  for (const d of days) {
    if (!lockedDates.has(d.iso)) continue;
    d.lockedDoctors = built.slots.filter((s) => s.date === d.iso).length;
    if (existing[d.iso]) lockedPatterns[d.iso] = existing[d.iso];
  }

  const run = (dayPatterns, iterations) => generateSchedule(
    { ...input, month: { ...input.month, dayPatterns, plan: null } },
    { optimizer: { iterations, restarts: iterations < 10000 ? 1 : 3 } },
  );

  // Mevcut durum — karsilastirma tabani
  const currentOut = run(input.month.dayPatterns || {}, finalIterations);
  const current = {
    label: 'Şu anki yapılandırma',
    dayPatterns: input.month.dayPatterns || {},
    exceptions: Object.keys(input.month.dayPatterns || {}).length,
    summary: summarize(currentOut, doctorCount),
  };
  const basePerDoctor = current.summary.perDoctor;
  const score = (summary, exceptions) => scoreCandidate(summary, exceptions, { basePerDoctor });
  current.score = score(current.summary, current.exceptions);

  const candidates = buildCandidates({
    days,
    patterns: policy.enabledPatterns,
    doctorCount,
    minDoctors,
    maxDoctors,
    lockedDates,
    lockedPatterns,
  });

  // 1. asama: dusuk iterasyonla eleme
  const screened = [];
  candidates.forEach((c, i) => {
    if (onProgress) onProgress({ phase: 'screen', done: i, total: candidates.length });
    try {
      const out = run(c.dayPatterns, screenIterations);
      const summary = summarize(out, doctorCount);
      screened.push({ ...c, summary, score: score(summary, c.exceptions) });
    } catch {
      /* gecersiz yapilandirma elenir */
    }
  });
  screened.sort((a, b) => a.score - b.score);

  // 2. asama: finalistlerin tam cozumu
  const top = screened.slice(0, finalists).map((c, i) => {
    if (onProgress) onProgress({ phase: 'final', done: i, total: finalists });
    const out = run(c.dayPatterns, finalIterations);
    const summary = summarize(out, doctorCount);
    return {
      ...c,
      summary,
      score: score(summary, c.exceptions),
      staffingDelta: summary.slots - current.summary.slots,
    };
  });
  top.sort((a, b) => a.score - b.score);

  // Kil payi farklar oneri sayilmaz: degisiklik ancak anlamli bir kazanc
  // getiriyorsa gundeme gelir, aksi halde "mevcut yapilandirma iyi" denir.
  const best = top[0] && top[0].score < current.score - 1 ? top[0] : null;
  return {
    current,
    candidates: top,
    best,
    searched: candidates.length,
    doctorCount,
  };
}
