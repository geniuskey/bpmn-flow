import { expect, test } from '@playwright/test';
import { center, el, exportXml, settle } from './helpers';

test('shape library: search, create a catch event, change its type', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await page.keyboard.press('0');
  const library = page.getByTestId('shape-library');
  await expect(library.getByRole('group', { name: 'Intermediate events' })).toBeVisible();

  // Icons are the shapes as the canvas draws them.
  await expect(
    page.getByTestId('create-catch-message').locator('svg .bf-intermediate-inner'),
  ).toHaveCount(1);

  // Search narrows the library; collapsed groups open while searching.
  await library.getByRole('button', { name: /Start events/ }).click();
  await expect(page.getByTestId('create-StartEvent')).toHaveCount(0);
  await library.getByLabel('Search shapes').fill('catch link');
  await expect(library.locator('[data-library-entry]')).toHaveCount(1);
  await library.getByLabel('Search shapes').fill('');
  await library.getByRole('button', { name: /Start events/ }).click();
  await expect(page.getByTestId('create-StartEvent')).toBeVisible();

  // Click-to-place a message catch event below the start event.
  const start = await center(page, 'Start_1');
  await page.getByTestId('create-catch-message').click();
  await page.mouse.move(start.x + 80, start.y + 160);
  await page.mouse.move(start.x + 100, start.y + 160, { steps: 3 });
  await page.mouse.click(start.x + 100, start.y + 160);
  await settle(page);
  let xml = await exportXml(page);
  const id = /<bpmn:intermediateCatchEvent id="([^"]+)">\s*<bpmn:messageEventDefinition/.exec(
    xml,
  )?.[1];
  expect(id).toBeTruthy();

  // Change type from the context pad: the menu shows the variants with their shapes.
  await el(page, id!).click();
  await page.locator('.djs-context-pad [data-action="replace"]').click();
  const menu = page.locator('.djs-popup');
  await expect(menu.locator('[data-id="replace-catch-timer"] svg')).toHaveCount(1);
  // Not offered: what it already is, and boundary variants (a boundary event needs a host).
  await expect(menu.locator('[data-id="replace-catch-message"]')).toHaveCount(0);
  await expect(menu.locator('[data-id^="replace-boundary-"]')).toHaveCount(0);
  await menu.locator('[data-id="replace-throw-signal"]').click();
  xml = await exportXml(page);
  expect(xml).toMatch(
    new RegExp(`<bpmn:intermediateThrowEvent id="${id}">\\s*<bpmn:signalEventDefinition`),
  );
  // One undo step restores the catch event.
  await page.keyboard.press('ControlOrMeta+z');
  xml = await exportXml(page);
  expect(xml).toMatch(
    new RegExp(`<bpmn:intermediateCatchEvent id="${id}">\\s*<bpmn:messageEventDefinition`),
  );
});

test('shape library: event sub-process starts only inside an event sub-process', async ({
  page,
}) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await page.keyboard.press('0');
  const task = await center(page, 'Task_check');
  // Not at the top level: nothing is created.
  await page.getByTestId('create-start-error').click();
  await page.mouse.move(task.x, task.y + 250, { steps: 3 });
  await page.mouse.click(task.x, task.y + 250);
  await settle(page);
  await expect(page.locator('.djs-shape')).toHaveCount(3);
  await page.keyboard.press('Escape');
  // Event sub-process, then the error start event inside it.
  await page.getByTestId('create-event-sub-process').click();
  await page.mouse.move(task.x, task.y + 260, { steps: 3 });
  await page.mouse.click(task.x, task.y + 260);
  await settle(page);
  await page.getByTestId('create-start-error').click();
  await page.mouse.move(task.x - 100, task.y + 260, { steps: 3 });
  await page.mouse.click(task.x - 100, task.y + 260);
  await settle(page);
  const xml = await exportXml(page);
  expect(xml).toMatch(
    /<bpmn:subProcess id="[^"]+" triggeredByEvent="true">\s*<bpmn:startEvent id="[^"]+">\s*<bpmn:errorEventDefinition/,
  );
});

test('shape library: a lane dropped on a pool is added to it', async ({ page }) => {
  await page.goto('/?sample=collaboration-lanes');
  await expect(el(page, 'Pool_support')).toBeVisible();
  const before = await page.locator('.djs-shape[data-element-id^="Lane"]').count();
  const lane = (await el(page, 'Lane_expert').boundingBox())!;
  await page.getByTestId('create-lane').click();
  // On the lane's own header band (not on a task inside it).
  const at = { x: lane.x + 15, y: lane.y + lane.height / 2 };
  await page.mouse.move(at.x - 20, at.y);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.click(at.x, at.y);
  await settle(page);
  await expect(page.locator('.djs-shape[data-element-id^="Lane"]')).toHaveCount(before + 1);
  const xml = await exportXml(page);
  expect((xml.match(/<bpmn:lane /g) ?? []).length).toBe(before + 1);
  // One undo step removes it again.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.djs-shape[data-element-id^="Lane"]')).toHaveCount(before);
});
