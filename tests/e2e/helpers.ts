/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export const el = (page: Page, id: string) => page.locator(`.djs-element[data-element-id="${id}"]`);

export async function center(page: Page, id: string) {
  const box = (await el(page, id).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function drag(page: Page, id: string, dx: number, dy: number) {
  const c = await center(page, id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 5 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

/** diagram-js swallows clicks for 400ms after a drag (ghost-click trap). */
export async function settle(page: Page) {
  await page.waitForTimeout(450);
}

export async function exportXml(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByTestId('export-button').click();
  return readFile(await (await download).path(), 'utf8');
}

export async function openXml(page: Page, xml: string, name = 'reimport.bpmn') {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (await chooser).setFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(xml) });
}

export function count(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<bpmn:${tag}[ >/]`, 'g')) ?? []).length;
}

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = fileURLToPath(new URL('../schema/BPMN20.xsd', import.meta.url));

/** Validates against the OMG BPMN 2.0 XSD (`npm run schemas`); returns 'skipped' when unavailable. */
export function xsdValidate(xml: string): string {
  if (!existsSync(schema)) return 'skipped';
  const file = join(mkdtempSync(join(tmpdir(), 'bpmn-flow-e2e-')), 'out.bpmn');
  writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', schema, file], { stdio: 'pipe' });
    return 'valid';
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr;
    if (!stderr) return 'skipped';
    return stderr.toString();
  }
}

/** Saves editor output for the external interoperability check (scripts/interop/). */
export function saveForInterop(name: string, xml: string): void {
  const dir = process.env.INTEROP_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), xml);
}

/** Reads a session slot straight from IndexedDB. */
export function storedSession(page: Page, slot: 'current' | 'previous' = 'current') {
  return page.evaluate(
    (key) =>
      new Promise<{ xml: string; fileName: string } | null>((resolve, reject) => {
        const open = indexedDB.open('bpmn-flow');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('session')) return resolve(null);
          const get = db.transaction('session').objectStore('session').get(key);
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
    slot,
  );
}

/** Waits until the autosave in IndexedDB contains `text` (no fixed delay). */
export async function expectStored(
  page: Page,
  text: string,
  slot: 'current' | 'previous' = 'current',
) {
  await expect.poll(async () => (await storedSession(page, slot))?.xml ?? '').toContain(text);
}
