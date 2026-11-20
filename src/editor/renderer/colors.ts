/**
 * Applies DI color extensions (`color:*`, `bioc:*`, see readDiColors) to one
 * element's graphics. The renderer styles everything through `--bf-*` CSS
 * variables, so an element is recolored by redefining those variables on its
 * own `.djs-visual` group; the rest of the canvas keeps following the theme.
 *
 * As in bpmn-js, text inside a shape takes the label color, else the stroke
 * color. Labels outside the shape (events, gateways, data, flows) only take an
 * explicit label color, so they stay readable on the canvas in both themes.
 */
import { classes as svgClasses } from 'tiny-svg';
import { readDiColors } from '@/bpmn/di/di';
import type { ModdleElement } from '@/bpmn/model/moddle';

const FILL_VARS = [
  '--bf-shape-fill',
  '--bf-activity-fill',
  '--bf-gateway-fill',
  '--bf-pool-fill',
  '--bf-pool-band',
];
const SHAPE_STROKE_VARS = [
  '--bf-shape-stroke',
  '--bf-event-start',
  '--bf-event-end',
  '--bf-gateway',
  '--bf-muted',
  '--bf-connection',
];
const EDGE_STROKE_VARS = ['--bf-connection', '--bf-shape-stroke'];
const TEXT_VARS = ['--bf-di-text', '--bf-di-label'];
const ALL_VARS = [...new Set([...FILL_VARS, ...SHAPE_STROKE_VARS, ...TEXT_VARS])];

export function applyDiColors(
  gfx: SVGElement,
  di: ModdleElement | undefined,
  kind: 'shape' | 'edge',
): void {
  // The same visual group is reused when an element is redrawn (e.g. on undo).
  const style = gfx.style;
  for (const name of ALL_VARS) style.removeProperty(name);
  svgClasses(gfx).remove('bf-di-fill').remove('bf-di-text');

  const colors = readDiColors(di);
  if (!colors) return;
  if (colors.fill) {
    for (const name of kind === 'shape' ? FILL_VARS : ['--bf-shape-fill']) {
      style.setProperty(name, colors.fill);
    }
    svgClasses(gfx).add('bf-di-fill');
  }
  if (colors.stroke) {
    for (const name of kind === 'shape' ? SHAPE_STROKE_VARS : EDGE_STROKE_VARS) {
      style.setProperty(name, colors.stroke);
    }
  }
  const text = colors.label ?? colors.stroke;
  if (text) {
    style.setProperty('--bf-di-text', text);
    if (colors.label) style.setProperty('--bf-di-label', colors.label);
    svgClasses(gfx).add('bf-di-text');
  }
}
