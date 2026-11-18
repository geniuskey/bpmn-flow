/**
 * Browser half of the package smoke test: serves the consumer bundle and
 * checks that the vanilla editor and the React component render and edit.
 * Usage: node scripts/lib-smoke-browser.mjs <dist dir>
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const dir = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(dir, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);

  const shapes = await page.evaluate(() => window.ready);
  assert.ok(shapes > 0, 'vanilla editor imported shapes');
  const drawn = await page.locator('#vanilla .djs-shape').count();
  assert.ok(drawn >= shapes, `vanilla canvas drew ${drawn} shapes`);

  const reactShapes = await page.evaluate(() => window.reactImported);
  assert.equal(reactShapes, shapes, 'React component imported the same diagram');
  assert.ok((await page.locator('#react .djs-shape').count()) >= shapes);
  assert.ok(await page.evaluate(() => window.reactEditor?.getSnapshot().readOnly === false));

  // Styles applied: the library tokens reach the canvas.
  const primary = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#vanilla .bf-canvas-host')).getPropertyValue(
      '--primary',
    ),
  );
  assert.ok(primary.trim(), 'canvas tokens are defined');

  // Keyboard on the vanilla editor: select all, delete, undo.
  await page.click('#vanilla', { position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+a');
  const selected = await page.evaluate(() => window.editor.getSnapshot().selection.length);
  assert.ok(selected > 0, 'Mod+A selected elements');
  await page.keyboard.press('Delete');
  assert.equal(
    await page.locator('#vanilla .djs-shape').count(),
    0,
    'Delete removed the selection',
  );
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await page.locator('#vanilla .djs-shape').count(), drawn, 'Mod+Z restored it');

  // Auto layout: the vanilla editor runs ELK in a worker, the React one in-thread.
  const workers = [];
  page.on('worker', (w) => workers.push(w.url()));
  assert.equal(await page.evaluate(() => window.editor.autoLayout()), true, 'auto layout ran');
  assert.ok(
    workers.some((u) => u.includes('elk-worker')),
    'layout used the ELK worker',
  );
  assert.equal(await page.evaluate(() => window.reactEditor.autoLayout()), true);
  const xml = await page.evaluate(() => window.editor.exportXml());
  assert.match(xml, /<bpmn:definitions/);
  assert.equal(await page.evaluate(() => window.editor.getSnapshot().dirty), false);

  assert.deepEqual(errors, [], 'no console errors');
  console.log(`browser ok: ${shapes} shapes, ${xml.length} bytes exported after layout`);
} finally {
  await browser.close();
  server.close();
}
