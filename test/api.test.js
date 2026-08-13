/**
 * Uctan uca API testi: gercek HTTP sunucusuna karsi tam is akisi.
 * Kendi gecici veri klasorunu kullanir, mevcut veriye dokunmaz.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'nobet-test-'));
const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test.before(async () => {
  child = spawn(process.execPath, [join(projectRoot, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), NOBET_DATA_DIR: dataDir, NOBET_ADMIN_PASS: 'test1234' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${BASE}/api/me`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Sunucu baslatilamadi');
});

test.after(() => {
  child?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

test('giris yapmadan korumali uca erisilemez', async () => {
  const out = await call('GET', '/api/doctors');
  assert.equal(out.status, 401);
});

test('yonetici girisi ve doktor olusturma', async () => {
  const login = await call('POST', '/api/login', { username: 'admin', password: 'test1234' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');

  for (let i = 1; i <= 8; i += 1) {
    const out = await call('POST', '/api/doctors', {
      name: `Dr Test ${i}`,
      code: `D${String(i).padStart(2, '0')}`,
      username: `test${i}`,
      password: 'parola123',
    });
    assert.equal(out.status, 200, JSON.stringify(out.data));
  }
  const list = await call('GET', '/api/doctors');
  assert.equal(list.data.doctors.length, 9); // 8 doktor + yonetici
});

test('yanlis parolayla giris reddedilir', async () => {
  const saved = cookie;
  cookie = '';
  const out = await call('POST', '/api/login', { username: 'test1', password: 'yanlis' });
  assert.equal(out.status, 401);
  cookie = saved;
});

test('ay olusturma, cizelge uretme ve yayinlama', async () => {
  const created = await call('POST', '/api/months', { id: '2026-08' });
  assert.equal(created.status, 200);

  const ws = await call('GET', '/api/months/2026-08');
  assert.equal(ws.status, 200);
  assert.equal(ws.data.slots.length, 62);
  assert.equal(ws.data.participants.length, 8);

  const gen = await call('POST', '/api/months/2026-08/generate', {});
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  assert.equal(gen.data.report.unassigned.length, 0);
  assert.equal(gen.data.report.issues.length, 0);

  const pub = await call('POST', '/api/months/2026-08/status', { status: 'published' });
  assert.equal(pub.data.month.status, 'published');
});

test('doktor kendi tercihini kaydeder, baskasininkini goremez', async () => {
  const adminCookie = cookie;
  cookie = '';
  const login = await call('POST', '/api/login', { username: 'test3', password: 'parola123' });
  assert.equal(login.status, 200);
  const me = login.data.user.id;

  const save = await call('PUT', '/api/months/2026-08/preferences', {
    preferences: { '2026-08-15': 'avoid', '2026-08-22': 'want' },
  });
  assert.equal(save.status, 200);

  const ws = await call('GET', '/api/months/2026-08');
  assert.deepEqual(Object.keys(ws.data.preferences), [me]);
  assert.equal(ws.data.preferences[me]['2026-08-15'], 'avoid');

  // Doktor baska bir doktorun tercihini yazamaz: doctorId yok sayilir ve
  // kayit yine kendi uzerine yapilir.
  const other = await call('PUT', '/api/months/2026-08/preferences', {
    doctorId: 'baska-doktor', preferences: { '2026-08-02': 'avoid' },
  });
  assert.equal(other.status, 200);
  const check = await call('GET', '/api/months/2026-08');
  assert.deepEqual(Object.keys(check.data.preferences), [me]);
  assert.equal(check.data.preferences[me]['2026-08-02'], 'avoid');

  // Doktor yonetici uclarina erisemez
  const forbidden = await call('POST', '/api/months/2026-08/generate', {});
  assert.equal(forbidden.status, 403);

  // Asil tercihleri geri yaz (kayit tam degisim semantigi tasir)
  const restore = await call('PUT', '/api/months/2026-08/preferences', {
    preferences: { '2026-08-15': 'avoid', '2026-08-22': 'want' },
  });
  assert.equal(restore.status, 200);

  cookie = adminCookie;

  // Izin/rapor kaydini yalnizca yonetici girebilir
  const izin = await call('PUT', '/api/months/2026-08/preferences', {
    doctorId: me, preferences: { '2026-08-14': 'off', '2026-08-15': 'avoid', '2026-08-22': 'want' },
  });
  assert.equal(izin.data.preferences['2026-08-14'], 'off');

  // Yonetici, baska bir doktorun tercihini de onun adina girebilir
  const doctors = (await call('GET', '/api/doctors')).data.doctors;
  const test1 = doctors.find((d) => d.username === 'test1');
  const byAdmin = await call('PUT', '/api/months/2026-08/preferences', {
    doctorId: test1.id, preferences: { '2026-08-09': 'off' },
  });
  assert.equal(byAdmin.status, 200);
  const full = await call('GET', '/api/months/2026-08');
  assert.equal(full.data.preferences[test1.id]['2026-08-09'], 'off');
});

test('doktor kendine izin/rapor isaretleyemez', async () => {
  const adminCookie = cookie;
  cookie = '';
  await call('POST', '/api/login', { username: 'test4', password: 'parola123' });
  const me = (await call('GET', '/api/me')).data.user.id;

  const out = await call('PUT', '/api/months/2026-08/preferences', {
    preferences: { '2026-08-05': 'off', '2026-08-06': 'avoid', '2026-08-07': 'want' },
  });
  assert.equal(out.status, 200);
  // "off" sessizce dusurulur, digerleri kaydedilir
  assert.equal(out.data.preferences['2026-08-05'], undefined);
  assert.equal(out.data.preferences['2026-08-06'], 'avoid');
  assert.equal(out.data.preferences['2026-08-07'], 'want');

  cookie = adminCookie;
  const ws = (await call('GET', '/api/months/2026-08')).data;
  assert.equal(ws.preferences[me]['2026-08-05'], undefined, 'doktorun izin isareti kaydedilmis');
});

test('yoneticinin girdigi izin, doktorun kaydiyla silinmez', async () => {
  const adminCookie = cookie;
  const doctors = (await call('GET', '/api/doctors')).data.doctors;
  const test4 = doctors.find((d) => d.username === 'test4');

  // Yonetici izin/rapor giriyor
  const set = await call('PUT', '/api/months/2026-08/preferences', {
    doctorId: test4.id,
    preferences: { '2026-08-06': 'avoid', '2026-08-07': 'want', '2026-08-12': 'off', '2026-08-13': 'off' },
  });
  assert.equal(set.data.preferences['2026-08-12'], 'off');

  // Doktor kendi tercihlerini yeniden kaydediyor (izin gunlerini gondermeden)
  cookie = '';
  await call('POST', '/api/login', { username: 'test4', password: 'parola123' });
  const saved = await call('PUT', '/api/months/2026-08/preferences', {
    preferences: { '2026-08-20': 'want' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.preferences['2026-08-20'], 'want');
  assert.equal(saved.data.preferences['2026-08-12'], 'off', 'yoneticinin izni silinmis');
  assert.equal(saved.data.preferences['2026-08-13'], 'off', 'yoneticinin izni silinmis');

  cookie = adminCookie;
});

test('yeniden uretimde izinli gunler kesinlikle bos kalir', async () => {
  const gen = await call('POST', '/api/months/2026-08/generate', {});
  const ws = gen.data;
  const test3 = Object.values(ws.doctors).find((d) => d.username === 'test3');
  const test1 = Object.values(ws.doctors).find((d) => d.username === 'test1');

  for (const slot of ws.slots.filter((s) => s.date === '2026-08-14')) {
    assert.notEqual(ws.assignments[slot.id], test3.id, '14 Agustos izinli gunune atama yapilmis');
  }
  for (const slot of ws.slots.filter((s) => s.date === '2026-08-09')) {
    assert.notEqual(ws.assignments[slot.id], test1.id, '9 Agustos izinli gunune atama yapilmis');
  }
  // Izinli gunler hedefi dusurur
  const row = gen.data.report.rows.find((r) => r.doctorId === test3.id);
  assert.equal(row.availableDays, 30);
});

test('ay ortasi revizyon: 19undan oncesi degismez', async () => {
  const before = (await call('GET', '/api/months/2026-08')).data.assignments;

  const revize = await call('POST', '/api/months/2026-08/generate', { fromDate: '2026-08-19', seed: 5150 });
  assert.equal(revize.status, 200);
  const after = revize.data.assignments;

  let changedBefore = 0;
  let changedAfter = 0;
  for (const [slotId, doctorId] of Object.entries(after)) {
    const date = slotId.split('#')[0];
    if (before[slotId] === doctorId) continue;
    if (date < '2026-08-19') changedBefore += 1;
    else changedAfter += 1;
  }
  assert.equal(changedBefore, 0, '19 Agustos oncesi degismis');
  assert.ok(changedAfter >= 0);
  assert.equal(revize.data.report.unassigned.length, 0);
});

test('dondurulmus tarihe elle atama reddedilir', async () => {
  await call('PUT', '/api/months/2026-08/config', { lockedThrough: '2026-08-18' });
  const ws = (await call('GET', '/api/months/2026-08')).data;
  const doctorId = Object.values(ws.doctors).find((d) => d.username === 'test1').id;

  const donmus = ws.slots.find((s) => s.date === '2026-08-10' && !s.isNight).id;
  const serbest = ws.slots.find((s) => s.date === '2026-08-25' && !s.isNight).id;

  const blocked = await call('POST', '/api/months/2026-08/assign', { slotId: donmus, doctorId });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /dondurul/i);

  const allowed = await call('POST', '/api/months/2026-08/assign', { slotId: serbest, doctorId });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.assignments[serbest], doctorId);
});

test('aday listesi uygunluk ve etki bilgisi dondurur', async () => {
  const ws = (await call('GET', '/api/months/2026-08')).data;
  const slotId = ws.slots.find((s) => s.date === '2026-08-25' && s.isNight).id;
  const out = await call('GET', `/api/months/2026-08/candidates?slot=${encodeURIComponent(slotId)}`);
  assert.equal(out.status, 200);
  assert.equal(out.data.candidates.length, 8);
  assert.ok(out.data.candidates.some((c) => c.feasible));
  const engelli = out.data.candidates.find((c) => !c.feasible);
  if (engelli) assert.ok(engelli.reasons.length > 0);
});

test('kesinlestirme devir defterine yazar ve sonraki ayi etkiler', async () => {
  await call('PUT', '/api/months/2026-08/config', { lockedThrough: null });
  await call('POST', '/api/months/2026-08/generate', {});
  const fin = await call('POST', '/api/months/2026-08/finalize');
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  assert.equal(fin.data.month.status, 'final');

  await call('POST', '/api/months', { id: '2026-09' });
  const eylul = (await call('GET', '/api/months/2026-09')).data;
  const toplamDevir = Object.values(eylul.ledger).reduce(
    (s, v) => s + Object.values(v).reduce((a, b) => a + b, 0), 0,
  );
  assert.ok(Math.abs(toplamDevir) < 1e-6, `devir toplami sifir olmali: ${toplamDevir}`);
  const sifirdanFarkli = Object.values(eylul.ledger).some(
    (v) => Object.values(v).some((x) => Math.abs(x) > 0.01),
  );
  assert.ok(sifirdanFarkli, 'devir defteri bos kalmis');

  // Kesinlesmis ay degistirilemez
  const blocked = await call('POST', '/api/months/2026-08/generate', {});
  assert.equal(blocked.status, 400);
});

test('CSV disa aktarim calisir', async () => {
  const res = await fetch(`${BASE}/api/months/2026-08/export?kind=summary`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Doktor'));
  assert.ok(text.split('\r\n').length >= 9);
});

test('kapsama boslugu olan vardiya sablonu reddedilir', async () => {
  const out = await call('PUT', '/api/settings', {
    shiftTemplates: {
      weekday: [{ id: 'a', label: 'Gunduz', start: '09:00', end: '18:00' }],
      weekend: [{ id: 'a', label: 'Gunduz', start: '09:00', end: '18:00' }],
    },
  });
  assert.equal(out.status, 400);
  assert.match(out.data.error, /kapsama/i);
});

test('katilim: ayin 15inde ayrilan doktor sonrasina yazilmaz', async () => {
  const ws = (await call('GET', '/api/months/2026-09')).data;
  const hedef = Object.values(ws.doctors).find((d) => d.username === 'test5');
  const participants = ws.participants.map((p) =>
    p.doctorId === hedef.id ? { ...p, to: '2026-09-15' } : p);

  const saved = await call('PUT', '/api/months/2026-09/participants', { participants });
  assert.equal(saved.status, 200);

  const gen = await call('POST', '/api/months/2026-09/generate', {});
  assert.equal(gen.data.report.unassigned.length, 0);
  for (const [slotId, doctorId] of Object.entries(gen.data.assignments)) {
    if (doctorId !== hedef.id) continue;
    assert.ok(slotId.split('#')[0] <= '2026-09-15', `${slotId} ayrilma tarihinden sonra`);
  }
  const row = gen.data.report.rows.find((r) => r.doctorId === hedef.id);
  assert.ok(row.totalHours > 0);
  assert.ok(row.availableDays === 15);
});
