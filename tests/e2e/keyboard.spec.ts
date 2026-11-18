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
