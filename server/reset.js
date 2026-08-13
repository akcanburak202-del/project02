/**
 * Veriyi sifirlar. Once yedek alir, sonra db.json dosyasini siler.
 * Kullanim: npm run reset -- --evet
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, backup } from './store.js';

const DB_FILE = join(DATA_DIR, 'db.json');

if (!process.argv.includes('--evet')) {
  console.log('Bu işlem tüm veriyi siler. Onaylamak için: npm run reset -- --evet');
  process.exit(1);
}

if (!existsSync(DB_FILE)) {
  console.log('Silinecek veri yok.');
  process.exit(0);
}

const file = backup('sifirlama-oncesi');
unlinkSync(DB_FILE);
console.log(`Veri silindi. Yedek: ${file}`);
