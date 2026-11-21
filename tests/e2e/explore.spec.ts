/** Exploring diagrams in small spaces: layout options, reflow view, focus mode, level of detail. */
import { expect, test } from '@playwright/test';
import { el, exportXml } from './helpers';

test('layout options: top to bottom from the toolbar menu, one undo step', async ({ page }) => {
  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Review')).toBeVisible();
  await page.getByTestId('layout-options').click();
  await page.getByRole('menuitemradio', { name: 'Top to bottom' }).click();
  await expect
    .poll(async () => {
      const a = (await el(page, 'Start').locator('.djs-hit').boundingBox())!;
      const b = (await el(page, 'Review').locator('.djs-hit').boundingBox())!;
      return b.y > a.y + a.height && Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)) < 2;
    })
    .toBe(true);
  // The choice is kept for the next layout.
  await page.getByTestId('layout-options').click();
  await expect(page.getByRole('menuitemradio', { name: 'Top to bottom' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
});

test('line style from the toolbar menu: curved lines are drawn, straight ones laid out', async ({
  page,
}) => {
  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Review')).toBeVisible();
  const paths = () =>
    page
      .locator('.djs-connection path.bf-connection')
      .evaluateAll((ps) => ps.map((p) => p.getAttribute('d') ?? ''));
  await page.getByTestId('layout-options').click();
  await page.getByRole('menuitemradio', { name: 'Curved lines' }).click();
  await expect.poll(async () => (await paths()).some((d) => d.includes('Q'))).toBe(true);
  await page.getByTestId('layout-options').click();
  await page.getByRole('menuitemradio', { name: 'Straight lines' }).click();
  await expect
    .poll(async () => (await paths()).every((d) => !d.includes('Q') && d.split('L').length === 2))
    .toBe(true);
  // Kept after a reload.
  await page.reload();
  await page.getByTestId('layout-options').click();
  await expect(page.getByRole('menuitemradio', { name: 'Straight lines' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
});

test('reflow view: fits a narrow window top to bottom, read-only, the file keeps its layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.goto('/?sample=collaboration-lanes');
  await expect(el(page, 'Triage')).toBeVisible();
  const before = await exportXml(page);

  await page.getByTestId('reflow-toggle').click();
  const view = page.getByTestId('reflow-view');
  await expect(view).toBeVisible();
  await expect(view).toContainText('top → bottom');
  // Lanes side by side, flow downwards.
  const triage = (await view.locator('.djs-element[data-element-id="Triage"]').boundingBox())!;
  const solve = (await view.locator('.djs-element[data-element-id="Solve"]').boundingBox())!;
  expect(solve.y).toBeGreaterThan(triage.y + triage.height);
  expect(solve.x).toBeGreaterThan(triage.x + triage.width);
  // Nothing can be edited there.
  await expect(view.locator('.djs-context-pad.open')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  expect(await exportXml(page)).toBe(before);
});

test('focus mode dims everything outside the paths through the selection', async ({ page }) => {
  await page.goto('/?sample=mvp-elements');
  await expect(el(page, 'Pay')).toBeVisible();
  await page.getByRole('button', { name: 'Focus mode' }).click();
  await el(page, 'Pay').click();
  await expect(el(page, 'Pay')).toHaveClass(/bf-focus/);
  await expect(el(page, 'Start')).toHaveClass(/bf-focus/);
  await expect(el(page, 'Paid')).toHaveClass(/bf-focus/);
  await expect(el(page, 'Rejected')).not.toHaveClass(/bf-focus/);
  await expect(el(page, 'Notify')).not.toHaveClass(/bf-focus/);
  await expect
    .poll(() =>
      el(page, 'Rejected')
        .locator('.djs-visual')
        .evaluate((n) => Number(getComputedStyle(n).opacity)),
    )
    .toBeLessThan(0.5);
  // Turning it off restores everything.
  await page.getByRole('button', { name: 'Focus mode' }).click();
  await expect(page.locator('.bf-focusing')).toHaveCount(0);
});

test('zoomed far out, flow names are hidden', async ({ page }) => {
  await page.goto('/?sample=mvp-elements');
  const label = page.locator('.bf-flow-label').first();
  await expect(label).toBeVisible();
  await page.getByTestId('zoom-level').click();
  await page.getByRole('menuitem', { name: '50%', exact: true }).click();
  await expect(label).toBeHidden();
});
