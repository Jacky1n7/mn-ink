// Assemble main.js and the drawing page from addon/src, addon/web and vendor/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// perfect-freehand's ESM build → `var INK_FREEHAND = { getStroke, … }` (no modules in JSB).
export function freehand() {
  const src = read('vendor', 'perfect-freehand-1.2.2.min.mjs');
  const m = src.match(/export\s*\{([^}]*)\};?\s*$/);
  if (!m) throw new Error('unexpected perfect-freehand build');
  const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)).filter(([, e]) => e !== 'default');
  const license = read('vendor', 'perfect-freehand.LICENSE').trim().split('\n').map((l) => ' * ' + l).join('\n');
  return `/*\n * perfect-freehand 1.2.2 — https://github.com/steveruizok/perfect-freehand\n${license}\n */\n`
    + `var INK_FREEHAND = (function () {\n${src.slice(0, m.index)}\nreturn { ${names.map(([l, e]) => `${e}: ${l}`).join(', ')} };\n})();\n`;
}

export function page() {
  return read('addon', 'web', 'canvas.html')
    .replace('/*@@FREEHAND@@*/', () => freehand())
    .replace('/*@@SHARED@@*/', () => read('addon', 'web', 'shared.js'));
}

// Ordered module list: [name, source].
export function modules({ dev = false, live = false } = {}) {
  const srcDir = path.join(root, 'addon', 'src');
  const out = [];
  for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort()) {
    if (f.startsWith('00-dev') && !dev) continue;
    // A live reload keeps the running dev channel and add-on class.
    if (live && (f.startsWith('00-dev') || f.startsWith('90-addon'))) continue;
    out.push([f, read('addon', 'src', f)]);
    if (f.startsWith('10-core')) {
      out.push(['vendor/perfect-freehand', freehand()]);
      out.push(['web/shared.js', read('addon', 'web', 'shared.js')]);
    }
  }
  out.push(['web/canvas.html', `var INK_PAGE_HTML = ${JSON.stringify(page())};\n`]);
  return out;
}
