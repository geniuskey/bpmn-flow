import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const el = (page: Page, id: string) => page.locator(`.djs-element[data-element-id="${id}"]`);

async function center(page: Page, id: string) {
  const box = (await el(page, id).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, id: string, dx: number, dy: number) {
  const c = await center(page, id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 5 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function exportXml(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByTestId('export-button').click();
  return readFile(await (await download).path(), 'utf8');
}

function bounds(xml: string, diId: string) {
  const m = new RegExp(`id="${diId}"[^>]*>\\s*<dc:Bounds x="([\\d.]+)" y="([\\d.]+)"`).exec(xml);
  if (!m) throw new Error(`no bounds for ${diId}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

test('renders a sample without third-party branding', async ({ page }) => {
  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Review')).toBeVisible();
  for (const id of [
    'Start',
    'Review',
    'Approved',
    'Split',
    'Pay',
    'Notify',
    'Join',
    'Paid',
    'Rejected',
    'F1',
    'F9',
  ]) {
    await expect(el(page, id)).toHaveCount(1);
  }
  await expect(page.getByTestId('metrics')).toContainText('Gateways');
  await expect(page.locator('a[href*="bpmn.io"], .bjs-powered-by')).toHaveCount(0);
});

test('select → rename → undo/redo → move → export → re-import', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();

  await el(page, 'Task_check').click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector).toContainText('Task_check');
  const name = inspector.getByLabel('Name');
  await name.fill('Validate order');
  await name.press('Enter');
  await expect(el(page, 'Task_check')).toContainText('Validate order');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(el(page, 'Task_check')).toContainText('Check order');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(el(page, 'Task_check')).toContainText('Validate order');

  await page.keyboard.press('0'); // 100% zoom: screen px == diagram units
  await drag(page, 'Task_check', 60, 100);
  const xml = await exportXml(page);
  expect(xml).toContain('name="Validate order"');
  expect(bounds(xml, 'Task_check_di')).toEqual({ x: 300, y: 180 });
  // Untouched elements keep their exact DI.
  expect(bounds(xml, 'Start_1_di')).toEqual({ x: 152, y: 102 });
  // Documentation survives.
  expect(xml).toContain('Verify stock and payment.');
  // The label of the moved task's neighbours is unchanged; connection now ends on the moved task border.
  const flowA = /id="Flow_a_di"[\s\S]*?<\/bpmndi:BPMNEdge>/.exec(xml)![0];
  const points = [...flowA.matchAll(/x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({
    x: +m[1]!,
    y: +m[2]!,
  }));
  expect(points[0]).toEqual({ x: 188, y: 120 });
  expect(points.at(-1)!.x).toBe(300);

  // Re-import the exported file through the Open dialog.
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({ name: 'roundtrip.bpmn', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.getByTestId('document-title')).toContainText('roundtrip.bpmn');
  await expect(el(page, 'Task_check')).toContainText('Validate order');
  const reexported = await exportXml(page);
  expect(bounds(reexported, 'Task_check_di')).toEqual({ x: 300, y: 180 });
});

test('nodes cannot be dragged out of their pool', async ({ page }) => {
  await page.goto('/?sample=collaboration-lanes');
  await expect(el(page, 'Triage')).toBeVisible();
  await page.keyboard.press('0');
  // Measure relative to the pool: dragging near the edge auto-scrolls the canvas.
  const offset = async () => {
    const [a, b] = [
      await el(page, 'Triage').boundingBox(),
      await el(page, 'Pool_support').boundingBox(),
    ];
    return { dx: Math.round(a!.x - b!.x), dy: Math.round(a!.y - b!.y) };
  };
  const before = await offset();
  await drag(page, 'Triage', 0, -250);
  expect(await offset()).toEqual(before);

  await drag(page, 'Triage', 40, 0);
  expect((await offset()).dx - before.dx).toBeGreaterThan(20);
});

test('unsupported elements open read-only', async ({ page }) => {
  await page.goto('/?sample=unsupported-elements');
  await expect(page.getByText('Read-only').first()).toBeVisible();
  await expect(page.getByTestId('compatibility-issues')).toContainText('Implicit Throw Event');
  // Dragging pans the canvas instead of moving the element: relative positions stay the same.
  const offset = async () => {
    const [a, b] = [
      await el(page, 'End_unsup').boundingBox(),
      await el(page, 'Start_msg').boundingBox(),
    ];
    return { dx: a!.x - b!.x, dy: a!.y - b!.y };
  };
  const before = await offset();
  await drag(page, 'End_unsup', 80, 0);
  expect(await offset()).toEqual(before);
  await el(page, 'End_unsup').click();
  await expect(page.getByTestId('inspector').getByLabel('Name')).toBeDisabled();
});

test('lossy files block re-export and offer the original', async ({ page }) => {
  await page.goto('/?sample=lossy-unknown-content');
  await expect(page.getByRole('button', { name: /Original/ })).toBeVisible();
  await expect(page.getByTestId('export-button')).toHaveCount(0);
  await expect(page.getByTestId('compatibility-issues')).toContainText('PARSE_WARNING');
});

test('malformed files keep the current document', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'broken.bpmn',
    mimeType: 'application/xml',
    buffer: Buffer.from('<bpmn:definitions'),
  });
  await expect(page.getByRole('alert')).toContainText('Could not open “broken.bpmn”');
  await expect(page.getByTestId('document-title')).toContainText('simple-process.bpmn');
  await expect(el(page, 'Task_check')).toBeVisible();
});

test('theme switch toggles dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  const toggle = page.getByRole('button', { name: 'Switch theme' });
  await toggle.click(); // system -> light
  await toggle.click(); // light -> dark
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('settings popover is not clipped by the header', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const snap = dialog.getByLabel('Snap to grid');
  await expect(snap).toBeVisible();
  // The control must be the topmost element at its position (not covered by the canvas).
  const box = (await snap.boundingBox())!;
  const header = (await page.locator('header').boundingBox())!;
  expect(box.y).toBeGreaterThan(header.y + header.height);
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  const hit = await page.evaluate<string | undefined>(
    `document.elementFromPoint(${x}, ${y})?.getAttribute('aria-label')`,
  );
  expect(hit).toBe('Snap to grid');
  await snap.click();
  await expect(snap).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('context menu stays inside a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.goto('/?sample=simple-process');
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width - 5, canvas.y + canvas.height - 5, {
    button: 'right',
  });
  const menu = (await page.getByRole('menu', { name: 'Context menu' }).boundingBox())!;
  expect(menu.x + menu.width).toBeLessThanOrEqual(800);
  expect(menu.y + menu.height).toBeLessThanOrEqual(500);
  expect(menu.y).toBeGreaterThanOrEqual(0);
});

test('color fields show the rendered default color, not white', async ({ page }) => {
  await page.goto('/?sample=vendor-camunda-style');
  await expect(el(page, 'StartEvent_1')).toBeVisible();
  await el(page, 'StartEvent_1').click();
  const inspector = page.getByTestId('inspector');
  const fill = inspector.getByLabel('Fill color', { exact: true });
  const stroke = inspector.getByLabel('Stroke color', { exact: true });
  await expect(fill).toHaveValue('#c8e6c9'); // explicit DI color

  await inspector.getByRole('button', { name: 'Default colors' }).click();
  await expect(inspector).toContainText('Default · ');
  // The theme's start-event colors: a green stroke and a faint green tint.
  const [r, g, b] = (await stroke.inputValue()).match(/\w\w/g)!.map((h) => parseInt(h, 16));
  expect(g).toBeGreaterThan(r! + 60);
  expect(g).toBeGreaterThan(b! + 30);
  const tint = (await fill.inputValue()).match(/\w\w/g)!.map((h) => parseInt(h, 16));
  expect(tint[1]).toBeGreaterThan(tint[0]!);
  expect(tint[1]).toBeLessThan(255);
});
