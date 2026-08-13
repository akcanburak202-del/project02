/**
 * Doktor ekrani: kendi tercihlerini bildirme + yayinlanmis nobetlerini gorme.
 */

import {
  DAY_SHORT, api, fmtDate, fmtDateShort, fmtHours, fmtSigned, h, icon, segmented, toast, todayIso, trMonthLabel,
} from '../core.js';
import { render, state, withBusy } from '../state.js';

// Doktor yalnizca "istiyorum" ve "istemiyorum" isaretleyebilir.
// Izin/rapor (off) sadece yonetici tarafindan girilir; doktora salt okunur gorunur.
const CYCLE = { undefined: 'want', want: 'avoid', avoid: null };

function draftPrefs(ws) {
  if (state.myPrefMonth !== ws.month.id || !state.myPrefs) {
    state.myPrefs = structuredClone(ws.preferences?.[state.me.id] || {});
    state.myPrefMonth = ws.month.id;
    state.myPrefsDirty = false;
  }
  return state.myPrefs;
}

function preferenceCard(ws) {
  const prefs = draftPrefs(ws);
  const editable = ws.month.prefWindowOpen && ws.month.status !== 'final';
  const today = todayIso();
  const counts = { want: 0, avoid: 0, off: 0 };
  for (const v of Object.values(prefs)) if (counts[v] !== undefined) counts[v] += 1;

  const cells = [];
  const lead = (ws.days[0].weekday + 6) % 7;
  for (let i = 0; i < lead; i += 1) cells.push(h('div'));

  for (const day of ws.days) {
    const value = prefs[day.iso];
    const past = day.iso < today;
    const izinli = value === 'off'; // yonetici tarafindan girilmis, degistirilemez
    cells.push(h('button', {
      class: ['pref-day', day.type === 'weekend' && 'we', value, (past || izinli) && 'past'].filter(Boolean).join(' '),
      type: 'button',
      disabled: !editable || past || izinli,
      title: izinli
        ? 'İzin/rapor kaydı — yalnızca sorumlu hekim değiştirebilir'
        : past ? 'Geçmiş gün' : 'Tıkla: istiyorum → istemiyorum → temiz',
      onClick: () => {
        const next = CYCLE[prefs[day.iso]];
        if (next) prefs[day.iso] = next;
        else delete prefs[day.iso];
        state.myPrefsDirty = true;
        render();
      },
    },
      h('span', { class: 'n' }, day.day),
      h('span', { class: 'lbl' }, DAY_SHORT[day.weekday]),
      value && h('span', { class: 'lbl' },
        value === 'want' ? '✓ istiyorum' : value === 'avoid' ? '× istemiyorum' : 'izinli')));
  }

  const save = async () => {
    const out = await withBusy(() => api.put(`/api/months/${ws.month.id}/preferences`, { preferences: prefs }));
    if (!out) return;
    state.myPrefsDirty = false;
    toast('Tercihlerin kaydedildi', 'ok');
    if (out.warning) toast(out.warning, 'warn', 7000);
    const fresh = await api.get(`/api/months/${ws.month.id}`);
    state.ws = fresh;
    render();
  };

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, `${trMonthLabel(ws.month.id)} tercihlerim`),
      counts.want ? h('span', { class: 'chip chip-ok' }, `${counts.want} istiyorum`) : null,
      counts.avoid ? h('span', { class: 'chip chip-warn' }, `${counts.avoid} istemiyorum`) : null,
      counts.off ? h('span', { class: 'chip chip-danger' }, `${counts.off} izinli`) : null,
      editable && h('button', {
        class: 'btn btn-primary btn-sm', onClick: save, disabled: !state.myPrefsDirty,
      }, state.myPrefsDirty ? 'Kaydet' : 'Kaydedildi')),
    h('div', { class: 'card-body' },
      !editable && h('div', { class: 'banner banner-warn' },
        icon('lock'),
        ws.month.status === 'final'
          ? 'Bu ay kesinleşti, tercih değiştirilemez.'
          : 'Bu ay için tercih girişi kapatıldı. Değişiklik gerekiyorsa sorumlu hekimle görüşün.'),
      ws.month.prefDeadline && editable && h('div', { class: 'banner banner-info' },
        `Son tercih bildirme tarihi: ${fmtDate(ws.month.prefDeadline)}`),
      h('div', { class: 'pref-grid mb-8' },
        ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d, i) =>
          h('div', { class: `cal-head${i >= 5 ? ' we' : ''}` }, d)),
        cells),
      h('div', { class: 'legend' },
        h('span', null, h('b', { style: { background: 'var(--ok-soft)', border: '1px solid #a5d9b7' } }), 'İstiyorum — mümkünse bu güne yaz'),
        h('span', null, h('b', { style: { background: 'var(--warn-soft)', border: '1px solid #edcd9c' } }), 'İstemiyorum — mümkünse yazma'),
        h('span', null, h('b', { style: { background: 'var(--danger-soft)', border: '1px solid #efb9b9' } }), 'İzinli/raporlu — sorumlu hekim girer')),
      h('div', { class: 'small muted mt-8' },
        'İki işaret de eşit dağılımı bozmadığı ölçüde karşılanır. ',
        'İzin ve rapor kayıtlarını yalnızca sorumlu hekim girebilir; kırmızı işaretli günler size bilgi olarak gösterilir.')),
  );
}

function myShiftsCard(ws) {
  const mine = ws.slots
    .filter((s) => ws.assignments[s.id] === state.me.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const row = ws.report?.rows?.find((r) => r.doctorId === state.me.id);

  if (!ws.scheduleVisible) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Nöbetlerim')),
      h('div', { class: 'card-body' },
        h('div', { class: 'banner banner-info' }, 'Bu ayın çizelgesi henüz yayınlanmadı. Yayınlandığında burada görünecek.')));
  }

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Nöbetlerim'),
      h('span', { class: 'chip chip-info' }, `${mine.length} nöbet`),
      row && h('span', { class: 'chip' }, `${fmtHours(row.totalHours)} saat`),
      h('a', { class: 'btn btn-sm', href: `/api/months/${ws.month.id}/export?kind=schedule` }, 'CSV')),
    h('div', { class: 'card-body tight' },
      mine.length
        ? h('table', null,
          h('thead', null, h('tr', null,
            h('th', null, 'Tarih'), h('th', null, 'Gün'), h('th', null, 'Vardiya'),
            h('th', null, 'Giriş–Çıkış'), h('th', { class: 'num' }, 'Süre'), h('th', null, 'Birlikte'))),
          h('tbody', null, mine.map((s) => {
            const day = ws.days.find((d) => d.iso === s.date);
            const partners = ws.slots
              .filter((o) => o.date === s.date && o.id !== s.id)
              .map((o) => ws.doctors[ws.assignments[o.id]]?.name)
              .filter(Boolean);
            return h('tr', null,
              h('td', { class: 'mono' }, fmtDate(s.date)),
              h('td', null, day?.dayName,
                day?.type === 'weekend' && h('span', { class: 'chip chip-warn', style: { marginLeft: '6px' } },
                  day.isHoliday ? 'tatil' : 'h.sonu')),
              h('td', null, s.label),
              h('td', { class: 'mono' }, s.timeLabel),
              h('td', { class: 'num' }, fmtHours(s.hours)),
              h('td', { class: 'small muted' }, partners.join(', ') || '—'));
          })))
        : h('div', { class: 'card-body' }, h('div', { class: 'small muted' }, 'Bu ay nöbetin görünmüyor.'))),
    row && h('div', { class: 'card-body', style: { borderTop: '1px solid var(--border)' } },
      h('div', { class: 'row-wrap gap-16' },
        ws.categories.map((c) => h('div', null,
          h('div', { class: 'small muted' }, c.label),
          h('div', { style: { fontWeight: 700, fontSize: '16px' } }, `${fmtHours(row.actual[c.key])} sa`),
          h('div', { class: 'small muted' }, `hedef ${fmtHours(row.target[c.key])} · ${fmtSigned(row.deviation[c.key])}`))))),
  );
}

function monthTable(ws) {
  if (!ws.scheduleVisible) return null;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, `${trMonthLabel(ws.month.id)} tam çizelge`),
      h('button', { class: 'btn btn-sm', onClick: () => window.print() }, 'Yazdır')),
    h('div', { class: 'card-body tight' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', null, 'Tarih'), h('th', null, 'Gün'),
            ...ws.slots.filter((s) => s.date === ws.days[0].iso).map((s) => h('th', null, `${s.label} (${s.timeLabel})`)))),
          h('tbody', null, ws.days.map((day) => {
            const slots = ws.slots.filter((s) => s.date === day.iso);
            return h('tr', { style: day.type === 'weekend' ? { background: 'var(--weekend)' } : {} },
              h('td', { class: 'mono' }, fmtDateShort(day.iso)),
              h('td', null, day.shortName),
              slots.map((s) => {
                const id = ws.assignments[s.id];
                const isMe = id === state.me.id;
                return h('td', { style: isMe ? { fontWeight: 700, color: 'var(--primary-dark)' } : {} },
                  ws.doctors[id]?.name || '—');
              }));
          }))))));
}

export function renderDoctorHome() {
  const ws = state.ws;
  if (!ws) {
    return h('div', { class: 'empty' },
      h('h3', null, 'Görüntülenecek ay yok'),
      h('p', null, 'Sorumlu hekim bir çizelge ayı oluşturduğunda burada görünecek.'));
  }
  const view = state.doctorView || 'prefs';

  return h('div', null,
    h('div', { class: 'toolbar no-print' },
      h('div', { class: 'grow' },
        h('h2', null, `Merhaba, ${state.me.name}`),
        h('div', { class: 'small muted' },
          ws.month.status === 'draft' ? 'Bu ayın çizelgesi hazırlanıyor.'
            : ws.month.status === 'published' ? 'Bu ayın çizelgesi yayında.'
              : 'Bu ay kesinleşti.')),
      segmented([
        { value: 'prefs', label: 'Tercihlerim' },
        { value: 'shifts', label: 'Nöbetlerim' },
      ], view, (v) => { state.doctorView = v; render(); })),

    view === 'prefs'
      ? preferenceCard(ws)
      : h('div', { class: 'col gap-16' }, myShiftsCard(ws), monthTable(ws)));
}
