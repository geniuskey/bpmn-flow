#!/usr/bin/env node
/**
 * Downloads the official OMG BPMN 2.0 XML schemas into tests/schema/ for the
 * XSD validation test. The files are not committed: their redistribution terms
 * are not stated in the files themselves (see docs/licenses.md).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = 'https://www.omg.org/spec/BPMN/20100501/';
const FILES = ['BPMN20.xsd', 'Semantic.xsd', 'BPMNDI.xsd', 'DC.xsd', 'DI.xsd'];
const dir = new URL('../tests/schema/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const name of FILES) {
  const target = new URL(name, dir);
  if (existsSync(target)) continue;
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`Download failed: ${name} (${res.status})`);
  await writeFile(target, await res.text());
  console.log(`downloaded ${name}`);
}
