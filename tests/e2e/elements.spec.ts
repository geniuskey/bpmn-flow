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

async function place(page: Page, type: string, at: { x: number; y: number }): Promise<string> {
  const before = new Set(
    await page
      .locator('.djs-shape')
      .evaluateAll((n) => n.map((x) => x.getAttribute('data-element-id')!)),
  );
  await page.getByTestId(`create-${type}`).click();
  // Jump next to the target first: a path from the shape library across the canvas
  // edge would auto-scroll the canvas.
  await page.mouse.move(at.x - 20, at.y);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.click(at.x, at.y);
  await settle(page);
  const after = await page
    .locator('.djs-shape')
    .evaluateAll((n) => n.map((x) => x.getAttribute('data-element-id')!));
  const created = after.filter((id) => !before.has(id));
  expect(created).toHaveLength(1);
  return created[0]!;
}

async function connect(page: Page, from: string, to: string) {
  await page.keyboard.press('c');
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await settle(page);
  await page.keyboard.press('v');
}

test('boundary events, sub-processes, data, annotations and groups', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await page.keyboard.press('0');
  const task = (await el(page, 'Task_check').boundingBox())!;

  // Boundary event: dropped on the task border, it attaches to the task.
  const boundary = await place(page, 'BoundaryEvent', {
    x: task.x + task.width / 2,
    y: task.y + task.height,
  });
  let xml = await exportXml(page);
  expect(xml).toMatch(
    new RegExp(
      `<bpmn:boundaryEvent id="${boundary}" attachedToRef="Task_check">\\s*<bpmn:timerEventDefinition`,
    ),
  );

  // Complete the timer so other tools can execute it; the finding disappears.
  await page.getByRole('tab', { name: /Validation/ }).click();
  await expect(page.getByTestId('validation')).toContainText('has no duration, date or cycle');
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  await el(page, boundary).click();
  await page.getByTestId('inspector').getByLabel('Timer expression').fill('PT1H');
  await page.getByTestId('inspector').getByLabel('Timer expression').press('Enter');
  await expect(page.getByText('has no duration, date or cycle')).toHaveCount(0);
  xml = await exportXml(page);
  expect(xml).toMatch(
    /<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H<\/bpmn:timeDuration>/,
  );

  // The boundary event moves with its host.
  const bBefore = (await el(page, boundary).boundingBox())!;
  const t = await center(page, 'Task_check');
  await page.mouse.move(t.x, t.y - 20);
  await page.mouse.down();
  await page.mouse.move(t.x + 20, t.y - 20, { steps: 4 });
  await page.mouse.move(t.x + 40, t.y - 20, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  expect(Math.round((await el(page, boundary).boundingBox())!.x - bBefore.x)).toBe(40);

  // Expanded sub-process below; a new task placed inside belongs to it.
  const sub = await place(page, 'SubProcess', { x: task.x + 300, y: task.y + 340 });
  const subBox = (await el(page, sub).boundingBox())!;
  const inner = await place(page, 'Task', {
    x: subBox.x + subBox.width / 2,
    y: subBox.y + subBox.height / 2,
  });

  // Data object → task (input association), annotation ↔ task, group.
  const data = await place(page, 'DataObjectReference', { x: task.x - 60, y: task.y + 260 });
  await connect(page, data, 'Task_check');
  const note = await place(page, 'TextAnnotation', { x: task.x + 60, y: task.y - 60 });
  await connect(page, note, 'Task_check');
  await place(page, 'Group', { x: task.x + 480, y: task.y + 60 });

  // Name the annotation inline.
  await el(page, note).dblclick();
  await page.keyboard.type('Checked by finance');
  await page.keyboard.press('Enter');

  xml = await exportXml(page);
  const subBlock = new RegExp(`<bpmn:subProcess id="${sub}"[\\s\\S]*?</bpmn:subProcess>`).exec(
    xml,
  )![0];
  expect(subBlock).toContain(`<bpmn:task id="${inner}"`);
  expect(xml).toMatch(/<bpmn:dataObjectReference id="[^"]+" dataObjectRef="[^"]+" \/>/);
  expect(count(xml, 'dataObject')).toBe(1);
  expect(xml).toMatch(
    /<bpmn:dataInputAssociation id="[^"]+">\s*<bpmn:sourceRef>[^<]+<\/bpmn:sourceRef>\s*<bpmn:targetRef>[^<]+<\/bpmn:targetRef>/,
  );
  // The association targets a Data Input of the task's I/O specification (BPMN 2.0.2 PDF 253).
  expect(xml).toMatch(
    /<bpmn:ioSpecification id="[^"]+">\s*<bpmn:dataInput id="DataInput_[^"]+" \/>\s*<bpmn:inputSet id="[^"]+">\s*<bpmn:dataInputRefs>DataInput_[^<]+<\/bpmn:dataInputRefs>/,
  );
  expect(xml).toMatch(
    new RegExp(`<bpmn:association id="[^"]+" sourceRef="${note}" targetRef="Task_check" />`),
  );
  expect(xml).toContain('<bpmn:text>Checked by finance</bpmn:text>');
  expect(xml).toMatch(/<bpmn:group id="[^"]+" categoryValueRef="[^"]+" \/>/);
  expect(xml).toMatch(/<bpmn:category id="[^"]+">\s*<bpmn:categoryValue id="[^"]+" \/>/);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-elements.bpmn', xml);

  // Change the task type and the boundary event's definition.
  // Deselect first: the annotation's resize handles may cover the task corner.
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  await el(page, 'Task_check').click({ position: { x: 8, y: 8 } });
  await page.getByTestId('inspector').getByLabel('Element type').selectOption('bpmn:SendTask');
  // Deselect first: the task's resize handle sits on top of the boundary event.
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  await el(page, boundary).click();
  await page
    .getByTestId('inspector')
    .getByLabel('Event definition')
    .selectOption('bpmn:EscalationEventDefinition');
  // Error boundary events always interrupt (BPMN 2.0.2 PDF 288); escalation may not.
  await page.getByTestId('inspector').getByLabel('Interrupting').uncheck();
  xml = await exportXml(page);
  expect(xml).toMatch(/<bpmn:sendTask id="Task_check"/);
  expect(xml).toMatch(
    new RegExp(
      `<bpmn:boundaryEvent id="${boundary}" cancelActivity="false" attachedToRef="Task_check">\\s*<bpmn:escalationEventDefinition`,
    ),
  );
  // The data input association moved with the type change.
  expect(/<bpmn:sendTask id="Task_check"[\s\S]*?<\/bpmn:sendTask>/.exec(xml)![0]).toContain(
    'dataInputAssociation',
  );

  // Deleting the task deletes its boundary event and associations; undo restores all.
  await el(page, 'Task_check').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('Delete');
  xml = await exportXml(page);
  expect(xml).not.toContain(boundary);
  expect(count(xml, 'association')).toBe(0);
  expect(xml).not.toContain('dataInputAssociation');
  await page.keyboard.press('ControlOrMeta+z');
  xml = await exportXml(page);
  expect(xml).toContain(`<bpmn:boundaryEvent id="${boundary}"`);
  expect(count(xml, 'association')).toBe(1);

  await openXml(page, xml);
  await expect(page.getByText('Read-only')).toHaveCount(0);
  await expect(el(page, boundary)).toHaveCount(1);
});

test('all supported element families open editable and render', async ({ page }) => {
  await page.goto('/?sample=all-elements');
  await expect(el(page, 'Sub')).toBeVisible();
  await expect(page.getByText('Read-only')).toHaveCount(0);
  for (const id of [
    'B_timer',
    'B_error',
    'Or',
    'Join',
    'Notify',
    'Call',
    'DOR_1',
    'DSR_1',
    'Note',
    'Grp_1',
    'DIA_1',
    'DOA_1',
    'Assoc_1',
    'SubS',
    'Script',
  ]) {
    await expect(el(page, id)).toHaveCount(1);
  }
  // Content of the sub-process moves with it.
  const before = (await el(page, 'Script').boundingBox())!;
  const sub = (await el(page, 'Sub').boundingBox())!;
  await page.mouse.move(sub.x + 20, sub.y + 10);
  await page.mouse.down();
  await page.mouse.move(sub.x + 30, sub.y + 40, { steps: 4 });
  await page.mouse.move(sub.x + 20, sub.y + 70, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  const after = (await el(page, 'Script').boundingBox())!;
  expect(Math.round(after.y - before.y)).toBeGreaterThan(40);
  const xml = await exportXml(page);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
});

test('transactions, ad-hoc sub-processes, compensation and loop markers', async ({ page }) => {
  await page.goto('/?sample=advanced-elements');
  await expect(el(page, 'Book')).toBeVisible();
  await expect(page.getByText('Read-only')).toHaveCount(0);
  for (const id of [
    'Comp',
    'Cancelled',
    'Cancel_flight',
    'CompAssoc',
    'Extras',
    'Hotel',
    'Aborted',
  ]) {
    await expect(el(page, id)).toHaveCount(1);
  }
  // Loop markers: switch the standard loop to a parallel multi-instance and back to none.
  await el(page, 'Collect').click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector.getByLabel('Loop', { exact: true })).toHaveValue('standard');
  await inspector.getByLabel('Loop', { exact: true }).selectOption('parallel');
  let xml = await exportXml(page);
  expect(/<bpmn:userTask id="Collect"[\s\S]*?<\/bpmn:userTask>/.exec(xml)![0]).toMatch(
    /<bpmn:multiInstanceLoopCharacteristics id="[^"]+" \/>/,
  );
  // ioSpecification and the potential owner are preserved untouched.
  expect(xml).toContain('<bpmn:dataInput id="DI_1" name="customer" />');
  // <formalExpression> is written as the equivalent <expression xsi:type="tFormalExpression">.
  expect(xml).toMatch(
    /<bpmn:potentialOwner id="Owner_1">\s*<bpmn:resourceAssignmentExpression id="RAE_1">\s*<bpmn:expression xsi:type="bpmn:tFormalExpression">sales<\/bpmn:expression>/,
  );
  await inspector.getByLabel('Loop', { exact: true }).selectOption('none');
  // Collect is in the normal flow: compensation activities have no sequence flows (PDF 268).
  await expect(inspector.getByLabel('For compensation')).toBeDisabled();
  xml = await exportXml(page);
  expect(xml).not.toContain('standardLoopCharacteristics');
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-advanced.bpmn', xml);

  // The transaction keeps its type: it has a cancel boundary event and start / end
  // events, which an ad-hoc sub-process cannot have (BPMN 2.0.2 PDF 211, 287).
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  await el(page, 'Book').click({ position: { x: 10, y: 10 } });
  await expect(inspector.getByLabel('Element type')).toHaveCount(0);
  // Change the ad-hoc sub-process into a transaction; content stays.
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  await el(page, 'Extras').click({ position: { x: 10, y: 10 } });
  await inspector.getByLabel('Element type').selectOption('bpmn:Transaction');
  xml = await exportXml(page);
  expect(/<bpmn:transaction id="Extras"[\s\S]*?<\/bpmn:transaction>/.exec(xml)![0]).toContain(
    '<bpmn:task id="Hotel"',
  );
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
});

test('BPMN 2.0 notation: multiple events, event-based gateway variants, collections, black-box pools', async ({
  page,
}) => {
  await page.goto('/?sample=notation');
  await expect(el(page, 'Task_handle')).toBeVisible();
  await expect(page.getByText('Read-only')).toHaveCount(0);
  // Black-box pool, message envelopes (shaded when non-initiating), collection marker and data state.
  await expect(el(page, 'Pool_customer').locator('.bf-black-box')).toHaveCount(1);
  await expect(el(page, 'Pool_service').locator('.bf-black-box')).toHaveCount(0);
  await expect(el(page, 'Mf_request').locator('.bf-message-envelope')).toHaveCount(1);
  await expect(el(page, 'Mf_reply').locator('.bf-non-initiating')).toHaveCount(1);
  await expect(el(page, 'Data_requests').locator('.bf-collection-marker')).toHaveCount(1);
  await expect(el(page, 'Data_requests')).toContainText('[approved]');

  const inspector = page.getByTestId('inspector');
  // Parallel multiple start event.
  await el(page, 'Start_pm').click();
  await expect(inspector.getByLabel('Event definition')).toHaveValue('__multiple');
  await expect(inspector.getByLabel('Parallel multiple')).toBeChecked();
  await expect(inspector.getByLabel('Timer expression')).toHaveValue('2027-01-01T09:00:00Z');

  // Multiple end event: remove a trigger, then add it back.
  await el(page, 'End_multi').click();
  await inspector.getByLabel('Remove Signal trigger').click();
  let xml = await exportXml(page);
  let end = /<bpmn:endEvent id="End_multi"[\s\S]*?<\/bpmn:endEvent>/.exec(xml)![0];
  expect(end).toContain('messageEventDefinition id="End_multi_msg"');
  expect(end).not.toContain('signalEventDefinition');
  await expect(inspector.getByLabel('Event definition')).toHaveValue('bpmn:MessageEventDefinition');
  await inspector.getByRole('button', { name: 'Add trigger' }).click();
  await page.getByRole('menuitem', { name: 'Signal', exact: true }).click();
  xml = await exportXml(page);
  end = /<bpmn:endEvent id="End_multi"[\s\S]*?<\/bpmn:endEvent>/.exec(xml)![0];
  expect(end).toContain('signalEventDefinition');
  await expect(inspector.getByLabel('Event definition')).toHaveValue('__multiple');

  // Instantiating parallel event-based gateway.
  // An instantiating gateway has no incoming sequence flows (PDF 328): remove s2 first.
  await el(page, 'Gw_event').click();
  await expect(inspector.getByLabel('Instantiate')).toBeDisabled();
  // A horizontal flow has a zero-height box, so click its midpoint directly.
  const s2 = (await el(page, 's2').boundingBox())!;
  await page.mouse.click(s2.x + s2.width / 2, s2.y + s2.height / 2);
  await page.keyboard.press('Delete');
  await el(page, 'Gw_event').click();
  await inspector.getByLabel('Instantiate').check();
  await inspector.getByLabel('Event gateway type').selectOption('Parallel');
  // Collection off.
  await el(page, 'Data_requests').click();
  await inspector.getByLabel('Collection').uncheck();
  xml = await exportXml(page);
  expect(xml).toMatch(
    /<bpmn:eventBasedGateway id="Gw_event" instantiate="true" eventGatewayType="Parallel">/,
  );
  expect(xml).toContain('<bpmn:dataObject id="Data_requests_obj" />');
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-notation.bpmn', xml);
});

test('process data inputs / outputs and black-box pools', async ({ page }) => {
  await page.goto('/?sample=notation');
  await expect(el(page, 'In_ticket')).toBeVisible();
  await expect(page.getByText('Read-only')).toHaveCount(0);
  await expect(el(page, 'Out_report').locator('.bf-collection-marker')).toHaveCount(1);
  await expect(el(page, 'Dia_ticket')).toHaveCount(1);
  await expect(el(page, 'Doa_report')).toHaveCount(1);

  // A new data input in the pool, read by the task.
  const timer = await center(page, 'Catch_timer');
  const endMulti = await center(page, 'End_multi');
  const endUpdate = await center(page, 'End_update');
  const input = await place(page, 'DataInput', {
    x: (timer.x + endMulti.x) / 2,
    y: endUpdate.y,
  });
  await connect(page, input, 'Task_handle');
  let xml = await exportXml(page);
  const io = /<bpmn:ioSpecification id="IO_service">[\s\S]*?<\/bpmn:ioSpecification>/.exec(xml)![0];
  expect(io).toContain(`<bpmn:dataInput id="${input}"`);
  expect(io).toMatch(new RegExp(`<bpmn:dataInputRefs>${input}</bpmn:dataInputRefs>`));
  const task = /<bpmn:userTask id="Task_handle"[\s\S]*?<\/bpmn:userTask>/.exec(xml)![0];
  expect(task).toContain(`<bpmn:sourceRef>${input}</bpmn:sourceRef>`);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  saveForInterop('e2e-data-io.bpmn', xml);

  // Deleting it removes it from the I/O specification and drops its association.
  await el(page, input).click();
  await page.keyboard.press('Delete');
  xml = await exportXml(page);
  expect(xml).not.toContain(input);
  expect(xml).toContain('<bpmn:dataInputRefs>In_ticket</bpmn:dataInputRefs>');

  // Black-box pool: give the customer a process, then make it a black box again.
  const inspector = page.getByTestId('inspector');
  await page.getByTestId('canvas').click({ position: { x: 15, y: 15 } });
  await el(page, 'Pool_customer').click({ position: { x: 300, y: 10 } });
  await expect(inspector.getByLabel('Black-box pool')).toBeChecked();
  await inspector.getByLabel('Black-box pool').uncheck();
  await expect(el(page, 'Pool_customer').locator('.bf-black-box')).toHaveCount(0);
  xml = await exportXml(page);
  expect(xml).toMatch(/<bpmn:participant id="Pool_customer" name="Customer" processRef="[^"]+"/);
  expect(count(xml, 'process')).toBe(2);
  await inspector.getByLabel('Black-box pool').check();
  xml = await exportXml(page);
  expect(xml).toContain('<bpmn:participant id="Pool_customer" name="Customer" />');
  expect(count(xml, 'process')).toBe(1);
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
  // Undo brings the same process back.
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(count(await exportXml(page), 'process')).toBe(2);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(count(await exportXml(page), 'process')).toBe(1);

  // A pool with content cannot become a black box.
  await el(page, 'Pool_service').click({ position: { x: 15, y: 60 } });
  await expect(inspector.getByLabel('Black-box pool')).toBeDisabled();
});

test('an annotation and a data object are associated with a sequence flow (PDF 95, Fig 10.68)', async ({
  page,
}) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Flow_b')).toBeVisible();
  await page.keyboard.press('0');
  const flow = (await el(page, 'Flow_b').boundingBox())!;
  const note = await place(page, 'TextAnnotation', { x: flow.x + 60, y: flow.y - 120 });
  await connect(page, note, 'Flow_b');
  const data = await place(page, 'DataObjectReference', { x: flow.x + 20, y: flow.y + 140 });
  await connect(page, data, 'Flow_b');
  const xml = await exportXml(page);
  expect(xml).toMatch(
    new RegExp(`<bpmn:association id="[^"]+" sourceRef="${note}" targetRef="Flow_b" />`),
  );
  expect(xml).toMatch(
    new RegExp(`<bpmn:association id="[^"]+" sourceRef="${data}" targetRef="Flow_b" />`),
  );
  expect(['valid', 'skipped']).toContain(xsdValidate(xml));
});
