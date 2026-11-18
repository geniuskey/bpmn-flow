/// <reference lib="dom" />
/** Autosave, session backup and text-field commit behaviour (no lost edits). */
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { el, exportXml } from './helpers';

/** Reads a session slot straight from IndexedDB. */
function storedSession(page: Page, slot: 'current' | 'previous' = 'current') {
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

async function expectStored(page: Page, text: string, slot: 'current' | 'previous' = 'current') {
  await expect.poll(async () => (await storedSession(page, slot))?.xml ?? '').toContain(text);
}

async function rename(page: Page, id: string, name: string) {
  await el(page, id).click();
  const field = page.getByTestId('inspector').getByLabel('Name', { exact: true });
  await field.fill(name);
  await field.press('Enter');
}

test('Escape in an Inspector field reverts the draft instead of committing it', async ({
  page,
}) => {
  await page.goto('/?sample=simple-process');
  await el(page, 'Task_check').click();
  const field = page.getByTestId('inspector').getByLabel('Name', { exact: true });
  await field.fill('Typed then cancelled');
  await field.press('Escape');
  await expect(field).toHaveValue('Check order');
  await expect(el(page, 'Task_check')).toContainText('Check order');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('Mod+S while typing exports the value being typed', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await el(page, 'Task_check').click();
  const field = page.getByTestId('inspector').getByLabel('Name', { exact: true });
  await field.fill('Typed, not blurred');
  const download = page.waitForEvent('download');
  await field.press('ControlOrMeta+s');
  const xml = await readFile(await (await download).path(), 'utf8');
  expect(xml).toContain('name="Typed, not blurred"');
});

/** Presses Mod+O, picks a file, and returns the "discard changes?" dialog message (dismissed). */
async function openAndDismiss(page: Page): Promise<string> {
  const chooser = page.waitForEvent('filechooser');
  const dialog = page.waitForEvent('dialog');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'other.bpmn',
    mimeType: 'application/xml',
    buffer: Buffer.from(await readFile('public/samples/mvp-elements.bpmn')),
  });
  const d = await dialog;
  const message = d.message();
  await d.dismiss();
  return message;
}

test('Mod+O while typing asks before discarding the value being typed', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await el(page, 'Task_check').click();
  const field = page.getByTestId('inspector').getByLabel('Name', { exact: true });
  await field.fill('UnsavedTyping');
  await field.focus();
  expect(await openAndDismiss(page)).toContain('Discard unsaved changes');
  await expect(el(page, 'Task_check')).toContainText('UnsavedTyping');
});

test('an edit exported right away is still autosaved', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await rename(page, 'Task_check', 'Exported quickly');
  await exportXml(page); // within the autosave delay: export clears `dirty`
  await expectStored(page, 'Exported quickly');
});

test('undo back to the exported state is autosaved', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await exportXml(page);
  await rename(page, 'Task_check', 'Undone later');
  await expectStored(page, 'Undone later');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await storedSession(page))?.xml ?? '')
    .not.toContain('Undone later');
});

test('export, undo, then a different edit still counts as unsaved', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await rename(page, 'Task_check', 'First');
  await exportXml(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await rename(page, 'Task_check', 'Second');
  expect(await openAndDismiss(page)).toContain('Discard unsaved changes');
  await expect(el(page, 'Task_check')).toContainText('Second');
});

test('a sample link keeps the autosaved work and can go back to it', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await rename(page, 'Task_check', 'MyUnexportedWork');
  await expectStored(page, 'MyUnexportedWork');

  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Review')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('was kept');
  await expectStored(page, 'MyUnexportedWork', 'previous');

  // Reloading the sample link must not push the work out of the backup.
  await page.reload();
  await expect(el(page, 'Review')).toBeVisible();
  await expectStored(page, 'MyUnexportedWork', 'previous');

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Search commands').fill('restore previous');
  await page.keyboard.press('Enter');
  await expect(el(page, 'Task_check')).toContainText('MyUnexportedWork');
  await expect(page.getByTestId('document-title')).toContainText('simple-process.bpmn');
});

test('a session that cannot be restored is kept, not overwritten', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expectStored(page, 'Check order');
  // Corrupt the stored session, as an incompatible app update could. Do it from
  // a same-origin page without the app, which would flush its own autosave.
  await page.goto('/favicon.svg');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('bpmn-flow');
        open.onsuccess = () => {
          const tx = open.result.transaction('session', 'readwrite');
          tx.objectStore('session').put({
            id: 'current',
            xml: '<not-bpmn',
            fileName: 'broken.bpmn',
            documentId: 'broken',
            savedAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto('/');
  await expect(page.getByText('could not be restored')).toBeVisible();
  await expect
    .poll(async () => (await storedSession(page, 'previous'))?.fileName)
    .toBe('broken.bpmn');
});

test('a Latin-1 file opens correctly and "Download original" survives a restore', async ({
  page,
}) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  const text = (await readFile('public/samples/simple-process.bpmn', 'utf8'))
    .replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
    )
    .replace('Check order', 'Prüfen');
  const bytes = Buffer.from(text, 'latin1');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({ name: 'latin1.bpmn', mimeType: 'application/xml', buffer: bytes });
  await expect(page.getByTestId('document-title')).toContainText('latin1.bpmn');
  await expect(el(page, 'Task_check')).toContainText('Prüfen');

  await rename(page, 'Task_check', 'Edited');
  await expectStored(page, 'Edited');
  await page.goto('/');
  await expect(el(page, 'Task_check')).toContainText('Edited');

  await page.keyboard.press('ControlOrMeta+k');
  await page
    .getByRole('dialog', { name: 'Command palette' })
    .getByLabel('Search commands')
    .fill('original');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const original = await readFile(await (await download).path());
  expect(original.equals(bytes)).toBe(true);
});
