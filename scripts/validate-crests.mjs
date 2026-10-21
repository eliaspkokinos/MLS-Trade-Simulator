// Crest manifest validator.
// For every club in data/crest-manifest.json: fetch the URL, confirm it returns 200
// and that the bytes are actually an image (content-type AND magic-number check).
// Reports failures by club id. Exit code 1 if any fail, so CI blocks a bad manifest.
//
// Run: node scripts/validate-crests.mjs
// Needs network access to the crest CDN, so it runs in CI (GitHub Actions) or locally,
// not inside network-restricted sandboxes.

import { readFileSync, writeFileSync } from 'fs';

const manifestPath = new URL('../data/crest-manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath));

// Magic numbers for the image formats a crest might be.
function sniffImage(bytes) {
  const b = new Uint8Array(bytes);
  const starts = (sig, off = 0) => sig.every((v, i) => b[off + i] === v);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  // SVG / XML: look for "<svg" or "<?xml" near the front
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 256)).toLowerCase();
  if (head.includes('<svg') || head.includes('<?xml')) return 'svg';
  return null;
}

async function checkOne(id, entry) {
  const url = entry.crestUrl;
  const out = { id, name: entry.name, url, ok: false, status: null, contentType: null, format: null, error: null };
  if (!url) { out.error = 'no crestUrl'; return out; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    out.status = res.status;
    out.contentType = res.headers.get('content-type');
    if (!res.ok) { out.error = `HTTP ${res.status}`; return out; }
    const buf = await res.arrayBuffer();
    out.format = sniffImage(buf);
    const ctIsImage = (out.contentType || '').toLowerCase().startsWith('image/');
    if (!out.format) { out.error = `not an image (content-type ${out.contentType || 'none'})`; return out; }
    if (!ctIsImage && out.format !== 'svg') { out.error = `image bytes but content-type ${out.contentType || 'none'}`; return out; }
    if (buf.byteLength < 100) { out.error = `suspiciously small (${buf.byteLength} bytes)`; return out; }
    out.ok = true;
    return out;
  } catch (e) {
    out.error = e.name === 'AbortError' ? 'timeout' : String(e.message || e);
    return out;
  }
}

const ids = Object.keys(manifest);
const results = await Promise.all(ids.map((id) => checkOne(id, manifest[id])));
results.sort((a, b) => a.id.localeCompare(b.id));

const failures = results.filter((r) => !r.ok);
const passes = results.filter((r) => r.ok);

console.log(`Crest manifest: ${results.length} clubs`);
console.log(`PASS ${passes.length} / FAIL ${failures.length}\n`);
for (const r of results) {
  const tag = r.ok ? 'ok  ' : 'FAIL';
  const detail = r.ok ? `${r.format} ${r.status}` : r.error;
  console.log(`  [${tag}] ${r.id.padEnd(5)} ${r.name.padEnd(26)} ${detail}`);
}
// In GitHub Actions, surface results as annotations (readable via the API) and a job summary.
if (process.env.GITHUB_ACTIONS === 'true') {
  for (const f of failures) {
    console.log(`::error title=Crest ${f.id}::${f.name} (${f.id}) — ${f.error} [${f.url}]`);
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = ['# Crest validation', '', `PASS ${passes.length} / FAIL ${failures.length}`, ''];
    for (const r of results) lines.push(`- ${r.ok ? 'ok' : 'FAIL'} \`${r.id}\` ${r.name} — ${r.ok ? r.format : r.error}`);
    try { writeFileSync(summaryPath, lines.join('\n') + '\n'); } catch {}
  }
}

if (failures.length) {
  console.log('\nFailures by club id: ' + failures.map((f) => f.id).join(', '));
  process.exit(1);
} else {
  console.log('\nAll crest URLs resolve to valid images.');
}
