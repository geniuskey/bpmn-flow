/** Auto layout keeps boundary events, sub-process content and pool artifacts with their owners. */
import { expect, test } from '@playwright/test';
import { exportXml } from './helpers';

function bounds(xml: string, diId: string) {
  const m = new RegExp(
    `id="${diId}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"`,
  ).exec(xml);
  if (!m) throw new Error(`no bounds for ${diId}`);
  const [x, y, width, height] = m.slice(1).map(Number) as [number, number, number, number];
  return { x, y, width, height };
}

const center = (b: ReturnType<typeof bounds>) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('auto layout moves boundary events and sub-process content with their activity', async ({
  page,
}) => {
  await page.goto('/?sample=all-elements');
  const before = await exportXml(page);
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect
    .poll(async () => bounds(await exportXml(page), 'Sub_di'))
    .not.toEqual(bounds(before, 'Sub_di'));
  const xml = await exportXml(page);

  const sub = bounds(xml, 'Sub_di');
  const b = center(bounds(xml, 'B_error_di'));
  // The boundary event sits on the sub-process border.
  expect(b.x).toBeGreaterThanOrEqual(sub.x);
  expect(b.x).toBeLessThanOrEqual(sub.x + sub.width);
  expect(Math.min(Math.abs(b.y - sub.y), Math.abs(b.y - (sub.y + sub.height)))).toBeLessThan(2);
  // Its content stays inside.
  for (const id of ['SubS_di', 'SubE_di']) {
    const c = center(bounds(xml, id));
    expect(c.x).toBeGreaterThan(sub.x);
    expect(c.x).toBeLessThan(sub.x + sub.width);
    expect(c.y).toBeGreaterThan(sub.y);
    expect(c.y).toBeLessThan(sub.y + sub.height);
  }
});
