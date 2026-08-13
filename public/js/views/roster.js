/**
 * Katilim ekrani: bu ay kimler gorev alacak, hangi tarihler arasinda,
 * hangi gunlerde izinli, kac nobete kadar.
 */

import { api, fmtDate, fmtHours, h, openModal } from '../core.js';
import { applyWorkspace, render, state, withBusy } from '../app.js';

function draft() {
  // Uzerinde calisilan kopya: kaydedene kadar sunucuya gitmez.
  if (!state.rosterDraft || state.rosterDraftMonth !== state.ws.month.id) {
    state.rosterDraft = structuredClone(state.ws.participants);
    state.rosterDraftMonth = state.ws.month.id;
  }
  return state.rosterDraft;
}

export function resetRosterDraft() {
  state.rosterDraft = null;
  state.rosterDraftMonth = null;
}

function rowFor(list, doctorId) {
  let row = list.find((p) => p.doctorId === doctorId);
  if (!row) {
    row = { doctorId, active: false, from: null, to: null, offDates: [], loadFactor: 1, maxShifts: null, shiftPreference: 'any' };
    list.push(row);
  }
  return row;
}

function offDatesDialog(row, onDone) {
  const ws = state.ws;
  openModal((close) => {
    const selected = new Set(row.offDates || []);
    const grid = h('div', { class: 'pref-grid' });
    const paint = () => {
      grid.replaceChildren(
        ...ws.days.map((day) =>
          h('button', {
            class: `pref-day${day.type === 'weekend' ? ' we' : ''}${selected.has(day.iso) ? ' off' : ''}`,
            type: 'button',
            onClick: () => {
              if (selected.has(day.iso)) selected.delete(day.iso);
              else selected.add(day.iso);
              paint();
            },
          },
            h('span', { class: 'n' }, day.day),
            h('span', { class: 'lbl' }, day.shortName))),
      );
    };
    paint();

    return h('div', null,
      h('h3', null, `${ws.doctors[row.doctorId]?.name} — izinli günler`),
      h('p', { class: 'modal-text' }, 'İşaretlenen günlerde bu doktora kesinlikle nöbet verilmez ve aylık hedefi buna göre düşürülür.'),
      h('div', { class: 'mt-16' }, grid),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: () => { selected.clear(); paint(); } }, 'Temizle'),
        h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn btn-primary',
          onClick: () => { row.offDates = [...selected].sort(); close(); onDone(); },
        }, 'Tamam')));
  }, { wide: true });
}

export function renderRoster() {
  const ws = state.ws;
  const list = draft();
  const readOnly = ws.month.status === 'final';
  const doctors = Object.values(ws.doctors).filter((d) => d.active && d.scheduled);
  const rerender = () => render();

  const save = async () => {
    const out = await withBusy(
      () => api.put(`/api/months/${ws.month.id}/participants`, { participants: list }),
      { success: 'Katılım bilgileri kaydedildi' },
    );
    if (!out) return;
    resetRosterDraft();
    applyWorkspace(out);
  };

  const body = doctors.map((doc) => {
    const row = rowFor(list, doc.id);
    const reportRow = ws.report.rows.find((r) => r.doctorId === doc.id);
    const dis = readOnly || !row.active;

    return h('tr', null,
      h('td', null,
        h('label', { class: 'inline' },
          h('input', {
            type: 'checkbox', checked: row.active !== false, disabled: readOnly,
            onChange: (e) => { row.active = e.target.checked; rerender(); },
          }),
          h('div', null,
            h('div', { style: { fontWeight: 600 } }, doc.name),
            h('div', { class: 'small muted' }, doc.code || doc.username)))),
      h('td', null, h('input', {
        type: 'date', value: row.from || '', disabled: dis,
        min: `${ws.month.id}-01`,
        onChange: (e) => { row.from = e.target.value || null; },
      })),
      h('td', null, h('input', {
        type: 'date', value: row.to || '', disabled: dis,
        min: `${ws.month.id}-01`,
        onChange: (e) => { row.to = e.target.value || null; },
      })),
      h('td', null,
        h('button', {
          class: 'btn btn-sm', disabled: dis,
          onClick: () => offDatesDialog(row, rerender),
        }, row.offDates?.length ? `${row.offDates.length} gün izinli` : 'İzin ekle')),
      h('td', null, h('select', {
        disabled: dis,
        onChange: (e) => { row.shiftPreference = e.target.value; },
      },
        h('option', { value: 'any', selected: row.shiftPreference === 'any' }, 'Farketmez'),
        h('option', { value: 'day', selected: row.shiftPreference === 'day' }, 'Gündüz ağırlıklı'),
        h('option', { value: 'night', selected: row.shiftPreference === 'night' }, 'Gece ağırlıklı'))),
      h('td', null, h('input', {
        type: 'number', step: '0.1', min: '0.1', max: '2', value: row.loadFactor ?? 1, disabled: dis,
        onChange: (e) => { row.loadFactor = Number(e.target.value) || 1; },
      })),
      h('td', null, h('input', {
        type: 'number', min: '1', max: '31', value: row.maxShifts ?? '', placeholder: 'sınırsız', disabled: dis,
        onChange: (e) => { row.maxShifts = e.target.value === '' ? null : Number(e.target.value); },
      })),
      h('td', { class: 'num small muted' },
        reportRow ? `${reportRow.availableDays} gün · ${fmtHours(reportRow.targetTotalHours)} sa` : '—'),
    );
  });

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('div', { class: 'grow' },
        h('h2', null, 'Bu ay kimler nöbet tutacak?'),
        h('div', { class: 'small muted' },
          'Görev başlangıç/bitiş tarihi girerek ay ortasında katılan veya ayrılan doktorları tanımlayabilirsin. ',
          'Hedef saatler görev süresiyle orantılı hesaplanır.')),
      h('button', { class: 'btn', onClick: () => { resetRosterDraft(); render(); } }, 'Değişiklikleri geri al'),
      h('button', { class: 'btn btn-primary', onClick: save, disabled: readOnly }, 'Kaydet')),

    readOnly && h('div', { class: 'banner banner-info' }, 'Ay kesinleştirildiği için katılım bilgileri değiştirilemez.'),
    ws.month.lockedThrough && h('div', { class: 'banner banner-warn' },
      `Dikkat: çizelge ${fmtDate(ws.month.lockedThrough)} tarihine kadar dondurulmuş. Katılım değişikliği yalnızca sonraki günleri etkiler; yeniden planlama gerekir.`),

    h('div', { class: 'card' },
      h('div', { class: 'card-body tight' },
        h('div', { class: 'table-wrap' },
          h('table', null,
            h('thead', null, h('tr', null,
              h('th', null, 'Doktor'),
              h('th', null, 'Görev başlangıcı'),
              h('th', null, 'Görev bitişi'),
              h('th', null, 'İzin günleri'),
              h('th', null, 'Vardiya tercihi'),
              h('th', null, 'Yük katsayısı'),
              h('th', null, 'Maks. nöbet'),
              h('th', { class: 'num' }, 'Hesaplanan hedef'))),
            h('tbody', null, body))))),

    h('div', { class: 'small muted mt-8' },
      'Yük katsayısı: 1 = tam gün eşit pay, 0,5 = yarım pay. Boş bırakılan başlangıç/bitiş tarihi "ay boyunca görevli" demektir.'),
  );
}

