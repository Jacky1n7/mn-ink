// Talk to a dev build of the add-on running in MarginNote.
//
//   node scripts/dev.mjs eval '<js expression>'   evaluate in the add-on, print the result
//   node scripts/dev.mjs evalf <file.js>           same, from a file
//   node scripts/dev.mjs push [--clip]             re-evaluate every module + the page (hot reload)
//
// Needs the MN Agent Bridge receiver app (~/Applications/MNAgentBridgeReceiver.app).
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modules } from './assemble.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(os.homedir(), '.mn-agent-bridge', 'inbox');
const key = fs.readFileSync(path.join(root, 'dist', 'dev-key'), 'utf8').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Snippets go in the URL; only a hot-reload push (too big for a URL) borrows
// the clipboard — which iCloud Universal Clipboard copies to other devices.
const URL_MAX = 24000;

export async function devEval(code, timeoutMs = 15000) {
  const id = 'ink' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  const inUrl = encodeURIComponent(code).length <= URL_MAX;
  const saved = inUrl ? null : execFileSync('pbpaste', { encoding: 'utf8' });
  if (!inUrl) execFileSync('pbcopy', { input: `mnink-dev:${id}:${code}` });
  const url = `marginnote4app://addon/mninkdev?id=${id}&key=${key}` + (inUrl ? '&c=' + encodeURIComponent(code) : '');
  try {
    await new Promise((res, rej) => execFile('open', ['-g', url], (e) => (e ? rej(e) : res())));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let names = [];
      try {
        names = fs.readdirSync(INBOX).filter((f) => f.startsWith(id + '.') && f.endsWith('.json'));
      } catch {}
      const total = Number(names[0]?.match(/-of-(\d+)\.json$/)?.[1] || 0);
      if (total && names.length >= total) {
        let raw = '';
        for (let i = 0; i < total; i++) raw += fs.readFileSync(path.join(INBOX, `${id}.${i}-of-${total}.json`), 'utf8');
        for (const n of names) fs.rmSync(path.join(INBOX, n), { force: true });
        return JSON.parse(raw);
      }
      await sleep(40);
    }
    throw new Error('timeout — is MarginNote open with the MN Ink dev build?');
  } finally {
    if (!inUrl) execFileSync('pbcopy', { input: saved });
  }
}

function pushSource() {
  let js = '';
  for (const [name, src] of modules({ live: true })) js += `\n// ${name}\n` + src;
  js = js.replaceAll('__INK_VERSION__', 'hot-' + new Date().toISOString().slice(11, 19));
  // Let the running code tear down its views before the functions are replaced.
  return `(function(){ try { if (typeof inkBeforeReload === 'function') inkBeforeReload(); } catch (e) {} })();\n` + js
    + `\n(function(){ try { return inkAfterReload(); } catch (e) { return 'after reload: ' + e; } })();`;
}

// A push is ~200 KB: send it in URL-sized pieces collected in a global, then
// evaluate the whole. (--clip: old single-shot path through the clipboard.)
async function devEvalBig(code) {
  if (process.argv.includes('--clip')) return devEval(code);
  const parts = [];
  for (let i = 0; i < code.length; ) {
    let n = Math.min(6000, code.length - i);
    while (n > 200 && encodeURIComponent(`__inkPush+=${JSON.stringify(code.slice(i, i + n))};0`).length > URL_MAX) n = Math.floor(n * 0.7);
    parts.push(code.slice(i, i + n));
    i += n;
  }
  let r = await devEval('globalThis.__inkPush="";0');
  if (!r.ok) return r;
  for (const part of parts) {
    r = await devEval(`__inkPush+=${JSON.stringify(part)};0`);
    if (!r.ok) return r;
  }
  return devEval('(function(){ var c = __inkPush; __inkPush = ""; return (0, eval)(c); })()', 30000);
}

const [cmd, arg] = process.argv.slice(2);
let res;
if (cmd === 'eval') res = await devEval(arg);
else if (cmd === 'evalf') res = await devEval(fs.readFileSync(arg, 'utf8'));
else if (cmd === 'push') res = await devEvalBig(pushSource());
else {
  console.error('usage: dev.mjs eval <js> | evalf <file> | push');
  process.exit(2);
}
console.log(JSON.stringify(res, null, 2));
if (!res.ok) process.exit(1);
