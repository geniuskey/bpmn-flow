/** Labels: centered text inside shapes, external labels, captions and pool/lane titles. */
import Text from 'diagram-js/lib/util/Text';
import { append as svgAppend, attr as svgAttr, classes as svgClasses } from 'tiny-svg';
import { readLabelBounds, readLabelFont, type LabelFont } from '@/bpmn/di/di';
import { getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import type { BpmnShape } from '../model';
import { el } from './svg';
import { estimateLabel } from '../layout/engine';

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

function textStyle(font: LabelFont | undefined) {
  return font?.size || font?.name
    ? {
        fontFamily: font.name ? `${font.name}, ${FONT_FAMILY}` : FONT_FAMILY,
        fontSize: font.size ?? FONT_SIZE,
        lineHeight: 1.25,
      }
    : undefined;
}

export function drawCenteredText(
  gfx: SVGElement,
  text: string | undefined,
  box: Box,
  className: string,
  align: Align = 'center-middle',
  font?: LabelFont,
  padding = 6,
): SVGElement | undefined {
  if (!text) return undefined;
  // Line breaking measures with the label's own font (BPMNLabelStyle).
  const style = textStyle(font);
  const node = TEXT.createText(text, {
    box: { width: box.width, height: box.height },
    align: align as 'center-middle', // 'left-middle' works at runtime, missing from the typings
    padding,
    ...(style ? { style } : {}),
  });
  svgAttr(node, { transform: `translate(${box.x}, ${box.y})` });
  const css = fontCss(font);
  if (css) svgAttr(node, { style: css });
  for (const c of className.split(' ')) svgClasses(node).add(c);
  svgAppend(gfx, node);
  return node;
}

/** Size of a label wrapped at `maxWidth` in the default font (estimated without a layout engine). */
export function measureLabel(text: string, maxWidth: number): { width: number; height: number } {
  try {
    const d = TEXT.getDimensions(text, {
      box: { width: maxWidth, height: 0 },
      padding: 0,
    } as never);
    if (d.width > 0 && d.height > 0)
      return { width: Math.ceil(d.width) + 4, height: Math.ceil(d.height) + 2 };
  } catch {
    // No layout engine (Node, tests without canvas measuring).
  }
  return estimateLabel(text, maxWidth);
}

/** Padding inside BPMNLabel bounds: they already are the text's extent. */
export const DI_LABEL_PADDING = 1;

/**
 * A label at BPMNLabel bounds written by another tool. The bounds fit the text
 * as that tool measured it; in our font the same words can be a little wider.
 * The box keeps its center and may grow by 15%, and always to its longest
 * word; lines break between words, measured (diagram-js estimates the break by
 * character count and can cut a word that fits).
 */
export function fitDiLabel(
  text: string,
  box: Box,
  font?: LabelFont,
  minWidth = 0,
): { text: string; box: Box } {
  const style = textStyle(font);
  const measure = (line: string) => {
    try {
      return TEXT.getDimensions(line, {
        box: { width: 100_000, height: 0 },
        padding: 0,
        ...(style ? { style } : {}),
      } as never).width;
    } catch {
      return 0; // No layout engine (tests without canvas measuring).
    }
  };
  const lines = text.split(/\r?\n/).map((line) => line.split(/\s+/).filter(Boolean));
  const longest = Math.max(0, ...lines.flat().map(measure));
  const width = Math.max(
    box.width * 1.15 + 2 * DI_LABEL_PADDING,
    longest + 2 + 2 * DI_LABEL_PADDING,
    minWidth,
  );
  const room = width - 2 * DI_LABEL_PADDING;
  const wrapped: string[] = [];
  for (const words of lines) {
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > room) {
        wrapped.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    wrapped.push(line);
  }
  return {
    text: wrapped.join('\n'),
    box: { x: box.x - (width - box.width) / 2, y: box.y, width, height: box.height },
  };
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
  const font = readLabelFont(shape.di);
  if (box && text) {
    const fitted = fitDiLabel(text, box, font);
    drawCenteredText(
      gfx,
      fitted.text,
      fitted.box,
      className,
      'center-middle',
      font,
      DI_LABEL_PADDING,
    );
  } else {
    drawCenteredText(gfx, text, fallback, className, align, font);
  }
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
  const font = readLabelFont(shape.di);
  if (label) {
    const fitted = fitDiLabel(
      name,
      { x: label.x - shape.x, y: label.y - shape.y, width: label.width, height: label.height },
      font,
      90,
    );
    drawCenteredText(
      gfx,
      fitted.text,
      fitted.box,
      'bf-label bf-external-label',
      'center-top',
      font,
      DI_LABEL_PADDING,
    );
    return;
  }
  const box = { x: shape.width / 2 - 45, y: shape.height + 6, width: 90, height: 30 };
  drawCenteredText(gfx, name, box, 'bf-label bf-external-label', 'center-top', font);
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
