/**
 * Choreography activities carry participant bands: BPMNShapes whose
 * `bpmnElement` is a participant and whose `choreographyActivityShape` points
 * to the activity's shape. The editor keeps them on the activity diagram
 * element (`bands`) and re-stacks them whenever the activity moves or resizes.
 *
 * Bands sit in an upper and a lower section with the name band between them
 * (BPMN 2.0.2 Fig 11.8, 11.21): the top band and further ("middle") bands of
 * the upper section stack downwards, the bottom band and the middle bands of
 * the lower section upwards. The section of a middle band is read from its DI
 * bounds: the bands contiguous with the topmost band form the upper section.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { readBounds, type Bounds } from '@/bpmn/di/di';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';

export const BAND_HEIGHT = 20;
/** Room for the activity name and its markers between the band sections. */
export const MIN_NAME_BAND = 30;

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

export type BandPosition = 'top' | 'middle' | 'bottom';

export function bandPosition(band: ModdleElement): BandPosition {
  return bandKind(band).split('_')[0] as BandPosition;
}

export function makeBandKind(position: BandPosition, initiating: boolean): BandKind {
  return `${position}_${initiating ? 'initiating' : 'non_initiating'}` as BandKind;
}

function bandHeight(band: ModdleElement): number {
  return readBounds(band)?.height || BAND_HEIGHT;
}

export interface BandSections {
  upper: ModdleElement[];
  lower: ModdleElement[];
}

/**
 * The bands of the upper and lower section, each top to bottom. Top bands are
 * always upper, bottom bands lower; middle bands are upper when their DI bounds
 * are contiguous with the topmost band. Middle bands without bounds go to the
 * smaller section (upper first), so added bands alternate (PDF 361).
 */
export function bandSections(bands: ModdleElement[]): BandSections {
  const placed = bands.filter((b) => readBounds(b));
  const byY = [...placed].sort((a, b) => readBounds(a)!.y - readBounds(b)!.y);
  const contiguous = new Set<ModdleElement>();
  let end: number | undefined;
  for (const b of byY) {
    const r = readBounds(b)!;
    if (end !== undefined && r.y > end + 1) break;
    contiguous.add(b);
    end = Math.max(end ?? r.y, r.y + r.height);
  }
  const yOf = (b: ModdleElement) => readBounds(b)?.y ?? 0;
  const upper: ModdleElement[] = [];
  const lower: ModdleElement[] = [];
  const unplaced: ModdleElement[] = [];
  for (const b of bands) {
    const pos = bandPosition(b);
    if (pos === 'top') upper.push(b);
    else if (pos === 'bottom') lower.push(b);
    else if (!readBounds(b)) unplaced.push(b);
    else if (contiguous.has(b)) upper.push(b);
    else lower.push(b);
  }
  const rank = (b: ModdleElement) => {
    const pos = bandPosition(b);
    return pos === 'top' ? 0 : pos === 'bottom' ? 2 : 1;
  };
  upper.sort((a, b) => rank(a) - rank(b) || yOf(a) - yOf(b));
  lower.sort((a, b) => rank(a) - rank(b) || yOf(a) - yOf(b));
  for (const b of unplaced) {
    if (upper.length <= lower.length) upper.push(b);
    else lower.splice(Math.max(0, lower.length - 1), 0, b);
  }
  return { upper, lower };
}

/** Bands top to bottom. */
export function orderedBands(bands: ModdleElement[]): ModdleElement[] {
  const { upper, lower } = bandSections(bands);
  return [...upper, ...lower];
}

/** Band bounds for an activity: the upper section stacks downwards, the lower one upwards. */
export function layoutBands(activity: Bounds, bands: ModdleElement[]): Map<ModdleElement, Bounds> {
  const { upper, lower } = bandSections(bands);
  return layoutSections(activity, upper, lower);
}

export function layoutSections(
  activity: Bounds,
  upper: ModdleElement[],
  lower: ModdleElement[],
): Map<ModdleElement, Bounds> {
  const out = new Map<ModdleElement, Bounds>();
  let top = activity.y;
  for (const b of upper) {
    const h = bandHeight(b);
    out.set(b, { x: activity.x, y: top, width: activity.width, height: h });
    top += h;
  }
  let bottom = activity.y + activity.height;
  for (const b of [...lower].reverse()) {
    const h = bandHeight(b);
    bottom -= h;
    out.set(b, { x: activity.x, y: bottom, width: activity.width, height: h });
  }
  return out;
}

/** Total height of the bands of an activity. */
export function bandsHeight(bands: ModdleElement[]): number {
  return bands.reduce((sum, b) => sum + bandHeight(b), 0);
}

/** The name band between the sections (relative to the activity when `activity` is at 0,0). */
export function nameBand(activity: Bounds, bands: ModdleElement[]): Bounds {
  const layout = layoutBands(activity, bands);
  const { upper, lower } = bandSections(bands);
  const last = upper.at(-1);
  const first = lower[0];
  const top = last ? layout.get(last)!.y + layout.get(last)!.height : activity.y;
  const bottom = first ? layout.get(first)!.y : activity.y + activity.height;
  return { x: activity.x, y: top, width: activity.width, height: Math.max(0, bottom - top) };
}

/**
 * Whether participant bands may show their message (isMessageVisible, PDF
 * 355): choreography tasks and call choreographies calling a global
 * choreography task, never sub-choreographies or calls of a choreography.
 */
export function showsBandMessages(activity: ModdleElement | undefined): boolean {
  if (is(activity, 'bpmn:ChoreographyTask')) return true;
  return (
    is(activity, 'bpmn:CallChoreography') &&
    is(getRef(activity!, 'calledChoreographyRef'), 'bpmn:GlobalChoreographyTask')
  );
}

/** The message flows a participant sends in a choreography task. */
export function sentFlows(activity: ModdleElement, participant: ModdleElement): ModdleElement[] {
  return getMany(activity, 'messageFlowRef').filter((f) => getRef(f, 'sourceRef') === participant);
}

/**
 * A call choreography (or call conversation) shows the [+] marker when it
 * calls a Choreography (a Collaboration) rather than a Global Choreography
 * Task (a Global Conversation): Fig 11.25, Table 12.34.
 */
export function callsComposite(bo: ModdleElement | undefined): boolean {
  if (is(bo, 'bpmn:CallChoreography')) {
    const called = getRef(bo!, 'calledChoreographyRef');
    return !!called && !is(called, 'bpmn:GlobalChoreographyTask');
  }
  if (is(bo, 'bpmn:CallConversation')) {
    const called = getRef(bo!, 'calledCollaborationRef');
    return !!called && !is(called, 'bpmn:GlobalConversation');
  }
  return false;
}
