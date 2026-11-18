#!/usr/bin/env node
/**
 * Audits dependency licenses and (with --write) regenerates THIRD_PARTY_NOTICES.md.
 *
 *   node scripts/check-licenses.mjs           # audit; exit 1 on licenses needing review
 *   node scripts/check-licenses.mjs --write   # audit + regenerate notices
 *
 * Production dependencies are shipped in the bundle, so their license texts are
 * reproduced in full. Dev dependencies are build tools and only summarized.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Python-2.0',
  'CC-BY-4.0',
  'MIT-0',
]);
/**
 * Dev-only packages with licenses outside ALLOWED, reviewed by hand. They are
 * never shipped in the static bundle. Keep the reason current.
 */
const DEV_REVIEWED = {
  lightningcss: 'MPL-2.0 CSS compiler used by Tailwind/Vite at build time; not distributed.',
  'lightningcss-darwin-arm64': 'Platform binary of lightningcss (MPL-2.0); build-time only.',
  'lightningcss-darwin-x64': 'Platform binary of lightningcss (MPL-2.0); build-time only.',
  'lightningcss-linux-x64-gnu': 'Platform binary of lightningcss (MPL-2.0); build-time only.',
  'lightningcss-linux-x64-musl': 'Platform binary of lightningcss (MPL-2.0); build-time only.',
  'lightningcss-linux-arm64-gnu': 'Platform binary of lightningcss (MPL-2.0); build-time only.',
  'lightningcss-win32-x64-msvc': 'Platform binary of lightningcss (MPL-2.0); build-time only.',
};
/**
 * Production packages with licenses outside ALLOWED, reviewed and accepted.
 * See docs/licenses.md for the full reasoning.
 */
const PROD_REVIEWED = {
  elkjs:
    'Used under EPL-2.0 (elected from "EPL-2.0 OR GPL-3.0-or-later"). Distributed unmodified as a ' +
    'separate, lazily loaded file; source: https://github.com/kieler/elkjs. EPL-2.0 permits this ' +
    'provided the license notice and source location are given (below).',
};
const root = process.cwd();
const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function listPackages(omitDev) {
  const args = ['ls', '--all', '--parseable', ...(omitDev ? ['--omit=dev'] : [])];
  let out;
  try {
    out = execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    out = err.stdout ?? '';
  }
  const seen = new Map();
  for (const dir of out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (dir === root) continue;
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    const license =
      typeof pkg.license === 'string'
        ? pkg.license
        : (pkg.license?.type ??
          (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN'));
    const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\..*)?$/i.test(f));
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    seen.set(key, {
      name: pkg.name,
      version: pkg.version,
      license,
      repository: repo?.replace(/^git\+/, '').replace(/\.git$/, ''),
      text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : null,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isAllowed(expr) {
  // Accept "A OR B" when any alternative is allowed; "A AND B" only when all are.
  const clean = expr.replace(/[()]/g, '');
  if (clean.includes(' OR ')) return clean.split(' OR ').some((p) => isAllowed(p.trim()));
  if (clean.includes(' AND ')) return clean.split(' AND ').every((p) => isAllowed(p.trim()));
  return ALLOWED.has(clean.trim());
}

const prod = listPackages(true);
const prodKeys = new Set(prod.map((p) => `${p.name}@${p.version}`));
const dev = listPackages(false).filter((p) => !prodKeys.has(`${p.name}@${p.version}`));

const review = [
  ...prod.filter((p) => !PROD_REVIEWED[p.name]),
  ...dev.filter((p) => !DEV_REVIEWED[p.name]),
].filter((p) => !isAllowed(p.license));
const prodReviewed = prod.filter((p) => !isAllowed(p.license) && PROD_REVIEWED[p.name]);
const devReviewed = dev.filter((p) => !isAllowed(p.license) && DEV_REVIEWED[p.name]);
const missingText = prod.filter((p) => !p.text);

console.log(`Production packages: ${prod.length}, dev-only packages: ${dev.length}`);
for (const p of prodReviewed) {
  console.log(`OK(prod) ${p.name}@${p.version}: ${p.license} — ${PROD_REVIEWED[p.name]}`);
}
for (const p of devReviewed)
  console.log(`OK(dev) ${p.name}@${p.version}: ${p.license} — ${DEV_REVIEWED[p.name]}`);
for (const p of review) console.log(`REVIEW  ${p.name}@${p.version}: ${p.license}`);
for (const p of missingText)
  console.log(`NO-TEXT ${p.name}@${p.version}: ${p.license} (no LICENSE file in package)`);

if (process.argv.includes('--write')) {
  const devByLicense = new Map();
  for (const p of dev) devByLicense.set(p.license, (devByLicense.get(p.license) ?? 0) + 1);
  const lines = [
    '# Third-Party Notices',
    '',
    `${own.name} bundles the third-party software listed below. Each component is`,
    'distributed under its own license; the copyright notices and license texts are',
    'reproduced as required.',
    '',
    '> Generated by `npm run licenses -- --write`. Do not edit by hand.',
    '',
    '## Policy notes',
    '',
    '- `bpmn-js` is **not** used, copied or modified. The editor is built on `diagram-js`',
    '  and `bpmn-moddle`, which are MIT-licensed and contain no watermark requirement.',
    '- BPMN 2.0 is an OMG standard; implementing its XML format does not reuse any',
    '  editor source code.',
    '- `elkjs` (Eclipse Layout Kernel, auto layout) is dual-licensed `EPL-2.0 OR GPL-3.0-or-later`;',
    '  BPMN Flow uses it under **EPL-2.0**, unmodified. Its source code is available at',
    '  https://github.com/kieler/elkjs. See docs/licenses.md.',
    '- Some components are adapted from shadcn/ui (MIT, https://ui.shadcn.com); they are',
    '  copied source and therefore listed below.',
    '',
    '## Bundled (production) dependencies',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...prod.map(
      (p) =>
        `| ${p.name} | ${p.version} | ${p.license}${PROD_REVIEWED[p.name] ? ' (used under EPL-2.0)' : ''} |`,
    ),
    '| shadcn/ui (adapted components) | — | MIT |',
    '',
    '## Build and test tools (not distributed)',
    '',
    `${dev.length} development-only packages, by license: ` +
      [...devByLicense.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([l, n]) => `${l} (${n})`)
        .join(', ') +
      '.',
    '',
    ...(devReviewed.length
      ? [
          'Reviewed development tools with non-permissive licenses (never bundled):',
          '',
          ...devReviewed.map(
            (p) => `- ${p.name}@${p.version} — ${p.license}: ${DEV_REVIEWED[p.name]}`,
          ),
          '',
        ]
      : []),
    '## License texts',
    '',
  ];
  for (const p of prod) {
    lines.push(`### ${p.name}@${p.version}`, '');
    if (p.repository) lines.push(`Source: ${p.repository}`, '');
    lines.push(`License: ${p.license}`, '');
    lines.push(
      '```',
      p.text ?? `No license file is shipped with this package; declared license: ${p.license}.`,
      '```',
      '',
    );
  }
  lines.push(
    '### shadcn/ui',
    '',
    'Source: https://github.com/shadcn-ui/ui',
    '',
    'License: MIT',
    '',
    '```',
    'MIT License',
    '',
    'Copyright (c) 2023 shadcn',
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
    '```',
    '',
  );
  writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
  console.log('Wrote THIRD_PARTY_NOTICES.md');
}

if (review.length) process.exitCode = 1;
