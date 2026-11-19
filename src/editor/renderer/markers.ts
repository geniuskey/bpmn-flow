/** Markers and icons drawn inside shapes: gateway and event markers, activity markers, task type icons. */
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import type { BpmnShape } from '../model';
import { isExpanded, isThrowing } from './visuals';
import { el, path, pentagonPath } from './svg';

export function drawGatewayMarker(gfx: SVGElement, shape: BpmnShape): void {
  const bo = shape.businessObject;
  const cx = shape.width / 2;
  const cy = shape.height / 2;
  const s = Math.min(shape.width, shape.height) * 0.22;
  if (is(bo, 'bpmn:ParallelGateway')) {
    path(gfx, `M${cx - s},${cy}H${cx + s}M${cx},${cy - s}V${cy + s}`, 'bf-marker');
  } else if (is(bo, 'bpmn:InclusiveGateway')) {
    el(gfx, 'circle', { cx, cy, r: s * 0.95 }, 'bf-marker');
  } else if (is(bo, 'bpmn:ComplexGateway')) {
    const d = s * 0.75;
    path(
      gfx,
      `M${cx - s},${cy}H${cx + s}M${cx},${cy - s}V${cy + s}M${cx - d},${cy - d}L${cx + d},${cy + d}M${cx + d},${cy - d}L${cx - d},${cy + d}`,
      'bf-marker',
    );
  } else if (is(bo, 'bpmn:EventBasedGateway')) {
    // Event-based: double ring + pentagon. Instantiating: single ring + pentagon,
    // or single ring + open cross for the parallel variant.
    const instantiate = bo.get('instantiate') === true;
    el(gfx, 'circle', { cx, cy, r: s * 1.2 }, 'bf-marker-thin');
    if (!instantiate) el(gfx, 'circle', { cx, cy, r: s * 0.95 }, 'bf-marker-thin');
    if (instantiate && bo.get('eventGatewayType') === 'Parallel') {
      const a = s * 0.75;
      const b = s * 0.22;
      path(
        gfx,
        `M${cx - b},${cy - a}H${cx + b}V${cy - b}H${cx + a}V${cy + b}H${cx + b}V${cy + a}H${cx - b}V${cy + b}H${cx - a}V${cy - b}H${cx - b}z`,
        'bf-marker-thin',
      );
    } else {
      path(gfx, pentagonPath(cx, cy, s * 0.55), 'bf-marker-thin');
    }
  } else if (shape.di.get('isMarkerVisible') === true) {
    // BPMN: the exclusive gateway "X" marker is optional and controlled by DI.
    const d = s * 0.8;
    path(
      gfx,
      `M${cx - d},${cy - d}L${cx + d},${cy + d}M${cx + d},${cy - d}L${cx - d},${cy + d}`,
      'bf-marker',
    );
  }
}

/** Marker for the (single) event definition: message envelope, timer clock, terminate dot. */
export function drawEventMarker(gfx: SVGElement, shape: BpmnShape): void {
  const defs = getMany(shape.businessObject, 'eventDefinitions');
  const def = defs[0];
  if (!def) return;
  const cx = shape.width / 2;
  const cy = shape.height / 2;
  const r = Math.min(shape.width, shape.height) / 2;
  const thrown = isThrowing(shape.businessObject);
  const cls = thrown ? 'bf-event-marker-filled' : 'bf-event-marker';
  if (defs.length > 1) {
    if (shape.businessObject.get('parallelMultiple') === true) {
      // Parallel Multiple: open cross (catching only).
      const a = r * 0.5;
      const b = r * 0.16;
      path(
        gfx,
        `M${cx - b},${cy - a}H${cx + b}V${cy - b}H${cx + a}V${cy + b}H${cx + b}V${cy + a}H${cx - b}V${cy + b}H${cx - a}V${cy - b}H${cx - b}z`,
        'bf-event-marker',
      );
    } else {
      // Multiple: pentagon, filled when thrown.
      path(gfx, pentagonPath(cx, cy, r * 0.52), cls);
    }
    return;
  }
  if (is(def, 'bpmn:MessageEventDefinition')) {
    const w = r * 0.95;
    const h = r * 0.65;
    const x = cx - w / 2;
    const y = cy - h / 2;
    path(gfx, `M${x},${y}h${w}v${h}h${-w}z`, thrown ? 'bf-event-marker-filled' : 'bf-event-marker');
    path(
      gfx,
      `M${x},${y}L${cx},${cy + h * 0.1}L${x + w},${y}`,
      thrown ? 'bf-event-marker-inverse' : 'bf-event-marker',
    );
  } else if (is(def, 'bpmn:TimerEventDefinition')) {
    el(gfx, 'circle', { cx, cy, r: r * 0.62 }, 'bf-event-marker');
    path(gfx, `M${cx},${cy - r * 0.45}V${cy}L${cx + r * 0.32},${cy + r * 0.18}`, 'bf-event-marker');
  } else if (is(def, 'bpmn:TerminateEventDefinition')) {
    el(gfx, 'circle', { cx, cy, r: r * 0.55 }, 'bf-event-marker-filled');
  } else if (is(def, 'bpmn:SignalEventDefinition')) {
    const t = r * 0.55;
    path(gfx, `M${cx},${cy - t}L${cx + t * 0.9},${cy + t * 0.6}H${cx - t * 0.9}z`, cls);
  } else if (is(def, 'bpmn:ErrorEventDefinition')) {
    const t = r * 0.5;
    path(
      gfx,
      `M${cx - t},${cy + t}L${cx - t * 0.4},${cy - t * 0.7}L${cx + t * 0.2},${cy + t * 0.1}L${cx + t},${cy - t}L${cx + t * 0.4},${cy + t * 0.7}L${cx - t * 0.2},${cy - t * 0.1}z`,
      cls,
    );
  } else if (is(def, 'bpmn:EscalationEventDefinition')) {
    const t = r * 0.55;
    path(
      gfx,
      `M${cx},${cy - t}L${cx + t * 0.6},${cy + t * 0.8}L${cx},${cy + t * 0.2}L${cx - t * 0.6},${cy + t * 0.8}z`,
      cls,
    );
  } else if (is(def, 'bpmn:ConditionalEventDefinition')) {
    const w = r * 0.8;
    const h = r * 1.0;
    const x = cx - w / 2;
    const y = cy - h / 2;
    path(gfx, `M${x},${y}h${w}v${h}h${-w}z`, 'bf-event-marker');
    path(
      gfx,
      [1, 2, 3, 4].map((k) => `M${x + 2},${y + (h * k) / 5}h${w - 4}`).join(''),
      'bf-event-marker',
    );
  } else if (is(def, 'bpmn:CompensateEventDefinition')) {
    const t = r * 0.45;
    path(
      gfx,
      `M${cx},${cy - t}L${cx - t},${cy}L${cx},${cy + t}zM${cx + t},${cy - t}L${cx},${cy}L${cx + t},${cy + t}z`,
      cls,
    );
  } else if (is(def, 'bpmn:CancelEventDefinition')) {
    const t = r * 0.42;
    if (thrown) {
      // Throwing markers are filled (Table 12.22): a solid X shape.
      const w = t * 0.32;
      path(
        gfx,
        `M${cx - t},${cy - t + w}L${cx - t + w},${cy - t}L${cx},${cy - w}L${cx + t - w},${cy - t}L${cx + t},${cy - t + w}L${cx + w},${cy}L${cx + t},${cy + t - w}L${cx + t - w},${cy + t}L${cx},${cy + w}L${cx - t + w},${cy + t}L${cx - t},${cy + t - w}L${cx - w},${cy}z`,
        'bf-event-marker-filled',
      );
    } else {
      path(
        gfx,
        `M${cx - t},${cy - t}L${cx + t},${cy + t}M${cx + t},${cy - t}L${cx - t},${cy + t}`,
        'bf-cancel-marker',
      );
    }
  } else if (is(def, 'bpmn:LinkEventDefinition')) {
    const t = r * 0.5;
    path(
      gfx,
      `M${cx - t},${cy - t * 0.35}H${cx + t * 0.1}V${cy - t * 0.75}L${cx + t},${cy}L${cx + t * 0.1},${cy + t * 0.75}V${cy + t * 0.35}H${cx - t}z`,
      cls,
    );
  }
}

/**
 * Bottom-center activity markers: loop, multi-instance, compensation, ad-hoc,
 * collapsed sub-process [+].
 */
export function drawActivityMarkers(
  gfx: SVGElement,
  shape: BpmnShape,
  extra: ('collapsed' | 'adhoc')[],
): void {
  const bo = shape.businessObject;
  // Order per BPMN 2.0.2 §12 / PDF 202–203: loop or multi-instance and
  // compensation left of the collapsed [+]; the ad-hoc tilde to its right.
  const markers: string[] = [];
  const loop = getRef(bo, 'loopCharacteristics');
  if (loop) {
    markers.push(
      is(loop, 'bpmn:StandardLoopCharacteristics')
        ? 'loop'
        : loop.get('isSequential') === true
          ? 'sequential'
          : 'parallel',
    );
  }
  if (bo.get('isForCompensation') === true) markers.push('compensation');
  if (
    (is(bo, 'bpmn:SubProcess') && !isExpanded(shape)) ||
    (is(bo, 'bpmn:CallActivity') &&
      is(calledElementOf(bo), 'bpmn:Process') &&
      shape.di.get('isExpanded') !== true)
  ) {
    markers.push('collapsed');
  }
  markers.push(...extra);
  const size = 14;
  const gap = 4;
  let x = shape.width / 2 - (markers.length * size + (markers.length - 1) * gap) / 2;
  const y = shape.height - size - 5;
  for (const m of markers) {
    const g = el(gfx, 'g', { transform: `translate(${x}, ${y})` }, 'bf-icon');
    switch (m) {
      case 'collapsed':
        path(g, 'M0,0h14v14h-14z', 'bf-icon-stroke');
        path(g, 'M3,7h8M7,3v8', 'bf-icon-stroke');
        break;
      case 'loop':
        path(g, 'M11.5,4.5A5.5,5.5 0 1 0 12.5,9', 'bf-icon-stroke');
        path(g, 'M9,4.5h3v-3', 'bf-icon-stroke');
        break;
      case 'parallel':
        path(g, 'M3,1v12M7,1v12M11,1v12', 'bf-icon-stroke');
        break;
      case 'sequential':
        path(g, 'M1,3h12M1,7h12M1,11h12', 'bf-icon-stroke');
        break;
      case 'compensation':
        path(g, 'M7,2L1,7L7,12zM13,2L7,7L13,12z', 'bf-icon-stroke');
        break;
      case 'adhoc':
        path(g, 'M1,8c2-4 4-4 6,0s4,4 6,0', 'bf-icon-stroke');
        break;
    }
    x += size + gap;
  }
}

/** The process or global task a call activity calls (`calledElement` is an id / QName). */
export function calledElementOf(bo: ModdleElement): ModdleElement | undefined {
  const ref = bo.get('calledElement');
  if (typeof ref !== 'string' || !ref) return undefined;
  const local = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  let defs: ModdleElement | undefined = bo;
  while (defs?.$parent) defs = defs.$parent;
  return getMany(defs, 'rootElements').find((r) => r.id === local);
}

/**
 * Icon type for an activity. A call activity calling a global task shows that
 * task's marker (BPMN 2.0.2 Table 12.18): GlobalUserTask → user task, etc.
 */
export function iconType(bo: ModdleElement): string {
  if (!is(bo, 'bpmn:CallActivity')) return bo.$type;
  const called = calledElementOf(bo);
  const m = called?.$type.match(/^bpmn:Global(User|Manual|Script|BusinessRule)Task$/);
  return m ? `bpmn:${m[1]}Task` : bo.$type;
}

/**
 * A collapsed event sub-process shows its start event (trigger marker, dashed
 * when non-interrupting) in the upper left corner (BPMN 2.0.2 PDF 204).
 */
export function drawEventSubProcessTrigger(gfx: SVGElement, sub: ModdleElement): void {
  const start = getMany(sub, 'flowElements').find((f) => is(f, 'bpmn:StartEvent'));
  if (!start) return;
  const g = el(gfx, 'g', { transform: 'translate(5, 5)' }, 'bf-event-subprocess-trigger');
  const nonInterrupting = start.get('isInterrupting') === false;
  el(
    g,
    'circle',
    { cx: 9, cy: 9, r: 8.5 },
    nonInterrupting
      ? 'bf-shape bf-event bf-start-event bf-non-interrupting'
      : 'bf-shape bf-event bf-start-event',
  );
  drawEventMarker(g, { width: 18, height: 18, businessObject: start } as BpmnShape);
}

export function drawTaskIcon(gfx: SVGElement, type: string, bo?: ModdleElement): void {
  switch (type) {
    case 'bpmn:UserTask':
      return drawUserIcon(gfx);
    case 'bpmn:ServiceTask':
      return drawServiceIcon(gfx);
    case 'bpmn:SendTask':
    case 'bpmn:ReceiveTask': {
      // An instantiating receive task looks like a message start event (PDF 189).
      if (type === 'bpmn:ReceiveTask' && bo?.get('instantiate') === true) {
        el(gfx, 'circle', { cx: 16, cy: 14, r: 10 }, 'bf-icon-stroke');
      }
      const g = el(gfx, 'g', { transform: 'translate(8, 9)' }, 'bf-icon');
      const filled = type === 'bpmn:SendTask';
      path(g, 'M0,0h16v11h-16z', filled ? 'bf-icon-filled' : 'bf-icon-stroke');
      path(g, 'M0,0L8,6L16,0', filled ? 'bf-icon-inverse' : 'bf-icon-stroke');
      return;
    }
    case 'bpmn:ManualTask': {
      const g = el(gfx, 'g', { transform: 'translate(8, 8)' }, 'bf-icon');
      path(
        g,
        'M1,8c0-2 2-3 3-2V2c0-1.3 2-1.3 2 0v4V1c0-1.3 2-1.3 2 0v5V2c0-1.3 2-1.3 2 0v5V4c0-1.3 2-1.3 2 0v6c0 3-2 5-5 5H7c-2 0-3-1-4-2z',
        'bf-icon-stroke',
      );
      return;
    }
    case 'bpmn:BusinessRuleTask': {
      const g = el(gfx, 'g', { transform: 'translate(8, 9)' }, 'bf-icon');
      path(g, 'M0,0h16v12h-16z', 'bf-icon-stroke');
      path(g, 'M0,4h16M0,8h16M5,4v8', 'bf-icon-stroke');
      return;
    }
    case 'bpmn:ScriptTask': {
      const g = el(gfx, 'g', { transform: 'translate(8, 7)' }, 'bf-icon');
      path(g, 'M3,0h11c-3,3 -3,6 0,9s3,6 0,7H3c3-1 3-4 0-7s-3-6 0-9z', 'bf-icon-stroke');
      path(g, 'M5,4h6M5.5,8h6M6,12h6', 'bf-icon-stroke');
      return;
    }
  }
}

export function drawUserIcon(gfx: SVGElement): void {
  const g = el(gfx, 'g', { transform: 'translate(8, 8)' }, 'bf-icon');
  el(g, 'circle', { cx: 7, cy: 5, r: 3.5 }, 'bf-icon-stroke');
  path(g, 'M1,15c0-3.3 2.7-6 6-6s6,2.7 6,6', 'bf-icon-stroke');
}

export function drawServiceIcon(gfx: SVGElement): void {
  const g = el(gfx, 'g', { transform: 'translate(8, 8)' }, 'bf-icon');
  // Cog: dashed thick ring forms the teeth, inner ring forms the hub.
  el(g, 'circle', { cx: 7, cy: 7, r: 5.5, 'stroke-dasharray': '2.2 2.12' }, 'bf-icon-teeth');
  el(g, 'circle', { cx: 7, cy: 7, r: 4 }, 'bf-icon-stroke');
  el(g, 'circle', { cx: 7, cy: 7, r: 1.6 }, 'bf-icon-stroke');
}
