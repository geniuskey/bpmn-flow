/** Color presets and value helpers for the Inspector's color fields. */

/** Light fill + dark stroke pairs, the same set Camunda Modeler offers. */
export const COLOR_PRESETS = [
  { name: 'Blue', fill: '#bbdefb', stroke: '#0d4372' },
  { name: 'Orange', fill: '#ffe0b2', stroke: '#6b3c00' },
  { name: 'Green', fill: '#c8e6c9', stroke: '#205022' },
  { name: 'Red', fill: '#ffcdd2', stroke: '#831311' },
  { name: 'Purple', fill: '#e1bee7', stroke: '#5b176d' },
] as const;

/** `<input type="color">` only takes #rrggbb; other CSS colors are normalized when possible. */
export function toHex6(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]?$/.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{8}$/.test(value)) return value.slice(0, 7);
  try {
    // Paint one pixel and read it back: this normalizes any CSS color the
    // browser knows (named, rgb(), hsl(), oklch(), color-mix() results, …).
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    // An invalid color leaves fillStyle unchanged, so it differs between two
    // different starting values; a valid one overwrites both alike.
    ctx.fillStyle = '#000000';
    ctx.fillStyle = value;
    const first = ctx.fillStyle;
    ctx.fillStyle = '#ffffff';
    ctx.fillStyle = value;
    if (ctx.fillStyle !== first) return undefined;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return undefined;
  }
}
