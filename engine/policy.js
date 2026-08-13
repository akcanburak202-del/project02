/**
 * Tercih girisine dair yetki kurallari.
 *
 * Bu kurallar hem sunucuda hem tarayicida calisan demo surumunde ayni
 * sekilde uygulanmali; bu yuzden tek bir yerde tanimlanir.
 *
 * Kural: izin / rapor (off) kaydini YALNIZCA yonetici girebilir. Doktor
 * kendi ekranindan sadece "istiyorum" ve "istemiyorum" isaretler.
 */

export const PREF_VALUES = new Set(['want', 'avoid', 'off']);
export const DOCTOR_PREF_VALUES = new Set(['want', 'avoid']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Gecersiz tarih ve izin verilmeyen degerleri ayiklar. */
export function sanitizePreferences(prefs, allowed = PREF_VALUES) {
  const out = {};
  for (const [iso, value] of Object.entries(prefs || {})) {
    if (!ISO_DATE.test(iso)) continue;
    if (!allowed.has(value)) continue;
    out[iso] = value;
  }
  return out;
}

/**
 * Bir doktorun tercih haritasinin yeni halini uretir.
 *
 * Yonetici gonderdiginde harita oldugu gibi degisir.
 * Doktor gonderdiginde:
 *   - gonderdigi "off" degerleri sessizce dusurulur,
 *   - yoneticinin daha once koydugu izin gunleri korunur.
 * Aksi halde doktorun kaydi, yoneticinin girdigi izinleri silerdi.
 */
export function applyPreferenceUpdate(existing, incoming, { isAdmin }) {
  if (isAdmin) return sanitizePreferences(incoming, PREF_VALUES);

  const next = sanitizePreferences(incoming, DOCTOR_PREF_VALUES);
  for (const [iso, value] of Object.entries(existing || {})) {
    if (value === 'off') next[iso] = 'off';
  }
  return next;
}
