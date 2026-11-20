/** Labels: centered text inside shapes, external labels, captions and pool/lane titles. */
import Text from 'diagram-js/lib/util/Text';
import { append as svgAppend, attr as svgAttr, classes as svgClasses } from 'tiny-svg';
import { readLabelBounds, readLabelFont, type LabelFont } from '@/bpmn/di/di';
import { getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import type { BpmnShape } from '../model';
import { el } from './svg';

export const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const FONT_SIZE = 12;

/** Text layout (line breaking, measuring) shared by all labels. */
export const TEXT = new Text({
  style: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, lineHeight: 1.25 },
});

export type Align = 'center-middle' | 'center-top' | 'left-middle';
type Box = { x: number; y: number; width: number; height: number };

/** Inline CSS for a BPMNLabelStyle font (inline so it wins over the theme classes). */
export function fontCss(font: LabelFont | undefined): string {
  if (!font) return '';
  const decoration = [font.isUnderline && 'underline', font.isStrikeThrough && 'line-through']
    .filter(Boolean)
    .join(' ');
  return [
    font.name && `font-family:${JSON.stringify(font.name)}, ${FONT_FAMILY}`,
    font.size && `font-size:${font.size}px`,
    font.isBold !== undefined && `font-weight:${font.isBold ? 700 : 400}`,
    font.isItalic !== undefined && `font-style:${font.isItalic ? 'italic' : 'normal'}`,
    decoration && `text-decoration:${decoration}`,
  ]
    .filter(Boolean)
    .join(';');
}

export function drawCenteredText(
  gfx: SVGElement,
  text: string | undefined,
  box: Box,
  className: string,
  align: Align = 'center-middle',
  font?: LabelFont,
): SVGElement | undefined {
  if (!text) return undefined;
  const node = TEXT.createText(text, {
    box: { width: box.width, height: box.height },
    align: align as 'center-middle', // 'left-middle' works at runtime, missing from the typings
    padding: 6,
    // Line breaking measures with the label's own font (BPMNLabelStyle).
    ...(font?.size || font?.name
      ? {
          style: {
            fontFamily: font.name ? `${font.name}, ${FONT_FAMILY}` : FONT_FAMILY,
            fontSize: font.size ?? FONT_SIZE,
            lineHeight: 1.25,
          },
        }
      : {}),
  });
  svgAttr(node, { transform: `translate(${box.x}, ${box.y})` });
  const css = fontCss(font);
  if (css) svgAttr(node, { style: css });
  for (const c of className.split(' ')) svgClasses(node).add(c);
  svgAppend(gfx, node);
  return node;
}

/**
 * BPMNLabel bounds of a shape, relative to the shape (BPMN 2.0.2 §12.2.3.7,
 * PDF 406): where the label is drawn when the DI gives them.
 */
export function labelBoxOf(shape: { x: number; y: number; di?: ModdleElement }): Box | undefined {
  const label = readLabelBounds(shape.di);
  if (!label || label.width <= 0 || label.height <= 0) return undefined;
  return { x: label.x - shape.x, y: label.y - shape.y, width: label.width, height: label.height };
}

/**
 * The name drawn inside a shape: at its BPMNLabel bounds and in its
 * BPMNLabelStyle font when the DI has them, otherwise in `fallback`.
 */
export function drawShapeName(
  gfx: SVGElement,
  shape: { x: number; y: number; di?: ModdleElement },
  text: string | undefined,
  fallback: Box,
  className: string,
  align: Align = 'center-middle',
): void {
  const box = labelBoxOf(shape);
  drawCenteredText(
    gfx,
    text,
    box ?? fallback,
    className,
    box ? 'center-middle' : align,
    readLabelFont(shape.di),
  );
}

/** Data state of an item-aware element: data object / store references, data inputs / outputs (PDF 234, 243). */
export function dataStateName(bo: ModdleElement): string | undefined {
  const itemAware =
    is(bo, 'bpmn:DataObjectReference') ||
    is(bo, 'bpmn:DataStoreReference') ||
    is(bo, 'bpmn:DataObject') ||
    is(bo, 'bpmn:DataInput') ||
    is(bo, 'bpmn:DataOutput');
  return itemAware
    ? ((getRef(bo, 'dataState')?.name as string | undefined) ?? undefined)
    : undefined;
}

/** Label below events/gateways; uses BPMN DI label bounds when present. */
export function drawExternalLabel(gfx: SVGElement, shape: BpmnShape): void {
  const bo = shape.businessObject;
  const state = dataStateName(bo);
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
  drawCenteredText(
    gfx,
    name,
    box,
    'bf-label bf-external-label',
    'center-top',
    readLabelFont(shape.di),
  );
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
