import { expect, test } from '@playwright/test';
import {
  center,
  count,
  drag,
  el,
  exportXml,
  openXml,
  saveForInterop,
  settle,
  xsdValidate,
} from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('create elements from the palette, append and connect, then round-trip', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await page.keyboard.press('0');

  // Click-to-place a start event below the existing flow.
  const start = await center(page, 'Start_1');
  await page.getByTestId('create-StartEvent').click();
  await page.mouse.move(start.x, start.y + 200);
  await page.mouse.click(start.x, start.y + 200);
  // Drag-to-place a task.
  await page.getByTestId('create-Task').scrollIntoViewIfNeeded();
  const button = (await page.getByTestId('create-Task').boundingBox())!;
  await page.mouse.move(button.x + 10, button.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x + 150, start.y + 200, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.djs-shape')).toHaveCount(5);

  // Connect the new start event to the new task with the connect tool (press on source, drag to target).
  const shapes = await page
    .locator('.djs-shape')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-element-id')!));
  const [newStart, newTask] = shapes.filter(
    (id) => !['Start_1', 'Task_check', 'End_1'].includes(id),
  );
  await page.keyboard.press('c');
  const a = await center(page, newStart!);
  const b = await center(page, newTask!);
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.djs-connection')).toHaveCount(3);
  await settle(page);

  // Back to the select tool; append an end event from the task's contextual toolbar.
  await page.keyboard.press('v');
  await el(page, newTask!).click();
  await page.locator('.djs-context-pad .entry[aria-label="Append end event"]').click();
  await expect(page.locator('.djs-connection')).toHaveCount(4);

  const xml = await exportXml(page);
  expect(count(xml, 'startEvent')).toBe(2);
  expect(count(xml, 'task')).toBe(2);
  expect(count(xml, 'endEvent')).toBe(2);
  expect(count(xml, 'sequenceFlow')).toBe(4);
  expect(xml).toContain(`sourceRef="${newStart}" targetRef="${newTask}"`);
  // Incoming/outgoing references are maintained.
  expect(xml).toMatch(new RegExp(`id="${newTask}"[^>]*>\\s*<bpmn:incoming>`));
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-created.bpmn', xml);

  await openXml(page, xml);
  await expect(page.getByTestId('document-title')).toContainText('reimport.bpmn');
  await expect(page.locator('.djs-connection')).toHaveCount(4);
  await expect(page.getByText('Read-only')).toHaveCount(0);
});

test('inline rename, change type, documentation, condition and default flow', async ({ page }) => {
  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Review')).toBeVisible();

  await el(page, 'Review').dblclick();
  await page.keyboard.type('Check receipt');
  await page.keyboard.press('Enter');
  await expect(el(page, 'Review')).toContainText('Check receipt');

  await el(page, 'Review').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change to Service Task' }).click();

  await el(page, 'Review').click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector.getByLabel('Element type')).toHaveValue('bpmn:ServiceTask');
  await inspector.getByLabel('Description').fill('Automated check');
  await inspector.getByLabel('Description').blur();

  // Deselect first so the contextual toolbar does not cover the flow.
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  // The segment dragger overlay sits on top of a hovered flow; click through it.
  await el(page, 'F3').click({ force: true });
  await inspector.getByLabel('Condition expression').fill('${amount < 100}');
  await inspector.getByLabel('Condition expression').press('Enter');
  await inspector.getByLabel('Default flow').check();

  const xml = await exportXml(page);
  expect(xml).toMatch(/<bpmn:serviceTask id="Review" name="Check receipt">/);
  expect(xml).toContain('<bpmn:documentation>Automated check</bpmn:documentation>');
  expect(xml).toContain('${amount &lt; 100}');
  expect(xml).toContain('default="F3"');

  // Everything is undoable step by step.
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z');
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  const undone = await exportXml(page);
  expect(undone).toMatch(/<bpmn:userTask id="Review" name="Review expense">/);
  expect(undone).toContain('default="F4"');
  expect(undone).not.toContain('Automated check');
});

test('delete, copy/paste, duplicate and undo', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();

  await el(page, 'Task_check').click();
  await page.keyboard.press('Delete');
  await expect(el(page, 'Task_check')).toHaveCount(0);
  await expect(page.locator('.djs-connection')).toHaveCount(0);
  let xml = await exportXml(page);
  expect(count(xml, 'sequenceFlow')).toBe(0);
  expect(xml).not.toContain('Flow_a');
  expect(xml).not.toContain('<bpmn:outgoing>');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(el(page, 'Task_check')).toHaveCount(1);
  await expect(page.locator('.djs-connection')).toHaveCount(2);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.djs-shape')).toHaveCount(6);
  await expect(page.locator('.djs-connection')).toHaveCount(4);
  // The pasted copy overlaps the original's center; click its free corner.
  await el(page, 'Task_check').click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.djs-shape')).toHaveCount(7);

  xml = await exportXml(page);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  expect(count(xml, 'task')).toBe(3);
  expect(count(xml, 'sequenceFlow')).toBe(4);
  expect((xml.match(/name="Check order"/g) ?? []).length).toBe(3);
});

test('pools and lanes: create pool, add lane, move across lanes, auto layout', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await page.keyboard.press('0');

  const c = await center(page, 'Task_check');
  await page.getByTestId('create-Participant').click();
  await page.mouse.move(c.x, c.y + 250);
  await page.mouse.click(c.x, c.y + 250);
  const pool = page.locator('.djs-shape[data-element-id^="Participant_"]');
  await expect(pool).toHaveCount(1);
  const poolId = (await pool.getAttribute('data-element-id'))!;

  // Add two lanes via the contextual toolbar.
  await el(page, poolId).click({ position: { x: 10, y: 20 } });
  await page.locator('.djs-context-pad .entry[aria-label="Add lane below"]').click();
  await expect(page.locator('.djs-shape[data-element-id^="Lane_"]')).toHaveCount(2);

  let xml = await exportXml(page);
  expect(count(xml, 'collaboration')).toBe(1);
  expect(xml).toContain(`processRef="Process_simple"`);
  expect(count(xml, 'lane')).toBe(2);
  expect((xml.match(/<bpmn:flowNodeRef>/g) ?? []).length).toBe(3);

  // Move the end event into the second lane: lane membership follows.
  const lanes = await page
    .locator('.djs-shape[data-element-id^="Lane_"]')
    .evaluateAll((n) => n.map((x) => x.getAttribute('data-element-id')!));
  const second = (await el(page, lanes[1]!).boundingBox())!;
  const end = await center(page, 'End_1');
  await drag(page, 'End_1', 0, second.y + second.height / 2 - end.y);
  xml = await exportXml(page);
  const laneBlock = (id: string) =>
    new RegExp(`<bpmn:lane id="${id}"[\\s\\S]*?</bpmn:lane>`).exec(xml)![0];
  expect(laneBlock(lanes[1]!)).toContain('End_1');
  expect(laneBlock(lanes[0]!)).not.toContain('End_1');

  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  xml = await exportXml(page);
  expect(laneBlock(lanes[1]!)).toContain('End_1');
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-pools-lanes.bpmn', xml);

  await openXml(page, xml);
  await expect(page.locator('.djs-shape[data-element-id^="Lane_"]')).toHaveCount(2);
  await expect(page.getByText('Read-only')).toHaveCount(0);
});

test('command palette runs commands', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Search commands').fill('select all');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toContainText('5 elements selected');
});
