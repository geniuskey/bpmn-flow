/** SVG path builders used for hit-testing, connection cropping and drawing. */
import type { Point } from '@/bpmn/di/di';
import type { LineStyle } from '../layout/graph';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Outline = 'circle' | 'diamond' | 'roundRect' | 'rect' | 'hexagon';

export function circlePath(b: Box): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = b.width / 2;
  const ry = b.height / 2;
  return `M${cx},${cy - ry}a${rx},${ry} 0 1,1 0,${2 * ry}a${rx},${ry} 0 1,1 0,${-2 * ry}z`;
}

export function diamondPath(b: Box): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return `M${cx},${b.y}L${b.x + b.width},${cy}L${cx},${b.y + b.height}L${b.x},${cy}z`;
}

export function rectPath(b: Box, r = 0): string {
  if (!r) return `M${b.x},${b.y}h${b.width}v${b.height}h${-b.width}z`;
  const { x, y, width: w, height: h } = b;
  return (
    `M${x + r},${y}h${w - 2 * r}a${r},${r} 0 0,1 ${r},${r}v${h - 2 * r}` +
    `a${r},${r} 0 0,1 ${-r},${r}h${-(w - 2 * r)}a${r},${r} 0 0,1 ${-r},${-r}` +
    `v${-(h - 2 * r)}a${r},${r} 0 0,1 ${r},${-r}z`
  );
}

export const TASK_RADIUS = 10;

/** Conversation node: hexagon with flat top and bottom. */
export function hexagonPath(b: Box): string {
  const q = b.width / 4;
  const m = b.y + b.height / 2;
  return `M${b.x + q},${b.y}H${b.x + 3 * q}L${b.x + b.width},${m}L${b.x + 3 * q},${b.y + b.height}H${b.x + q}L${b.x},${m}z`;
}

export function outlinePath(outline: Outline, b: Box): string {
  switch (outline) {
    case 'circle':
      return circlePath(b);
    case 'diamond':
      return diamondPath(b);
    case 'roundRect':
      return rectPath(b, TASK_RADIUS);
    case 'rect':
      return rectPath(b);
    case 'hexagon':
      return hexagonPath(b);
  }
}

export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A polyline whose bends are rounded with `radius` (less where segments are short). */
export function roundedPath(points: Point[], radius = 10): string {
  if (points.length < 3) return polylinePath(points);
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (!r) {
      d += `L${b.x},${b.y}`;
      continue;
    }
    const p = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r };
    const q = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += `L${r2(p.x)},${r2(p.y)}Q${b.x},${b.y} ${r2(q.x)},${r2(q.y)}`;
  }
  const end = points[points.length - 1]!;
  return `${d}L${end.x},${end.y}`;
}

/**
 * A smooth curve along a polyline: each bend is the control point of a curve
 * between the middles of its segments; the ends keep their direction (so
 * arrow heads and markers still line up).
 */
export function curvedPath(points: Point[]): string {
  if (points.length < 3) return polylinePath(points);
  const mid = (a: Point, b: Point) => ({ x: r2((a.x + b.x) / 2), y: r2((a.y + b.y) / 2) });
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const start = mid(first, points[1]!);
  let d = `M${first.x},${first.y}L${start.x},${start.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const b = points[i]!;
    const to = i === points.length - 2 ? mid(b, last) : mid(b, points[i + 1]!);
    d += `Q${b.x},${b.y} ${to.x},${to.y}`;
  }
  return `${d}L${last.x},${last.y}`;
}

/** The path of a connection drawn in a line style. */
export function linePath(points: Point[], style: LineStyle = 'orthogonal'): string {
  if (style === 'rounded') return roundedPath(points);
  if (style === 'curved') return curvedPath(points);
  return polylinePath(points);
}

/** Arrow head triangle at the end of the last segment. */
export function arrowHeadPath(points: Point[], length = 10, halfWidth = 4.5): string | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const dx = end.x - prev.x;
  const dy = end.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len;
  const uy = dy / len;
  const bx = end.x - ux * length;
  const by = end.y - uy * length;
  return `M${end.x},${end.y}L${bx - uy * halfWidth},${by + ux * halfWidth}L${bx + uy * halfWidth},${by - ux * halfWidth}z`;
}

/** Small marker near the start of a connection (default-flow slash or conditional diamond). */
export function startMarkerPath(points: Point[], kind: 'slash' | 'diamond'): string | null {
  if (points.length < 2) return null;
  const a = points[0]!;
  const b = points[1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!len) return null;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  if (kind === 'slash') {
    const cx = a.x + ux * 10;
    const cy = a.y + uy * 10;
    // slash rotated 45° relative to the segment
    const sx = (ux - uy) * 5;
    const sy = (uy + ux) * 5;
    return `M${cx - sx},${cy - sy}L${cx + sx},${cy + sy}`;
  }
  const p1 = { x: a.x + ux * 7 - uy * 4.5, y: a.y + uy * 7 + ux * 4.5 };
  const p2 = { x: a.x + ux * 14, y: a.y + uy * 14 };
  const p3 = { x: a.x + ux * 7 + uy * 4.5, y: a.y + uy * 7 - ux * 4.5 };
  return `M${a.x},${a.y}L${p1.x},${p1.y}L${p2.x},${p2.y}L${p3.x},${p3.y}z`;
}

/** Midpoint along a polyline (by length). */
export function polylineMid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg >= total / 2 && seg) {
      const t = (total / 2 - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  return points[0]!;
}
