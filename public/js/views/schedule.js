/**
 * Cizelge calisma ekrani: aylik takvim, elle duzenleme, revizyon araclari.
 */

import {
  DAY_SHORT, api, confirmDialog, deviationBar, fmtDate, fmtDateTime, fmtHours, fmtSigned,
  h, icon, openModal, toast, todayIso, trMonthLabel,
} from '../core.js';
import { applyWorkspace, refreshMonths, render, state, withBusy } from '../state.js';

export function doctorLabel(ws, id, { short = true } = {}) {
  const d = ws.doctors?.[id];
  if (!d) return id ? '?' : '';
  if (short && d.code) return d.code;
  return d.name;
}

export function doctorName(ws, id) {
  return ws.doctors?.[id]?.name || id || '(boş)';
}

/** "09:00–24:00" -> "09-24", "15:00–09:00 (+1)" -> "15-09⁺" */
function shortTime(label) {
  return label.replaceAll(':00', '').replace('–', '-').replace(' (+1)', '⁺');
}

/* ------------------------- Aday secim penceresi -------------------- */

async function openSlotEditor(slot) {
  const ws = state.ws;
  const locked = isLocked(slot.date);
  let candidates = [];
  try {
    const out = await api.get(`/api/months/${ws.month.id}/candidates?slot=${encodeURIComponent(slot.id)}`);
    candidates = out.candidates;
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const day = ws.days.find((d) => d.iso === slot.date);
  const current = ws.assignments[slot.id];
  const pinned = (ws.month.pinned || []).includes(slot.id);

  openModal((close) => {
    const assign = async (doctorId) => {
      const out = await withBusy(
        () => api.post(`/api/months/${ws.month.id}/assign`, { slotId: slot.id, doctorId }),
        { success: doctorId ? `${doctorName(ws, doctorId)} atandı` : 'Slot boşaltıldı' },
      );
      if (!out) return;
      close();
      applyWorkspace(out);
    };

    return h(
      'div',
      null,
      h('h3', null, `${fmtDate(slot.date)} ${day?.dayName || ''} · ${slot.label}`),
      h('p', { class: 'modal-text' },
        `${slot.timeLabel} · ${fmtHours(slot.hours)} saat · `,
        `${slot.dayType === 'weekend' ? 'Hafta sonu/tatil' : 'Hafta içi'} · `,
        `paylaşımsız ${fmtHours(slot.cat.wdSolo + slot.cat.weSolo)} sa, paylaşımlı ${fmtHours(slot.cat.wdShared + slot.cat.weShared)} sa`),

      locked && h('div', { class: 'banner banner-info mt-16' },
        icon('lock'), `Bu tarih ${fmtDate(ws.month.lockedThrough)} tarihine kadar dondurulmuş; değiştirilemez.`),

      h('div', { class: 'row mt-16 mb-8' },
        h('h4', { class: 'grow' }, 'Atanabilecek doktorlar'),
        h('span', { class: 'small muted' }, 'atama sonrası hedeften sapma')),

      h('div', null, candidates.map((c) => {
        const blocked = !c.feasible || locked;
        const better = c.costDelta < -0.5;
        const sapma = c.deviationAfter;
        return h(
          'div',
          {
            class: `cand${blocked ? ' blocked' : ''}${c.current ? ' current' : ''}`,
            onClick: () => !blocked && !c.current && assign(c.doctorId),
            title: blocked
              ? c.reasons.map((r) => r.message).join(', ')
              : `Bu doktoru ata (denge puanı ${fmtSigned(c.costDelta, 0)}; düşük olan daha iyi)`,
          },
          h('div', null,
            h('div', { class: 'cand-name' },
              c.name,
              c.current && h('span', { class: 'chip chip-info', style: { marginLeft: '6px' } }, 'şu an atanmış')),
            !c.feasible
              ? h('div', { class: 'cand-why' }, c.reasons.map((r) => r.message).join(' · '))
              : h('div', { class: 'small muted' },
                `atanırsa ${c.shiftsAfter} nöbet · hedefe göre ${fmtSigned(sapma)} sa`)),
          h('div', { class: 'small muted nowrap' }, prefBadge(ws, c.doctorId, slot.date)),
          h('div', { class: `cand-delta ${better ? 'delta-good' : c.costDelta > 0.5 ? 'delta-bad' : ''}` },
            c.feasible ? (better ? '↓ dengeler' : c.costDelta > 40 ? '↑ bozar' : '≈ nötr') : '—'),
        );
      })),

      h('div', { class: 'modal-actions' },
        current && !locked && h('button', {
          class: 'btn',
          onClick: async () => {
            const out = await withBusy(
              () => api.post(`/api/months/${ws.month.id}/pin`, { slotId: slot.id, pinned: !pinned }),
              { success: pinned ? 'Sabitleme kaldırıldı' : 'Slot sabitlendi' },
            );
            if (out) { close(); applyWorkspace(out); }
          },
        }, pinned ? 'Sabitlemeyi kaldır' : 'Sabitle (yeniden üretimde korunur)'),
        current && !locked && h('button', { class: 'btn btn-danger', onClick: () => assign(null) }, 'Boşalt'),
        h('button', { class: 'btn', onClick: close }, 'Kapat')),
    );
  }, { wide: false });
}

function prefBadge(ws, doctorId, date) {
  const value = ws.preferences?.[doctorId]?.[date];
  if (value === 'want') return h('span', { class: 'chip chip-ok' }, 'istiyor');
  if (value === 'avoid') return h('span', { class: 'chip chip-warn' }, 'istemiyor');
  if (value === 'off') return h('span', { class: 'chip chip-danger' }, 'izinli');
  return '';
}

function isLocked(date) {
  const lt = state.ws?.month?.lockedThrough;
  return !!lt && date <= lt;
}

/* ----------------------------- Takas modu ------------------------- */

async function handleSwapClick(slot) {
  const ws = state.ws;
  // '__arm__' = takas modu acildi ama henuz ilk nobet secilmedi.
  if (!state.selection || state.selection === '__arm__') {
    state.selection = slot.id;
    render();
    return;
  }
  if (state.selection === slot.id) {
    state.selection = null;
    render();
    return;
  }
  const a = state.selection;
  const b = slot.id;
  state.selection = null;

  const check = await withBusy(() =>
    api.get(`/api/months/${ws.month.id}/swap-check?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`));
  if (!check) return render();

  const r = check.result;
  if (!r.ok) {
    toast(`Takas yapılamaz: ${r.reasons.join(', ')}`, 'error', 6000);
    return render();
  }
  const etki = r.costDelta < 0 ? 'dengeyi iyileştirir' : r.costDelta > 0 ? 'dengeyi bir miktar bozar' : 'dengeyi değiştirmez';
  const ok = await confirmDialog(
    `${doctorName(ws, ws.assignments[a])} ile ${doctorName(ws, ws.assignments[b])} nöbetleri değiştirilecek. Bu takas ${etki} (Δ ${fmtSigned(r.costDelta, 0)}).`,
    { title: 'Nöbet takası', okLabel: 'Takas et' },
  );
  if (!ok) return render();

  const out = await withBusy(() => api.post(`/api/months/${ws.month.id}/swap`, { slotA: a, slotB: b }), {
    success: 'Takas yapıldı',
  });
  if (out) applyWorkspace(out);
  else render();
}

/* ---------------------------- Araç çubuğu ------------------------- */

function generateDialog() {
  const ws = state.ws;
  const hasSchedule = Object.keys(ws.assignments || {}).length > 0;

  openModal((close) => {
    const mode = { value: hasSchedule ? 'from' : 'all' };
    const fromInput = h('input', { type: 'date', value: todayIso(), min: `${ws.month.id}-01` });
    const lockCheck = h('input', { type: 'checkbox', checked: true });
    const seedInput = h('input', { type: 'number', placeholder: 'boş = otomatik' });
    const body = h('div');

    const paint = () => {
      body.replaceChildren(
        h('div', { class: 'col' },
          h('label', { class: 'inline' },
            h('input', {
              type: 'radio', name: 'genmode', checked: mode.value === 'all',
              onChange: () => { mode.value = 'all'; paint(); },
            }),
            'Ayın tamamını yeniden planla'),
          h('div', { class: 'small muted', style: { marginLeft: '22px' } },
            'Sabitlenmiş ve dondurulmuş slotlar yine korunur.'),

          h('label', { class: 'inline mt-8' },
            h('input', {
              type: 'radio', name: 'genmode', checked: mode.value === 'from',
              onChange: () => { mode.value = 'from'; paint(); },
            }),
            'Belirli bir tarihten itibaren yeniden planla'),
          h('div', { style: { marginLeft: '22px' } },
            h('div', { class: 'small muted mb-8' },
              'Bu tarihten önceki günler aynen kalır; sadece sonrası yeniden düzenlenir. Ay içi revizyon için bunu kullanın.'),
            h('div', { class: 'row' },
              fromInput,
              h('label', { class: 'inline nowrap' }, lockCheck, 'Öncesini dondur')),
          ),

          h('details', { class: 'mt-16' },
            h('summary', { class: 'small muted' }, 'Gelişmiş'),
            h('label', { class: 'field mt-8' }, 'Rastgelelik tohumu (aynı tohum aynı çizelgeyi üretir)', seedInput)),
        ),
      );
      fromInput.disabled = mode.value !== 'from';
      lockCheck.disabled = mode.value !== 'from';
    };
    paint();

    return h('div', null,
      h('h3', null, `${trMonthLabel(ws.month.id)} çizelgesi`),
      h('p', { class: 'modal-text' },
        'Çizelge; katılım bilgileri, tercihler, dinlenme kuralları ve devreden saat dengesi birlikte gözetilerek üretilir.'),
      body,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            const fromDate = mode.value === 'from' ? fromInput.value : null;
            if (mode.value === 'from' && !fromDate) return toast('Tarih seçin', 'error');
            const seed = seedInput.value === '' ? null : Number(seedInput.value);

            if (fromDate && lockCheck.checked) {
              const prev = new Date(`${fromDate}T00:00:00Z`);
              prev.setUTCDate(prev.getUTCDate() - 1);
              await api.put(`/api/months/${ws.month.id}/config`, {
                lockedThrough: prev.toISOString().slice(0, 10),
              });
            }
            const out = await withBusy(
              () => api.post(`/api/months/${ws.month.id}/generate`, { fromDate, seed }),
              { success: 'Çizelge hazır' },
            );
            if (!out) return;
            close();
            applyWorkspace(out);
          },
        }, 'Çizelgeyi üret')),
    );
  });
}

function freezeDialog() {
  const ws = state.ws;
  openModal((close) => {
    const input = h('input', { type: 'date', value: ws.month.lockedThrough || todayIso() });
    return h('div', null,
      h('h3', null, 'Çizelgeyi dondur'),
      h('p', { class: 'modal-text' },
        'Seçilen tarih dahil olmak üzere öncesindeki tüm nöbetler değiştirilemez hale gelir. Uygulanmış günleri korumak için kullanılır; denge hesabında bu saatler sayılmaya devam eder.'),
      h('label', { class: 'field mt-16' }, 'Şu tarihe kadar dondur (dahil)', input),
      h('div', { class: 'modal-actions' },
        ws.month.lockedThrough && h('button', {
          class: 'btn',
          onClick: async () => {
            const out = await withBusy(
              () => api.put(`/api/months/${ws.month.id}/config`, { lockedThrough: null }),
              { success: 'Dondurma kaldırıldı' },
            );
            if (out) { close(); applyWorkspace(out); }
          },
        }, 'Dondurmayı kaldır'),
        h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            const out = await withBusy(
              () => api.put(`/api/months/${ws.month.id}/config`, { lockedThrough: input.value }),
              { success: 'Dondurma uygulandı' },
            );
            if (out) { close(); applyWorkspace(out); }
          },
        }, 'Uygula')),
    );
  });
}

function toolbar() {
  const ws = state.ws;
  const m = ws.month;
  const swapMode = !!state.selection;
  const hasSchedule = Object.keys(ws.assignments || {}).some((k) => ws.assignments[k]);

  const statusChip = m.status === 'final'
    ? h('span', { class: 'chip chip-ok' }, icon('check'), 'Kesinleşti')
    : m.status === 'published'
      ? h('span', { class: 'chip chip-info' }, 'Yayında')
      : h('span', { class: 'chip' }, 'Taslak');

  return h('div', { class: 'toolbar no-print' },
    statusChip,
    m.lockedThrough && h('span', { class: 'chip chip-warn', title: 'Bu tarihe kadar değiştirilemez' },
      icon('lock'), `${fmtDate(m.lockedThrough)}`),
    m.generatedAt && h('span', { class: 'small muted nowrap' }, `Üretim: ${fmtDateTime(m.generatedAt)}`),
    h('div', { class: 'sep' }),

    m.status !== 'final' && h('button', { class: 'btn btn-primary', onClick: generateDialog },
      hasSchedule ? 'Yeniden planla' : 'Çizelgeyi üret'),
    m.status !== 'final' && hasSchedule && h('button', {
      class: swapMode ? 'btn btn-primary' : 'btn',
      onClick: () => { state.selection = swapMode ? null : '__arm__'; render(); },
      title: 'İki nöbeti karşılıklı değiştir',
    }, icon('swap'), swapMode ? 'Takas: iptal' : 'Takas'),
    m.status !== 'final' && h('button', { class: 'btn', onClick: freezeDialog }, icon('lock'), 'Dondur'),
    m.status !== 'final' && ws.config?.shiftPolicy?.mode === 'flexible' && h('button', {
      class: 'btn',
      onClick: proposeDialog,
      title: 'Gün desenlerini araç denesin; sonucu görüp siz karar verin',
    }, 'Desen öner'),

    h('div', { class: 'sep' }),
    m.status === 'draft' && hasSchedule && h('button', {
      class: 'btn',
      onClick: async () => {
        const out = await withBusy(() => api.post(`/api/months/${m.id}/status`, { status: 'published' }),
          { success: 'Çizelge yayınlandı, doktorlar görebilir' });
        if (out) { await refreshMonths(); applyWorkspace(out); }
      },
    }, 'Yayınla'),
    m.status === 'published' && h('button', {
      class: 'btn',
      onClick: async () => {
        const out = await withBusy(() => api.post(`/api/months/${m.id}/status`, { status: 'draft' }));
        if (out) { await refreshMonths(); applyWorkspace(out); }
      },
    }, 'Yayından kaldır'),
    m.status === 'published' && h('button', {
      class: 'btn',
      onClick: async () => {
        const ok = await confirmDialog(
          'Ay kesinleştirilecek. Bu ayın hedeften sapmaları devir defterine işlenir ve sonraki aylarda dengelenir. Çizelge değiştirilemez hale gelir.',
          { title: 'Ayı kesinleştir', okLabel: 'Kesinleştir' },
        );
        if (!ok) return;
        const out = await withBusy(() => api.post(`/api/months/${m.id}/finalize`), { success: 'Ay kesinleştirildi' });
        if (out) { await refreshMonths(); applyWorkspace(out); }
      },
    }, icon('check'), 'Kesinleştir'),
    m.status === 'final' && h('button', {
      class: 'btn',
      onClick: async () => {
        const ok = await confirmDialog('Kesinleştirme geri alınacak ve devir defteri kaydı silinecek.', {
          title: 'Geri al', okLabel: 'Geri al', danger: true,
        });
        if (!ok) return;
        const out = await withBusy(() => api.post(`/api/months/${m.id}/unfinalize`), { success: 'Geri alındı' });
        if (out) { await refreshMonths(); applyWorkspace(out); }
      },
    }, 'Kesinleştirmeyi geri al'),

    h('div', { class: 'grow' }),
    h('a', { class: 'btn btn-sm', href: `/api/months/${m.id}/export?kind=schedule` }, 'CSV: çizelge'),
    h('a', { class: 'btn btn-sm', href: `/api/months/${m.id}/export?kind=summary` }, 'CSV: özet'),
    h('button', { class: 'btn btn-sm', onClick: () => window.print() }, 'Yazdır'),
  );
}

/* --------------------------- Gün deseni --------------------------- */

/**
 * Gunun duzenini secme penceresi.
 *
 * Esneklik ile ongorulebilirligin bulustugu yer burasi: arac saatleri kendi
 * ayarlar ama gunun KAC KISIYLE ve HANGI SEKILDE gececegi listeyi hazirlayanin
 * karari olarak kalir. Her desen, uretecegi fiili mesai dagilimiyla birlikte
 * gosterilir.
 */
function openPatternPicker(day) {
  const ws = state.ws;
  const secili = ws.dayPatterns?.[day.iso] || null;
  const gecerli = day.patternId;

  openModal((close) => {
    const uygula = async (patternId, dates) => {
      const out = await withBusy(
        () => api.post(`/api/months/${ws.month.id}/day-pattern`, { dates, patternId }),
        { success: 'Gün deseni uygulandı' },
      );
      if (!out) return;
      close();
      applyWorkspace(out);
    };

    const ayniTip = ws.days.filter((d) => d.type === day.type && !isLocked(d.iso)).map((d) => d.iso);

    return h('div', null,
      h('h3', null, `${fmtDate(day.iso)} ${day.dayName} — gün deseni`),
      h('p', { class: 'modal-text' },
        'Günün kaç doktorla ve hangi düzende geçeceğini siz seçersiniz; araç yalnızca ',
        'saatleri ve kimin nöbet tutacağını belirler. Böylece esneklik öngörülebilir kalır.'),

      h('div', { class: 'mt-16' }, (ws.patterns || []).map((p) => {
        const aktif = p.id === gecerli;
        return h('div', {
          class: `cand${aktif ? ' current' : ''}`,
          style: { gridTemplateColumns: '1fr auto' },
          onClick: () => !aktif && uygula(p.id, [day.iso]),
        },
          h('div', null,
            h('div', { class: 'cand-name' }, p.name,
              aktif && h('span', { class: 'chip chip-info', style: { marginLeft: '6px' } }, 'bu günde kullanılıyor')),
            p.note && h('div', { class: 'small muted' }, p.note),
            h('div', { class: 'small mt-8' }, p.preview.map((v) =>
              h('div', { class: 'mono', style: { fontSize: '11.5px' } },
                `${v.label.padEnd(16, ' ')} ${v.timeLabel}  ·  ${fmtHours(v.presenceHours)} sa hastanede  ·  ${fmtHours(v.effectiveHours)} sa fiilî`)))),
          h('div', { class: 'nowrap' },
            h('span', { class: 'chip' }, `${p.doctorsPerDay} doktor`),
            !aktif && h('button', {
              class: 'btn btn-sm mt-8',
              onClick: (e) => { e.stopPropagation(); uygula(p.id, ayniTip); },
              title: `Ayın tüm ${day.type === 'weekend' ? 'hafta sonu' : 'hafta içi'} günlerine uygula`,
            }, 'Tümüne uygula')));
      })),

      secili && h('div', { class: 'small muted mt-8' },
        'Bu gün için özel bir desen seçilmiş. Varsayılana dönmek için aşağıdaki düğmeyi kullanın.'),

      h('div', { class: 'modal-actions' },
        secili && h('button', {
          class: 'btn',
          onClick: () => uygula(null, [day.iso]),
        }, 'Varsayılana dön'),
        h('button', { class: 'btn', onClick: close }, 'Kapat')));
  }, { wide: true });
}

/* ------------------------ Desen onerisi --------------------------- */

/**
 * DESEN ONERISI — arac arar, yonetici karar verir.
 *
 * Neden otomatik uygulanmaz: bir gunde kac doktor bulunacagi adalet degil,
 * bakim kalitesi ve guvenlik kararidir. Arac hasta yogunlugunu bilmez.
 * Bu yuzden arama yoneticinin cizdigi sinirlar icinde yapilir ve sonuc
 * yalnizca bir KARSILASTIRMA olarak sunulur.
 */
function karsilastirmaSatiri(baslik, ozet, { vurgu = false, taban = null } = {}) {
  const fark = (deger, tabanDeger, tersYon = true) => {
    if (taban === null || Math.abs(deger - tabanDeger) < 0.005) return null;
    const iyi = tersYon ? deger < tabanDeger : deger > tabanDeger;
    return h('span', {
      class: iyi ? 'delta-good' : 'delta-bad',
      style: { marginLeft: '4px', fontSize: '11px' },
    }, `${deger > tabanDeger ? '+' : '−'}${fmtHours(Math.abs(deger - tabanDeger))}`);
  };

  return h('tr', { style: vurgu ? { fontWeight: 640 } : null },
    h('td', null, baslik),
    h('td', { class: 'num' }, String(ozet.slots)),
    h('td', { class: 'num' },
      ozet.countsEqual
        ? h('span', { class: 'chip chip-ok' }, `herkes ${ozet.counts[0]}`)
        : `${Math.min(...ozet.counts)}–${Math.max(...ozet.counts)}`),
    h('td', { class: 'num' }, fmtHours(ozet.effSpread), taban && fark(ozet.effSpread, taban.effSpread)),
    h('td', { class: 'num' }, fmtHours(ozet.presSpread), taban && fark(ozet.presSpread, taban.presSpread)),
    h('td', { class: 'num' }, ozet.warnings ? h('span', { class: 'chip chip-warn' }, String(ozet.warnings)) : '—'),
  );
}

function proposeDialog() {
  const ws = state.ws;
  const acikDesen = (ws.patterns || []).filter((p) => p.enabled !== false);
  const kisiSecenekleri = [...new Set(acikDesen.map((p) => p.doctorsPerDay))].sort((a, b) => a - b);

  openModal((close) => {
    const minSel = h('select', null,
      ...kisiSecenekleri.map((n) => h('option', { value: String(n), selected: n === 2 }, `${n} doktor`)));
    const maxSel = h('select', null,
      ...kisiSecenekleri.map((n) => h('option', { value: String(n), selected: n === Math.min(3, Math.max(...kisiSecenekleri)) }, `${n} doktor`)));
    const manuelKoru = h('input', { type: 'checkbox', checked: true });

    const sonuc = h('div');
    const govde = h('div');

    const ciz = () => {
      govde.replaceChildren(
        h('p', { class: 'modal-text' },
          'Araç, açık gün desenlerinin kombinasyonlarını deneyip nöbet sayısı ve fiilî mesai ',
          'dengesi en iyi çıkanı bulur. ',
          h('strong', null, 'Hiçbir şey kendiliğinden değişmez'),
          ' — sonucu görüp uygulayıp uygulamayacağınıza siz karar verirsiniz.'),

        h('div', { class: 'banner banner-info mt-8' },
          h('strong', null, 'Sınırları siz koyarsınız. '),
          'Bir günde kaç doktor bulunacağı bir hasta güvenliği kararıdır; araç bunu bilemez. ',
          'Aşağıdaki alt/üst sınırın dışına çıkan hiçbir öneri üretilmez.'),

        h('div', { class: 'row mt-16' },
          h('label', { class: 'field' }, 'Günde en az', minSel),
          h('label', { class: 'field' }, 'Günde en çok', maxSel)),
        h('label', { class: 'inline mt-8' }, manuelKoru,
          'Elle desen seçtiğim günlere dokunma'),
        ws.month.lockedThrough && h('div', { class: 'small muted mt-8' },
          `${fmtDate(ws.month.lockedThrough)} tarihine kadar dondurulmuş günler her hâlükârda korunur.`),

        h('div', { class: 'small muted mt-16' },
          'Arama her adayı gerçek bir çizelge çözerek değerlendirir; birkaç saniye sürebilir.'),
        sonuc,
      );
    };

    const ara = async () => {
      const out = await withBusy(
        () => api.post(`/api/months/${ws.month.id}/propose-patterns`, {
          minDoctors: Number(minSel.value),
          maxDoctors: Number(maxSel.value),
          keepManual: manuelKoru.checked,
        }),
      );
      if (!out) return;
      const p = out.proposal;

      if (p.unavailable) {
        sonuc.replaceChildren(h('div', { class: 'banner banner-warn mt-16' }, p.unavailable));
        return;
      }

      const taban = p.current.summary;
      sonuc.replaceChildren(
        h('h4', { class: 'mt-16' }, `${p.searched} yapılandırma denendi`),
        h('table', { class: 'mt-8' },
          h('thead', null, h('tr', null,
            h('th', null, 'Yapılandırma'),
            h('th', { class: 'num' }, 'Nöbet'),
            h('th', { class: 'num' }, 'Kişi başı'),
            h('th', { class: 'num', title: 'En çok ve en az fiilî mesai arasındaki fark' }, 'Fiilî fark'),
            h('th', { class: 'num', title: 'Hastanede bulunma saatleri arasındaki fark' }, 'Bulunma farkı'),
            h('th', { class: 'num' }, 'Uyarı'))),
          h('tbody', null,
            karsilastirmaSatiri('Şu anki düzen', taban, { vurgu: true }),
            ...p.candidates.map((c) => karsilastirmaSatiri(c.label, c.summary, { taban })))),

        !p.best && h('div', { class: 'banner banner-ok mt-16' },
          'Şu anki düzen, sınırlarınız içinde bulunabilen en iyi düzen. Değiştirmeye gerek yok.'),

        p.best && h('div', { class: 'banner banner-info mt-16' },
          h('div', null, h('strong', null, 'Öneri: '), p.best.label),
          h('ul', { class: 'mt-8' },
            p.best.summary.countsEqual && !taban.countsEqual
              && h('li', null, `Nöbet sayısı herkeste eşitleniyor (${p.best.summary.counts[0]} nöbet).`),
            p.best.summary.effSpread < taban.effSpread
              && h('li', null, `Fiilî mesai farkı ${fmtHours(taban.effSpread)} sa → ${fmtHours(p.best.summary.effSpread)} sa.`),
            p.best.staffingDelta
              && h('li', null,
                `Ay boyunca toplam nöbet sayısı ${p.best.staffingDelta > 0 ? 'artıyor' : 'azalıyor'}: `,
                `${taban.slots} → ${p.best.summary.slots}. `,
                h('strong', null, 'Bu bir kadro kararıdır'),
                ' — günlük toplam iş yükü değişmez, aynı iş daha fazla/az nöbete bölünür.'),
            p.best.exceptions
              ? h('li', null, `${p.best.exceptions} gün varsayılan desenden farklı olacak.`)
              : h('li', null, 'Ay boyunca tek bir düzen — istisna günü yok.'))),

        p.best && h('div', { class: 'banner banner-warn mt-8' },
          'Uygulanırsa bu ayın mevcut atamaları silinir ve çizelgeyi yeniden üretmeniz gerekir. ',
          'Dondurulmuş günler korunur.'),

        p.best && h('div', { class: 'modal-actions' },
          h('button', {
            class: 'btn btn-primary',
            onClick: async () => {
              const ok = await confirmDialog(
                `"${p.best.label}" düzeni uygulanacak. Bu ayın mevcut atamaları silinecek ve çizelgeyi yeniden üretmeniz gerekecek.`,
                { title: 'Öneriyi uygula', okLabel: 'Uygula' },
              );
              if (!ok) return;
              const res = await withBusy(
                () => api.post(`/api/months/${ws.month.id}/apply-patterns`, { dayPatterns: p.best.dayPatterns }),
                { success: 'Gün desenleri uygulandı — çizelgeyi yeniden üretin' },
              );
              if (!res) return;
              close();
              applyWorkspace(res);
            },
          }, 'Öneriyi uygula')),
      );
    };

    ciz();

    return h('div', null,
      h('h3', null, 'Gün deseni öner'),
      govde,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: close }, 'Kapat'),
        h('button', { class: 'btn btn-primary', onClick: ara }, 'Ara')));
  }, { wide: true });
}

/* ------------------------------ Takvim ---------------------------- */

function slotChip(slot) {
  const ws = state.ws;
  const doctorId = ws.assignments[slot.id];
  const locked = isLocked(slot.date);
  const pinned = (ws.month.pinned || []).includes(slot.id);
  const pref = doctorId ? ws.preferences?.[doctorId]?.[slot.date] : null;
  const selected = state.selection === slot.id;
  const swapArmed = !!state.selection;

  return h('button', {
    class: [
      'slot',
      slot.isNight ? 'night' : 'dayshift',
      !doctorId && 'empty',
      pinned && 'pinned',
      locked && 'locked',
      selected && 'selected',
      swapArmed && !selected && doctorId && !locked && 'highlight',
    ].filter(Boolean).join(' '),
    title: `${slot.label} ${slot.timeLabel} · ${fmtHours(slot.hours)} sa\n${doctorId ? doctorName(ws, doctorId) : 'Atanmamış'}${locked ? '\n(dondurulmuş)' : ''}`,
    onClick: () => {
      if (state.selection) {
        if (locked || !doctorId) return toast('Bu slot takas edilemez', 'warn');
        handleSwapClick(slot);
        return;
      }
      if (ws.month.status === 'final') return toast('Ay kesinleşti, düzenlenemez', 'warn');
      openSlotEditor(slot);
    },
  },
    h('span', { class: 'slot-time' }, shortTime(slot.timeLabel)),
    h('span', { class: 'slot-name' }, doctorId ? doctorLabel(ws, doctorId) : '—'),
    h('span', { class: 'slot-flags' },
      pref === 'want' && h('span', { class: 'pref-dot pref-want', title: 'İstediği gün' }),
      pref === 'avoid' && h('span', { class: 'pref-dot pref-avoid', title: 'İstemediği gün' }),
      pinned && icon('pin'),
      locked && icon('lock')),
  );
}

function calendar() {
  const ws = state.ws;
  const today = todayIso();
  const cells = [];
  const first = ws.days[0];
  const lead = (first.weekday + 6) % 7; // Pazartesi ile baslayan hafta
  for (let i = 0; i < lead; i += 1) cells.push(h('div', { class: 'day blank' }));

  for (const day of ws.days) {
    const slots = ws.slots.filter((s) => s.date === day.iso);
    const frozen = isLocked(day.iso);
    const desenler = ws.patterns || [];
    cells.push(h('div', {
      class: ['day', day.type === 'weekend' && 'we', day.isHoliday && 'holiday', frozen && 'frozen', day.iso === today && 'today']
        .filter(Boolean).join(' '),
    },
      h('div', { class: 'day-head' },
        h('span', { class: 'day-num' }, day.day),
        h('span', null, DAY_SHORT[day.weekday]),
        h('span', { class: 'flag' }, day.isHoliday && h('span', { class: 'chip chip-danger' }, 'tatil'), frozen && icon('lock'))),
      // Gunun deseni: hangi duzenin kullanildigi her zaman gorunur, tiklanarak degistirilir.
      desenler.length > 1 && day.patternName && h('button', {
        class: 'day-pattern',
        disabled: frozen || ws.month.status === 'final',
        title: `Gün deseni: ${day.patternName}\nDeğiştirmek için tıkla`,
        onClick: () => openPatternPicker(day),
      }, day.patternName),
      slots.map(slotChip)));
  }

  return h('div', null,
    h('div', { class: 'print-title' },
      h('h2', null, `${trMonthLabel(ws.month.id)} Nöbet Çizelgesi`),
      h('div', { class: 'small muted' }, `${state.hospitalName} · ${fmtDateTime(new Date().toISOString())}`)),
    h('div', { class: 'calendar' },
      ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d, i) =>
        h('div', { class: `cal-head${i >= 5 ? ' we' : ''}` }, d)),
      cells));
}

/* ----------------------------- Yan panel -------------------------- */

function sidePanel() {
  const ws = state.ws;
  const effKeys = (ws.categories || []).filter((c) => c.group === 'effective').map((c) => c.key);
  const eff = (vec) => effKeys.reduce((a, k) => a + (vec[k] || 0), 0);
  const rows = [...ws.report.rows].sort((a, b) => eff(b.actual) - eff(a.actual));
  const issues = [
    ...(ws.report.issues || []),
    ...(ws.warnings || []).filter((w) => w.level !== 'info'),
  ];

  return h('aside', { class: 'side no-print' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'grow' }, 'Denge'),
        h('span', { class: 'small muted', title: 'Fiilî mesai = bulunma saati / o an hastanedeki doktor sayısı' }, 'fiilî mesai')),
      h('div', { class: 'card-body' },
        rows.map((r) => {
          const a = eff(r.actual);
          const t = eff(r.target);
          return h('div', { class: 'mini-row' },
            h('div', null,
              h('div', { class: 'mini-name' }, doctorName(ws, r.doctorId)),
              h('div', { class: 'mini-sub' },
                `${r.shifts} nöbet · ${fmtHours(a)}/${fmtHours(t)} sa · bulunma ${fmtHours(r.totalHours)}`)),
            h('div', { class: 'row', style: { gap: '6px' } },
              h('span', { class: 'mini-sub nowrap', style: { minWidth: '38px', textAlign: 'right' } }, fmtSigned(a - t)),
              deviationBar(a - t, 6)));
        }))),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'grow' }, 'Uyarılar'),
        h('span', { class: `chip ${issues.length ? 'chip-warn' : 'chip-ok'}` }, issues.length || 'temiz')),
      h('div', { class: 'card-body' },
        issues.length
          ? issues.slice(0, 60).map((i) => h('div', { class: `issue issue-${i.level}` }, icon('warn'), h('span', null, i.message)))
          : h('div', { class: 'small muted' }, 'Kural ihlali veya boş slot yok.'))),
  );
}

/* ------------------------------ Ana ------------------------------- */

export function renderSchedule() {
  const ws = state.ws;
  if (!ws) return h('div', { class: 'empty' }, 'Ay verisi yüklenemedi.');

  const banners = [];
  if (state.selection) {
    banners.push(h('div', { class: 'banner banner-info no-print' },
      icon('swap'),
      state.selection === '__arm__'
        ? 'Takas modu: değiştirmek istediğin ilk nöbete tıkla.'
        : 'Şimdi takas edilecek ikinci nöbete tıkla. Vazgeçmek için aynı nöbete tekrar tıkla.'));
  }
  if (ws.report.unassigned?.length) {
    banners.push(h('div', { class: 'banner banner-danger no-print' },
      icon('warn'), `${ws.report.unassigned.length} slot boş. Kadro veya kurallar bu ay için fazla dar olabilir.`));
  }
  const errors = (ws.warnings || []).filter((w) => w.level === 'error');
  if (errors.length) {
    banners.push(h('div', { class: 'banner banner-danger no-print' },
      icon('warn'), errors.map((e) => e.message).join(' ')));
  }
  if (!Object.keys(ws.assignments || {}).length) {
    banners.push(h('div', { class: 'banner banner-info no-print' },
      'Bu ay için henüz çizelge üretilmedi. Önce "Katılım" sekmesinden kadroyu gözden geçir, sonra "Çizelgeyi üret" de.'));
  }

  return h('div', null,
    toolbar(),
    banners,
    h('div', { class: 'workspace' }, calendar(), sidePanel()));
}
