#!/usr/bin/env node
/**
 * Commercial-modeler check: opens each BPMN Flow export in the official
 * Camunda Modeler desktop application (downloaded separately; not a dependency
 * and not part of the BPMN Flow build) and reports whether it imported cleanly.
 *
 * The privacy dialog shown on first start is left untouched (nothing is
 * consented to). The status-bar counts are Camunda's own engine lint results
 * (executability hints), reported for information only.
 *
 * Usage:
 *   CAMUNDA_MODELER="/path/Camunda Modeler.app/Contents/MacOS/Camunda Modeler" \
 *     node scripts/interop/camunda_modeler_check.mjs <dir>
 */
import { _electron as electron } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = process.argv[2];
const executablePath = process.env.CAMUNDA_MODELER;
if (!dir || !executablePath) {
  console.error(
    'Usage: CAMUNDA_MODELER=<executable> node scripts/interop/camunda_modeler_check.mjs <dir>',
  );
  process.exit(2);
}

const PROBLEM =
  /Imported with \d+ warning|unparsable content|Unable to (open|import)|could not|failed to import|No diagram to display/i;

let failures = 0;
for (const name of readdirSync(dir)
  .filter((f) => f.endsWith('.bpmn'))
  .sort()) {
  const app = await electron.launch({ executablePath, args: [resolve(join(dir, name))] });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.djs-element', { timeout: 30_000 }).catch(() => undefined);
    await win.waitForTimeout(2500);
    const rendered = await win.locator('.djs-element').count();
    const text = await win.locator('body').innerText();
    const problem = PROBLEM.exec(text)?.[0];
    const lint = /\n(\d+)\n(\d+)\n\d+\.\d+\.\d+/.exec(text);
    const lintInfo = lint
      ? `engine lint: ${lint[1]} error(s), ${lint[2]} warning(s)`
      : 'engine lint: n/a';
    const source = readFileSync(join(dir, name), 'utf8');
    if (source.includes('<bpmn:choreography ')) {
      // Camunda Modeler has no choreography support: it reads participant bands as
      // duplicate participant shapes and does not draw choreography tasks.
      console.log(
        `LIMIT ${name}: Camunda Modeler does not support choreography diagrams (${problem ?? 'opened'})`,
      );
      continue;
    }
    if (problem || rendered < 2) {
      failures++;
      console.log(`FAIL ${name}: ${problem ?? 'nothing rendered'} (${rendered} elements)`);
    } else {
      console.log(
        `OK   ${name}: opened, ${rendered} diagram elements rendered, no import warnings (${lintInfo})`,
      );
    }
  } finally {
    await app.close();
  }
}
console.log(`Camunda Modeler: ${failures} file(s) failed`);
process.exitCode = failures ? 1 : 0;
