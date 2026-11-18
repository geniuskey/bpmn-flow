/** Keyboard moves and context-pad appends obey the same modeling rules as mouse edits. */
import { expect, test, type Page } from '@playwright/test';
import { el, exportXml, settle } from './helpers';

const appendEntries = (page: Page) => page.locator('.djs-context-pad .entry[aria-label^="Append"]');

function bounds(xml: string, diId: string) {
  const m = new RegExp(
    `id="${diId}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"`,
  ).exec(xml);
  if (!m) throw new Error(`no bounds for ${diId}`);
  const [x, y, width, height] = m.slice(1).map(Number) as [number, number, number, number];
  return { x, y, width, height };
}

test('arrow keys cannot move a connected node into a sub-process', async ({ page }) => {
  await page.goto('/?sample=all-elements');
  await el(page, 'Or').click();
  await settle(page);
  // The gateway (465,135) would end up inside the sub-process (560,180 340×170).
  for (let i = 0; i < 15; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowDown');
  const xml = await exportXml(page);
  const sub = /<bpmn:subProcess id="Sub"[\s\S]*?<\/bpmn:subProcess>/.exec(xml)![0];
  expect(sub).not.toContain('id="Or"');
  expect(xml).toContain('<bpmn:inclusiveGateway id="Or"');
});

test('append is only offered where the result is valid BPMN', async ({ page }) => {
  await page.goto('/?sample=choreography');
  await el(page, 'Start_c').click();
  await expect(page.locator('.djs-context-pad .entry[aria-label="Append end event"]')).toHaveCount(
    1,
  );
  await expect(page.locator('.djs-context-pad .entry[aria-label="Append task"]')).toHaveCount(0);

  await page.goto('/?sample=advanced-elements');
  await el(page, 'Comp').click(); // compensation boundary event
  await expect(appendEntries(page)).toHaveCount(0);
  await el(page, 'Cancel_flight').click(); // compensation activity
  await expect(appendEntries(page)).toHaveCount(0);
});

test('appending near the edge of a pool grows the pool and its lanes in one step', async ({
  page,
}) => {
  await page.goto('/?sample=collaboration-lanes');
  const before = await exportXml(page);
  const pool = bounds(before, 'Pool_support_di');

  // Solve (460..560) is close to the pool's right edge (760): the appended task is not.
  await el(page, 'Solve').click();
  await page.locator('.djs-context-pad .entry[aria-label="Append task"]').click();
  await settle(page);

  const after = await exportXml(page);
  const grown = bounds(after, 'Pool_support_di');
  expect(grown.x + grown.width).toBeGreaterThan(pool.x + pool.width);
  const id = /<bpmn:task id="([^"]+)"/.exec(after)![1]!;
  const task = bounds(after, `${id}_di`);
  expect(task.x + task.width).toBeLessThanOrEqual(grown.x + grown.width);
  for (const lane of ['Lane_agent_di', 'Lane_expert_di']) {
    const l = bounds(after, lane);
    expect(l.x + l.width).toBe(grown.x + grown.width);
  }

  // One undo removes the task and the growth it caused.
  await page.keyboard.press('ControlOrMeta+z');
  const undone = await exportXml(page);
  expect(undone).not.toContain('<bpmn:task id="');
  expect(bounds(undone, 'Pool_support_di')).toEqual(pool);
});

function countIn(xml: string, tag: string) {
  return (xml.match(new RegExp(`<bpmn:${tag}[ >/]`, 'g')) ?? []).length;
}

test('paste keeps semantics; boundary events in the selection do not block it', async ({
  page,
}) => {
  await page.goto('/?sample=all-elements');
  const before = await exportXml(page);
  await el(page, 'S').click(); // signal start event
  // Corner clicks: the center of a shape can be covered by the context pad.
  for (const id of ['Prepare', 'B_timer', 'Or', 'Send']) {
    await el(page, id).click({ modifiers: ['Shift'], position: { x: 6, y: 6 } });
  }
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await settle(page);
  const xml = await exportXml(page);

  const signals = (x: string) =>
    (x.match(/<bpmn:signalEventDefinition [^>]*signalRef="Sig_go"/g) ?? []).length;
  expect(signals(xml)).toBe(signals(before) + 1);
  expect(xml.match(/<bpmn:userTask id="[^"]+" name="Prepare"/g)).toHaveLength(2);
  expect(countIn(xml, 'inclusiveGateway')).toBe(countIn(before, 'inclusiveGateway') + 1);
  // The flow between the pasted gateway and send task keeps its condition.
  expect(xml.match(/<bpmn:conditionExpression [^>]*>notify</g)).toHaveLength(2);
  // The boundary event is left out (a paste does not re-create attachments).
  expect(countIn(xml, 'boundaryEvent')).toBe(countIn(before, 'boundaryEvent'));
});

test('cut removes only what it copied', async ({ page }) => {
  await page.goto('/?sample=all-elements');
  const before = await exportXml(page);
  await el(page, 'Prepare').click();
  await el(page, 'DSR_1').click({ modifiers: ['Shift'] }); // data store: not copyable
  await page.keyboard.press('ControlOrMeta+x');
  const xml = await exportXml(page);
  expect(xml).not.toContain('<bpmn:userTask id="Prepare"');
  expect(xml).toContain('<bpmn:dataStoreReference id="DSR_1"');
  expect(countIn(xml, 'dataStoreReference')).toBe(countIn(before, 'dataStoreReference'));
});
