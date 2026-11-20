/** Keyboard use outside the canvas: focused controls keep their keys; menus and tabs are operable. */
import { expect, test } from '@playwright/test';
import { el } from './helpers';

test('Enter and Backspace on a focused button do not act on the selected element', async ({
  page,
}) => {
  await page.goto('/?sample=simple-process');
  await el(page, 'Task_check').click();
  const toggle = page.getByRole('button', { name: 'Toggle analysis panel' });
  const panel = page.getByTestId('analysis-panel');
  const wasOpen = await panel.isVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  // The button was activated; no inline rename started.
  await expect(panel).toBeVisible({ visible: !wasOpen });
  await expect(page.locator('.bf-direct-editing')).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await expect(el(page, 'Task_check')).toHaveCount(1);
});

test('Shift+F10 opens the context menu with keyboard navigation', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  await el(page, 'Task_check').click();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Context menu' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(el(page, 'Task_check')).toHaveCount(1); // Escape did not act on the diagram

  // Enter runs the focused item: "Delete" removes the task.
  await page.keyboard.press('Shift+F10');
  const del = page.getByRole('menuitem', { name: /^Delete/ });
  await del.focus();
  await page.keyboard.press('Enter');
  await expect(el(page, 'Task_check')).toHaveCount(0);
});

test('analysis tabs follow the WAI-ARIA tabs pattern', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  const panel = page.getByTestId('analysis-panel');
  if (!(await panel.isVisible()))
    await page.getByRole('button', { name: 'Toggle analysis panel' }).click();
  const tabs = page.getByRole('tablist', { name: 'Analysis views' }).getByRole('tab');
  await tabs.first().click();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft'); // wraps to the last tab
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    (await tabs.last().getAttribute('id'))!,
  );
});

test('shape library arrow keys keep the column across groups', async ({ page }) => {
  await page.goto('/?sample=simple-process');
  const toggle = page.getByTestId('toggle-shape-library');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-controls', 'shape-library-list');
  const search = page.getByRole('searchbox', { name: 'Search shapes' });
  const groups = page.locator('#shape-library-list [role="group"]');
  const first = groups.nth(0).locator('[data-library-entry]');
  const second = groups.nth(1).locator('[data-library-entry]');
  await search.focus();
  await page.keyboard.press('ArrowDown');
  await expect(first.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  // From the first column of the first group's last row, down lands in the
  // first column of the next group.
  const count = await first.count();
  const lastRowStart = Math.floor((count - 1) / 6) * 6;
  await first.nth(lastRowStart).focus();
  await page.keyboard.press('ArrowDown');
  await expect(second.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first.nth(lastRowStart)).toBeFocused();

  await toggle.click();
  await expect(toggle).not.toHaveAttribute('aria-controls', /.+/);
});
