/**
 * Demo paketinin uretilebildigini ve AYRISTIRILABILDIGINI dogrular.
 *
 * NEDEN VAR
 * ---------
 * Uretici, ES modullerini duzenli ifadelerle kucuk bir yukleyiciye cevirir.
 * Desteklenmeyen bir sozdizimi sessizce bozuk kod uretebilir: bir kez
 * "export { x } from './y.js'" bicimi yanlis eslesti, paket ayristirilamaz
 * hale geldi ve demo bombos bir ekran acti — uretici ise "hazir" dedi.
 * Motor testlerinin hicbiri bunu goremezdi, cunku hata yalnizca paketleme
 * asamasinda olusuyor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'nobet-demo-'));
const outPath = join(dir, 'demo.html');

let html = '';

test.before(() => {
  execFileSync(process.execPath, [join(projectRoot, 'tools', 'build-demo.js'), outPath], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
  html = readFileSync(outPath, 'utf8');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

const bundleScript = () => {
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length, 'paket icinde script blogu yok');
  return blocks[blocks.length - 1];
};

test('demo paketi uretilir ve tek dosyadir', () => {
  assert.ok(html.length > 100_000, `paket beklenenden kucuk: ${html.length} bayt`);
  assert.ok(html.includes('<div id="app"'), 'uygulama kabugu yok');
  // Harici kaynak olmamali; dosya cift tiklanarak acilabilmeli.
  assert.equal(/<script[^>]*\ssrc=/.test(html), false, 'disaridan script yukleniyor');
  assert.equal(/<link[^>]*stylesheet/.test(html), false, 'disaridan stil yukleniyor');
});

test('uretilen paket ayristirilabilir', () => {
  // Asil koruma: sozdizimi hatasi varsa demo bos ekran acar.
  assert.doesNotThrow(() => new vm.Script(bundleScript(), { filename: 'demo-bundle.js' }));
});

test('donusturulmemis modul sozdizimi kalmaz', () => {
  const code = bundleScript();
  const kalan = code.split('\n')
    .map((satir, i) => [i + 1, satir])
    .filter(([, satir]) => /^\s*(import|export)\s/.test(satir));
  assert.deepEqual(kalan, [], `donusturulmemis satirlar: ${JSON.stringify(kalan.slice(0, 5))}`);
});

test('motorun tum modulleri pakete girer', () => {
  const code = bundleScript();
  for (const modul of [
    'engine/slots.js', 'engine/scheduler.js', 'engine/shiftplan.js', 'engine/patterns.js',
    'engine/fairness.js', 'engine/policy.js', 'engine/rhythm.js', 'engine/propose.js',
    'public/js/demo-api.js', 'public/js/app.js',
  ]) {
    assert.ok(code.includes(`__define(${JSON.stringify(modul)}`), `${modul} pakete girmemis`);
  }
});

test('yeniden disa aktarim (export ... from) dogru cevrilir', () => {
  const code = bundleScript();
  // engine/index.js ritim yardimcilarini rhythm.js'ten yeniden disa aktarir.
  assert.match(code, /const \{[^}]*mergeRhythm[^}]*\} = __req\("engine\/rhythm\.js"\)/);
});
