/**
 * Cizelge calisma ekrani: aylik takvim, elle duzenleme, revizyon araclari.
 */

import {
  DAY_SHORT, api, confirmDialog, deviationBar, fmtDate, fmtDateTime, fmtHours, fmtSigned,
  h, icon, openModal, toast, todayIso, trMonthLabel,
} from '../core.js';
import { applyWorkspace, refreshMonths, render, state, withBusy } from '../app.js';

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
    cells.push(h('div', {
      class: ['day', day.type === 'weekend' && 'we', day.isHoliday && 'holiday', frozen && 'frozen', day.iso === today && 'today']
        .filter(Boolean).join(' '),
    },
      h('div', { class: 'day-head' },
        h('span', { class: 'day-num' }, day.day),
        h('span', null, DAY_SHORT[day.weekday]),
        h('span', { class: 'flag' }, day.isHoliday && h('span', { class: 'chip chip-danger' }, 'tatil'), frozen && icon('lock'))),
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
  const rows = [...ws.report.rows].sort((a, b) => b.totalHours - a.totalHours);
  const issues = [
    ...(ws.report.issues || []),
    ...(ws.warnings || []).filter((w) => w.level !== 'info'),
  ];

  return h('aside', { class: 'side no-print' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'grow' }, 'Denge'),
        h('span', { class: 'small muted' }, `ort. sapma ${fmtHours(ws.report.meanAbsDeviation)} sa`)),
      h('div', { class: 'card-body' },
        rows.map((r) => h('div', { class: 'mini-row' },
          h('div', null,
            h('div', { class: 'mini-name' }, doctorName(ws, r.doctorId)),
            h('div', { class: 'mini-sub' },
              `${r.shifts} nöbet · ${fmtHours(r.totalHours)}/${fmtHours(r.targetTotalHours)} sa`)),
          h('div', { class: 'row', style: { gap: '6px' } },
            h('span', { class: 'mini-sub nowrap', style: { minWidth: '38px', textAlign: 'right' } },
              fmtSigned(r.totalHours - r.targetTotalHours)),
            deviationBar(r.totalHours - r.targetTotalHours, 16)))))),

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
