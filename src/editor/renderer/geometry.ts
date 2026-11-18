/** SVG path builders used for hit-testing, connection cropping and drawing. */
import type { Point } from '@/bpmn/di/di';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Outline = 'circle' | 'diamond' | 'roundRect' | 'rect';

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
  }
}

export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
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
