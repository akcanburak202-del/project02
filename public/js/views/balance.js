/**
 * Denge ekrani: 4 etiketli saatlerin gercek/hedef karsilastirmasi,
 * devir defteri ve doktor bazli nobet listesi.
 */

import { deviationBar, fmtDateShort, fmtHours, fmtSigned, h, segmented } from '../core.js';
import { render, state } from '../app.js';
import { doctorName } from './schedule.js';

const VIEWS = [
  { value: 'hours', label: 'Saat dağılımı' },
  { value: 'deviation', label: 'Hedeften sapma' },
  { value: 'ledger', label: 'Devir defteri' },
  { value: 'shifts', label: 'Nöbet listesi' },
];

export function renderBalance() {
  const ws = state.ws;
  const view = state.balanceView || 'hours';
  const cats = ws.categories;
  const rows = [...ws.report.rows].sort((a, b) =>
    doctorName(ws, a.doctorId).localeCompare(doctorName(ws, b.doctorId), 'tr'));

  const totalsRow = (pick) => cats.map((c) =>
    h('td', { class: 'num' }, fmtHours(rows.reduce((s, r) => s + pick(r)[c.key], 0))));

  let table;
  if (view === 'hours') {
    table = h('table', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Doktor'),
        h('th', { class: 'num' }, 'Nöbet'),
        h('th', { class: 'num' }, 'Gece'),
        h('th', { class: 'num' }, 'H.sonu'),
        cats.map((c) => h('th', { class: 'num', title: c.label }, c.short)),
        h('th', { class: 'num' }, 'Toplam'),
        h('th', { class: 'num' }, 'Hedef'),
        h('th', null, 'Fark'))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, h('div', { style: { fontWeight: 600 } }, doctorName(ws, r.doctorId)),
          r.availableDays < ws.days.length &&
            h('div', { class: 'small muted' }, `${r.availableDays}/${ws.days.length} gün görevli`)),
        h('td', { class: 'num' }, r.shifts),
        h('td', { class: 'num' }, r.nightShifts),
        h('td', { class: 'num' }, r.weekendShifts),
        cats.map((c) => h('td', { class: 'num' }, fmtHours(r.actual[c.key]))),
        h('td', { class: 'num', style: { fontWeight: 700 } }, fmtHours(r.totalHours)),
        h('td', { class: 'num muted' }, fmtHours(r.targetTotalHours)),
        h('td', null, deviationBar(r.totalHours - r.targetTotalHours, 16))))),
      h('tfoot', null, h('tr', null,
        h('th', null, 'Toplam'),
        h('th', { class: 'num' }, rows.reduce((s, r) => s + r.shifts, 0)),
        h('th', { class: 'num' }, rows.reduce((s, r) => s + r.nightShifts, 0)),
        h('th', { class: 'num' }, rows.reduce((s, r) => s + r.weekendShifts, 0)),
        totalsRow((r) => r.actual),
        h('th', { class: 'num' }, fmtHours(rows.reduce((s, r) => s + r.totalHours, 0))),
        h('th', null), h('th', null))));
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
    hours: 'Her doktorun ay içinde aldığı saatler dört etikete ayrılmış hâlde. "Hedef", görev süresi ve devir defteri dikkate alınarak hesaplanan adil paydır.',
    deviation: 'Etiket bazında gerçekleşen ile hedef arasındaki fark. Küçük farklar kaçınılmazdır (bir nöbet bölünemez); ay kesinleştiğinde bu farklar devir defterine yazılır ve sonraki aylarda kapatılır.',
    ledger: 'Geçmiş aylardan devreden fazla (+) veya eksik (−) saatler. Yeni ay planlanırken hedefler bu birikime göre ters yönde kaydırılır.',
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
          cats.map((c) => h('div', null,
            h('div', { class: 'small muted' }, c.label),
            h('div', { style: { fontSize: '19px', fontWeight: 700 } }, `${fmtHours(ws.totals[c.key])} sa`))),
          h('div', null,
            h('div', { class: 'small muted' }, 'Toplam'),
            h('div', { style: { fontSize: '19px', fontWeight: 700 } },
              `${fmtHours(cats.reduce((s, c) => s + ws.totals[c.key], 0))} sa`))))),
  );
}
