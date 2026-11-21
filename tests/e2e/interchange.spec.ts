import { expect, test, type Page } from '@playwright/test';
import { el, openXml } from './helpers';

/**
 * Files from other tools (shapes of the BPMN MIWG reference suite): their
 * BPMNLabel bounds fit the text in that tool's font, and colors may give a
 * fill only.
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" id="Defs" targetNamespace="http://example.com">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Pool" name="Pool" processRef="Proc" />
    <bpmn:participant id="Client" name="Client" />
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:eventBasedGateway id="Gw" />
    <bpmn:task id="Sub" name="Expanded Sub-Process 1" />
    <bpmn:sequenceFlow id="Accepted" name="Application accepted" sourceRef="Gw" targetRef="Sub" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true">
        <dc:Bounds x="72" y="120" width="600" height="200" />
        <bpmndi:BPMNLabel><dc:Bounds x="76" y="208" width="12.8" height="24.3" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Client_di" bpmnElement="Client" isHorizontal="true">
        <dc:Bounds x="72" y="360" width="600" height="120" />
        <bpmndi:BPMNLabel><dc:Bounds x="72" y="360" width="20" height="120" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gw_di" bpmnElement="Gw" color:background-color="#b98b00">
        <dc:Bounds x="160" y="200" width="40" height="40" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub">
        <dc:Bounds x="330" y="180" width="200" height="80" />
        <bpmndi:BPMNLabel><dc:Bounds x="335" y="185" width="124" height="12.8" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Accepted_di" bpmnElement="Accepted">
        <di:waypoint x="200" y="220" /><di:waypoint x="330" y="220" />
        <bpmndi:BPMNLabel><dc:Bounds x="240" y="230" width="53" height="27" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const lines = (page: Page, id: string, cls: string) =>
  el(page, id).locator(`text.${cls} tspan`).allTextContents();

/** Width of `text` in the font the label is drawn with. */
const textWidth = (page: Page, id: string, cls: string, text: string) =>
  el(page, id)
    .locator(`text.${cls}`)
    .evaluate((node, t) => {
      const style = getComputedStyle(node);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return ctx.measureText(t).width;
    }, text);

test('labels at tight BPMNLabel bounds break between words, as the other tool drew them', async ({
  page,
}) => {
  await page.goto('/');
  await openXml(page, XML, 'interchange.bpmn');
  await expect(el(page, 'Gw')).toBeVisible();

  // Vertical pool names stay whole (were "P/oo/l").
  expect(await lines(page, 'Pool', 'bf-pool-label')).toEqual(['Pool']);
  // A black-box pool's tall label box: the name runs vertically too.
  expect(await lines(page, 'Client', 'bf-pool-label')).toEqual(['Client']);
  await expect(el(page, 'Client').locator('text.bf-pool-label')).toHaveAttribute(
    'transform',
    /^matrix\(0, -1, 1, 0,/,
  );
  // One line where the other tool had room for one (up to 15% wider, as
  // measured in the font this machine draws with: CI has no Arial).
  const subWidth = await textWidth(page, 'Sub', 'bf-label', 'Expanded Sub-Process 1');
  expect(await lines(page, 'Sub', 'bf-label')).toHaveLength(subWidth <= 124 * 1.15 ? 1 : 2);
  // Breaks between words, never inside one (was "Applicatio/n accepted").
  const flow = await lines(page, 'Accepted', 'bf-flow-label');
  expect(flow.join(' ')).toBe('Application accepted');
  expect(flow).toContain('Application');

  // A fill-only color: the marker takes the neutral line color, not the theme
  // tint that would vanish on the fill.
  const strokes = await page.evaluate(() => {
    const visual = (id: string) =>
      document.querySelector(`.djs-element[data-element-id="${id}"] .djs-visual`)!;
    return {
      marker: getComputedStyle(visual('Gw').querySelector('.bf-marker-thin')!).stroke,
      outline: getComputedStyle(visual('Sub').querySelector('.bf-shape')!).stroke,
    };
  });
  expect(strokes.marker).toBe(strokes.outline);
});

/** B.1.0: the lanes start 31px into the pool, not at our 30px header. */
const LANES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="http://example.com">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Pool" name="Pool" processRef="Proc" />
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:laneSet id="Ls">
      <bpmn:lane id="Lane1" name="Lane 1"><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane2" name="Lane 2" />
    </bpmn:laneSet>
    <bpmn:task id="T1" name="Task" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true">
        <dc:Bounds x="49" y="352" width="600" height="300" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane1_di" bpmnElement="Lane1" isHorizontal="true">
        <dc:Bounds x="80" y="352" width="569" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane2_di" bpmnElement="Lane2" isHorizontal="true">
        <dc:Bounds x="80" y="502" width="569" height="150" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T1_di" bpmnElement="T1">
        <dc:Bounds x="200" y="387" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

test('a pool header line runs along its lanes, not beside them', async ({ page }) => {
  await page.goto('/');
  await openXml(page, LANES_XML, 'lanes.bpmn');
  await expect(el(page, 'T1')).toBeVisible();
  await expect(el(page, 'Pool').locator('path.bf-pool-divider')).toHaveAttribute('d', 'M31,0V300');
});
