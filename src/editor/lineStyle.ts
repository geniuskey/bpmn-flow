/**
 * The line style shared by the renderer (rounded / curved bends) and the
 * connection layouter (straight routes). The controller owns the state and
 * hands the same object to each diagram it opens.
 */
import type { LineStyle } from './layout/graph';

export interface LineStyleState {
  style: LineStyle;
}

/** The `lineStyle` service of a diagram, or orthogonal lines when there is none. */
export function lineStyleState(injector: {
  get(name: string, strict?: boolean): unknown;
}): LineStyleState {
  return (injector.get('lineStyle', false) as LineStyleState | null) ?? { style: 'orthogonal' };
}
