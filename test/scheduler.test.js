import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHIFT_TEMPLATES,
  buildContext,
  generateSchedule,
  updateLedger,
  vectorTotal,
} from '../engine/index.js';
import { CATEGORY_KEYS } from '../engine/slots.js';
import { diffDays } from '../engine/calendar.js';

function makeDoctors(n) {
  const doctors = {};
  for (let i = 1; i <= n; i += 1) {
    const id = `d${String(i).padStart(2, '0')}`;
    doctors[id] = { id, name: `Dr ${id}` };
  }
  return doctors;
}

function makeMonth(id, doctorIds, overrides = {}) {
  return {
    id,
    participants: doctorIds.map((doctorId) => ({ doctorId, active: true, loadFactor: 1 })),
    preferences: {},
    assignments: {},
    pinned: [],
    lockedThrough: null,
    settings: {},
    ...overrides,
  };
}

const settings = { shiftTemplates: DEFAULT_SHIFT_TEMPLATES };

test('8 doktor icin agustos cizelgesi eksiksiz ve kuralli uretilir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

  assert.equal(out.slots.length, 62);
  assert.equal(out.report.unassigned.length, 0);
  const errors = out.report.issues.filter((i) => i.level === 'error');
  assert.deepEqual(errors, []);
  assert.deepEqual(out.report.issues, []);

  // Her doktor 7-9 nobet arasinda olmali (62 / 8 = 7.75)
  for (const row of out.report.rows) {
    assert.ok(row.shifts >= 7 && row.shifts <= 9, `${row.doctorId} ${row.shifts} nobet aldi`);
  }
});

test('dort etiketli saatler doktorlar arasinda dengeli dagilir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

  for (const key of CATEGORY_KEYS) {
    const values = out.report.rows.map((r) => r.actual[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Kategori basina en fazla 12 saatlik yayilim kabul edilebilir
    assert.ok(max - min <= 12, `${key}: min ${min} max ${max}`);
  }
  assert.ok(out.report.meanAbsDeviation < 4, `ortalama sapma ${out.report.meanAbsDeviation}`);
});

test('ayni doktora ayni gunun iki vardiyasi verilmez ve dinlenme korunur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

  const byDoctor = new Map();
  for (const slot of out.slots) {
    const d = out.assignments[slot.id];
    if (!byDoctor.has(d)) byDoctor.set(d, []);
    byDoctor.get(d).push(slot);
  }
  for (const [doctorId, slots] of byDoctor) {
    slots.sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < slots.length; i += 1) {
      const gapHours = (slots[i].startMin - slots[i - 1].endMin) / 60;
      assert.ok(gapHours >= 12, `${doctorId}: ${slots[i - 1].id} -> ${slots[i].id} arasi ${gapHours} saat`);
    }
  }
});

test('ayin 15inde ayrilan doktor yaklasik yari saat alir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  month.participants[0] = { doctorId: 'd01', active: true, loadFactor: 1, to: '2026-08-15' };
  const out = generateSchedule({ month, doctors, settings });

  const row = out.report.rows.find((r) => r.doctorId === 'd01');
  assert.equal(row.availableDays, 15);
  for (const date of row.dates) assert.ok(date <= '2026-08-15', `d01 ${date} tarihinde gorevlendirilmis`);

  const fullTime = out.report.rows.find((r) => r.doctorId === 'd02');
  const ratio = row.totalHours / fullTime.totalHours;
  assert.ok(ratio > 0.35 && ratio < 0.65, `oran ${ratio}`);
});

test('gece nobeti gorev bitis tarihini asamaz', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  month.participants[0] = { doctorId: 'd01', active: true, to: '2026-08-15' };
  const out = generateSchedule({ month, doctors, settings });
  // 15 Agustos gece nobeti 16 sabahina tasar, d01'e verilmemeli
  assert.notEqual(out.assignments['2026-08-15#gece'], 'd01');
});

test('izinli (off) gunler kesinlikle atanmaz, istemedigi gunler buyuk olcude korunur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  month.preferences = {
    d01: { '2026-08-10': 'off', '2026-08-11': 'off', '2026-08-12': 'off' },
    d03: { '2026-08-05': 'avoid', '2026-08-06': 'avoid', '2026-08-20': 'avoid' },
  };
  const out = generateSchedule({ month, doctors, settings });

  const d01 = out.report.rows.find((r) => r.doctorId === 'd01');
  for (const date of d01.dates) {
    assert.ok(!['2026-08-10', '2026-08-11', '2026-08-12'].includes(date), `izinli gun atanmis: ${date}`);
  }
  const d03 = out.report.rows.find((r) => r.doctorId === 'd03');
  const ihlal = d03.dates.filter((d) => ['2026-08-05', '2026-08-06', '2026-08-20'].includes(d));
  assert.equal(ihlal.length, 0, `istemedigi gunlere atanmis: ${ihlal.join(', ')}`);
});

test('istedigi gunler oncelikli olarak karsilanir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  month.preferences = { d05: { '2026-08-07': 'want', '2026-08-21': 'want' } };
  const out = generateSchedule({ month, doctors, settings });
  const d05 = out.report.rows.find((r) => r.doctorId === 'd05');
  const karsilanan = ['2026-08-07', '2026-08-21'].filter((d) => d05.dates.includes(d));
  assert.ok(karsilanan.length >= 1, 'istenen gunlerin hicbiri karsilanmadi');
});

test('ayin 19unda revizyon: onceki gunler aynen korunur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const ilk = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

  const month = makeMonth('2026-08', ids, {
    assignments: ilk.assignments,
    lockedThrough: '2026-08-18',
  });
  // d02 ayin 19undan itibaren gorevden ayriliyor
  month.participants[1] = { doctorId: 'd02', active: true, to: '2026-08-18' };
  const revize = generateSchedule({ month, doctors, settings, seed: 999 });

  for (const slot of revize.slots) {
    if (slot.date <= '2026-08-18') {
      assert.equal(revize.assignments[slot.id], ilk.assignments[slot.id], `${slot.id} degismis`);
    } else {
      assert.notEqual(revize.assignments[slot.id], 'd02', `${slot.id} ayrilan doktora verilmis`);
    }
  }
  assert.equal(revize.report.unassigned.length, 0);
});

test('sabitlenen (pinned) slot korunur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids, {
    assignments: { '2026-08-22#gece': 'd07' },
    pinned: ['2026-08-22#gece'],
  });
  const out = generateSchedule({ month, doctors, settings });
  assert.equal(out.assignments['2026-08-22#gece'], 'd07');
});

test('ayni tohum ayni cizelgeyi uretir, farkli tohum farkli sonuc verir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const a = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings, seed: 42 });
  const b = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings, seed: 42 });
  assert.deepEqual(a.assignments, b.assignments);

  const c = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings, seed: 4242 });
  const farkli = Object.keys(a.assignments).some((k) => a.assignments[k] !== c.assignments[k]);
  assert.ok(farkli, 'farkli tohum ayni sonucu verdi');
});

test('devir defteri sonraki ayda dengelemeyi saglar ve borcu kapatir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);

  // d01 gecmiste her kategoride 6 saat fazla calismis olsun
  const ledger = {
    d01: { wdSolo: 6, wdShared: 6, weSolo: 3, weShared: 3 },
    d02: { wdSolo: -6, wdShared: -6, weSolo: -3, weShared: -3 },
  };
  const out = generateSchedule({ month: makeMonth('2026-09', ids), doctors, settings, ledger });

  const d01 = out.report.rows.find((r) => r.doctorId === 'd01');
  const d02 = out.report.rows.find((r) => r.doctorId === 'd02');

  // Hedef, adil paydan devir kadar asagi/yukari kaydirilmis olmali
  assert.ok(vectorTotal(d01.target) < vectorTotal(d01.fair), 'fazla calisanin hedefi dusmedi');
  assert.ok(vectorTotal(d02.target) > vectorTotal(d02.fair), 'eksik calisanin hedefi artmadi');

  // Ay kesinlestiginde defter sifira yaklasmali
  const next = updateLedger(ledger, out.report);
  const oncekiBorc = Math.abs(ledger.d01.wdSolo);
  const sonrakiBorc = Math.abs(next.d01.wdSolo);
  assert.ok(sonrakiBorc < oncekiBorc, `borc kapanmadi: ${oncekiBorc} -> ${sonrakiBorc}`);
});

test('devir defterinin toplami sifir kalir', () => {
  const doctors = makeDoctors(6);
  const ids = Object.keys(doctors);
  let ledger = {};
  for (const monthId of ['2026-09', '2026-10', '2026-11']) {
    const out = generateSchedule({ month: makeMonth(monthId, ids), doctors, settings, ledger });
    ledger = updateLedger(ledger, out.report);
    for (const key of CATEGORY_KEYS) {
      const sum = ids.reduce((s, id) => s + (ledger[id]?.[key] || 0), 0);
      assert.ok(Math.abs(sum) < 1e-6, `${monthId} ${key} toplami ${sum}`);
    }
  }
  // Uzun vadede kimsenin birikimi asiri buyumemeli
  for (const id of ids) {
    for (const key of CATEGORY_KEYS) {
      assert.ok(Math.abs(ledger[id][key]) < 25, `${id} ${key} birikimi ${ledger[id][key]}`);
    }
  }
});

test('4 doktorla dar kadroda da eksiksiz cizelge uretilir', () => {
  const doctors = makeDoctors(4);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });
  assert.equal(out.report.unassigned.length, 0);
  const errors = out.report.issues.filter((i) => i.level === 'error');
  assert.deepEqual(errors, []);
});

test('nobetler aya yayilir, kume olusturmaz', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });
  for (const row of out.report.rows) {
    for (let i = 1; i < row.dates.length; i += 1) {
      const gap = diffDays(row.dates[i], row.dates[i - 1]);
      assert.ok(gap >= 2, `${row.doctorId}: ${row.dates[i - 1]} ve ${row.dates[i]} cok yakin`);
    }
  }
});

test('buildContext hedeflerin toplamini ayin toplamina esitler', () => {
  const doctors = makeDoctors(7);
  const ids = Object.keys(doctors);
  const built = buildContext({ month: makeMonth('2026-08', ids), doctors, settings });
  for (const key of CATEGORY_KEYS) {
    const sum = ids.reduce((s, id) => s + built.ctx.targetMap.get(id).target[key], 0);
    assert.ok(Math.abs(sum - built.totals[key]) < 1e-6, `${key}: ${sum} != ${built.totals[key]}`);
  }
});
