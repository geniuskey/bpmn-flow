import { expect, test } from '@playwright/test';
import { el, exportXml, settle } from './helpers';

test('properties panel: header, collapsible sections, exact bounds', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  const inspector = page.getByTestId('inspector');

  // Nothing selected: the document, with a hint first.
  await expect(page.getByTestId('inspector-title')).toContainText('Document');
  await expect(inspector).toContainText('Nothing selected');

  await el(page, 'Task_check').click();
  await expect(page.getByTestId('inspector-title')).toContainText('Check order');

  // A collapsed section stays collapsed for the next selection.
  const general = inspector.getByRole('button', { name: 'General' });
  await general.click();
  await expect(general).toHaveAttribute('aria-expanded', 'false');
  await expect(inspector.getByLabel('Name')).toBeHidden();
  await el(page, 'Start_1').click();
  await expect(inspector.getByRole('button', { name: 'General' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await inspector.getByRole('button', { name: 'General' }).click();
  await expect(inspector.getByLabel('Name')).toBeVisible();

  // Events are drawn at a fixed size: only the position is editable.
  await expect(inspector.getByLabel('Width')).toBeDisabled();
  // Off center: the start event's context pad reaches over the task's middle.
  await el(page, 'Task_check').click({ position: { x: 85, y: 70 } });
  await inspector.getByLabel('X position').fill('300');
  await inspector.getByLabel('X position').press('Enter');
  await inspector.getByLabel('Width').fill('140');
  await inspector.getByLabel('Width').press('Enter');
  const xml = await exportXml(page);
  expect(xml).toMatch(
    /<bpmndi:BPMNShape id="Task_check_di"[^>]*>\s*<dc:Bounds x="300" y="80" width="140" height="80"/,
  );

  // Close from the header, reopen with the shortcut.
  await inspector.getByRole('button', { name: 'Close properties panel' }).click();
  await expect(inspector).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Alt+b');
  await expect(page.getByTestId('inspector')).toBeVisible();
});

test('multi-selection: colors of all selected elements in one undo step', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await el(page, 'Task_check').click();
  await page.keyboard.press('ControlOrMeta+a');
  const inspector = page.getByTestId('inspector');
  await expect(page.getByTestId('inspector-title')).toContainText('elements selected');
  await expect(inspector.getByRole('list', { name: 'Selected element types' })).toContainText(
    'Sequence Flow',
  );
  await inspector.getByRole('button', { name: /^Green colors$/ }).click();
  let xml = await exportXml(page);
  // Shapes get fill and stroke, connections the stroke only.
  expect(xml).toMatch(/<bpmndi:BPMNShape id="Task_check_di"[^>]*bioc:fill="/);
  expect(xml).toMatch(/<bpmndi:BPMNEdge id="Flow_a_di"[^>]*bioc:stroke="/);
  expect(xml).not.toMatch(/<bpmndi:BPMNEdge id="Flow_a_di"[^>]*bioc:fill="/);
  await page.keyboard.press('ControlOrMeta+z');
  xml = await exportXml(page);
  expect(xml).not.toContain('bioc:fill="');
  expect(xml).not.toContain('bioc:stroke="');

  // A type in the list narrows the selection to its elements.
  await inspector.getByRole('button', { name: /^Sequence Flow/ }).click();
  await expect(page.getByTestId('inspector-title')).toContainText('2 elements selected');
  await expect(inspector.getByRole('list', { name: 'Selected element types' })).not.toContainText(
    'Task',
  );
});

test('shape library: common shapes, preview card, resize and shortcut', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  const library = page.getByTestId('shape-library');
  const common = library.getByRole('group', { name: 'Common' });
  await expect(common.getByTestId('common-task')).toBeVisible();
  // Hidden while searching (the results come from the full groups).
  await library.getByLabel('Search shapes').fill('user task');
  await expect(common).toHaveCount(0);
  await expect(library.getByTestId('create-user-task')).toBeVisible();
  await library.getByLabel('Search shapes').fill('');

  // Hovering an entry shows its name and where it goes.
  await library.getByTestId('create-BoundaryEvent').hover();
  const card = page.getByTestId('library-preview');
  await expect(card).toContainText('Timer boundary event');
  await expect(card).toContainText('activity border');
  await page.mouse.move(600, 400);
  await expect(card).toHaveCount(0);

  // The common entries create the same elements.
  await page.getByTestId('common-exclusive-gateway').click();
  await page.mouse.move(700, 450, { steps: 3 });
  await page.mouse.click(700, 450);
  await settle(page);
  expect(await exportXml(page)).toContain('<bpmn:exclusiveGateway');

  const before = (await library.boundingBox())!.width;
  await page.getByRole('separator', { name: 'Resize shape library' }).dblclick();
  const handle = (await page
    .getByRole('separator', { name: 'Resize shape library' })
    .boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + 64, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  expect((await library.boundingBox())!.width).toBeGreaterThan(before + 40);

  await page.keyboard.press('ControlOrMeta+b');
  await expect(library).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByTestId('shape-library')).toBeVisible();
});

test('notices stay clear of the properties panel', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  // Nothing selected: a boundary event placed from the keyboard has no host.
  const inspector = (await page.getByTestId('inspector').boundingBox())!;
  await page.getByTestId('create-BoundaryEvent').focus();
  await page.keyboard.press('Enter');
  const notice = page.getByRole('status').filter({ hasText: 'does not fit here' });
  await expect(notice).toBeVisible();
  const box = (await notice.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(inspector.x);
});
