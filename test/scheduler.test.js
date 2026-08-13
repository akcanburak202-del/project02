import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHIFT_TEMPLATES,
  buildContext,
  generateSchedule,
  updateLedger,
  vectorTotal,
} from '../engine/index.js';
import { CATEGORY_KEYS, EFFECTIVE_KEYS, PRESENCE_KEYS } from '../engine/slots.js';

const fiili = (vec) => EFFECTIVE_KEYS.reduce((s, k) => s + (vec[k] || 0), 0);
const bulunma = (vec) => PRESENCE_KEYS.reduce((s, k) => s + (vec[k] || 0), 0);
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
  // Slot kimligi vardiya duzenine gore degistigi icin uretilen cizelgeden alinir.
  const ilk = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });
  const hedef = ilk.slots.find((s) => s.date === '2026-08-22' && s.isNight).id;

  const month = makeMonth('2026-08', ids, {
    assignments: { [hedef]: 'd07' },
    pinned: [hedef],
  });
  const out = generateSchedule({ month, doctors, settings, seed: 123 });
  assert.equal(out.assignments[hedef], 'd07');
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

  // d01 gecmiste fiili mesai olarak fazla calismis olsun (birincil olcut)
  const ledger = {
    d01: { effWd: 6, effWe: 3 },
    d02: { effWd: -6, effWe: -3 },
  };
  const out = generateSchedule({ month: makeMonth('2026-09', ids), doctors, settings, ledger });

  const d01 = out.report.rows.find((r) => r.doctorId === 'd01');
  const d02 = out.report.rows.find((r) => r.doctorId === 'd02');

  // Hedef, adil paydan devir kadar asagi/yukari kaydirilmis olmali
  assert.ok(vectorTotal(d01.target) < vectorTotal(d01.fair), 'fazla calisanin hedefi dusmedi');
  assert.ok(vectorTotal(d02.target) > vectorTotal(d02.fair), 'eksik calisanin hedefi artmadi');

  // Ay kesinlestiginde defter sifira yaklasmali
  const next = updateLedger(ledger, out.report);
  const oncekiBorc = Math.abs(ledger.d01.effWd);
  const sonrakiBorc = Math.abs(next.d01.effWd);
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

test('SERT KURAL: iki nobet arasinda en az bir tam gun bosluk kalir', () => {
  // Kadro daraldikca kural zorlanir; 4 doktor teorik alt sinira yakindir
  // (62 nobet / 4 = 15,5 nobet, ayda en fazla 16 gun calisilabilir).
  for (const n of [10, 8, 6, 5, 4]) {
    const doctors = makeDoctors(n);
    const ids = Object.keys(doctors);
    const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

    assert.equal(out.report.unassigned.length, 0, `${n} doktor: bos slot kaldi`);
    assert.deepEqual(
      out.warnings.filter((w) => w.level !== 'info'),
      [],
      `${n} doktor: kural gevsetildi`,
    );
    for (const row of out.report.rows) {
      for (let i = 1; i < row.dates.length; i += 1) {
        const gap = diffDays(row.dates[i], row.dates[i - 1]);
        assert.ok(gap >= 2, `${n} doktor / ${row.doctorId}: ${row.dates[i - 1]} ve ${row.dates[i]} ust uste`);
      }
    }
  }
});

test('ust uste gun kurali gevsetilirse ardisik nobet mumkun olur', () => {
  // Kural ayarlanabilir olmali: 2 verildiginde ardisik gune izin verilir.
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const gevsek = { ...settings, rules: { maxConsecutiveDays: 2 } };
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings: gevsek });
  assert.equal(out.report.unassigned.length, 0);
  // Kural gevsek olsa da yayilma cezasi yuzunden pratikte nadir gorulur;
  // burada onemli olan cozucunun bunu hata saymamasi.
  assert.deepEqual(out.warnings.filter((w) => w.level === 'error'), []);
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

test('nobet sayilari teorik minimum yayilimda kalir (taban/tavan disina cikilmaz)', () => {
  // 62 nobet 8 doktora bolunmuyorsa kimse 7 veya 8 disinda bir sayi almamali.
  // Bu, yumusak bir tercih degil sert bir sinirdir.
  for (const n of [4, 5, 6, 7, 8, 9, 10, 12]) {
    const doctors = makeDoctors(n);
    const ids = Object.keys(doctors);
    const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

    assert.equal(out.report.unassigned.length, 0, `${n} doktor: bos slot`);
    assert.deepEqual(out.warnings.filter((w) => w.level !== 'info'), [], `${n} doktor: uyari var`);

    const beklenen = out.slots.length / n;
    const taban = Math.floor(beklenen + 1e-9);
    const tavan = Math.ceil(beklenen - 1e-9);
    for (const row of out.report.rows) {
      assert.ok(
        row.shifts >= taban && row.shifts <= tavan,
        `${n} doktor / ${row.doctorId}: ${row.shifts} nobet (izinli ${taban}–${tavan})`,
      );
    }
  }
});

test('FIILI MESAI neredeyse tam esit dagilir', () => {
  // Fiili mesai havuzu sabit (gunde 24 sa) oldugu icin bu buyukluk gercekten
  // esitlenebilir; birincil adalet olcutu budur.
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

  const eff = out.report.rows.map((r) => fiili(r.actual));
  const yayilim = Math.max(...eff) - Math.min(...eff);
  assert.ok(yayilim <= 1, `fiili mesai yayilimi ${yayilim.toFixed(2)} sa`);

  // Havuz: 31 gun x 24 sa, 8 doktora bolunur
  const hedef = (31 * 24) / 8;
  for (const e of eff) {
    assert.ok(Math.abs(e - hedef) <= 0.75, `bir doktorun fiili mesaisi ${e.toFixed(2)} (hedef ${hedef})`);
  }
});

test('bulunma saatleri de makul araliktadir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });
  const pres = out.report.rows.map((r) => bulunma(r.actual));
  const yayilim = Math.max(...pres) - Math.min(...pres);
  assert.ok(yayilim <= 4, `bulunma saati yayilimi ${yayilim.toFixed(2)} sa`);
});

test('yarim zamanli ve ay ortasi katilan/ayrilan kadroda da sinirlar tutar', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  month.participants[0] = { doctorId: 'd01', active: true, to: '2026-08-15', loadFactor: 1 };
  month.participants[1] = { doctorId: 'd02', active: true, from: '2026-08-20', loadFactor: 1 };
  month.participants[4] = { doctorId: 'd05', active: true, loadFactor: 0.5 };
  month.preferences = { d03: { '2026-08-05': 'off', '2026-08-06': 'off', '2026-08-07': 'off' } };

  const out = generateSchedule({ month, doctors, settings });
  assert.equal(out.report.unassigned.length, 0);
  assert.deepEqual(out.warnings.filter((w) => w.level !== 'info'), []);

  for (const row of out.report.rows) {
    const taban = Math.floor(row.expectedShifts + 1e-9);
    const tavan = Math.ceil(row.expectedShifts - 1e-9);
    assert.ok(
      row.shifts >= taban && row.shifts <= tavan,
      `${row.doctorId}: ${row.shifts} nobet (beklenen ${row.expectedShifts.toFixed(2)}, izinli ${taban}–${tavan})`,
    );
    assert.ok(
      Math.abs(bulunma(row.actual) - bulunma(row.target)) <= 3,
      `${row.doctorId}: bulunma saati hedeften ${(bulunma(row.actual) - bulunma(row.target)).toFixed(2)} sa sapmis`,
    );
  }
});

test('uyarilar teslim edilen cizelgeyi yansitir', () => {
  // Acgozlu asamada gevsetilen ama sonradan onarilan kurallar uyari
  // olarak kalmamali; aksi halde temiz cizelge kirli gorunur.
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings });

  const uyarilar = out.warnings.filter((w) => w.level !== 'info');
  assert.deepEqual(out.report.issues, [], 'gercek kural ihlali var');
  assert.deepEqual(uyarilar, [], 'ihlal yokken uyari uretilmis');
});
