import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSlots, validateTemplates, vectorTotal } from '../engine/slots.js';
import { parseTime, formatRange } from '../engine/time.js';
import { DEFAULT_SHIFT_TEMPLATES } from '../engine/index.js';

test('parseTime gece yarisini asan saatleri cozer', () => {
  assert.equal(parseTime('09:00'), 540);
  assert.equal(parseTime('24:00'), 1440);
  assert.equal(parseTime('09:00+1'), 1980);
  assert.throws(() => parseTime('25:70'));
});

test('formatRange ertesi gune tasan vardiyayi isaretler', () => {
  assert.equal(formatRange(900, 1980), '15:00–09:00 (+1)');
  assert.equal(formatRange(540, 1440), '09:00–24:00');
});

test('kullanicinin ornegi: sali gunu 09-24 ve 15-09 vardiyalari', () => {
  // 2026 Agustos: 4 Agustos Sali
  const built = buildSlots({
    year: 2026,
    month: 8,
    shiftTemplates: DEFAULT_SHIFT_TEMPLATES,
  });
  const gunduz = built.slots.find((s) => s.id === '2026-08-04#gunduz');
  const gece = built.slots.find((s) => s.id === '2026-08-04#gece');

  assert.ok(gunduz && gece);
  // d01: 09:00-15:00 tek basina (6 sa), 15:00-24:00 paylasimli (9 sa)
  assert.equal(gunduz.hours, 15);
  assert.equal(gunduz.cat.wdSolo, 6);
  assert.equal(gunduz.cat.wdShared, 9);
  assert.equal(gunduz.cat.weSolo, 0);
  assert.equal(gunduz.cat.weShared, 0);

  // d02: 15:00-24:00 paylasimli (9 sa), 00:00-09:00 tek basina (9 sa)
  assert.equal(gece.hours, 18);
  assert.equal(gece.cat.wdShared, 9);
  assert.equal(gece.cat.wdSolo, 9);
});

test('cuma gecesi cumartesiye tasinca saatler haftasonu olarak etiketlenir', () => {
  // 2026-08-07 Cuma
  const built = buildSlots({ year: 2026, month: 8, shiftTemplates: DEFAULT_SHIFT_TEMPLATES });
  const cumaGece = built.slots.find((s) => s.id === '2026-08-07#gece');
  assert.equal(cumaGece.dayType, 'weekday');
  // 15:00-24:00 Cuma -> haftaici paylasimli
  assert.equal(cumaGece.cat.wdShared, 9);
  // 00:00-09:00 Cumartesi -> haftasonu paylasimsiz
  assert.equal(cumaGece.cat.weSolo, 9);
  assert.equal(cumaGece.cat.wdSolo, 0);
});

test('resmi tatil haftasonu gibi degerlendirilir', () => {
  const built = buildSlots({
    year: 2026,
    month: 8,
    shiftTemplates: DEFAULT_SHIFT_TEMPLATES,
    holidays: ['2026-08-04'],
  });
  const gunduz = built.slots.find((s) => s.id === '2026-08-04#gunduz');
  assert.equal(gunduz.cat.weSolo, 6);
  assert.equal(gunduz.cat.weShared, 9);
  assert.equal(gunduz.cat.wdSolo, 0);
});

test('ayin ilk ve son gunu de eksiksiz hesaplanir', () => {
  const built = buildSlots({ year: 2026, month: 8, shiftTemplates: DEFAULT_SHIFT_TEMPLATES });
  const ilkGunduz = built.slots.find((s) => s.id === '2026-08-01#gunduz');
  // 1 Agustos 2026 Cumartesi: 09:00-15:00 tek, 15:00-24:00 paylasimli
  assert.equal(ilkGunduz.cat.weSolo, 6);
  assert.equal(ilkGunduz.cat.weShared, 9);

  const sonGece = built.slots.find((s) => s.id === '2026-08-31#gece');
  // 31 Agustos Pazartesi gecesi 1 Eylul sabahina tasar, o saatler de sayilir
  assert.equal(sonGece.hours, 18);
  assert.equal(vectorTotal(sonGece.cat), 18);
});

test('tum slotlarin saat toplami ay toplamina esit', () => {
  const built = buildSlots({ year: 2026, month: 8, shiftTemplates: DEFAULT_SHIFT_TEMPLATES });
  const sum = built.slots.reduce((acc, s) => acc + vectorTotal(s.cat), 0);
  assert.ok(Math.abs(sum - vectorTotal(built.totals)) < 1e-9);
  // 31 gun x (15 + 18) saat
  assert.equal(sum, 31 * 33);
  assert.equal(built.warnings.length, 0);
});

test('kapsama boslugu olan sablon hata verir', () => {
  const problems = validateTemplates(
    [{ id: 'a', label: 'Gunduz', start: '09:00', end: '18:00' }],
    'Haftaici',
  );
  assert.ok(problems.some((p) => p.level === 'error' && p.message.includes('kapsama')));
});

test('gece 03:00 girisli vardiya uyari uretir', () => {
  const problems = validateTemplates(
    [
      { id: 'a', label: 'A', start: '03:00', end: '15:00' },
      { id: 'b', label: 'B', start: '15:00', end: '03:00+1' },
    ],
    'Haftaici',
  );
  assert.ok(problems.some((p) => p.level === 'warn' && p.message.includes('alışılmadık')));
  assert.ok(!problems.some((p) => p.level === 'error'));
});

test('uc vardiyali gun paylasimli saatleri dogru boler', () => {
  const built = buildSlots({
    year: 2026,
    month: 8,
    shiftTemplates: {
      weekday: [
        { id: 'a', label: 'A', start: '08:00', end: '20:00' },
        { id: 'b', label: 'B', start: '14:00', end: '02:00+1' },
        { id: 'c', label: 'C', start: '20:00', end: '08:00+1' },
      ],
      weekend: [
        { id: 'a', label: 'A', start: '08:00', end: '20:00' },
        { id: 'b', label: 'B', start: '14:00', end: '02:00+1' },
        { id: 'c', label: 'C', start: '20:00', end: '08:00+1' },
      ],
    },
  });
  const a = built.slots.find((s) => s.id === '2026-08-04#a');
  // A 08:00-14:00 tek (6 sa), 14:00-20:00 B ile paylasimli (6 sa)
  assert.equal(a.cat.wdSolo, 6);
  assert.equal(a.cat.wdShared, 6);
  const c = built.slots.find((s) => s.id === '2026-08-04#c');
  // C 20:00-02:00 B ile paylasimli (6 sa), 02:00-08:00 tek (6 sa)
  assert.equal(c.cat.wdShared, 6);
  assert.equal(c.cat.wdSolo, 6);
  assert.equal(built.warnings.length, 0);
});
