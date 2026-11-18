import { expect, test } from '@playwright/test';
import { el, exportXml, saveForInterop, settle, xsdValidate } from './helpers';

test('multiple diagrams: drill into a collapsed sub-process, edit it, delete it', async ({
  page,
}) => {
  await page.goto('/?sample=multi-diagram');
  await expect(el(page, 'Fulfil')).toBeVisible();
  await expect(page.getByText('Read-only')).toHaveCount(0);
  const selector = page.getByLabel('Diagram', { exact: true });
  await expect(selector.locator('option')).toHaveCount(2);

  // Drill down from the collapsed sub-process's contextual toolbar.
  await el(page, 'Fulfil').click();
  await page.locator('.djs-context-pad .entry[aria-label="Open sub-process diagram"]').click();
  await expect(el(page, 'Pick')).toBeVisible();
  await expect(el(page, 'Start_m')).toBeHidden();

  // Add a task inside the sub-process diagram.
  await page.keyboard.press('0');
  const pick = (await el(page, 'Pick').boundingBox())!;
  await page.getByTestId('create-Task').click();
  await page.mouse.move(pick.x + 60, pick.y + 200, { steps: 3 });
  await page.mouse.click(pick.x + 60, pick.y + 200);
  await settle(page);
  let xml = await exportXml(page);
  const sub = /<bpmn:subProcess id="Fulfil"[\s\S]*?<\/bpmn:subProcess>/.exec(xml)![0];
  const created = /<bpmn:task id="(Activity_[^"]+)"/.exec(sub)?.[1];
  expect(created).toBeTruthy();
  const plane = /<bpmndi:BPMNPlane id="Plane_fulfil"[\s\S]*?<\/bpmndi:BPMNPlane>/.exec(xml)![0];
  expect(plane).toContain(`bpmnElement="${created}"`);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-multi-diagram.bpmn', xml);

  // Back to the main diagram; deleting the sub-process removes its diagram too.
  await selector.selectOption('__root');
  await expect(el(page, 'Start_m')).toBeVisible();
  await el(page, 'Fulfil').click();
  await page.keyboard.press('Delete');
  xml = await exportXml(page);
  expect(xml).not.toContain('Diagram_fulfil');
  expect(xml).not.toContain('Fulfil');
  await expect(page.getByLabel('Diagram', { exact: true })).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  xml = await exportXml(page);
  expect(xml).toContain('<bpmndi:BPMNDiagram id="Diagram_fulfil">');
  expect(xml).toContain(`bpmnElement="${created}"`);
  await expect(page.getByLabel('Diagram', { exact: true }).locator('option')).toHaveCount(2);
});

test('conversation diagrams: create conversations and link them to pools', async ({ page }) => {
  await page.goto('/?sample=conversation');
  await expect(el(page, 'Conv_1')).toBeVisible();
  await expect(page.getByText('Read-only')).toHaveCount(0);
  await page.keyboard.press('0');

  const seller = (await el(page, 'Seller').boundingBox())!;
  const bank = (await el(page, 'Bank').boundingBox())!;
  const x = (seller.x + seller.width + bank.x) / 2;
  const y = seller.y + seller.height + 80;
  await page.getByTestId('create-Conversation').click();
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.click(x, y);
  await settle(page);
  const conv = (await page
    .locator('.djs-shape[data-element-id^="Conversation_"]')
    .getAttribute('data-element-id'))!;

  // Link the new conversation to two pools with the connect tool.
  for (const pool of ['Seller', 'Bank']) {
    await page.keyboard.press('c');
    const a = (await el(page, conv).boundingBox())!;
    const b = (await el(page, pool).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    await page.keyboard.press('v');
  }

  await el(page, conv).click();
  await page
    .getByTestId('inspector')
    .getByLabel('Element type')
    .selectOption('bpmn:SubConversation');
  const xml = await exportXml(page);
  expect(xml).toMatch(new RegExp(`<bpmn:subConversation id="${conv}" />`));
  expect(xml).toMatch(
    new RegExp(`<bpmn:conversationLink id="[^"]+" sourceRef="${conv}" targetRef="Seller" />`),
  );
  expect(xml).toMatch(
    new RegExp(`<bpmn:conversationLink id="[^"]+" sourceRef="${conv}" targetRef="Bank" />`),
  );
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-conversation.bpmn', xml);
});
