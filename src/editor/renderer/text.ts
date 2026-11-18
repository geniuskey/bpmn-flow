/** Labels: centered text inside shapes, external labels, captions and pool/lane titles. */
import Text from 'diagram-js/lib/util/Text';
import { append as svgAppend, attr as svgAttr, classes as svgClasses } from 'tiny-svg';
import { readLabelBounds } from '@/bpmn/di/di';
import { getRef, is } from '@/bpmn/model/moddle';
import type { BpmnShape } from '../model';
import { el } from './svg';

export const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const FONT_SIZE = 12;

/** Text layout (line breaking, measuring) shared by all labels. */
export const TEXT = new Text({
  style: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, lineHeight: 1.25 },
});

export function drawCenteredText(
  gfx: SVGElement,
  text: string | undefined,
  box: { x: number; y: number; width: number; height: number },
  className: string,
  align: 'center-middle' | 'center-top' = 'center-middle',
): void {
  if (!text) return;
  const node = TEXT.createText(text, {
    box: { width: box.width, height: box.height },
    align,
    padding: 6,
  });
  svgAttr(node, { transform: `translate(${box.x}, ${box.y})` });
  for (const c of className.split(' ')) svgClasses(node).add(c);
  svgAppend(gfx, node);
}

/** Label below events/gateways; uses BPMN DI label bounds when present. */
export function drawExternalLabel(gfx: SVGElement, shape: BpmnShape): void {
  const bo = shape.businessObject;
  const state =
    is(bo, 'bpmn:DataObjectReference') || is(bo, 'bpmn:DataStoreReference')
      ? (getRef(bo, 'dataState')?.name as string | undefined)
      : undefined;
  const name = [bo.name, state && `[${state}]`].filter(Boolean).join('\n');
  if (!name) return;
  const label = readLabelBounds(shape.di);
  const width = Math.max(label?.width ?? 0, 90);
  const box = label
    ? {
        x: label.x - shape.x - (width - label.width) / 2,
        y: label.y - shape.y,
        width,
        height: label.height,
      }
    : { x: shape.width / 2 - width / 2, y: shape.height + 6, width, height: 30 };
  drawCenteredText(gfx, name, box, 'bf-label bf-external-label', 'center-top');
}

/** Type caption inside the top-left corner of unsupported boxes. */
export function drawCaption(gfx: SVGElement, caption: string): void {
  const node = el(gfx, 'text', { x: 8, y: 14 }, 'bf-caption');
  node.textContent = caption;
}

/** Native hover tooltip. */
export function drawTitle(gfx: SVGElement, text: string): void {
  const node = el(gfx, 'title', {}, '');
  node.textContent = text;
}
