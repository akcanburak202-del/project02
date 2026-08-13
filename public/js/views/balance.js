/**
 * Denge ekrani: 4 etiketli saatlerin gercek/hedef karsilastirmasi,
 * devir defteri ve doktor bazli nobet listesi.
 */

import { deviationBar, fmtDateShort, fmtHours, fmtSigned, h, segmented } from '../core.js';
import { render, state } from '../state.js';
import { doctorName } from './schedule.js';

const VIEWS = [
  { value: 'hours', label: 'Saat dağılımı' },
  { value: 'deviation', label: 'Hedeften sapma' },
  { value: 'ledger', label: 'Devir defteri' },
  { value: 'rhythm', label: 'Ritim' },
  { value: 'shifts', label: 'Nöbet listesi' },
];

const GUN_ADI = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/**
 * RITIM GORUNUMU — saat tablosunda gorunmeyen esitsizlik.
 *
 * Saatler tipatip esit olsa bile o saatlerin gunlere nasil dustugu kisiden
 * kisiye cok farkli olabilir: birinin haftasina uc nobet duserken bir
 * baskasininki bos gecer, ya da biri aylardir hep carsambalari tutar.
 * Bu tablo tam olarak bunu gosterir.
 */
function rhythmTable(ws, rows) {
  const r = ws.rhythm || { current: {}, history: {}, windowMonths: 6 };
  const gecmisVar = Object.keys(r.history || {}).length > 0;

  const gecmisDegerleri = (wd) => rows
    .map((row) => r.history?.[row.doctorId]?.weekday?.[wd] || 0);

  return h('table', null,
    h('thead', null, h('tr', null,
      h('th', null, 'Doktor'),
      h('th', { class: 'num', title: '7 günlük herhangi bir pencerede adil payın üzerine taşan nöbet sayısı' },
        'Bu ay yoğun hafta'),
      h('th', { class: 'num' }, 'Bu ay nöbet'),
      gecmisVar && GUN_ADI.map((a, wd) => h('th', { class: 'num muted', title: `Son ${r.windowMonths} ayda ${a} günü tutulan nöbet` }, a)),
      gecmisVar && h('th', { class: 'num muted' }, `Son ${r.windowMonths} ay`))),
    h('tbody', null, rows.map((row) => {
      const bu = r.current?.[row.doctorId] || { denseExcess: 0, shifts: 0 };
      const gec = r.history?.[row.doctorId];
      return h('tr', null,
        h('td', null, doctorName(ws, row.doctorId)),
        h('td', { class: 'num' }, bu.denseExcess
          ? h('span', { class: bu.denseExcess > 1 ? 'chip chip-warn' : 'chip' }, String(bu.denseExcess))
          : '—'),
        h('td', { class: 'num' }, String(bu.shifts || 0)),
        gecmisVar && GUN_ADI.map((_, wd) => {
          const v = gec?.weekday?.[wd] || 0;
          const hepsi = gecmisDegerleri(wd);
          const ort = hepsi.reduce((a, b) => a + b, 0) / (hepsi.length || 1);
          const sapma = v - ort;
          return h('td', {
            class: 'num',
            style: Math.abs(sapma) >= 1.5
              ? { fontWeight: 700, color: sapma > 0 ? 'var(--warn)' : 'var(--primary-dark)' }
              : { color: 'var(--muted)' },
            title: `ortalama ${ort.toFixed(1)}`,
          }, String(v));
        }),
        gecmisVar && h('td', { class: 'num muted' }, String(gec?.shifts || 0)));
    })));
}

export function renderBalance() {
  const ws = state.ws;
  const view = state.balanceView || 'hours';
  const cats = ws.categories;
  const effCats = cats.filter((c) => c.group === 'effective');
  const presCats = cats.filter((c) => c.group !== 'effective');
  const topla = (vec, list) => list.reduce((a, c) => a + (vec[c.key] || 0), 0);
  const rows = [...ws.report.rows].sort((a, b) =>
    doctorName(ws, a.doctorId).localeCompare(doctorName(ws, b.doctorId), 'tr'));

  const totalsRow = (pick) => cats.map((c) =>
    h('td', { class: 'num' }, fmtHours(rows.reduce((s, r) => s + pick(r)[c.key], 0))));

  let table;
  if (view === 'hours') {
    const effHedef = (r) => topla(r.target, effCats);
    table = h('table', null,
      h('thead', null,
        h('tr', null,
          h('th', null, 'Doktor'),
          h('th', { class: 'num' }, 'Nöbet'),
          h('th', { class: 'num' }, 'Gece'),
          h('th', { class: 'num' }, 'H.sonu'),
          effCats.map((c) => h('th', { class: 'num', title: c.label }, c.short)),
          h('th', { class: 'num' }, 'FİİLÎ TOPLAM'),
          h('th', null, 'Fark'),
          presCats.map((c) => h('th', { class: 'num muted', title: c.label }, c.short)),
          h('th', { class: 'num muted' }, 'Bulunma'))),
      h('tbody', null, rows.map((r) => {
        const eff = topla(r.actual, effCats);
        return h('tr', null,
          h('td', null, h('div', { style: { fontWeight: 600 } }, doctorName(ws, r.doctorId)),
            r.availableDays < ws.days.length &&
              h('div', { class: 'small muted' }, `${r.availableDays}/${ws.days.length} gün görevli`)),
          h('td', { class: 'num' }, r.shifts),
          h('td', { class: 'num' }, r.nightShifts),
          h('td', { class: 'num' }, r.weekendShifts),
          effCats.map((c) => h('td', { class: 'num' }, fmtHours(r.actual[c.key]))),
          h('td', { class: 'num', style: { fontWeight: 700 } }, fmtHours(eff)),
          h('td', null, deviationBar(eff - effHedef(r), 6)),
          presCats.map((c) => h('td', { class: 'num muted' }, fmtHours(r.actual[c.key]))),
          h('td', { class: 'num muted' }, fmtHours(topla(r.actual, presCats))));
      })),
      h('tfoot', null, h('tr', null,
        h('th', null, 'Toplam'),
        h('th', { class: 'num' }, rows.reduce((s, r) => s + r.shifts, 0)),
        h('th', { class: 'num' }, rows.reduce((s, r) => s + r.nightShifts, 0)),
        h('th', { class: 'num' }, rows.reduce((s, r) => s + r.weekendShifts, 0)),
        effCats.map((c) => h('th', { class: 'num' }, fmtHours(rows.reduce((s, r) => s + r.actual[c.key], 0)))),
        h('th', { class: 'num' }, fmtHours(rows.reduce((s, r) => s + topla(r.actual, effCats), 0))),
        h('th', null),
        presCats.map((c) => h('th', { class: 'num muted' }, fmtHours(rows.reduce((s, r) => s + r.actual[c.key], 0)))),
        h('th', { class: 'num muted' }, fmtHours(rows.reduce((s, r) => s + topla(r.actual, presCats), 0))))));
  } else if (view === 'deviation') {
    table = h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Doktor'),
        cats.map((c) => h('th', { class: 'num', title: `${c.label} — gerçek / hedef` }, c.short)),
        h('th', { class: 'num' }, 'Toplam fark'))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { style: { fontWeight: 600 } }, doctorName(ws, r.doctorId)),
        cats.map((c) => h('td', { class: 'num' },
          h('div', null, fmtSigned(r.deviation[c.key])),
          h('div', { class: 'small muted' }, `${fmtHours(r.actual[c.key])}/${fmtHours(r.target[c.key])}`))),
        h('td', null, deviationBar(r.totalHours - r.targetTotalHours, 16))))));
  } else if (view === 'ledger') {
    table = h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Doktor'),
        cats.map((c) => h('th', { class: 'num', title: `${c.label} devir` }, c.short)),
        h('th', { class: 'num' }, 'Toplam devir'))),
      h('tbody', null, rows.map((r) => {
        const total = cats.reduce((s, c) => s + (r.ledger[c.key] || 0), 0);
        return h('tr', null,
          h('td', { style: { fontWeight: 600 } }, doctorName(ws, r.doctorId)),
          cats.map((c) => h('td', { class: 'num' }, fmtSigned(r.ledger[c.key] || 0))),
          h('td', { class: 'num', style: { fontWeight: 700 } }, fmtSigned(total)));
      })));
  } else if (view === 'rhythm') {
    table = rhythmTable(ws, rows);
  } else {
    table = h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Doktor'),
        h('th', { class: 'num' }, 'Nöbet'),
        h('th', null, 'Tarihler'))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { style: { fontWeight: 600 } }, doctorName(ws, r.doctorId)),
        h('td', { class: 'num' }, r.shifts),
        h('td', null, h('div', { class: 'row-wrap' },
          r.dates.map((d) => {
            const day = ws.days.find((x) => x.iso === d);
            return h('span', {
              class: `chip${day?.type === 'weekend' ? ' chip-warn' : ''}`,
            }, `${fmtDateShort(d)} ${day?.shortName || ''}`);
          })))))));
  }

  const explanation = {
    hours: 'FİİLÎ MESAİ birincil ölçüttür: bir saatin iş yükü, o an hastanedeki doktor sayısına bölünür (tek başınaysa 1, iki kişiyseniz 0,5). Günlük toplamı vardiya düzeninden bağımsız olarak tam 24 saat olduğu için gerçekten eşitlenebilir. Sağdaki soluk sütunlar hastanede fiilen geçirilen süredir; havuzu düzene göre değiştiğinden tam eşitlenemez.',
    deviation: 'Etiket bazında gerçekleşen ile hedef arasındaki fark. Küçük farklar kaçınılmazdır (bir nöbet bölünemez); ay kesinleştiğinde bu farklar devir defterine yazılır ve sonraki aylarda kapatılır.',
    ledger: 'Geçmiş aylardan devreden fazla (+) veya eksik (−) saatler. Yeni ay planlanırken hedefler bu birikime göre ters yönde kaydırılır.',
    rhythm: 'Saatler eşit olsa bile GÜNLER eşit düşmeyebilir. "Yoğun hafta", 7 günlük herhangi bir pencerede adil payın üzerine taşan nöbet sayısıdır. Sağdaki sütunlar son ayların haftagünü dağılımıdır; ortalamadan belirgin sapanlar renklendirilir (turuncu: fazla aldı, mavi: az aldı). Çizelge üretilirken bu birikim hesaba katılır, böylece aynı yük hep aynı kişide kalmaz. Kişinin kendi tercihi her zaman bunun önündedir.',
    shifts: 'Doktor bazlı nöbet tarihleri. Hafta sonu ve tatil günleri turuncu gösterilir.',
  };

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('div', { class: 'grow' },
        h('h2', null, 'Denge ve devir'),
        h('div', { class: 'small muted' },
          `Ortalama sapma ${fmtHours(ws.report.meanAbsDeviation)} sa · en büyük sapma ${fmtHours(ws.report.maxAbsDeviation)} sa`)),
      segmented(VIEWS, view, (v) => { state.balanceView = v; render(); }),
      h('a', { class: 'btn btn-sm', href: `/api/months/${ws.month.id}/export?kind=summary` }, 'CSV indir')),

    h('div', { class: 'banner banner-info' }, explanation[view]),

    h('div', { class: 'card' },
      h('div', { class: 'card-body tight' }, h('div', { class: 'table-wrap' }, table))),

    view === 'hours' && h('div', { class: 'card mt-16' },
      h('div', { class: 'card-head' }, h('h3', null, 'Ayın toplam saatleri')),
      h('div', { class: 'card-body' },
        h('div', { class: 'row-wrap gap-16' },
          effCats.map((c) => h('div', null,
            h('div', { class: 'small muted' }, c.label),
            h('div', { style: { fontSize: '19px', fontWeight: 700 } }, `${fmtHours(ws.totals[c.key])} sa`))),
          h('div', null,
            h('div', { class: 'small muted' }, 'Fiilî mesai toplamı'),
            h('div', { style: { fontSize: '19px', fontWeight: 700, color: 'var(--primary-dark)' } },
              `${fmtHours(topla(ws.totals, effCats))} sa`),
            h('div', { class: 'small muted' }, `${ws.days.length} gün × 24 sa — düzenden bağımsız sabit`)),
          h('div', null,
            h('div', { class: 'small muted' }, 'Hastanede bulunma toplamı'),
            h('div', { style: { fontSize: '19px', fontWeight: 700 } }, `${fmtHours(topla(ws.totals, presCats))} sa`))))),
  );
}
