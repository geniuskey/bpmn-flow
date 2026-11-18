#!/usr/bin/env node
/**
 * Builds the @geniuskey/bpmn-flow package into packages/bpmn-flow/dist:
 * ES modules + style.css (Vite library mode), then type declarations (tsc),
 * with the `@/…` path alias rewritten to relative paths so they resolve for
 * consumers.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'bpmn-flow');
const typesDir = join(pkgDir, 'dist', 'types');
const bin = (name) => join(root, 'node_modules', '.bin', name);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

run(bin('vite'), ['build', '-c', 'vite.lib.config.ts', '--logLevel', 'warn']);
run(bin('tsc'), ['-p', 'tsconfig.lib.json']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith('.d.ts')) yield path;
  }
}

// `@/x` → relative, and every relative specifier gets its `.js` extension so the
// declarations also resolve under `moduleResolution: node16 / nodenext`.
function resolveSpecifier(file, spec) {
  let target = spec.startsWith('@/') ? join(typesDir, spec.slice(2)) : join(dirname(file), spec);
  if (existsSync(`${target}.d.ts`)) target += '.js';
  else if (existsSync(join(target, 'index.d.ts'))) target = join(target, 'index.js');
  else throw new Error(`Cannot resolve "${spec}" in ${relative(root, file)}`);
  let rel = relative(dirname(file), target).split(sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

// Deep imports into packages without an `exports` map (diagram-js) need the
// extension too under nodenext; packages with one (react, elkjs…) are left alone.
function resolveBareSpecifier(spec) {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  // The package's own name only appears in doc-comment examples.
  if (name === spec || name === '@geniuskey/bpmn-flow') return spec;
  const pkgJson = JSON.parse(
    readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  if (pkgJson.exports || /\.[cm]?js$/.test(spec)) return spec;
  const base = join(root, 'node_modules', spec);
  if (existsSync(`${base}.d.ts`)) return `${spec}.js`;
  if (existsSync(join(base, 'index.d.ts'))) return `${spec}/index.js`;
  throw new Error(`Cannot resolve types for "${spec}"`);
}

let rewritten = 0;
for (const file of files(typesDir)) {
  const source = readFileSync(file, 'utf8');
  const out = source.replace(/(from\s+|import\()(['"])([^'"]+)\2/g, (_, lead, quote, spec) => {
    const local = spec.startsWith('@/') || spec.startsWith('.');
    const resolved = local ? resolveSpecifier(file, spec) : resolveBareSpecifier(spec);
    return `${lead}${quote}${resolved}${quote}`;
  });
  if (out !== source) {
    writeFileSync(file, out);
    rewritten++;
  }
}
const leftover = [...files(typesDir)].filter((f) =>
  /(from\s+|import\()['"]@\//.test(readFileSync(f, 'utf8')),
);
if (leftover.length) {
  console.error('Unresolved @/ imports remain in:', leftover);
  process.exit(1);
}

copyFileSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'));
console.log(`@geniuskey/bpmn-flow built (${rewritten} declaration files rewritten).`);
