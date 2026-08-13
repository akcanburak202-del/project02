/**
 * Basit, dosya tabanli veri deposu.
 *
 * Tum veri tek bir JSON dosyasinda tutulur; yazma islemleri gecici dosya +
 * rename ile atomik yapilir ve sira ile (kuyruklanarak) islenir. Bu olcekte
 * (onlarca doktor, aylik cizelgeler) harici bir veritabanina gerek yoktur ve
 * yedekleme "dosyayi kopyala" kadar basittir.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.NOBET_DATA_DIR || join(here, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');
const BACKUP_DIR = join(DATA_DIR, 'backups');

let cache = null;
let writeChain = Promise.resolve();

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
}

export function emptyDb() {
  return {
    version: 1,
    users: {},
    settings: null,
    months: {},
    auditLog: [],
  };
}

export function load() {
  if (cache) return cache;
  ensureDirs();
  if (!existsSync(DB_FILE)) {
    cache = emptyDb();
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    // Bozuk dosyayi kaybetmemek icin kenara al, bos veriyle devam etme.
    const broken = join(BACKUP_DIR, `bozuk-${Date.now()}.json`);
    copyFileSync(DB_FILE, broken);
    throw new Error(`Veri dosyası okunamadı (${err.message}). Kopyası: ${broken}`);
  }
  return cache;
}

function persist(db) {
  ensureDirs();
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  renameSync(tmp, DB_FILE);
}

/**
 * Veriyi degistirir. mutator senkron olmali; yazmalar kuyruklanir.
 * @returns mutator'un dondurdugu deger
 */
export function update(mutator) {
  const db = load();
  const result = mutator(db);
  writeChain = writeChain.then(() => {
    persist(db);
  });
  return result;
}

/** Bekleyen yazmalarin tamamlanmasini bekler (kapanis / test icin). */
export async function flush() {
  await writeChain;
}

/** Gunluk yedek: veri dosyasinin tarihli kopyasi. */
export function backup(tag = '') {
  ensureDirs();
  if (!existsSync(DB_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(BACKUP_DIR, `db-${stamp}${tag ? `-${tag}` : ''}.json`);
  copyFileSync(DB_FILE, file);
  return file;
}

export function resetCache() {
  cache = null;
}

/** Islem gunlugu: kim, ne zaman, ne yapti. */
export function logAction(db, { userId, userName, action, detail }) {
  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    at: new Date().toISOString(),
    userId: userId || null,
    userName: userName || null,
    action,
    detail: detail || null,
  });
  if (db.auditLog.length > 500) db.auditLog.length = 500;
}
