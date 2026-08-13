/**
 * Yonetici tercih ekrani: tum doktorlarin istek/izin isaretleri tek matriste.
 * Yonetici, telefonla gelen istekleri doktor adina buradan isleyebilir.
 */

import { api, h, toast } from '../core.js';
import { applyWorkspace, render, state, withBusy } from '../app.js';

const CYCLE = { undefined: 'want', want: 'avoid', avoid: 'off', off: null };
const LABEL = { want: 'istiyor', avoid: 'istemiyor', off: 'izinli' };

export function renderPreferencesAdmin() {
  const ws = state.ws;
  const doctors = Object.values(ws.doctors)
    .filter((d) => d.active && d.scheduled)
    .sort((a, b) => (a.code || '').localeCompare(b.code || '') || a.name.localeCompare(b.name, 'tr'));

  const local = state.prefDraftMonth === ws.month.id && state.prefDraft
    ? state.prefDraft
    : structuredClone(ws.preferences || {});
  state.prefDraft = local;
  state.prefDraftMonth = ws.month.id;

  const dirty = new Set(state.prefDirty || []);
  state.prefDirty = dirty;

  const cycle = (doctorId, iso) => {
    const map = local[doctorId] || (local[doctorId] = {});
    const next = CYCLE[map[iso]];
    if (next) map[iso] = next;
    else delete map[iso];
    dirty.add(doctorId);
    render();
  };

  const saveAll = async () => {
    if (!dirty.size) return toast('Değişiklik yok', 'warn');
    for (const doctorId of dirty) {
      const out = await withBusy(() =>
        api.put(`/api/months/${ws.month.id}/preferences`, { doctorId, preferences: local[doctorId] || {} }));
      if (!out) return;
    }
    toast(`${dirty.size} doktorun tercihi kaydedildi`, 'ok');
    state.prefDraft = null;
    state.prefDraftMonth = null;
    state.prefDirty = null;
    const fresh = await api.get(`/api/months/${ws.month.id}`);
    applyWorkspace(fresh);
  };

  const header = h('tr', null,
    h('th', { style: { position: 'sticky', left: 0, zIndex: 3 } }, 'Doktor'),
    ws.days.map((d) =>
      h('th', {
        class: 'center',
        style: { padding: '4px 1px', minWidth: '30px', background: d.type === 'weekend' ? 'var(--weekend)' : undefined },
        title: `${d.day} ${d.dayName}`,
      },
        h('div', null, d.day),
        // Tek harf kisaltma belirsiz olurdu (Cum/Cmt, Paz/Pzt/Per hep ayni harf)
        h('div', {
          style: { fontSize: '9px', fontWeight: 500, letterSpacing: '-.02em', textTransform: 'none' },
          class: d.type === 'weekend' ? '' : 'muted',
        }, d.shortName))),
    h('th', { class: 'num' }, 'Özet'));

  const rows = doctors.map((doc) => {
    const map = local[doc.id] || {};
    const counts = { want: 0, avoid: 0, off: 0 };
    for (const v of Object.values(map)) if (counts[v] !== undefined) counts[v] += 1;

    return h('tr', null,
      h('td', {
        style: { position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, fontWeight: 600, whiteSpace: 'nowrap' },
      }, doc.name, dirty.has(doc.id) && h('span', { class: 'chip chip-warn', style: { marginLeft: '6px' } }, '•')),
      ws.days.map((d) => {
        const value = map[d.iso];
        const bg = value === 'want' ? 'var(--ok-soft)'
          : value === 'avoid' ? 'var(--warn-soft)'
            : value === 'off' ? 'var(--danger-soft)'
              : d.type === 'weekend' ? 'var(--weekend)' : undefined;
        const mark = value === 'want' ? '✓' : value === 'avoid' ? '×' : value === 'off' ? 'İ' : '';
        return h('td', {
          class: 'center',
          style: { padding: '2px', cursor: 'pointer', background: bg, fontWeight: 700, userSelect: 'none' },
          title: `${doc.name} · ${d.day} ${d.dayName}${value ? ` — ${LABEL[value]}` : ''}\n(tıkla: istiyor → istemiyor → izinli → temiz)`,
          onClick: () => cycle(doc.id, d.iso),
        }, mark);
      }),
      h('td', { class: 'num small nowrap' },
        counts.want ? h('span', { class: 'chip chip-ok' }, `${counts.want}`) : '',
        ' ',
        counts.avoid ? h('span', { class: 'chip chip-warn' }, `${counts.avoid}`) : '',
        ' ',
        counts.off ? h('span', { class: 'chip chip-danger' }, `${counts.off}`) : ''));
  });

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('div', { class: 'grow' },
        h('h2', null, 'Doktor tercihleri'),
        h('div', { class: 'small muted' }, 'Hücreye tıklayarak sırayla: istiyor → istemiyor → izinli → temiz')),
      h('label', { class: 'inline' },
        h('input', {
          type: 'checkbox', checked: ws.month.prefWindowOpen,
          onChange: async (e) => {
            const out = await withBusy(
              () => api.put(`/api/months/${ws.month.id}/config`, { prefWindowOpen: e.target.checked }),
              { success: e.target.checked ? 'Tercih girişi açıldı' : 'Tercih girişi kapatıldı' },
            );
            if (out) applyWorkspace(out);
          },
        }),
        'Doktorlar tercih girebilsin'),
      h('label', { class: 'inline nowrap', title: 'Doktorların ekranında son tarih olarak gösterilir' },
        'Son tarih',
        h('input', {
          type: 'date', style: { width: 'auto' }, value: ws.month.prefDeadline || '',
          onChange: async (e) => {
            const out = await withBusy(
              () => api.put(`/api/months/${ws.month.id}/config`, { prefDeadline: e.target.value || null }),
              { success: e.target.value ? 'Son tarih kaydedildi' : 'Son tarih kaldırıldı' },
            );
            if (out) applyWorkspace(out);
          },
        })),
      h('button', { class: 'btn btn-primary', onClick: saveAll, disabled: !dirty.size },
        dirty.size ? `Kaydet (${dirty.size})` : 'Kaydet')),

    h('div', { class: 'banner banner-info' },
      h('div', null,
        h('b', null, 'İzinli'), ' işareti kesin kuraldır, o güne asla nöbet verilmez ve hedef saat buna göre düşer. ',
        h('b', null, 'İstemiyor'), ' ve ', h('b', null, 'İstiyor'), ' ise eşit dağılımı bozmadığı sürece karşılanır.')),

    h('div', { class: 'card' },
      h('div', { class: 'card-body tight' },
        h('div', { class: 'table-wrap' },
          h('table', { style: { fontSize: '12px' } },
            h('thead', null, header),
            h('tbody', null, rows))))),

    h('div', { class: 'legend mt-8' },
      h('span', null, h('b', { style: { background: 'var(--ok-soft)', border: '1px solid #a5d9b7' } }), 'İstiyor (✓)'),
      h('span', null, h('b', { style: { background: 'var(--warn-soft)', border: '1px solid #edcd9c' } }), 'İstemiyor (×)'),
      h('span', null, h('b', { style: { background: 'var(--danger-soft)', border: '1px solid #efb9b9' } }), 'İzinli (İ) — kesin')),
  );
}
