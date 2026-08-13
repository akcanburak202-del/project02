import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PATTERNS } from '../engine/patterns.js';
import { proposeDayPatterns, scoreCandidate, summarize } from '../engine/propose.js';
import { generateSchedule } from '../engine/index.js';

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
    dayPatterns: {},
    settings: {},
    ...overrides,
  };
}

/** Uclu deseni de acik olan ayar — aramanin secenegi olsun diye. */
const settingsWithUclu = {
  shiftPolicy: {
    patterns: DEFAULT_PATTERNS.map((p) => (p.id === 'uclu' ? { ...p, enabled: true } : p)),
  },
};

// Arama her adayi tam bir cizelge cozumuyle degerlendirdigi icin testlerde
// iterasyon sayisi dusuk tutulur; amac siralamanin dogrulugu, cozumun keskinligi degil.
const fast = { screenIterations: 400, finalIterations: 2000, finalists: 2 };

test('uygulanabilir olmayan aday hicbir zaman onerilmez', () => {
  const base = {
    slots: 60, perDoctor: 7.5, countSpread: 0, countsEqual: true, counts: [],
    effSpread: 0, presSpread: 0, unassigned: 0, warnings: 0, issues: 0,
  };
  assert.equal(scoreCandidate({ ...base, unassigned: 1 }, 0), Infinity);
  assert.equal(scoreCandidate({ ...base, issues: 1 }, 0), Infinity);
  assert.ok(Number.isFinite(scoreCandidate(base, 0)));
});

test('kadro artisi bedava degildir: ayni dengeyi daha kalabalik saglayan aday kaybeder', () => {
  const lean = {
    slots: 62, perDoctor: 7.75, countSpread: 0, countsEqual: true, counts: [],
    effSpread: 0.25, presSpread: 1.5, unassigned: 0, warnings: 0, issues: 0,
  };
  // Ayni denge, ama herkes 9 nobet tutuyor (kisi basi +1,25)
  const crowded = { ...lean, slots: 72, perDoctor: 9 };
  const opts = { basePerDoctor: 7.75 };
  assert.ok(
    scoreCandidate(crowded, 0, opts) > scoreCandidate(lean, 0, opts),
    'daha kalabalik yapilandirma daha iyi puan almamali',
  );

  // Buna karsilik nobet sayisini tam bolduren kucuk bir ekleme kazanabilmeli
  const unequal = { ...lean, slots: 62, perDoctor: 7.75, countSpread: 1, effSpread: 0.5 };
  const nudged = { ...lean, slots: 64, perDoctor: 8, countSpread: 0, effSpread: 0.25 };
  assert.ok(scoreCandidate(nudged, 2, opts) < scoreCandidate(unequal, 0, opts));
});

test('basitlik odullendirilir: esit sonucta daha az istisnali yapilandirma kazanir', () => {
  const s = {
    slots: 64, perDoctor: 8, countSpread: 0, countsEqual: true, counts: [],
    effSpread: 0.25, presSpread: 1.5, unassigned: 0, warnings: 0, issues: 0,
  };
  assert.ok(scoreCandidate(s, 2) < scoreCandidate(s, 6));
});

test('8 doktor icin nobet sayisini tam bolduren yapilandirmayi bulur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const res = proposeDayPatterns(
    { month: makeMonth('2026-08', ids), doctors, settings: settingsWithUclu },
    { ...fast, minDoctors: 2, maxDoctors: 3 },
  );

  // Mevcut durum: 62 nobet, 8 doktor -> tam bolunmez
  assert.equal(res.current.summary.slots, 62);
  assert.equal(res.current.summary.countsEqual, false);

  assert.ok(res.best, 'bir oneri uretilmeliydi');
  assert.equal(res.best.summary.countsEqual, true, 'onerinin nobet sayilari esit olmali');
  assert.equal(res.best.summary.slots % 8, 0);
  assert.ok(res.best.score < res.current.score);

  // Kadro sicramasi olmamali: +2 nobet kabul edilebilir, +10 degil
  assert.ok(res.best.summary.slots - res.current.summary.slots <= 4);
});

test('oneri hicbir seyi degistirmez — yalnizca karsilastirma dondurur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids);
  const before = JSON.stringify(month);

  proposeDayPatterns({ month, doctors, settings: settingsWithUclu }, fast);
  assert.equal(JSON.stringify(month), before, 'ay kaydi degismemeli');
});

test('dondurulmus gunlerin deseni her adayda korunur', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids, {
    lockedThrough: '2026-08-10',
    dayPatterns: { '2026-08-05': 'uclu' },
  });

  const res = proposeDayPatterns(
    { month, doctors, settings: settingsWithUclu },
    { ...fast, minDoctors: 2, maxDoctors: 3 },
  );

  for (const c of res.candidates) {
    assert.equal(c.dayPatterns['2026-08-05'], 'uclu', `${c.label}: dondurulmus gun degismis`);
    for (let d = 1; d <= 10; d += 1) {
      const iso = `2026-08-${String(d).padStart(2, '0')}`;
      assert.equal(
        c.dayPatterns[iso] ?? null,
        month.dayPatterns[iso] ?? null,
        `${c.label}: ${iso} dondurulmus olmasina ragmen degismis`,
      );
    }
  }
});

test('elle secilmis gunler korunur (keepManual)', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const month = makeMonth('2026-08', ids, { dayPatterns: { '2026-08-20': 'ikili-tam' } });

  const res = proposeDayPatterns(
    { month, doctors, settings: settingsWithUclu },
    { ...fast, minDoctors: 2, maxDoctors: 3 },
  );
  for (const c of res.candidates) {
    assert.equal(c.dayPatterns['2026-08-20'], 'ikili-tam', `${c.label}: elle secim silinmis`);
  }
});

test('doktor sayisi sinirlari disindaki desenler aday olmaz', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const settings = {
    shiftPolicy: {
      patterns: DEFAULT_PATTERNS.map((p) => ({ ...p, enabled: true })),
    },
  };
  const res = proposeDayPatterns(
    { month: makeMonth('2026-08', ids), doctors, settings },
    { ...fast, minDoctors: 2, maxDoctors: 2 },
  );
  // Tek nobetci (1) ve uclu (3) sinirlar disinda -> hicbir adayda gorunmemeli
  for (const c of res.candidates) {
    for (const id of Object.values(c.dayPatterns)) {
      assert.ok(id !== 'tekli-24' && id !== 'uclu', `${c.label}: sinir disi desen kullanmis (${id})`);
    }
  }
});

test('onerilen yapilandirma gercekten uygulanabilir bir cizelge uretir', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const res = proposeDayPatterns(
    { month: makeMonth('2026-08', ids), doctors, settings: settingsWithUclu },
    { ...fast, minDoctors: 2, maxDoctors: 3 },
  );
  assert.ok(res.best);

  const out = generateSchedule({
    month: makeMonth('2026-08', ids, { dayPatterns: res.best.dayPatterns }),
    doctors,
    settings: settingsWithUclu,
  });
  assert.equal(out.report.unassigned.length, 0);
  assert.deepEqual(out.report.issues, []);
});

test('sabit modda oneri calismaz ve bunu acikca soyler', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const res = proposeDayPatterns(
    { month: makeMonth('2026-08', ids), doctors, settings: { shiftPolicy: { mode: 'fixed' } } },
    fast,
  );
  assert.equal(res.best, null);
  assert.ok(res.unavailable);
});

test('gorevli doktor yoksa oneri uretilmez', () => {
  const res = proposeDayPatterns(
    { month: makeMonth('2026-08', []), doctors: {}, settings: settingsWithUclu },
    fast,
  );
  assert.equal(res.best, null);
  assert.ok(res.unavailable);
});

test('summarize denge tablosunu karsilastirilabilir olculere indirger', () => {
  const doctors = makeDoctors(8);
  const ids = Object.keys(doctors);
  const out = generateSchedule({ month: makeMonth('2026-08', ids), doctors, settings: settingsWithUclu });
  const s = summarize(out, 8);

  assert.equal(s.slots, out.slots.length);
  assert.equal(s.perDoctor, out.slots.length / 8);
  assert.equal(s.counts.length, 8);
  assert.ok(s.effSpread >= 0 && s.presSpread >= 0);
  assert.equal(s.countSpread, Math.max(...s.counts) - Math.min(...s.counts));
});
