import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSlotsFromPlan, refreshPlanSlots, refreshPlanWindow, vectorTotal } from '../engine/slots.js';
import {
  DEFAULT_SHIFT_POLICY, createPlan, isDayValid, normalizePolicy, planDeviationHours,
  readVariable, timeVariables, validatePolicy, writeVariable,
} from '../engine/shiftplan.js';
import { DEFAULT_PATTERNS, normalizePatterns, previewPattern, validatePattern } from '../engine/patterns.js';
import { monthDays } from '../engine/calendar.js';
import { makeRng } from '../engine/scheduler.js';
import { generateSchedule, DEFAULT_SHIFT_TEMPLATES } from '../engine/index.js';
import { CATEGORY_KEYS, EFFECTIVE_KEYS as EFF_KEYS } from '../engine/slots.js';

const CAL = { weekendDays: [0, 6], holidays: [] };

function setup(policy = DEFAULT_SHIFT_POLICY) {
  const days = monthDays(2026, 8, CAL);
  const plan = createPlan(normalizePolicy(policy), days);
  const built = buildSlotsFromPlan({ year: 2026, month: 8, days, plan, ...CAL });
  return { days, plan, built };
}

test('varsayilan tercih saatleri kullanicinin tarif ettigi duzeni verir', () => {
  const { built } = setup();
  const gunduz = built.slots.find((s) => s.id === '2026-08-04#v1');
  const gece = built.slots.find((s) => s.id === '2026-08-04#v2');

  assert.equal(gunduz.timeLabel, '09:00–24:00');
  assert.equal(gece.timeLabel, '15:00–09:00 (+1)');
  // 4 Agustos Sali: gunduz 6 sa tek + 9 sa paylasimli, gece 9 + 9
  assert.equal(gunduz.cat.wdSolo, 6);
  assert.equal(gunduz.cat.wdShared, 9);
  assert.equal(gece.cat.wdShared, 9);
  assert.equal(gece.cat.wdSolo, 9);
  assert.equal(built.warnings.length, 0);
});

test('esnek plan 24 saati kesintisiz kapsar', () => {
  const { days, plan, built } = setup();
  const vars = timeVariables(plan, days);
  const rng = makeRng(7);

  // Rastgele ama gecerli 200 plan uzerinde kapsama boslugu olmamali
  for (let i = 0; i < 200; i += 1) {
    const v = vars[(rng() * vars.length) | 0];
    const step = plan.policy.stepMinutes;
    const slotCount = Math.floor((v.max - v.min) / step);
    const before = readVariable(plan, v);
    writeVariable(plan, v, v.min + ((rng() * (slotCount + 1)) | 0) * step);
    const ok = [v.day - 1, v.day].every((d) => d < 0 || d >= days.length || isDayValid(plan, days, d));
    if (!ok) {
      writeVariable(plan, v, before);
      continue;
    }
    refreshPlanSlots(built, { year: 2026, month: 8, ...CAL });
    const gaps = built.warnings || [];
    assert.equal(gaps.length, 0, 'kapsama boslugu olustu');
  }
});

test('YEREL guncelleme, tam yeniden hesapla birebir ayni sonucu verir', () => {
  // Optimizasyon dongusu hizli olsun diye yalnizca etkilenen gunler yeniden
  // hesaplaniyor. Bu kisayolun tam hesapla ayni sonucu verdigi kanitlanmali;
  // aksi halde cizelge sessizce yanlis saat dagilimiyla uretilir.
  const { days, plan, built } = setup();
  const vars = timeVariables(plan, days);
  const rng = makeRng(20260813);
  const opts = { year: 2026, month: 8, ...CAL };

  for (let i = 0; i < 300; i += 1) {
    const v = vars[(rng() * vars.length) | 0];
    const step = plan.policy.stepMinutes;
    const slotCount = Math.floor((v.max - v.min) / step);
    const before = readVariable(plan, v);
    const next = v.min + ((rng() * (slotCount + 1)) | 0) * step;
    if (next === before) continue;
    writeVariable(plan, v, next);

    const touched = v.kind === 'handover' ? [v.day - 1, v.day] : [v.day];
    const lo = Math.max(0, Math.min(...touched) - 1);
    const hi = Math.min(days.length - 1, Math.max(...touched));
    if (!touched.every((d) => d < 0 || d >= days.length || isDayValid(plan, days, d))) {
      writeVariable(plan, v, before);
      continue;
    }

    refreshPlanWindow(built, opts, lo, hi);
    const local = built.slots.map((s) => ({ id: s.id, start: s.startMin, end: s.endMin, cat: { ...s.cat } }));
    const localTotals = { ...built.totals };

    refreshPlanSlots(built, opts);
    const full = built.slots.map((s) => ({ id: s.id, start: s.startMin, end: s.endMin, cat: { ...s.cat } }));

    for (let j = 0; j < full.length; j += 1) {
      assert.equal(local[j].id, full[j].id);
      assert.equal(local[j].start, full[j].start, `${full[j].id} baslangic`);
      assert.equal(local[j].end, full[j].end, `${full[j].id} bitis`);
      for (const key of CATEGORY_KEYS) {
        assert.ok(
          Math.abs(local[j].cat[key] - full[j].cat[key]) < 1e-9,
          `${full[j].id} ${key}: yerel ${local[j].cat[key]} != tam ${full[j].cat[key]}`,
        );
      }
    }
    for (const key of CATEGORY_KEYS) {
      assert.ok(Math.abs(localTotals[key] - built.totals[key]) < 1e-6, `toplam ${key} kaydi`);
    }
  }
});

test('ay toplamlari her zaman slotlarin gercek toplamina esit kalir', () => {
  // Artimli toplam guncellemesi kaydi kolay bir yerdir: toplamlar kayarsa
  // hedefler yanlis tabana gore hesaplanir ve devir defteri sifir toplamini
  // kaybeder. Bu yuzden dogrudan olculur.
  const { days, plan, built } = setup();
  const vars = timeVariables(plan, days);
  const rng = makeRng(4242);
  const opts = { year: 2026, month: 8, ...CAL };

  const check = (etiket) => {
    for (const key of CATEGORY_KEYS) {
      const sum = built.slots.reduce((acc, s) => acc + s.cat[key], 0);
      assert.ok(
        Math.abs(sum - built.totals[key]) < 1e-9,
        `${etiket} ${key}: toplam ${built.totals[key]} != slot toplami ${sum}`,
      );
    }
  };
  check('baslangic');

  for (let i = 0; i < 150; i += 1) {
    const v = vars[(rng() * vars.length) | 0];
    const step = plan.policy.stepMinutes;
    const slotCount = Math.floor((v.max - v.min) / step);
    const before = readVariable(plan, v);
    writeVariable(plan, v, v.min + ((rng() * (slotCount + 1)) | 0) * step);
    const touched = v.kind === 'handover' ? [v.day - 1, v.day] : [v.day];
    if (!touched.every((d) => d < 0 || d >= days.length || isDayValid(plan, days, d))) {
      writeVariable(plan, v, before);
      continue;
    }
    const lo = Math.max(0, Math.min(...touched) - 1);
    const hi = Math.min(days.length - 1, Math.max(...touched));
    refreshPlanWindow(built, opts, lo, hi);
    check(`${i}. degisiklikten sonra`);
  }
});

test('saat etiketi plan degisince guncellenir', () => {
  const { days, plan, built } = setup();
  // 4 Agustos (indeks 3) gunduz vardiyasinin cikis saati
  const v = timeVariables(plan, days).find((x) => x.kind === 'time' && x.day === 3);
  writeVariable(plan, v, 22 * 60);
  refreshPlanWindow(built, { year: 2026, month: 8, ...CAL }, 2, 3);
  const gunduz = built.slots.find((s) => s.id === '2026-08-04#v1');
  assert.equal(gunduz.timeLabel, '09:00–22:00');
  assert.equal(gunduz.hours, 13);
});

test('esnek mod, sabit saatlere gore cok daha esit dagitir', () => {
  const doctors = {};
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const id = `d${String(i).padStart(2, '0')}`;
    doctors[id] = { id, name: id };
    ids.push(id);
  }
  const month = () => ({
    id: '2026-08',
    participants: ids.map((doctorId) => ({ doctorId, active: true })),
    preferences: {}, assignments: {}, pinned: [], lockedThrough: null, settings: {},
  });

  const sabit = generateSchedule({
    month: month(), doctors,
    settings: { shiftPolicy: { mode: 'fixed' }, shiftTemplates: DEFAULT_SHIFT_TEMPLATES },
  });
  const esnek = generateSchedule({ month: month(), doctors, settings: {} });

  assert.equal(esnek.report.unassigned.length, 0);
  assert.deepEqual(esnek.report.issues, []);
  assert.ok(
    esnek.report.meanAbsDeviation < sabit.report.meanAbsDeviation / 2,
    `esnek ${esnek.report.meanAbsDeviation.toFixed(2)} sa, sabit ${sabit.report.meanAbsDeviation.toFixed(2)} sa`,
  );
  assert.ok(esnek.report.meanAbsDeviation < 1.2, `ortalama sapma ${esnek.report.meanAbsDeviation.toFixed(2)} sa`);
});

test('uretilen saatler makul araliklarda kalir', () => {
  const doctors = {};
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const id = `d${i}`;
    doctors[id] = { id, name: id };
    ids.push(id);
  }
  const out = generateSchedule({
    month: {
      id: '2026-08',
      participants: ids.map((doctorId) => ({ doctorId, active: true })),
      preferences: {}, assignments: {}, pinned: [], lockedThrough: null, settings: {},
    },
    doctors,
    settings: {},
  });

  const P = normalizePolicy(DEFAULT_SHIFT_POLICY);
  for (const slot of out.slots) {
    const startOfDay = ((slot.startMin % 1440) + 1440) % 1440;
    // Hicbir vardiya gece yarisi ile sabah arasinda baslamamali
    assert.ok(startOfDay >= 7 * 60 && startOfDay <= 18 * 60,
      `${slot.id} ${slot.timeLabel} — mantiksiz giris saati`);
    assert.ok(slot.hours >= P.minShiftHours && slot.hours <= P.maxShiftHours,
      `${slot.id} ${slot.hours} saat`);
  }
});

test('esneklik kapatilirsa saatler tercih edilen degerde sabit kalir', () => {
  const doctors = { d1: { id: 'd1', name: 'd1' } };
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const id = `d${i}`;
    doctors[id] = { id, name: id };
    ids.push(id);
  }
  const out = generateSchedule({
    month: {
      id: '2026-08',
      participants: ids.map((doctorId) => ({ doctorId, active: true })),
      preferences: {}, assignments: {}, pinned: [], lockedThrough: null, settings: {},
    },
    doctors,
    settings: { shiftPolicy: { flexibility: 'off' } },
  });
  for (const slot of out.slots) {
    assert.ok(
      slot.timeLabel === '09:00–24:00' || slot.timeLabel === '15:00–09:00 (+1)',
      `${slot.id} ${slot.timeLabel} — esneklik kapaliyken saat degismis`,
    );
  }
});

test('kapsama boslugu birakan gun deseni hata verir', () => {
  const problems = validatePolicy({
    patterns: [{
      id: 'bozuk',
      name: 'Bozuk desen',
      enabled: true,
      shifts: [
        // Gunduz erken cikip gece gec geliyor -> arada serviste kimse kalmaz
        { label: 'Gündüz', start: 'devir', end: { min: '13:00', preferred: '14:00', max: '15:00' } },
        { label: 'Gece', start: { min: '16:00', preferred: '17:00', max: '18:00' }, end: 'devir+1' },
      ],
    }],
  });
  assert.ok(problems.some((p) => p.level === 'error'), JSON.stringify(problems));
});

test('desen kutuphanesindeki her desen tam 24 saat fiili mesai verir', () => {
  // Bu, desenin gunu bosluksuz ve cakismasiz kapsadiginin de kanitidir.
  for (const pattern of normalizePatterns(DEFAULT_PATTERNS)) {
    const preview = previewPattern(pattern);
    const toplam = preview.reduce((a, s) => a + s.effectiveHours, 0);
    assert.ok(Math.abs(toplam - 24) < 0.01, `${pattern.name}: fiilî toplam ${toplam}`);
    assert.deepEqual(
      validatePattern(pattern).filter((p) => p.level === 'error'),
      [],
      `${pattern.name} gecersiz`,
    );
  }
});

test('gun basina farkli desen secilebilir ve slot yapisi ona gore olusur', () => {
  const doctors = {};
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const id = `d${String(i).padStart(2, '0')}`;
    doctors[id] = { id, name: id };
    ids.push(id);
  }
  const dayPatterns = {
    '2026-08-01': 'tekli-24',   // tek nobetci 24 saat
    '2026-08-05': 'ikili-tam',  // iki kisi de tam gun
  };
  const out = generateSchedule({
    month: {
      id: '2026-08',
      participants: ids.map((doctorId) => ({ doctorId, active: true })),
      preferences: {}, assignments: {}, pinned: [], lockedThrough: null,
      settings: {}, dayPatterns,
    },
    doctors,
    settings: { shiftPolicy: { patterns: DEFAULT_PATTERNS.map((p) => ({ ...p, enabled: true })) } },
  });

  const gun1 = out.slots.filter((s) => s.date === '2026-08-01');
  const gun5 = out.slots.filter((s) => s.date === '2026-08-05');
  assert.equal(gun1.length, 1, 'tek nobetci deseni bir slot uretmeli');
  assert.equal(gun5.length, 2, 'tam gun deseni iki slot uretmeli');

  // Tek nobetci: butun gun tek basina, yani fiili mesai = bulunma suresi
  assert.ok(Math.abs(gun1[0].effectiveHours - gun1[0].hours) < 1e-9);
  assert.ok(gun1[0].hours >= 22, `tek nobetci gunu ${gun1[0].hours} sa`);

  // Iki kisi tam gun: ayni araliklar, fiili mesai tam ortadan bolunur
  assert.equal(gun5[0].hours, gun5[1].hours);
  for (const s of gun5) assert.ok(Math.abs(s.effectiveHours - s.hours / 2) < 1e-9, `${s.effectiveHours}`);

  assert.equal(out.report.unassigned.length, 0);
  assert.deepEqual(out.warnings.filter((w) => w.level !== 'info'), []);
});

test('plan sapmasi tercih edilen saatlerde sifirdir', () => {
  const { days, plan } = setup();
  const vars = timeVariables(plan, days);
  assert.equal(planDeviationHours(plan, vars), 0);
  writeVariable(plan, vars[0], readVariable(plan, vars[0]) + 60);
  assert.equal(planDeviationHours(plan, vars), 1);
});

test('uc vardiyali gun deseni de kesintisiz kapsar', () => {
  const policy = {
    minShiftHours: 8,
    patterns: DEFAULT_PATTERNS.map((p) => ({ ...p, enabled: p.id === 'uclu' })),
    defaultPattern: { weekday: 'uclu', weekend: 'uclu' },
  };
  const days = monthDays(2026, 8, CAL);
  const plan = createPlan(normalizePolicy(policy), days);
  const built = buildSlotsFromPlan({ year: 2026, month: 8, days, plan, ...CAL });
  assert.equal(built.warnings.length, 0, JSON.stringify(built.warnings));
  assert.equal(built.slots.length, 31 * 3);
  // Gunluk fiili mesai toplami her zaman 24 saat
  const gun = built.slots.filter((s) => s.date === '2026-08-04');
  const fiiliToplam = gun.reduce((a, s) => a + s.effectiveHours, 0);
  assert.ok(Math.abs(fiiliToplam - 24) < 1e-9, `${fiiliToplam}`);
});

test('normalizePatterns ve normalizePolicy tekrar cagrilinca bozulmaz', () => {
  // Politika hem ayarlar kaydedilirken hem her ay kurulurken normalize edilir.
  // Islem idempotent degilse 'devir' isaretcileri sabit saate donusur, gunun
  // sonu kapanmaz ve sahte "kapsama boslugu" hatalari uretilir.
  const bir = normalizePatterns(DEFAULT_PATTERNS);
  const iki = normalizePatterns(bir);
  const uc = normalizePatterns(iki);
  for (const list of [iki, uc]) {
    list.forEach((p, i) => {
      p.shifts.forEach((sh, j) => {
        assert.equal(sh.start.kind, bir[i].shifts[j].start.kind, `${p.name} / ${sh.label} başlangıç`);
        assert.equal(sh.end.kind, bir[i].shifts[j].end.kind, `${p.name} / ${sh.label} bitiş`);
      });
      assert.equal(p.vars.length, bir[i].vars.length);
    });
  }

  const p1 = normalizePolicy({});
  const p2 = normalizePolicy(p1);
  assert.deepEqual(
    validatePolicy(p2).filter((x) => x.level === 'error'),
    [],
    'ikinci normalize sonrasi sahte hata',
  );
});
