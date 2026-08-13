/**
 * Ilk kurulum: veri dosyasi yoksa bir yonetici hesabi olusturur.
 * Ornek veri istenirse `node server/seed.js --demo` ile 8 doktorluk
 * gercekci bir kadro ve icinde bulunulan ay eklenir.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCategoryVector } from '../engine/slots.js';
import { monthId } from '../engine/calendar.js';
import { DATA_DIR, flush, logAction, update } from './store.js';
import { hashPassword } from './auth.js';
import { createMonthRecord, defaultSettings } from './api.js';

const DB_FILE = join(DATA_DIR, 'db.json');

function makeUser({ name, code, username, password, role = 'doctor', scheduled = true, title = '' }) {
  const { salt, hash } = hashPassword(password);
  return {
    id: `doc_${username}`,
    name,
    code: code || null,
    title,
    username: username.toLowerCase(),
    salt,
    passwordHash: hash,
    role,
    scheduled,
    shiftPreference: 'any',
    active: true,
    mustChangePassword: true,
    openingLedger: emptyCategoryVector(),
    createdAt: new Date().toISOString(),
  };
}

/** Veri dosyasi yoksa yonetici hesabini olusturur. */
export function ensureSeed() {
  if (existsSync(DB_FILE)) return { created: false };

  const username = process.env.NOBET_ADMIN_USER || 'admin';
  const password = process.env.NOBET_ADMIN_PASS || 'nobet2026';

  update((db) => {
    db.settings = defaultSettings();
    const admin = makeUser({
      name: 'Sistem Yöneticisi',
      username,
      password,
      role: 'admin',
      scheduled: false,
      title: 'Sorumlu Hekim',
    });
    db.users[admin.id] = admin;
    logAction(db, { action: 'ilk-kurulum', detail: 'yonetici hesabi olusturuldu' });
  });

  return { created: true, username, password };
}

const DEMO_DOCTORS = [
  { code: 'D01', name: 'Dr. Elif Yılmaz' },
  { code: 'D02', name: 'Dr. Mert Kaya' },
  { code: 'D03', name: 'Dr. Zeynep Demir' },
  { code: 'D04', name: 'Dr. Burak Şahin' },
  { code: 'D05', name: 'Dr. Selin Öztürk' },
  { code: 'D06', name: 'Dr. Can Aydın' },
  { code: 'D07', name: 'Dr. Deniz Arslan' },
  { code: 'D08', name: 'Dr. Ayşe Doğan' },
];

export async function seedDemo() {
  // ensureSeed yoneticiyi bellekteki veriye yazar; yazma kuyrugu henuz
  // diske inmemis olabilir, bu yuzden onbellegi sifirlamadan devam edilir.
  ensureSeed();
  update((db) => {
    DEMO_DOCTORS.forEach((d, i) => {
      const username = `d${String(i + 1).padStart(2, '0')}`;
      if (Object.values(db.users).some((u) => u.username === username)) return;
      const user = makeUser({ name: d.name, code: d.code, username, password: 'nobet2026' });
      db.users[user.id] = user;
    });
    const now = new Date();
    const id = monthId(now.getUTCFullYear(), now.getUTCMonth() + 1);
    if (!db.months[id]) db.months[id] = createMonthRecord(db, id);
    logAction(db, { action: 'ornek-veri', detail: `${DEMO_DOCTORS.length} doktor + ${id}` });
  });
  await flush();
  return { doctors: DEMO_DOCTORS.length };
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  if (process.argv.includes('--demo')) {
    const out = await seedDemo();
    console.log(`Örnek veri hazır: ${out.doctors} doktor. Parolalar: nobet2026`);
  } else {
    const info = ensureSeed();
    await flush();
    console.log(info.created ? `Yönetici oluşturuldu: ${info.username} / ${info.password}` : 'Veri zaten mevcut.');
  }
}
