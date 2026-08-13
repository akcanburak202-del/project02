/**
 * Ayarlar: vardiya sablonlari, kurallar, oncelik agirliklari, tatiller.
 */

import { api, confirmDialog, fmtDate, h, segmented, toast } from '../core.js';
import { render, state, withBusy } from '../state.js';

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

/**
 * Cizelge uretilirken uyulan kurallarin ozeti. Mevcut ayarlara gore
 * metinler guncellenir; boylece "hangi kurallara uyuluyor" sorusunun
 * cevabi her zaman ekranda ve dogru olur.
 */
function rulesSummary(s) {
  const sert = [
    'İzinli/raporlu işaretlenen günlere kesinlikle nöbet yazılmaz.',
    'Görev başlangıç/bitiş tarihi dışına nöbet yazılmaz; gece nöbeti ertesi sabaha taştığı için görev bitiş gününde gece nöbeti verilmez.',
    'Bir doktora aynı gün iki vardiya verilmez.',
    Number(s.rules.maxConsecutiveDays) <= 1
      ? 'Üst üste iki gün nöbet verilmez — iki nöbet arasında en az bir tam gün boş kalır.'
      : `Üst üste en fazla ${s.rules.maxConsecutiveDays} gün nöbet verilir.`,
    `İki nöbet arasında en az ${s.rules.minRestHours} saat dinlenme bırakılır (önceki aydan devreden gece nöbeti de hesaba katılır).`,
    s.rules.maxShiftsPerMonth
      ? `Bir doktor ayda en fazla ${s.rules.maxShiftsPerMonth} nöbet tutar.`
      : 'Aylık nöbet üst sınırı tanımlı değil (kişi bazında Katılım ekranından verilebilir).',
    'Günün 24 saati boşluksuz kapsanır; hiçbir slot boş bırakılmaz.',
  ];
  const yumusak = [
    'Dört etiketin (hafta içi/hafta sonu × paylaşımlı/paylaşımsız) hedeften sapması en aza indirilir.',
    'Nöbet, gece ve hafta sonu sayıları dengelenir.',
    '"İstemiyorum" günlerinden kaçınılır, "istiyorum" günleri tercih edilir.',
    'Nöbetler aya dengeli yayılır; birbirine çok yakın nöbetler cezalandırılır.',
    '7 günlük herhangi bir pencerede adil payın üzerine nöbet yığılmaz — kimsenin haftası diğerinden ağır geçmez.',
    `Son aylarda hangi haftagünlerini ve kaç yoğun haftayı kimin aldığı hatırlanır; yük aylar içinde sırayla dolaşır (Denge → ${'Ritim'}).`,
    'Gündüz/gece ağırlıklı çalışma tercihi gözetilir.',
  ];
  const li = (t) => h('li', { style: { marginBottom: '3px' } }, t);
  return h('div', { class: 'row-wrap gap-16 mt-16', style: { alignItems: 'flex-start' } },
    h('div', { style: { flex: '1 1 340px' } },
      h('h4', null, 'Asla çiğnenmeyen kurallar'),
      h('ul', { class: 'small', style: { paddingLeft: '18px', margin: '6px 0 0' } }, sert.map(li)),
      h('div', { class: 'small muted mt-8' },
        'Kadro bu kurallar için fazla darsa çizelge yine üretilir ama dinlenme / üst üste gün kuralı gevşetilen her nöbet ',
        h('b', null, 'uyarı olarak bildirilir'), ' — sessizce çiğnenmez.')),
    h('div', { style: { flex: '1 1 340px' } },
      h('h4', null, 'Elden geldiğince gözetilenler'),
      h('ul', { class: 'small', style: { paddingLeft: '18px', margin: '6px 0 0' } }, yumusak.map(li))));
}


const FLEX_LABELS = [
  { value: 'off', label: 'Kapalı', hint: 'Saatler hep tercih edilen değerde kalır. En öngörülebilir; eşitlik en zayıf.' },
  { value: 'tight', label: 'Az', hint: 'Saatler nadiren ve az oynar.' },
  { value: 'moderate', label: 'Ölçülü', hint: 'Önerilen. Eşitlik için gerektiği kadar oynar.' },
  { value: 'free', label: 'Serbest', hint: 'Eşitlik önce gelir; saatler gün gün daha çok değişebilir.' },
];

/** Bir saat penceresi: en erken / tercih edilen / en geç. */
function windowRow(label, w, onChange, hint) {
  const field = (key, caption) => h('label', { class: 'field' }, caption,
    h('input', {
      type: 'time', step: '1800', value: w[key],
      onChange: (e) => { w[key] = e.target.value || w[key]; onChange(); },
    }));
  return h('div', { style: { marginBottom: '10px' } },
    h('div', { style: { fontWeight: 600, fontSize: '13px' } }, label),
    hint && h('div', { class: 'small muted', style: { marginBottom: '4px' } }, hint),
    h('div', { class: 'row' }, field('min', 'En erken'), field('preferred', 'Tercih edilen'), field('max', 'En geç')));
}

function sideEditor(side, onChange) {
  const k = side.doctorsPerDay;
  return h('div', null,
    h('label', { class: 'field mb-8' }, 'Günde kaç doktor görev alır',
      h('input', {
        type: 'number', min: '1', max: '5', value: k,
        onChange: (e) => {
          const next = Math.max(1, Math.min(5, Number(e.target.value) || 1));
          side.doctorsPerDay = next;
          side.arrivals = Array.from({ length: next - 1 }, (_, i) =>
            side.arrivals?.[i] || { min: '14:00', preferred: '15:00', max: '17:00' });
          side.exits = Array.from({ length: next - 1 }, (_, i) =>
            side.exits?.[i] || { min: '22:00', preferred: '24:00', max: '24:00' });
          side.labels = Array.from({ length: next }, (_, i) =>
            side.labels?.[i] || (i === 0 ? 'Gündüz' : i === next - 1 ? 'Akşam/Gece' : `Vardiya ${i + 1}`));
          onChange();
        },
      })),
    windowRow('Sabah devri', side.handover, onChange,
      'Gündüz ekibi gelir, gece ekibi çıkar.'),
    (side.arrivals || []).map((a, i) => h('div', null,
      windowRow(`${i + 2}. vardiyanın gelişi`, a, onChange),
      windowRow(`${i + 1}. vardiyanın çıkışı`, side.exits[i], onChange,
        'Bu iki saatin arası paylaşımlı mesai olur.'))));
}

/** Vardiya düzeni kartı: saatleri araç mı seçsin, yönetici mi sabitlesin. */
function shiftCard(s, touch, applyPreset) {
  const policy = s.shiftPolicy;
  const esnek = policy.mode !== 'fixed';

  return h('div', { class: 'card mb-8' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Vardiya düzeni'),
      segmented([
        { value: 'flexible', label: 'Saatleri araç belirlesin' },
        { value: 'fixed', label: 'Saatler sabit' },
      ], esnek ? 'flexible' : 'fixed', (v) => { policy.mode = v; render(); })),

    h('div', { class: 'card-body' },
      esnek
        ? h('div', null,
          h('div', { class: 'banner banner-info' },
            h('div', null,
              'Araç, aşağıdaki aralıklar içinde her gün için giriş/çıkış saatlerini kendisi seçer. ',
              'Saatler sabitlenirse her nöbetin dört etikete katkısı da sabitlenir ve eşit dağıtım ',
              h('b', null, 'matematiksel olarak imkânsız'), ' hale gelir — bir doktorun payı hep aynı ',
              'büyüklüğün katları olabilir. Esneklik bu kilidi açar.')),
          h('div', { class: 'row-wrap gap-16 mb-8' },
            h('label', { class: 'field' }, 'Saat esnekliği',
              h('select', {
                onChange: (e) => { policy.flexibility = e.target.value; render(); },
              }, FLEX_LABELS.map((f) =>
                h('option', { value: f.value, selected: policy.flexibility === f.value }, f.label))),
              h('span', { class: 'small muted', style: { fontWeight: 400 } },
                FLEX_LABELS.find((f) => f.value === policy.flexibility)?.hint || '')),
            h('label', { class: 'field' }, 'Saat adımı (dakika)',
              h('select', {
                onChange: (e) => { policy.stepMinutes = Number(e.target.value); },
              }, [15, 30, 60].map((v) =>
                h('option', { value: v, selected: Number(policy.stepMinutes) === v }, `${v} dk`)))),
            h('label', { class: 'field' }, 'En kısa vardiya (saat)',
              h('input', {
                type: 'number', min: '4', max: '24', value: policy.minShiftHours,
                onChange: (e) => { policy.minShiftHours = Number(e.target.value); },
              })),
            h('label', { class: 'field' }, 'En uzun vardiya (saat)',
              h('input', {
                type: 'number', min: '8', max: '24', value: policy.maxShiftHours,
                onChange: (e) => { policy.maxShiftHours = Number(e.target.value); },
              }))),
          h('div', { class: 'row-wrap gap-16', style: { alignItems: 'flex-start' } },
            h('div', { style: { flex: '1 1 380px' } },
              h('h4', { class: 'mb-8' }, 'Hafta içi'), sideEditor(policy.weekday, touch)),
            h('div', { style: { flex: '1 1 380px' } },
              h('h4', { class: 'mb-8' }, 'Hafta sonu ve resmî tatil'), sideEditor(policy.weekend, touch))))
        : h('div', null,
          h('div', { class: 'banner banner-warn' },
            'Sabit saatlerde her nöbetin katkısı değişmez; dört etiketin tam eşit dağıtılması ',
            'genellikle mümkün olmaz ve fark devir defterine yazılır. Mevzuat gerektirmiyorsa ',
            '"Saatleri araç belirlesin" seçeneğini kullanın.'),
          h('div', { class: 'row-wrap mb-8' },
            PRESETS.map((p) => h('button', { class: 'btn btn-sm', title: p.detail, onClick: () => applyPreset(p) }, p.name))),
          h('div', { class: 'row-wrap gap-16', style: { alignItems: 'flex-start' } },
            h('div', { style: { flex: '1 1 340px' } },
              h('h4', { class: 'mb-8' }, 'Hafta içi'), templateEditor(s.shiftTemplates.weekday, touch)),
            h('div', { style: { flex: '1 1 340px' } },
              h('h4', { class: 'mb-8' }, 'Hafta sonu ve resmî tatil'), templateEditor(s.shiftTemplates.weekend, touch))))),
  );
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

    shiftCard(s, touch, applyPreset),

    h('div', { class: 'card mb-8' },
      h('div', { class: 'card-head' }, h('h3', null, 'Çalışma kuralları')),
      h('div', { class: 'card-body' },
        h('div', { class: 'row-wrap gap-16' },
          h('label', { class: 'field' }, 'İki nöbet arası en az dinlenme (saat)',
            h('input', {
              type: 'number', min: '0', max: '72', value: s.rules.minRestHours,
              onChange: (e) => { s.rules.minRestHours = Number(e.target.value); },
            })),
          h('label', { class: 'field' }, 'Üst üste en fazla kaç gün nöbet',
            h('input', {
              type: 'number', min: '1', max: '7', value: s.rules.maxConsecutiveDays,
              onChange: (e) => { s.rules.maxConsecutiveDays = Number(e.target.value); render(); },
            }),
            h('span', { class: 'small muted', style: { fontWeight: 400 } },
              Number(s.rules.maxConsecutiveDays) <= 1
                ? 'İki nöbet arasında en az bir tam gün boş kalır.'
                : `${s.rules.maxConsecutiveDays} güne kadar ardışık nöbet verilebilir.`)),
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
          'Devir telafi oranı, bir ayda kapatılabilecek devir miktarını sınırlar. 0,4 = adil payın en fazla %40\'ı kadar kaydırma.'),
        rulesSummary(s))),

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
