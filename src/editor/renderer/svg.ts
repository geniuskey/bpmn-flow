/** Small SVG helpers for the renderer: element creation with `bf-*` classes and paths. */
import {
  append as svgAppend,
  attr as svgAttr,
  classes as svgClasses,
  create as svgCreate,
} from 'tiny-svg';

export function el<K extends keyof SVGElementTagNameMap>(
  parent: SVGElement,
  tag: K,
  attrs: Record<string, string | number>,
  className: string,
): SVGElementTagNameMap[K] {
  const node = svgCreate(tag) as SVGElementTagNameMap[K];
  svgAttr(node, attrs);
  for (const c of className.split(' ')) if (c) svgClasses(node).add(c);
  svgAppend(parent, node);
  return node;
}

/** Regular pentagon pointing up (Multiple trigger, event-based gateway). */
export function pentagonPath(cx: number, cy: number, r: number): string {
  const pts = [0, 1, 2, 3, 4].map((k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  });
  return `M${pts.join('L')}z`;
}

export function path(parent: SVGElement, d: string, className: string): SVGPathElement {
  return el(parent, 'path', { d }, className);
}
