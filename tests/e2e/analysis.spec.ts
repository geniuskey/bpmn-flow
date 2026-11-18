import { expect, test } from '@playwright/test';
import { el, expectStored } from './helpers';

test('findings are listed and clicking one selects and highlights the element', async ({
  page,
}) => {
  await page.goto('/?sample=analysis-issues');
  await expect(el(page, 'A')).toBeVisible();
  await page.getByRole('tab', { name: /Findings/ }).click();
  const findings = page.getByTestId('findings');
  await expect(findings).toContainText('“Forgotten” is not connected to anything.');
  await expect(findings).toContainText('GRAPH-CYCLE');
  await findings.locator('[data-rule="GRAPH-DEAD-END"]').click();
  await expect(el(page, 'B')).toHaveClass(/selected/);
  await expect(el(page, 'B')).toHaveClass(/bf-highlight/);
  await expect(page.getByTestId('inspector').getByLabel('Name')).toHaveValue('Archive');

  // Fixing the problem updates the analysis live: connect B to the end event.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const b = (await el(page, 'B').boundingBox())!;
  const end = (await el(page, 'End').boundingBox())!;
  await page.keyboard.press('c');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(findings.locator('[data-rule="GRAPH-DEAD-END"]')).toHaveCount(0);
});

test('overview shows gateway branches and lane handoffs', async ({ page }) => {
  await page.goto('/?sample=collaboration-lanes');
  await expect(el(page, 'Triage')).toBeVisible();
  await page.getByRole('tab', { name: 'Metrics' }).click();
  const metrics = page.getByTestId('graph-metrics');
  await expect(metrics).toContainText('Lane handoffs');
  await expect(metrics.locator('div', { hasText: /^Lane handoffs1$/ })).toHaveCount(1);

  // Validation tab lists VAL-* rules only.
  await page.getByRole('tab', { name: 'Validation' }).click();
  await expect(page.getByText('No findings.')).toBeVisible();
});

test('analysis metadata drives estimates and survives a reload', async ({ page }) => {
  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Review')).toBeVisible();
  const inspector = page.getByTestId('inspector');
  const fill = async (id: string, label: string, value: string) => {
    await el(page, id).click();
    await inspector.getByLabel(label, { exact: true }).fill(value);
    await inspector.getByLabel(label, { exact: true }).press('Enter');
  };
  await fill('Review', 'Duration', '10');
  await fill('Review', 'Waiting', '50');
  await fill('Pay', 'Duration', '30');
  await fill('Notify', 'Duration', '5');

  await page.getByRole('tab', { name: 'Estimates' }).click();
  const estimates = page.getByTestId('estimates');
  await expect(estimates).toContainText('Elapsed — worst case1.5 h');
  await expect(estimates).toContainText('Elapsed — best case1 h');

  await page.reload();
  await expect(el(page, 'Review')).toBeVisible();
  await el(page, 'Review').click();
  await expect(inspector.getByLabel('Waiting', { exact: true })).toHaveValue('50');
});

test('autosave restores the last document on the next visit', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await expect(el(page, 'Task_check')).toBeVisible();
  await el(page, 'Task_check').dblclick();
  await page.keyboard.type('Autosaved name');
  await page.keyboard.press('Enter');
  await expectStored(page, 'Autosaved name');
  await page.goto('/');
  await expect(page.getByTestId('document-title')).toContainText('simple-process.bpmn');
  await expect(el(page, 'Task_check')).toContainText('Autosaved name');
  await expect(page.getByRole('status')).toContainText('Restored');
});
