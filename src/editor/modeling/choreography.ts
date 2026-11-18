/**
 * Choreography activities carry participant bands: BPMNShapes whose
 * `bpmnElement` is a participant and whose `choreographyActivityShape` points
 * to the activity's shape. The editor keeps them on the activity diagram
 * element (`bands`) and re-stacks them whenever the activity moves or resizes.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { readBounds, type Bounds } from '@/bpmn/di/di';
import type { ModdleElement } from '@/bpmn/model/moddle';

export const BAND_HEIGHT = 20;

export type BandKind =
  | 'top_initiating'
  | 'middle_initiating'
  | 'bottom_initiating'
  | 'top_non_initiating'
  | 'middle_non_initiating'
  | 'bottom_non_initiating';

export function bandsOf(element: Element): ModdleElement[] {
  return (element as { bands?: ModdleElement[] }).bands ?? [];
}

export function bandKind(band: ModdleElement): BandKind {
  return (band.get('participantBandKind') as BandKind | undefined) ?? 'top_initiating';
}

export function isInitiatingBand(band: ModdleElement): boolean {
  return bandKind(band).endsWith('_initiating') && !bandKind(band).endsWith('non_initiating');
}

/** Band bounds for an activity: top bands stack downwards, bottom bands upwards. */
export function layoutBands(activity: Bounds, bands: ModdleElement[]): Map<ModdleElement, Bounds> {
  const out = new Map<ModdleElement, Bounds>();
  const height = (b: ModdleElement) => readBounds(b)?.height || BAND_HEIGHT;
  let top = activity.y;
  for (const b of bands.filter((x) => !bandKind(x).startsWith('bottom'))) {
    const h = height(b);
    out.set(b, { x: activity.x, y: top, width: activity.width, height: h });
    top += h;
  }
  let bottom = activity.y + activity.height;
  for (const b of [...bands.filter((x) => bandKind(x).startsWith('bottom'))].reverse()) {
    const h = height(b);
    bottom -= h;
    out.set(b, { x: activity.x, y: bottom, width: activity.width, height: h });
  }
  return out;
}
