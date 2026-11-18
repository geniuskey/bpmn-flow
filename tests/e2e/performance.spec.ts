import { expect, test } from '@playwright/test';
import { openXml } from './helpers';

/** A chain of `n` tasks laid out in rows, with full DI. */
function largeProcess(n: number): string {
  const perRow = 20;
  const nodes: string[] = [
    '<bpmn:startEvent id="S"><bpmn:outgoing>f0</bpmn:outgoing></bpmn:startEvent>',
  ];
  const flows: string[] = [];
  const shapes: string[] = [
    '<bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="20" y="42" width="36" height="36" /></bpmndi:BPMNShape>',
  ];
  const edges: string[] = [];
  const pos = (i: number) => ({
    x: 100 + (i % perRow) * 150,
    y: 20 + Math.floor(i / perRow) * 140,
  });
  for (let i = 0; i < n; i++) {
    const { x, y } = pos(i);
    nodes.push(
      `<bpmn:task id="T${i}" name="Step ${i}"><bpmn:incoming>f${i}</bpmn:incoming><bpmn:outgoing>f${i + 1}</bpmn:outgoing></bpmn:task>`,
    );
    shapes.push(
      `<bpmndi:BPMNShape id="T${i}_di" bpmnElement="T${i}"><dc:Bounds x="${x}" y="${y}" width="100" height="80" /></bpmndi:BPMNShape>`,
    );
    const src = i === 0 ? 'S' : `T${i - 1}`;
    flows.push(`<bpmn:sequenceFlow id="f${i}" sourceRef="${src}" targetRef="T${i}" />`);
    const a = i === 0 ? { x: 56, y: 60 } : { x: pos(i - 1).x + 100, y: pos(i - 1).y + 40 };
    edges.push(
      `<bpmndi:BPMNEdge id="f${i}_di" bpmnElement="f${i}"><di:waypoint x="${a.x}" y="${a.y}" /><di:waypoint x="${x}" y="${y + 40}" /></bpmndi:BPMNEdge>`,
    );
  }
  const last = pos(n - 1);
  nodes.push(`<bpmn:endEvent id="E"><bpmn:incoming>f${n}</bpmn:incoming></bpmn:endEvent>`);
  flows.push(`<bpmn:sequenceFlow id="f${n}" sourceRef="T${n - 1}" targetRef="E" />`);
  shapes.push(
    `<bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="${last.x + 130}" y="${last.y + 22}" width="36" height="36" /></bpmndi:BPMNShape>`,
  );
  edges.push(
    `<bpmndi:BPMNEdge id="f${n}_di" bpmnElement="f${n}"><di:waypoint x="${last.x + 100}" y="${last.y + 40}" /><di:waypoint x="${last.x + 130}" y="${last.y + 40}" /></bpmndi:BPMNEdge>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D_large" targetNamespace="http://example.com">
<bpmn:process id="P_large">${nodes.join('')}${flows.join('')}</bpmn:process>
<bpmndi:BPMNDiagram id="Dg"><bpmndi:BPMNPlane id="Pl" bpmnElement="P_large">${shapes.join('')}${edges.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

test('opens, analyzes and exports a 1000-task diagram in reasonable time', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?sample=simple-process');
  await expect(page.locator('.djs-shape')).toHaveCount(3);

  const xml = largeProcess(1000);
  const t0 = Date.now();
  await openXml(page, xml, 'large.bpmn');
  await expect(page.locator('.djs-shape')).toHaveCount(1002, { timeout: 30_000 });
  const openMs = Date.now() - t0;

  await page.getByRole('tab', { name: /Findings/ }).click();
  const analyzed = await page.getByText(/analyzed in [\d.]+ ms/).textContent();
  const analysisMs = Number(/([\d.]+) ms/.exec(analyzed ?? '')?.[1]);

  const t1 = Date.now();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-button').click();
  await download;
  const exportMs = Date.now() - t1;

  console.log(
    `[perf] 1000 tasks — open+render ${openMs} ms, analysis ${analysisMs} ms, export+verify ${exportMs} ms`,
  );
  test.info().annotations.push({
    type: 'perf',
    description: `open ${openMs}ms, analysis ${analysisMs}ms, export ${exportMs}ms`,
  });
  expect(openMs).toBeLessThan(10_000);
  expect(analysisMs).toBeLessThan(500);
  expect(exportMs).toBeLessThan(10_000);
});
