import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

export const EDITABLE_FIXTURES = [
  'simple-process.bpmn',
  'mvp-elements.bpmn',
  'collaboration-lanes.bpmn',
  'extensions.bpmn',
  'vendor-camunda-style.bpmn',
  'collaboration-messages.bpmn',
  'all-elements.bpmn',
  'advanced-elements.bpmn',
];
