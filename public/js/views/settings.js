/**
 * Ayarlar: vardiya sablonlari, kurallar, oncelik agirliklari, tatiller.
 */

import { api, confirmDialog, fmtDate, h, toast } from '../core.js';
import { render, state, withBusy } from '../app.js';

const PRESETS = [
  {
    id: 'ikili',
    name: '2 doktor · 09–24 ve 15–09',
    detail: 'Kullanıcının tarif ettiği düzen: gündüz 09:00–24:00, gece 15:00–ertesi 09:00. Kesişim 15:00–24:00 paylaşımlı.',
    templates: [
      { id: 'gunduz', label: 'Gündüz', start: '09:00', end: '24:00' },
      { id: 'gece', label: 'Akşam/Gece', start: '15:00', end: '09:00+1' },
    ],
  },
  {
    id: 'ikili-08',
    name: '2 doktor · 08–20 ve 14–08',
    detail: 'Gündüz 08:00–20:00, gece 14:00–ertesi 08:00. Kesişim 14:00–20:00.',
    templates: [
      { id: 'gunduz', label: 'Gündüz', start: '08:00', end: '20:00' },
      { id: 'gece', label: 'Gece', start: '14:00', end: '08:00+1' },
    ],
  },
  {
    id: 'uclu',
    name: '3 doktor · 08–20, 14–02, 20–08',
    detail: 'Yoğun servisler için üç katmanlı düzen.',
    templates: [
      { id: 'sabah', label: 'Sabah', start: '08:00', end: '20:00' },
      { id: 'ikindi', label: 'İkindi', start: '14:00', end: '02:00+1' },
      { id: 'gece', label: 'Gece', start: '20:00', end: '08:00+1' },
    ],
  },
];

function templateEditor(list, onChange) {
  const rows = list.map((tpl, i) =>
    h('tr', null,
      h('td', null, h('input', {
        type: 'text', value: tpl.label,
        onChange: (e) => { list[i].label = e.target.value; onChange(); },
      })),
      h('td', null, h('input', {
        type: 'text', value: tpl.start, placeholder: '09:00', class: 'mono',
        onChange: (e) => { list[i].start = e.target.value.trim(); onChange(); },
      })),
      h('td', null, h('input', {
        type: 'text', value: tpl.end, placeholder: '09:00+1', class: 'mono',
        onChange: (e) => { list[i].end = e.target.value.trim(); onChange(); },
      })),
      h('td', { class: 'right' }, h('button', {
        class: 'btn btn-sm', onClick: () => { list.splice(i, 1); onChange(); },
      }, 'Sil'))));

  return h('div', null,
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Vardiya adı'), h('th', null, 'Giriş'), h('th', null, 'Çıkış'), h('th', null))),
      h('tbody', null, rows)),
    h('button', {
      class: 'btn btn-sm mt-8',
      onClick: () => {
        list.push({ id: `v${Date.now().toString(36).slice(-4)}`, label: 'Yeni vardiya', start: '09:00', end: '17:00' });
        onChange();
      },
    }, '+ Vardiya ekle'),
    h('div', { class: 'small muted mt-8' },
      'Ertesi güne taşan çıkış saatini "+1" ile yazın: ', h('code', null, '09:00+1'), '. ',
      'Gün sonunda biten vardiya için ', h('code', null, '24:00'), ' kullanın. ',
      'Vardiyalar birlikte günün 24 saatini boşluksuz kapsamalıdır.'));
}

export function renderSettings() {
  if (!state.settingsDraft) {
    api.get('/api/settings').then((out) => {
      state.settingsDraft = out.settings;
      render();
    }).catch((e) => toast(e.message, 'error'));
    return h('div', { class: 'empty' }, 'Yükleniyor…');
  }

  const s = state.settingsDraft;
  const touch = () => render();

  const save = async () => {
    const ok = await withBusy(() => api.put('/api/settings', s), { success: 'Ayarlar kaydedildi' });
    if (!ok) return;
    state.settingsDraft = null;
    if (state.monthId) {
      const fresh = await api.get(`/api/months/${state.monthId}`);
      state.ws = fresh;
    }
    render();
  };

  const applyPreset = async (preset) => {
    const ok = await confirmDialog(
      `"${preset.name}" düzeni hem hafta içi hem hafta sonu için uygulanacak. Mevcut vardiya tanımların değişecek.`,
      { title: 'Hazır düzen uygula', okLabel: 'Uygula' },
    );
    if (!ok) return;
    s.shiftTemplates = {
      weekday: structuredClone(preset.templates),
      weekend: structuredClone(preset.templates),
    };
    render();
  };

  const prefPriority = s.weights.avoidDay >= 80 ? 'high' : s.weights.avoidDay <= 15 ? 'low' : 'normal';

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('div', { class: 'grow' }, h('h2', null, 'Ayarlar'),
        h('div', { class: 'small muted' }, 'Bu ayarlar yeni üretilecek çizelgeler için geçerlidir.')),
      h('button', { class: 'btn', onClick: () => { state.settingsDraft = null; render(); } }, 'Geri al'),
      h('button', { class: 'btn btn-primary', onClick: save }, 'Kaydet')),

    h('div', { class: 'card mb-8' },
      h('div', { class: 'card-head' }, h('h3', null, 'Genel')),
      h('div', { class: 'card-body' },
        h('div', { class: 'row-wrap gap-16' },
          h('label', { class: 'field', style: { minWidth: '260px' } }, 'Birim adı',
            h('input', {
              type: 'text', value: s.hospitalName || '',
              onChange: (e) => { s.hospitalName = e.target.value; },
            })),
          h('label', { class: 'field' }, 'Hafta sonu günleri',
            h('div', { class: 'row-wrap' },
              ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'].map((d, i) =>
                h('label', { class: 'inline' },
                  h('input', {
                    type: 'checkbox', checked: s.weekendDays.includes(i),
                    onChange: (e) => {
                      const set = new Set(s.weekendDays);
                      if (e.target.checked) set.add(i);
                      else set.delete(i);
                      s.weekendDays = [...set].sort();
                    },
                  }), d))))))),

    h('div', { class: 'card mb-8' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'grow' }, 'Vardiya düzeni'),
        h('div', { class: 'row-wrap' },
          PRESETS.map((p) => h('button', { class: 'btn btn-sm', title: p.detail, onClick: () => applyPreset(p) }, p.name)))),
      h('div', { class: 'card-body' },
        h('div', { class: 'row-wrap gap-16', style: { alignItems: 'flex-start' } },
          h('div', { style: { flex: '1 1 340px' } },
            h('h4', { class: 'mb-8' }, 'Hafta içi'),
            templateEditor(s.shiftTemplates.weekday, touch)),
          h('div', { style: { flex: '1 1 340px' } },
            h('h4', { class: 'mb-8' }, 'Hafta sonu ve resmî tatil'),
            templateEditor(s.shiftTemplates.weekend, touch))))),

    h('div', { class: 'card mb-8' },
      h('div', { class: 'card-head' }, h('h3', null, 'Çalışma kuralları')),
      h('div', { class: 'card-body' },
        h('div', { class: 'row-wrap gap-16' },
          h('label', { class: 'field' }, 'İki nöbet arası en az dinlenme (saat)',
            h('input', {
              type: 'number', min: '0', max: '72', value: s.rules.minRestHours,
              onChange: (e) => { s.rules.minRestHours = Number(e.target.value); },
            })),
          h('label', { class: 'field' }, 'En fazla üst üste nöbet günü',
            h('input', {
              type: 'number', min: '1', max: '7', value: s.rules.maxConsecutiveDays,
              onChange: (e) => { s.rules.maxConsecutiveDays = Number(e.target.value); },
            })),
          h('label', { class: 'field' }, 'Aylık nöbet üst sınırı (boş = sınırsız)',
            h('input', {
              type: 'number', min: '1', max: '31', value: s.rules.maxShiftsPerMonth ?? '',
              onChange: (e) => { s.rules.maxShiftsPerMonth = e.target.value === '' ? null : Number(e.target.value); },
            })),
          h('label', { class: 'field' }, 'Devir telafi oranı (0–1)',
            h('input', {
              type: 'number', min: '0', max: '1', step: '0.1', value: s.rules.maxCarryRatio,
              onChange: (e) => { s.rules.maxCarryRatio = Number(e.target.value); },
            }))),
        h('div', { class: 'small muted mt-8' },
          'Devir telafi oranı, bir ayda kapatılabilecek devir miktarını sınırlar. 0,4 = adil payın en fazla %40\'ı kadar kaydırma.'))),

    h('div', { class: 'card mb-8' },
      h('div', { class: 'card-head' }, h('h3', null, 'Öncelikler')),
      h('div', { class: 'card-body' },
        h('div', { class: 'row-wrap gap-16' },
          h('label', { class: 'field' }, 'Tercihlere verilen ağırlık',
            h('select', {
              onChange: (e) => {
                const v = e.target.value;
                s.weights.avoidDay = v === 'high' ? 90 : v === 'low' ? 12 : 40;
                s.weights.wantDay = v === 'high' ? 34 : v === 'low' ? 5 : 15;
                render();
              },
            },
              h('option', { value: 'low', selected: prefPriority === 'low' }, 'Düşük — eşitlik her şeyin önünde'),
              h('option', { value: 'normal', selected: prefPriority === 'normal' }, 'Normal (önerilen)'),
              h('option', { value: 'high', selected: prefPriority === 'high' }, 'Yüksek — tercihleri elinden geldiğince karşıla'))),
          h('label', { class: 'field' }, 'Hafta sonu saatlerinin denge hassasiyeti',
            h('input', {
              type: 'number', min: '1', max: '4', step: '0.1', value: s.weights.categoryWeights.weSolo,
              onChange: (e) => {
                const v = Number(e.target.value);
                s.weights.categoryWeights.weSolo = v;
                s.weights.categoryWeights.weShared = v;
              },
            })),
          h('label', { class: 'field' }, 'Optimizasyon adımı (yüksek = daha iyi, daha yavaş)',
            h('input', {
              type: 'number', min: '5000', max: '400000', step: '5000', value: s.optimizer.iterations,
              onChange: (e) => { s.optimizer.iterations = Number(e.target.value); },
            }))),
        h('div', { class: 'small muted mt-8' },
          'Tercih ağırlığı yükseldikçe istenmeyen günler daha kararlı biçimde boş bırakılır; ',
          'ancak saat dağılımında birkaç saatlik sapma oluşabilir. İzin (kesin) işaretleri bu ayardan etkilenmez.'))),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Resmî tatiller')),
      h('div', { class: 'card-body' },
        h('p', { class: 'small muted' }, 'Buraya eklenen günler hafta sonu gibi değerlendirilir ve saatleri "hafta sonu" etiketiyle sayılır.'),
        h('div', { class: 'row-wrap mb-8' },
          (s.holidays || []).map((iso, i) =>
            h('span', { class: 'chip chip-danger' }, fmtDate(iso),
              h('button', {
                class: 'btn btn-sm btn-ghost', style: { padding: '0 2px' },
                onClick: () => { s.holidays.splice(i, 1); render(); },
              }, '×'))),
          !(s.holidays || []).length && h('span', { class: 'small muted' }, 'Tanımlı tatil yok.')),
        h('div', { class: 'row' },
          h('input', { type: 'date', id: 'holiday-input', style: { maxWidth: '190px' } }),
          h('button', {
            class: 'btn btn-sm',
            onClick: () => {
              const input = document.getElementById('holiday-input');
              if (!input.value) return;
              s.holidays = [...new Set([...(s.holidays || []), input.value])].sort();
              render();
            },
          }, 'Ekle')))),
  );
}
