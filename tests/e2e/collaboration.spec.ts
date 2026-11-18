import { expect, test, type Page } from '@playwright/test';
import {
  center,
  count,
  el,
  exportXml,
  openXml,
  saveForInterop,
  settle,
  xsdValidate,
} from './helpers';

/** The XML block of one process. */
function processBlock(xml: string, id: string): string {
  return new RegExp(`<bpmn:process id="${id}"[\\s\\S]*?</bpmn:process>`).exec(xml)?.[0] ?? '';
}

async function dragFromTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

test('message flows between pools, event definitions and cross-pool moves', async ({ page }) => {
  await page.goto('/?sample=collaboration-messages');
  await expect(el(page, 'MF_order')).toBeVisible();
  await page.keyboard.press('0');
  await expect(page.getByText('Read-only')).toHaveCount(0);

  // A new message flow from the shop's task to the customer's task.
  await page.keyboard.press('c');
  await dragFromTo(page, await center(page, 'Ship'), await center(page, 'Send'));
  await page.keyboard.press('v');
  let xml = await exportXml(page);
  expect(count(xml, 'messageFlow')).toBe(3);
  expect(xml).toMatch(
    /<bpmn:messageFlow id="MessageFlow_[^"]+" sourceRef="Ship" targetRef="Send" \/>/,
  );
  // A sequence flow cannot cross pools: the same gesture between tasks of one pool makes a sequence flow.
  expect(count(xml, 'sequenceFlow')).toBe(4);

  // Event definition: turn the customer's end event into a message end event.
  await el(page, 'Placed').click();
  await page
    .getByTestId('inspector')
    .getByLabel('Event definition')
    .selectOption('bpmn:MessageEventDefinition');
  xml = await exportXml(page);
  expect(xml).toMatch(
    /<bpmn:endEvent id="Placed"[\s\S]*?<bpmn:messageEventDefinition id="[^"]+" \/>/,
  );

  // A task connected by sequence flows cannot leave its pool…
  const ship = await center(page, 'Ship');
  const customerPool = (await el(page, 'Pool_customer').boundingBox())!;
  await dragFromTo(page, ship, { x: ship.x, y: customerPool.y + customerPool.height / 2 });
  xml = await exportXml(page);
  expect(processBlock(xml, 'Process_shop')).toContain('<bpmn:task id="Ship"');

  // …but a free-standing task can: it moves to the other process.
  await page.getByTestId('create-Task').click();
  const shop = (await el(page, 'Pool_shop').boundingBox())!;
  await page.mouse.click(shop.x + 120, shop.y + shop.height - 65);
  const created = (await page
    .locator('.djs-shape[data-element-id^="Activity_"]')
    .getAttribute('data-element-id'))!;
  await page.keyboard.press('Escape');
  const from = await center(page, created);
  await dragFromTo(page, from, { x: from.x, y: customerPool.y + customerPool.height / 2 });
  xml = await exportXml(page);
  expect(processBlock(xml, 'Process_customer')).toContain(`<bpmn:task id="${created}"`);
  expect(processBlock(xml, 'Process_shop')).not.toContain(`<bpmn:task id="${created}"`);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-collaboration.bpmn', xml);

  // Undo the move: the task returns to the shop process.
  await page.keyboard.press('ControlOrMeta+z');
  xml = await exportXml(page);
  expect(processBlock(xml, 'Process_shop')).toContain(`<bpmn:task id="${created}"`);

  await openXml(page, xml);
  await expect(page.getByText('Read-only')).toHaveCount(0);
  await expect(
    page.locator(
      '.djs-connection[data-element-id*="MessageFlow_"], .djs-connection[data-element-id^="MF_"]',
    ),
  ).toHaveCount(3);
});
