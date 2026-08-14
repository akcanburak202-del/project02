/**
 * Tek dosyalik demo uretici.
 *
 * public/ ve engine/ altindaki ES modullerini kucuk bir modul yukleyicisiyle
 * tek bir HTML dosyasina gomer. Boylece sunucu kurmadan, dosyayi cift
 * tiklayarak ya da paylasarak arayuz denenebilir.
 *
 * Kullanim: node tools/build-demo.js [cikti.html]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = ['public/js/demo-api.js', 'public/js/app.js'];

/** Bir modulun kaynagini yukleyiciye uygun hale getirir. */
function transform(code, modulePath) {
  const deps = [];
  const exported = new Set();
  let out = code;

  // import { a, b as c } from './x.js';   (cok satirli olabilir)
  out = out.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm,
    (_, names, spec) => {
      const target = resolveSpec(spec, modulePath);
      deps.push(target);
      const bindings = names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const m = /^(\S+)\s+as\s+(\S+)$/.exec(n);
          return m ? `${m[1]}: ${m[2]}` : n;
        })
        .join(', ');
      return `const { ${bindings} } = __req(${JSON.stringify(target)});`;
    },
  );

  // Yan etkili import (kullanilmiyor ama guvende olalim)
  out = out.replace(/^import\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_, spec) => {
    const target = resolveSpec(spec, modulePath);
    deps.push(target);
    return `__req(${JSON.stringify(target)});`;
  });

  // export * from './x.js'  -> desteklenmiyor, sessizce bozuk kod uretmesin
  if (/^export\s+\*/m.test(out)) {
    throw new Error(`${modulePath}: "export * from" desteklenmiyor; adlari tek tek yazin`);
  }

  // export { a, b as c } from './x.js';   (baska modulden yeniden disa aktarim)
  //
  // Bu bicim ayri ele ALINMALIDIR: asagidaki duz "export { ... }" kurali
  // satirin sonundaki `from '...'` kismini goremez, esleme kayar ve ortaya
  // ayrıstirilamayan kod cikar. Bir kez tam olarak bu oldu ve demo bos
  // ekran acildi; bu yuzden hem bu kural hem de sonundaki dogrulama var.
  out = out.replace(
    /^export\s*\{([^{}]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm,
    (_, names, spec) => {
      const target = resolveSpec(spec, modulePath);
      deps.push(target);
      const parts = [];
      for (const raw of names.split(',')) {
        const n = raw.trim();
        if (!n) continue;
        const m = /^(\S+)\s+as\s+(\S+)$/.exec(n);
        const from = m ? m[1] : n;
        const to = m ? m[2] : n;
        parts.push(from === to ? to : `${from}: ${to}`);
        exported.add(to);
      }
      return `const { ${parts.join(', ')} } = __req(${JSON.stringify(target)});`;
    },
  );

  // export { a, b as c };
  // Not: `[^{}]` bilincli — cok satirli listeleri kapsar ama suslu parantez
  // sinirini asip sonraki bloklari yutmaz.
  out = out.replace(/^export\s*\{([^{}]*?)\};?[ \t]*$/gm, (_, names) => {
    for (const raw of names.split(',')) {
      const n = raw.trim();
      if (!n) continue;
      const m = /^(\S+)\s+as\s+(\S+)$/.exec(n);
      exported.add(m ? m[2] : n);
    }
    return '';
  });

  // export function / const / let / class
  out = out.replace(/^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, (_, asyncKw, name) => {
    exported.add(name);
    return `${asyncKw || ''}function ${name}`;
  });
  out = out.replace(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });
  out = out.replace(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm, (_, name) => {
    exported.add(name);
    return `class ${name}`;
  });

  if (/^\s*export\s/m.test(out)) {
    throw new Error(`${modulePath}: donusturulemeyen export ifadesi kaldi`);
  }

  const assign = exported.size
    ? `\n__exports(${[...exported].map((n) => `${n}`).join(', ') && `{ ${[...exported].join(', ')} }`});\n`
    : '';
  return { code: out + assign, deps: [...new Set(deps)] };
}

function resolveSpec(spec, fromModule) {
  if (!spec.startsWith('.')) throw new Error(`${fromModule}: paket ithali desteklenmiyor (${spec})`);
  const abs = resolve(dirname(join(root, fromModule)), spec);
  return posix.normalize(relative(root, abs).split(/[\\/]/).join('/'));
}

const modules = new Map();
const graph = new Map();

function collect(modulePath) {
  if (modules.has(modulePath)) return;
  const source = readFileSync(join(root, modulePath), 'utf8');
  const { code, deps } = transform(source, modulePath);
  modules.set(modulePath, code);
  graph.set(modulePath, deps);
  for (const dep of deps) collect(dep);
}

for (const entry of ENTRIES) collect(entry);

/**
 * Dairesel bagimlilik denetimi.
 *
 * Yukleyici, bir modulun disa aktarimlarini govde calistiktan SONRA
 * yayimlar; dolayisiyla daire olusursa ic modul yarim bir nesne gorur ve
 * "undefined okunuyor" gibi anlasilmasi zor hatalar cikar. Tarayicinin
 * kendi ESM yukleyicisi bunu canli baglantilarla tolere ettigi icin hata
 * yalnizca demo paketinde ortaya cikar. Bu yuzden daire varsa paket
 * uretilmez ve zincir acikca yazilir.
 */
function assertNoCycles() {
  const state = new Map(); // 0 = isleniyor, 1 = bitti
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 1) return;
    if (state.get(id) === 0) {
      const from = stack.indexOf(id);
      throw new Error(`Dairesel bağımlılık: ${[...stack.slice(from), id].join(' -> ')}`);
    }
    state.set(id, 0);
    stack.push(id);
    for (const dep of graph.get(id) || []) visit(dep);
    stack.pop();
    state.set(id, 1);
  };
  for (const id of graph.keys()) visit(id);
}

assertNoCycles();

const css = readFileSync(join(root, 'public/css/app.css'), 'utf8');

const loader = `
// --- kucuk modul yukleyici ---
const __registry = new Map();
const __cache = new Map();
function __define(id, factory) { __registry.set(id, factory); }
function __req(id) {
  if (__cache.has(id)) return __cache.get(id);
  const factory = __registry.get(id);
  if (!factory) throw new Error('Modül bulunamadı: ' + id);
  const exports = {};
  __cache.set(id, exports);
  factory(exports);
  return exports;
}
`;

const body = [...modules.entries()]
  .map(([id, code]) => `__define(${JSON.stringify(id)}, (__exp) => {
const __exports = (o) => Object.assign(__exp, o);
${code}
});`)
  .join('\n\n');

const boot = `
// Demo arka ucunu arayuzden once devreye al
const __demo = __req('public/js/demo-api.js');
// Demo arka ucu ayni is parcaciginda calisir; agir istekler (orn. desen
// aramasi birkac saniye surer) sayfayi kilitler. Isten once iki kare
// kadar bekleyerek mesgul gostergesinin cizilmesine izin veriyoruz — is yine
// bloklar ama kullanici donmus bir ekranla karsilasmaz.
// (rAF yerine setTimeout: arka plan sekmesinde de kesin calisir.)
window.__NOBET_BACKEND__ = async (method, path, payload) => {
  await new Promise((r) => setTimeout(r, 32));
  return __demo.demoRequest(method, path, payload);
};
window.__NOBET_RESET__ = () => { __demo.resetDemo(); location.reload(); };
__req('public/js/app.js');
`;

const banner = `
<div id="demo-bar">
  <span><b>Demo</b> — sunucu yok, veriler yalnızca bu tarayıcıda saklanır.</span>
  <span class="demo-creds">yönetici: <code>admin</code> / <code>admin</code> &nbsp;·&nbsp; doktor: <code>d01</code> / <code>d01</code> … <code>d08</code></span>
  <button id="demo-reset" type="button">Demo verisini sıfırla</button>
</div>`;

const demoCss = `
#demo-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 7px 16px; font-size: 12px;
  background: #16202e; color: #e7ebf1;
  border-top: 1px solid #2b3648;
}
#demo-bar code { background: #24304380; padding: 1px 5px; border-radius: 4px; font-size: 11.5px; }
#demo-bar .demo-creds { color: #aab4c2; }
#demo-bar button {
  margin-left: auto; font: inherit; font-size: 11.5px; font-weight: 600;
  background: #2b3648; color: #e7ebf1; border: 1px solid #3b4860;
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
}
#demo-bar button:hover { background: #3b4860; }
.app { padding-bottom: 40px; }
@media print { #demo-bar { display: none !important; } }
`;

const html = `<title>Nöbet Çizelgesi</title>
<style>
${css}
${demoCss}
</style>
<div id="app" class="app"></div>
${banner}
<script type="module">
${loader}
${body}
${boot}
document.getElementById('demo-reset').addEventListener('click', () => {
  if (confirm('Tüm demo verisi silinip başlangıç durumuna dönülecek. Devam edilsin mi?')) window.__NOBET_RESET__();
});
</script>
`;

/**
 * Uretilen paketi YAZMADAN ONCE ayristir.
 *
 * Donusturme kurallari duzenli ifadelere dayaniyor; desteklenmeyen bir
 * sozdizimi sessizce bozuk kod uretebilir. Bir kez tam olarak bu oldu:
 * "export { x } from './y.js'" bicimi yanlis eslesti, paket ayristirilamaz
 * hale geldi ve demo bombos bir ekran actı — uretici ise "hazir" dedi.
 *
 * Bu kontrol yalnizca ayristirmayi dogrular, calistirmaz; tarayici API'leri
 * gerekmez. Hata varsa dosya hic yazilmaz.
 */
function assertParses(script) {
  try {
    new vm.Script(script, { filename: 'demo-bundle.js' });
  } catch (err) {
    const satirlar = script.split('\n');
    const no = Number(/demo-bundle\.js:(\d+)/.exec(err.stack || '')?.[1]);
    const baglam = Number.isFinite(no)
      ? `\n\n${satirlar.slice(Math.max(0, no - 3), no + 2).map((l, i) => `${no - 2 + i}| ${l.slice(0, 160)}`).join('\n')}`
      : '';
    throw new Error(`Uretilen paket ayristirilamiyor: ${err.message}${baglam}`);
  }
}

// type="module" olarak calisacagi icin ayni kapsamda dogrulanir.
assertParses(`${loader}\n${body}\n(async () => {\n${boot}\n})();`);

const outPath = process.argv[2] ? resolve(process.argv[2]) : join(root, 'demo', 'nobet-cizelgesi-demo.html');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`Demo hazır: ${relative(root, outPath)}  (${modules.size} modül, ${(html.length / 1024).toFixed(0)} KB)`);
