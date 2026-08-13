import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContext, extractRhythm, generateSchedule, mergeRhythm, monthRhythm, rhythmBias,
} from '../engine/index.js';

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
    preferences: {}, assignments: {}, pinned: [], lockedThrough: null,
    dayPatterns: {}, settings: {},
    ...overrides,
  };
}

const gunlerin = (row) => row.dates.map((iso) => Number(iso.slice(8, 10))).sort((a, b) => a - b);
const enYogunHafta = (row) => {
  const g = gunlerin(row);
  let m = 0;
  for (const s of g) m = Math.max(m, g.filter((x) => x >= s && x < s + 7).length);
  return m;
};

/* ------------------------- Olcum fonksiyonlari -------------------- */

test('monthRhythm haftagunlerini ve yogun hafta yukunu dogru sayar', () => {
  // 2026-08-03 pazartesi. Ust uste haftalarda pazartesi + carsamba.
  const r = monthRhythm(['2026-08-03', '2026-08-05', '2026-08-10', '2026-08-12'], 2);
  assert.equal(r.shifts, 4);
  assert.equal(r.weekday[1], 2, 'iki pazartesi');
  assert.equal(r.weekday[3], 2, 'iki carsamba');
  assert.equal(r.denseExcess, 0, 'pay 2 iken haftada 2 nobet tasma degil');

  // Ayni haftaya dort nobet: pay 2 -> ilk pencerede 2 tasma
  const yogun = monthRhythm(['2026-08-03', '2026-08-05', '2026-08-07', '2026-08-09'], 2);
  assert.ok(yogun.denseExcess >= 2, `beklenen tasma yok: ${yogun.denseExcess}`);
});

test('mergeRhythm aylik kayitlari toplar', () => {
  const a = { d01: { weekday: [0, 1, 0, 0, 0, 0, 0], denseExcess: 1, shifts: 1 } };
  const b = { d01: { weekday: [0, 2, 0, 0, 0, 0, 0], denseExcess: 0, shifts: 2 } };
  const m = mergeRhythm([a, b]);
  assert.equal(m.d01.weekday[1], 3);
  assert.equal(m.d01.denseExcess, 1);
  assert.equal(m.d01.shifts, 3);
});

test('rhythmBias fazla alani + , az alani - isaretler', () => {
  const history = {
    d01: { weekday: [0, 9, 0, 0, 0, 0, 0], denseExcess: 8, shifts: 9 },
    d02: { weekday: [0, 3, 0, 0, 0, 0, 0], denseExcess: 0, shifts: 9 },
  };
  const bias = rhythmBias(history, ['d01', 'd02']);
  assert.ok(bias.weekday.get('d01')[1] > 0, 'fazla pazartesi alan cezali olmali');
  assert.ok(bias.weekday.get('d02')[1] < 0, 'az pazartesi alan odullu olmali');
  assert.ok(bias.dense.get('d01') > bias.dense.get('d02'));
});

test('rhythmBias yarim zamanli calisani haksiz cezalandirmaz', () => {
  // d02 yarisi kadar nobet tutmus; haftagunu dagilimi ORANTILI olarak ayni.
  const history = {
    d01: { weekday: [2, 2, 2, 2, 2, 2, 2], denseExcess: 0, shifts: 14 },
    d02: { weekday: [1, 1, 1, 1, 1, 1, 1], denseExcess: 0, shifts: 7 },
  };
  const bias = rhythmBias(history, ['d01', 'd02']);
  for (let wd = 0; wd < 7; wd += 1) {
    assert.ok(Math.abs(bias.weekday.get('d01')[wd]) < 1e-9, `d01 ${wd} cezalanmis`);
    assert.ok(Math.abs(bias.weekday.get('d02')[wd]) < 1e-9, `d02 ${wd} cezalanmis`);
  }
});

test('gecmis yoksa hicbir yon verilmez', () => {
  const bias = rhythmBias(null, ['d01', 'd02']);
  assert.equal(bias.empty, true);
  assert.deepEqual(bias.weekday.get('d01'), [0, 0, 0, 0, 0, 0, 0]);
});

/* ---------------------- Ay ici yogunluk denetimi ------------------ */

test('hicbir doktora 7 gunde adil payin ustunde nobet yiginlmaz', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings: {} });

  // 62 nobet / 8 doktor / 31 gun -> 7 gunde adil pay 1,75 -> tavan 2, tolerans 1
  for (const row of out.report.rows) {
    assert.ok(enYogunHafta(row) <= 3, `${row.doctorId}: bir haftaya ${enYogunHafta(row)} nobet dusmus`);
  }
});

test('yogun hafta cezasi kapatilinca yuk gorunur bicimde artar', () => {
  const doctors = makeDoctors(10);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);

  const topla = (out) => out.report.rows.reduce((s, r) => s + enYogunHafta(r), 0);
  const acik = topla(generateSchedule({ month, doctors, settings: {} }, { seed: 7 }));
  const kapali = topla(generateSchedule(
    { month, doctors, settings: { weights: { weekDensity: 0 } } }, { seed: 7 },
  ));
  assert.ok(acik <= kapali, `ceza acikken yuk artmis: ${acik} > ${kapali}`);
});

test('yarim zamanli doktorun haftalik payi kendi yukune gore belirlenir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids, {
    participants: ids.map((doctorId, i) => ({
      doctorId, active: true, loadFactor: i === 0 ? 0.5 : 1,
    })),
  });
  const out = generateSchedule({ month, doctors, settings: {} });
  const yarim = out.report.rows.find((r) => r.doctorId === 'd01');
  const tam = out.report.rows.filter((r) => r.doctorId !== 'd01');
  assert.ok(yarim.shifts < Math.min(...tam.map((r) => r.shifts)), 'yarim zamanli daha az nobet almali');
  assert.equal(out.report.unassigned.length, 0);
});

/* ----------------------- Aylar arasi hafiza ----------------------- */

test('ritim hafizasi haftagunu dagilimini aylar icinde dengeler', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const AYLAR = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

  const kosu = (hafizaAcik) => {
    const settings = hafizaAcik ? {} : { weights: { weekdayHistory: 0, densityHistory: 0 } };
    const gecmis = [];
    for (const ay of AYLAR) {
      const month = makeMonth(ay, ids);
      const history = gecmis.length ? mergeRhythm(gecmis) : null;
      const out = generateSchedule({ month, doctors, settings, history });
      month.assignments = out.assignments;
      gecmis.push(extractRhythm(buildContext({ month, doctors, settings, history }), out.assignments));
    }
    const toplam = mergeRhythm(gecmis);
    let enBuyukFark = 0;
    for (let wd = 0; wd < 7; wd += 1) {
      const v = ids.map((id) => toplam[id].weekday[wd]);
      enBuyukFark = Math.max(enBuyukFark, Math.max(...v) - Math.min(...v));
    }
    const dv = ids.map((id) => toplam[id].denseExcess);
    return { enBuyukFark, yogunFark: Math.max(...dv) - Math.min(...dv) };
  };

  const acik = kosu(true);
  const kapali = kosu(false);
  assert.ok(
    acik.enBuyukFark < kapali.enBuyukFark,
    `haftagunu farki kapanmamis: açık ${acik.enBuyukFark}, kapalı ${kapali.enBuyukFark}`,
  );
  assert.ok(
    acik.yogunFark <= kapali.yogunFark,
    `yogun hafta farki kapanmamis: açık ${acik.yogunFark}, kapalı ${kapali.yogunFark}`,
  );
});

test('ritim hafizasi kisinin kendi tercihini ezmez', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);

  // d01 gecmiste asiri carsamba almis: hafiza onu carsambadan uzaklastirmak ister.
  const history = {};
  for (const id of ids) {
    history[id] = {
      weekday: id === 'd01' ? [1, 1, 1, 12, 1, 1, 1] : [3, 3, 3, 1, 3, 3, 3],
      denseExcess: 0,
      shifts: 18,
    };
  }

  // Ama d01 carsambalari acikca istiyor.
  const carsambalar = ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26'];
  const preferences = { d01: Object.fromEntries(carsambalar.map((iso) => [iso, 'want'])) };

  const out = generateSchedule({
    month: makeMonth('2026-08', ids, { preferences }), doctors, settings: {}, history,
  });
  const alinan = carsambalar.filter((iso) =>
    Object.entries(out.assignments).some(([slotId, id]) => id === 'd01' && slotId.startsWith(iso)));
  assert.ok(alinan.length >= 2, `tercih ezilmis: ${alinan.length}/4 çarşamba verilmiş`);
});

test('ritim hafizasi cizelgeyi bozmaz: bos slot ve kural ihlali olusturmaz', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const history = {};
  ids.forEach((id, i) => {
    const weekday = [1, 1, 1, 1, 1, 1, 1];
    weekday[i % 7] = 10; // her doktorda baska bir gun asiri birikmis
    history[id] = { weekday, denseExcess: i, shifts: 16 };
  });

  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings: {}, history });
  assert.equal(out.report.unassigned.length, 0);
  assert.deepEqual(out.report.issues, []);
});

test('extractRhythm cizelgeden dogru kayit cikarir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  const out = generateSchedule({ month, doctors, settings: {} });
  month.assignments = out.assignments;

  const kayit = extractRhythm(buildContext({ month, doctors, settings: {} }), out.assignments);
  const toplamNobet = Object.values(kayit).reduce((s, r) => s + r.shifts, 0);
  assert.equal(toplamNobet, out.slots.length, 'kayittaki nobet sayisi slot sayisina esit olmali');
  for (const row of out.report.rows) {
    assert.equal(kayit[row.doctorId].shifts, row.shifts);
    const haftaToplami = kayit[row.doctorId].weekday.reduce((a, b) => a + b, 0);
    assert.equal(haftaToplami, row.shifts, 'haftagunu dagilimi toplami nobet sayisina esit olmali');
  }
});
