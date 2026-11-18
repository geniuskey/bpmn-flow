#!/usr/bin/env node
/**
 * External interoperability check (see docs/compatibility.md):
 *  1. writes BPMN Flow exports (fixtures, edited) and E2E editor output to tests/interop-out/
 *  2. reads them with two independent BPMN implementations: SpiffWorkflow (parse + run)
 *     and pm4py (parse + Petri-net conversion).
 *
 * Setup once:  python3 -m venv .venv-interop && .venv-interop/bin/pip install SpiffWorkflow pm4py
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const out = 'tests/interop-out';
rmSync(out, { recursive: true, force: true });
const env = { ...process.env, INTEROP_OUT: out };
execFileSync('npx', ['vitest', 'run', 'tests/roundtrip/interop-export.test.ts'], {
  stdio: 'inherit',
  env,
});
if (!process.argv.includes('--no-e2e')) {
  execFileSync(
    'npx',
    ['playwright', 'test', 'tests/e2e/modeling.spec.ts', 'tests/e2e/collaboration.spec.ts'],
    {
      stdio: 'inherit',
      env,
    },
  );
}
const python = existsSync('.venv-interop/bin/python') ? '.venv-interop/bin/python' : 'python3';
let failed = false;
for (const check of ['spiff_check.py', 'pm4py_check.py']) {
  try {
    execFileSync(python, [`scripts/interop/${check}`, out], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}
// Camunda BPMN Model API (Java): set CAMUNDA_CLASSPATH to the camunda-bpmn-model and
// camunda-xml-model jars (Maven Central, org.camunda.bpm.model) and JAVA to a Java 17+ binary.
if (process.env.CAMUNDA_CLASSPATH) {
  try {
    execFileSync(
      process.env.JAVA ?? 'java',
      ['-cp', process.env.CAMUNDA_CLASSPATH, 'scripts/interop/CamundaCheck.java', out],
      { stdio: 'inherit' },
    );
  } catch {
    failed = true;
  }
} else {
  console.log('Skipping Camunda check (CAMUNDA_CLASSPATH not set).');
}
// Camunda Modeler desktop app: set CAMUNDA_MODELER to its executable.
if (process.env.CAMUNDA_MODELER) {
  try {
    execFileSync('node', ['scripts/interop/camunda_modeler_check.mjs', out], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
} else {
  console.log('Skipping Camunda Modeler check (CAMUNDA_MODELER not set).');
}
process.exitCode = failed ? 1 : 0;
