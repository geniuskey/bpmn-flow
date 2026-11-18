#!/usr/bin/env node
/**
 * End-to-end check of the published package, as a third party would use it:
 * build → `npm pack` → install the tarball into a fresh project → run the core
 * in Node, type-check against the declarations (bundler and nodenext
 * resolution), bundle a vanilla + React page with Vite and drive it in Chromium.
 *
 *   npm run test:lib            (add --keep to leave the temp project behind)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests', 'package');
const keep = process.argv.includes('--keep');
const bin = (name) => join(root, 'node_modules', '.bin', name);
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const step = (name) => console.log(`\n▶ ${name}`);

const work = mkdtempSync(join(tmpdir(), 'bpmn-flow-pkg-'));
try {
  step('build');
  run('node', [join(root, 'scripts', 'build-lib.mjs')]);

  step('pack');
  run('npm', ['pack', '--silent', '--pack-destination', work], join(root, 'packages', 'bpmn-flow'));
  const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack produced no tarball');

  step('install into a fresh project');
  const app = join(work, 'app');
  run('mkdir', ['-p', app]);
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2),
  );
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--prefer-offline',
      join(work, tarball),
      'react@19',
      'react-dom@19',
      '@types/react@19',
    ],
    app,
  );
  for (const f of ['core.mjs', 'types-check.ts', 'index.html', 'main.js']) {
    copyFileSync(join(fixtures, f), join(app, f));
  }
  copyFileSync(
    join(root, 'public', 'samples', 'collaboration-lanes.bpmn'),
    join(app, 'sample.bpmn'),
  );

  step('core in Node');
  run('node', ['core.mjs', 'sample.bpmn'], app);

  for (const resolution of ['bundler', 'nodenext']) {
    step(`type-check (moduleResolution: ${resolution})`);
    const module = resolution === 'bundler' ? 'esnext' : 'nodenext';
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          module,
          moduleResolution: resolution,
          lib: ['es2023', 'dom'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['types-check.ts'],
      }),
    );
    run(bin('tsc'), ['-p', 'tsconfig.json'], app);
  }

  step('bundle with Vite');
  writeFileSync(
    join(app, 'vite.config.mjs'),
    'export default { logLevel: "warn", build: { chunkSizeWarningLimit: 4000 } };\n',
  );
  run(bin('vite'), ['build', '--outDir', 'dist'], app);

  step('drive in Chromium');
  run('node', [join(root, 'scripts', 'lib-smoke-browser.mjs'), join(app, 'dist')]);

  console.log('\n✔ package smoke test passed');
} finally {
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
