/**
 * RITIM HAFIZASI — "hep bana denk geliyor" sorununun cozumu.
 *
 * SORUN
 * -----
 * Saat dengesi devir defteriyle aylar boyunca kapaniyor. Ama bir ayin
 * SAATLERI dogru dagitilmis olsa bile, o saatlerin GUNLERE nasil dustugu
 * kisiden kisiye cok farkli olabilir:
 *
 *   - Birinin haftasina uc nobet dusrken bir baskasinin haftasi bos gecer.
 *   - Biri aylardir hep carsambalari nobet tutuyordur.
 *
 * Ikisi de saat tablosunda gorunmez; toplamlar tıpatıp esit olabilir.
 * Olcum (8 doktor, 6 ay, hic tercih verisi yok, bu ozellik eklenmeden once):
 * bir doktor alti ayda dokuz cuma nobeti tutarken bir digeri uc tutmustu.
 *
 * Tek bir ayda bunu duzeltmek mumkun degil: bir ayda her haftagununden
 * yalnizca dort-bes tane vardir, hepsini herkese esit dagitamazsiniz. Bu
 * yuzden olcu ay degil, AYLAR olmali.
 *
 * COZUM
 * -----
 * Gecmis aylarin atamalarindan iki buyukluk cikarilir:
 *
 *   weekday[7]   hangi haftagununde kac nobet tutuldu
 *   denseExcess  7 gunluk pencerelerde adil paydan kac nobet fazla dustu
 *                (yani "yogun hafta" yuku)
 *
 * Yeni ayin cozumunde, gecmiste ortalamanin uzerinde yuk almis doktor icin
 * ayni yonde bir nobet almak biraz daha pahalidir. Ceza yumusaktir: tercihleri
 * ya da saat dengesini ezmez, yalnizca esit maliyetli secenekler arasinda
 * yonu belirler. Boylece fark kendiliginden kapanir — devir defteriyle ayni
 * mantik, farkli bir buyuklukte.
 *
 * KALICI VERI YOK
 * ---------------
 * Bu hafiza ayrica saklanmaz; gecmis aylarin atamalarindan her seferinde
 * yeniden hesaplanir. Boylece defterle gercek cizelge birbirinden kayamaz.
 */

/** Bir doktorun bir aydaki tarihlerinden ritim olculerini cikarir. */
export function monthRhythm(dates, weekAllowance = 2) {
  const weekday = new Array(7).fill(0);
  const gunler = [];
  for (const iso of dates || []) {
    const t = Date.parse(`${iso}T00:00:00Z`);
    if (Number.isNaN(t)) continue;
    weekday[new Date(t).getUTCDay()] += 1;
    gunler.push(Math.round(t / 86400000));
  }
  gunler.sort((a, b) => a - b);

  // 7 gunluk kayan pencerelerde adil payin uzerine tasan nobetler
  let denseExcess = 0;
  let w = 0;
  for (let i = 0; i < gunler.length; i += 1) {
    if (w < i) w = i;
    while (w < gunler.length && gunler[w] < gunler[i] + 7) w += 1;
    const fazla = (w - i) - weekAllowance;
    if (fazla > 0) denseExcess += fazla;
  }

  return { weekday, denseExcess, shifts: gunler.length };
}

/** Aylik ritim kayitlarini tek bir gecmise toplar. */
export function mergeRhythm(records) {
  const out = {};
  for (const rec of records || []) {
    for (const [doctorId, r] of Object.entries(rec || {})) {
      const cur = out[doctorId] || { weekday: new Array(7).fill(0), denseExcess: 0, shifts: 0 };
      for (let i = 0; i < 7; i += 1) cur.weekday[i] += r.weekday?.[i] || 0;
      cur.denseExcess += r.denseExcess || 0;
      cur.shifts += r.shifts || 0;
      out[doctorId] = cur;
    }
  }
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Gecmisi cozucunun kullanabilecegi sapmalara cevirir.
 *
 * weekday[d][wd] : o doktorun o haftagunune, kendi nobet sayisina gore
 *                  BEKLENENDEN kac nobet fazla/eksik dustugu (nobet cinsinden)
 * dense[d]       : yogun hafta yukunun ortalamadan farki (0 merkezli, olcekli)
 *
 * Beklenen deger doktorun kendi toplamindan turetilir; boylece yarim zamanli
 * calisan ya da sonradan katilan biri haksiz yere cezalanmaz.
 */
export function rhythmBias(history, doctorIds, { clampShifts = 3 } = {}) {
  const weekday = new Map();
  const dense = new Map();
  for (const id of doctorIds) {
    weekday.set(id, new Array(7).fill(0));
    dense.set(id, 0);
  }
  if (!history || !doctorIds.length) return { weekday, dense, empty: true };

  const rows = doctorIds.map((id) => history[id]).filter(Boolean);
  if (!rows.length) return { weekday, dense, empty: true };

  const toplamNobet = rows.reduce((s, r) => s + (r.shifts || 0), 0);
  if (!toplamNobet) return { weekday, dense, empty: true };

  // Ayin kendi yapisindan gelen egilim (orn. hafta sonu gunleri daha az
  // olabilir) cezaya donusmesin diye beklenen deger GENEL dagilimdan turetilir.
  const genel = new Array(7).fill(0);
  for (const r of rows) for (let i = 0; i < 7; i += 1) genel[i] += r.weekday?.[i] || 0;

  for (const id of doctorIds) {
    const r = history[id];
    if (!r || !r.shifts) continue;
    const pay = r.shifts / toplamNobet;
    const v = weekday.get(id);
    for (let i = 0; i < 7; i += 1) {
      const beklenen = genel[i] * pay;
      v[i] = clamp((r.weekday?.[i] || 0) - beklenen, -clampShifts, clampShifts);
    }
  }

  const ortYogun = rows.reduce((s, r) => s + (r.denseExcess || 0), 0) / rows.length;
  const olcek = Math.max(1, ortYogun);
  for (const id of doctorIds) {
    const r = history[id];
    if (!r || !r.shifts) continue;
    dense.set(id, clamp(((r.denseExcess || 0) - ortYogun) / olcek, -1, 2));
  }

  return { weekday, dense, empty: false, months: null };
}
