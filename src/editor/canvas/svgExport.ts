/**
 * Standalone SVG of the visible diagram (the active root). Shape styling comes
 * from CSS classes and theme tokens (src/styles/canvas.css), so the computed
 * presentation is inlined on each node; the export always uses the light
 * theme and leaves out editor chrome (hit areas, outlines, handles).
 */
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING = 20;

/** Editor-only graphics that must not end up in an image. */
const CHROME = [
  '.djs-hit',
  '.djs-outline',
  '.djs-bendpoints',
  '.djs-segment-dragger',
  '.djs-resizer',
  '.djs-dragger',
  '.djs-drag-group',
  '.djs-connection-preview',
  '.djs-complex-preview',
].join(',');

const PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'filter',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'white-space',
] as const;

const COLOR_PROPERTIES = new Set(['fill', 'stroke']);

export interface SvgExport {
  svg: string;
  width: number;
  height: number;
}

export function exportSvg(canvas: Canvas, registry: ElementRegistry): SvgExport | null {
  const layer = canvas.getActiveLayer() as SVGGElement | null;
  if (!layer) return null;
  const bounds = contentBounds(registry, layer);
  if (!bounds) return null;

  const html = document.documentElement;
  const dark = html.classList.contains('dark');
  const highlighted = [...layer.querySelectorAll('.bf-highlight')];
  // Synchronous: the page never repaints in between.
  if (dark) html.classList.remove('dark');
  highlighted.forEach((n) => n.classList.remove('bf-highlight'));
  let content: SVGGElement;
  try {
    content = cloneWithStyles(layer);
  } finally {
    if (dark) html.classList.add('dark');
    highlighted.forEach((n) => n.classList.add('bf-highlight'));
  }

  const x = Math.floor(bounds.x - PADDING);
  const y = Math.floor(bounds.y - PADDING);
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  const defs = (layer.ownerSVGElement ?? layer.closest('svg'))?.querySelector(':scope > defs');
  if (defs) svg.appendChild(defs.cloneNode(true));
  content.removeAttribute('class');
  svg.appendChild(content);
  const text = new XMLSerializer().serializeToString(svg);
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${text}`, width, height };
}

/** Union of the shapes, connections and labels drawn in the layer. */
function contentBounds(
  registry: ElementRegistry,
  layer: SVGGElement,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, w = 0, h = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const el of registry.getAll() as Element[]) {
    if (!el.parent) continue; // a root
    const gfx = registry.getGraphics(el);
    if (!gfx || !layer.contains(gfx)) continue;
    const c = el as Connection;
    if (c.waypoints) {
      for (const p of c.waypoints) add(p.x, p.y);
      continue;
    }
    const s = el as Shape;
    if (s.width > 0 || s.height > 0) add(s.x, s.y, s.width, s.height);
  }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : null;
}

/**
 * Inherited properties are written only where they differ from the parent;
 * `opacity` and `filter` (not inherited) only where they are set.
 */
function cloneWithStyles(source: SVGGElement): SVGGElement {
  const clone = source.cloneNode(true) as SVGGElement;
  const from = [source, ...source.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  const resolved = new Map<Node, Map<string, string>>();
  from.forEach((node, i) => {
    const target = to[i] as SVGElement;
    if (node.matches(CHROME)) {
      target.setAttribute('data-bf-chrome', '');
      return;
    }
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') {
      target.setAttribute('display', 'none');
      return;
    }
    const parent = node === source ? undefined : resolved.get(node.parentNode!);
    const values = new Map<string, string>();
    const inline: string[] = [];
    for (const p of PROPERTIES) {
      const raw = style.getPropertyValue(p);
      if (!raw) continue;
      const v = COLOR_PROPERTIES.has(p) ? toRgb(raw) : p === 'filter' ? colorsToRgb(raw) : raw;
      if (p === 'opacity' || p === 'filter') {
        if (v !== '1' && v !== 'none') inline.push(`${p}:${v}`);
        continue;
      }
      values.set(p, v);
      if (parent?.get(p) !== v) inline.push(`${p}:${v}`);
    }
    resolved.set(node, values);
    if (inline.length) target.setAttribute('style', inline.join(';'));
    else target.removeAttribute('style');
    target.removeAttribute('class');
  });
  clone.querySelectorAll('[data-bf-chrome]').forEach((n) => n.remove());
  return clone;
}

/** Colors inside a value such as `drop-shadow(oklch(...) 0px 1px 2px)`. */
function colorsToRgb(value: string): string {
  return value.replace(/(?:oklch|oklab|lab|lch|color)\([^()]*\)/g, (c) => toRgb(c));
}

const rgbCache = new Map<string, string>();
let probe: CanvasRenderingContext2D | null | undefined;

/** Modern color syntax (oklch, color-mix results) as rgb() for other SVG viewers. */
function toRgb(value: string): string {
  if (value === 'none' || value.startsWith('url(') || value.startsWith('rgb')) return value;
  const cached = rgbCache.get(value);
  if (cached) return cached;
  probe ??= (() => {
    try {
      return document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    } catch {
      return null;
    }
  })();
  if (!probe) return value;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const out =
    a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a! / 255).toFixed(3)})`;
  rgbCache.set(value, out);
  return out;
}
