/**
 * Renders BPMN shapes with a modern, theme-aware style while keeping the BPMN
 * notation (circle = event, rounded rectangle = activity, diamond = gateway).
 *
 * Colors are not hard-coded: every SVG node gets `bf-*` classes that are styled
 * by CSS variables in src/styles/canvas.css, so theme switches need no redraw.
 */
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import Text from 'diagram-js/lib/util/Text';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import {
  append as svgAppend,
  attr as svgAttr,
  classes as svgClasses,
  create as svgCreate,
} from 'tiny-svg';
import { readLabelBounds } from '@/bpmn/di/di';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import type { BpmnConnection, BpmnShape } from '../model';
import { arrowHeadPath, outlinePath, polylineMid, polylinePath, startMarkerPath } from './geometry';
import { hasExternalLabel, isCollection, isExpanded, isThrowing, visualFor } from './visuals';
import { bandKind, bandsOf, isInitiatingBand, layoutBands } from '../modeling/choreography';

export const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_SIZE = 12;

function el<K extends keyof SVGElementTagNameMap>(
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
function pentagonPath(cx: number, cy: number, r: number): string {
  const pts = [0, 1, 2, 3, 4].map((k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  });
  return `M${pts.join('L')}z`;
}

function path(parent: SVGElement, d: string, className: string): SVGPathElement {
  return el(parent, 'path', { d }, className);
}

export default class BpmnFlowRenderer extends BaseRenderer {
  static $inject = ['eventBus'];

  private readonly text = new Text({
    style: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, lineHeight: 1.25 },
  });

  constructor(eventBus: EventBus) {
    super(eventBus, 1500);
  }

  override canRender(element: Element): boolean {
    return !!(element as Partial<BpmnShape>).businessObject;
  }

  override getShapePath(shape: Shape): string {
    const { businessObject } = shape as BpmnShape;
    const visual = visualFor(businessObject, false);
    return outlinePath(visual.outline, shape);
  }

  override getConnectionPath(connection: Connection): string {
    return polylinePath(connection.waypoints);
  }

  override drawShape(gfx: SVGElement, element: Shape): SVGElement {
    const shape = element as BpmnShape;
    const bo = shape.businessObject;
    const visual = visualFor(bo, false);
    const box = { x: 0, y: 0, width: shape.width, height: shape.height };
    const unsupported = visual.kind === 'unsupportedShape' ? ' bf-unsupported' : '';
    let main: SVGElement;

    switch (visual.kind) {
      case 'event':
        main = this.drawEvent(gfx, shape);
        break;
      case 'activity': {
        const call = is(bo, 'bpmn:CallActivity') ? ' bf-call-activity' : '';
        main = path(gfx, outlinePath('roundRect', box), `bf-shape bf-activity${call}`);
        this.drawTaskIcon(gfx, bo.$type);
        this.drawCenteredText(gfx, bo.name, box, 'bf-label');
        this.drawActivityMarkers(gfx, shape, []);
        break;
      }
      case 'subProcess': {
        const eventSub = bo.get('triggeredByEvent') === true ? ' bf-event-subprocess' : '';
        main = path(
          gfx,
          outlinePath('roundRect', box),
          `bf-shape bf-activity bf-subprocess${eventSub}`,
        );
        if (is(bo, 'bpmn:Transaction')) {
          path(
            gfx,
            outlinePath('roundRect', {
              x: 3,
              y: 3,
              width: shape.width - 6,
              height: shape.height - 6,
            }),
            'bf-transaction-inner',
          );
        }
        const extra: ('collapsed' | 'adhoc')[] = [];
        if (is(bo, 'bpmn:AdHocSubProcess')) extra.push('adhoc');
        this.drawActivityMarkers(gfx, shape, extra);
        if (isExpanded(bo, shape.di)) {
          this.drawCenteredText(
            gfx,
            bo.name,
            { x: 0, y: 0, width: shape.width, height: 26 },
            'bf-label',
            'center-top',
          );
        } else {
          this.drawCenteredText(gfx, bo.name, box, 'bf-label');
        }
        break;
      }
      case 'gateway':
        main = path(gfx, outlinePath('diamond', box), 'bf-shape bf-gateway');
        this.drawGatewayMarker(gfx, shape);
        break;
      case 'participant':
        main = getRef(bo, 'processRef')
          ? this.drawPool(gfx, shape, 'bf-participant')
          : this.drawBlackBoxPool(gfx, shape);
        break;
      case 'lane':
        main = this.drawPool(gfx, shape, 'bf-lane');
        break;
      case 'textAnnotation': {
        main = path(gfx, outlinePath('rect', box), 'bf-annotation-hit');
        path(gfx, `M14,0H0V${shape.height}H14`, 'bf-annotation');
        const text = (bo as unknown as { text?: string }).text;
        if (text) {
          const node = this.text.createText(text, {
            box: { width: shape.width, height: shape.height },
            align: 'left-top' as never, // supported at runtime, missing from the typings
            padding: 6,
          });
          svgClasses(node).add('bf-label');
          svgAppend(gfx, node);
        }
        break;
      }
      case 'group': {
        main = path(gfx, outlinePath('roundRect', box), 'bf-group');
        const value = getRef(bo, 'categoryValueRef') as
          (ModdleElement & { value?: string }) | undefined;
        if (value?.value) {
          this.drawCenteredText(
            gfx,
            value.value,
            { x: 0, y: 0, width: shape.width, height: 24 },
            'bf-label bf-group-label',
            'center-top',
          );
        }
        break;
      }
      case 'dataObject': {
        const w = shape.width;
        const h = shape.height;
        const f = Math.min(10, w / 3);
        main = path(gfx, `M0,0H${w - f}L${w},${f}V${h}H0z`, 'bf-shape bf-data');
        path(gfx, `M${w - f},0V${f}H${w}`, 'bf-data-fold');
        if (is(bo, 'bpmn:DataInput') || is(bo, 'bpmn:DataOutput')) {
          // Data input: hollow arrow; data output: filled arrow (top-left corner).
          path(
            gfx,
            'M4,7h6v-3l6,6l-6,6v-3h-6z',
            is(bo, 'bpmn:DataOutput') ? 'bf-event-marker-filled' : 'bf-event-marker',
          );
        }
        if (isCollection(bo)) {
          // Collection: three vertical bars at the bottom center.
          const x = w / 2;
          const y = h - 12;
          path(gfx, `M${x - 4},${y}v8M${x},${y}v8M${x + 4},${y}v8`, 'bf-collection-marker');
        }
        break;
      }
      case 'dataStore': {
        const w = shape.width;
        const h = shape.height;
        const ry = Math.min(8, h / 6);
        main = path(
          gfx,
          `M0,${ry}A${w / 2},${ry} 0 0,1 ${w},${ry}V${h - ry}A${w / 2},${ry} 0 0,1 0,${h - ry}z`,
          'bf-shape bf-data',
        );
        path(
          gfx,
          `M0,${ry}A${w / 2},${ry} 0 0,0 ${w},${ry}M0,${ry * 2}A${w / 2},${ry} 0 0,0 ${w},${ry * 2}`,
          'bf-data-fold',
        );
        break;
      }
      case 'choreography': {
        main = this.drawChoreography(gfx, shape);
        break;
      }
      case 'conversation': {
        const call = is(bo, 'bpmn:CallConversation') ? ' bf-call-conversation' : '';
        main = path(gfx, outlinePath('hexagon', box), `bf-shape bf-conversation${call}`);
        if (is(bo, 'bpmn:SubConversation')) {
          const cx = shape.width / 2;
          const by = shape.height - 14;
          path(gfx, `M${cx - 5},${by}h10v10h-10z`, 'bf-icon-stroke');
          path(gfx, `M${cx - 3},${by + 5}h6M${cx},${by + 2}v6`, 'bf-icon-stroke');
        }
        break;
      }
      default:
        main = path(gfx, outlinePath(visual.outline, box), `bf-shape${unsupported}`);
        if (visual.outline === 'roundRect' || visual.outline === 'rect') {
          this.drawCenteredText(gfx, bo.name, box, 'bf-label');
          this.drawCaption(gfx, visual.caption ?? bo.$type);
        }
        this.drawTitle(gfx, `${visual.caption ?? bo.$type} — not editable in BPMN Flow yet`);
    }

    if (hasExternalLabel(bo)) this.drawExternalLabel(gfx, shape);
    return main;
  }

  override drawConnection(gfx: SVGElement, element: Connection): SVGElement {
    const connection = element as BpmnConnection;
    const bo = connection.businessObject;
    const visual = visualFor(bo, true);
    const points = connection.waypoints;
    const unsupported = visual.kind === 'unsupportedConnection' ? ' bf-unsupported' : '';
    const message = visual.kind === 'messageFlow' ? ' bf-message-flow' : '';
    const line = path(gfx, polylinePath(points), `bf-connection${unsupported}${message}`);
    if (message && points.length > 1) {
      const a = points[0]!;
      el(gfx, 'circle', { cx: a.x, cy: a.y, r: 4 }, 'bf-message-start');
      const head = arrowHeadPath(points);
      if (head) path(gfx, head, 'bf-message-arrow');
      if (getRef(bo, 'messageRef')) {
        // Envelope at the middle; shaded for a non-initiating (reply) message.
        const mid = polylineMid(points);
        const shaded = connection.di?.get('messageVisibleKind') === 'non_initiating';
        const g = el(
          gfx,
          'g',
          { transform: `translate(${mid.x - 10}, ${mid.y - 7})` },
          shaded ? 'bf-message-envelope bf-non-initiating' : 'bf-message-envelope',
        );
        path(g, 'M0,0h20v14h-20z', 'bf-envelope-body');
        path(g, 'M0,0L10,7L20,0', 'bf-envelope-flap');
      }
    }
    if (unsupported) this.drawTitle(gfx, `${bo.$type} — not editable in BPMN Flow yet`);
    if (visual.kind === 'association') {
      svgClasses(line).add('bf-association');
      if (bo.get('associationDirection') === 'One' || bo.get('associationDirection') === 'Both') {
        const head = arrowHeadPath(points, 9, 5);
        if (head) path(gfx, head, 'bf-open-arrow');
      }
    }
    if (visual.kind === 'conversationLink') {
      svgClasses(line).add('bf-conversation-link');
    }
    if (visual.kind === 'dataAssociation') {
      svgClasses(line).add('bf-association');
      const head = arrowHeadPath(points, 9, 5);
      if (head) path(gfx, head, 'bf-open-arrow');
    }

    if (visual.kind === 'sequenceFlow') {
      const head = arrowHeadPath(points);
      if (head) path(gfx, head, 'bf-arrow');
      const source = getRef(bo, 'sourceRef');
      const isDefault = source && getRef(source, 'default') === bo;
      const isConditional =
        !!getRef(bo, 'conditionExpression') && source && is(source, 'bpmn:Activity');
      if (isDefault) {
        const d = startMarkerPath(points, 'slash');
        if (d) path(gfx, d, 'bf-connection-marker');
      } else if (isConditional) {
        const d = startMarkerPath(points, 'diamond');
        if (d) path(gfx, d, 'bf-conditional-marker');
      }
    }

    if (bo.name) {
      const label = readLabelBounds(connection.di);
      const mid = polylineMid(points);
      const box = label
        ? { x: label.x, y: label.y, width: Math.max(label.width, 40), height: label.height }
        : { x: mid.x - 45, y: mid.y - 22, width: 90, height: 18 };
      this.drawCenteredText(
        gfx,
        bo.name,
        box,
        'bf-label bf-flow-label',
        label ? 'center-top' : 'center-middle',
      );
    }
    return line;
  }

  private drawCenteredText(
    gfx: SVGElement,
    text: string | undefined,
    box: { x: number; y: number; width: number; height: number },
    className: string,
    align: 'center-middle' | 'center-top' = 'center-middle',
  ): void {
    if (!text) return;
    const node = this.text.createText(text, {
      box: { width: box.width, height: box.height },
      align,
      padding: 6,
    });
    svgAttr(node, { transform: `translate(${box.x}, ${box.y})` });
    for (const c of className.split(' ')) svgClasses(node).add(c);
    svgAppend(gfx, node);
  }

  /** Label below events/gateways; uses BPMN DI label bounds when present. */
  private drawExternalLabel(gfx: SVGElement, shape: BpmnShape): void {
    const bo = shape.businessObject;
    const state =
      is(bo, 'bpmn:DataObjectReference') || is(bo, 'bpmn:DataStoreReference')
        ? (getRef(bo, 'dataState')?.name as string | undefined)
        : undefined;
    const name = [bo.name, state && `[${state}]`].filter(Boolean).join('\n');
    if (!name) return;
    const label = readLabelBounds(shape.di);
    const width = Math.max(label?.width ?? 0, 90);
    const box = label
      ? {
          x: label.x - shape.x - (width - label.width) / 2,
          y: label.y - shape.y,
          width,
          height: label.height,
        }
      : { x: shape.width / 2 - width / 2, y: shape.height + 6, width, height: 30 };
    this.drawCenteredText(gfx, name, box, 'bf-label bf-external-label', 'center-top');
  }

  /** Type caption inside the top-left corner of unsupported boxes. */
  private drawCaption(gfx: SVGElement, caption: string): void {
    const node = el(gfx, 'text', { x: 8, y: 14 }, 'bf-caption');
    node.textContent = caption;
  }

  /** Native hover tooltip. */
  private drawTitle(gfx: SVGElement, text: string): void {
    const node = el(gfx, 'title', {}, '');
    node.textContent = text;
  }

  private drawGatewayMarker(gfx: SVGElement, shape: BpmnShape): void {
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

  /** Event circle(s) by event type, plus the definition marker. */
  private drawEvent(gfx: SVGElement, shape: BpmnShape): SVGElement {
    const bo = shape.businessObject;
    const box = { x: 0, y: 0, width: shape.width, height: shape.height };
    let main: SVGElement;
    if (is(bo, 'bpmn:StartEvent')) {
      const nonInterrupting = bo.get('isInterrupting') === false ? ' bf-non-interrupting' : '';
      main = path(
        gfx,
        outlinePath('circle', box),
        `bf-shape bf-event bf-start-event${nonInterrupting}`,
      );
    } else if (is(bo, 'bpmn:EndEvent')) {
      main = path(gfx, outlinePath('circle', box), 'bf-shape bf-event bf-end-event');
    } else {
      const nonInterrupting =
        is(bo, 'bpmn:BoundaryEvent') && bo.get('cancelActivity') === false
          ? ' bf-non-interrupting'
          : '';
      main = path(
        gfx,
        outlinePath('circle', box),
        `bf-shape bf-event bf-intermediate-event${nonInterrupting}`,
      );
      const inset = 3;
      path(
        gfx,
        outlinePath('circle', {
          x: inset,
          y: inset,
          width: shape.width - 2 * inset,
          height: shape.height - 2 * inset,
        }),
        `bf-intermediate-inner${nonInterrupting}`,
      );
    }
    this.drawEventMarker(gfx, shape);
    return main;
  }

  /** Marker for the (single) event definition: message envelope, timer clock, terminate dot. */
  private drawEventMarker(gfx: SVGElement, shape: BpmnShape): void {
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
      path(
        gfx,
        `M${x},${y}h${w}v${h}h${-w}z`,
        thrown ? 'bf-event-marker-filled' : 'bf-event-marker',
      );
      path(
        gfx,
        `M${x},${y}L${cx},${cy + h * 0.1}L${x + w},${y}`,
        thrown ? 'bf-event-marker-inverse' : 'bf-event-marker',
      );
    } else if (is(def, 'bpmn:TimerEventDefinition')) {
      el(gfx, 'circle', { cx, cy, r: r * 0.62 }, 'bf-event-marker');
      path(
        gfx,
        `M${cx},${cy - r * 0.45}V${cy}L${cx + r * 0.32},${cy + r * 0.18}`,
        'bf-event-marker',
      );
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
      path(
        gfx,
        `M${cx - t},${cy - t}L${cx + t},${cy + t}M${cx + t},${cy - t}L${cx - t},${cy + t}`,
        thrown ? 'bf-cancel-marker-filled' : 'bf-cancel-marker',
      );
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
  private drawActivityMarkers(
    gfx: SVGElement,
    shape: BpmnShape,
    extra: ('collapsed' | 'adhoc')[],
  ): void {
    const bo = shape.businessObject;
    const markers: string[] = [];
    if (is(bo, 'bpmn:SubProcess') && !isExpanded(bo, shape.di)) markers.push('collapsed');
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

  private drawTaskIcon(gfx: SVGElement, type: string): void {
    switch (type) {
      case 'bpmn:UserTask':
        return this.drawUserIcon(gfx);
      case 'bpmn:ServiceTask':
        return this.drawServiceIcon(gfx);
      case 'bpmn:SendTask':
      case 'bpmn:ReceiveTask': {
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

  private drawUserIcon(gfx: SVGElement): void {
    const g = el(gfx, 'g', { transform: 'translate(8, 8)' }, 'bf-icon');
    el(g, 'circle', { cx: 7, cy: 5, r: 3.5 }, 'bf-icon-stroke');
    path(g, 'M1,15c0-3.3 2.7-6 6-6s6,2.7 6,6', 'bf-icon-stroke');
  }

  private drawServiceIcon(gfx: SVGElement): void {
    const g = el(gfx, 'g', { transform: 'translate(8, 8)' }, 'bf-icon');
    // Cog: dashed thick ring forms the teeth, inner ring forms the hub.
    el(g, 'circle', { cx: 7, cy: 7, r: 5.5, 'stroke-dasharray': '2.2 2.12' }, 'bf-icon-teeth');
    el(g, 'circle', { cx: 7, cy: 7, r: 4 }, 'bf-icon-stroke');
    el(g, 'circle', { cx: 7, cy: 7, r: 1.6 }, 'bf-icon-stroke');
  }

  /** Choreography activity: rounded box with participant bands (shaded when not initiating). */
  private drawChoreography(gfx: SVGElement, shape: BpmnShape): SVGElement {
    const bo = shape.businessObject;
    const box = { x: 0, y: 0, width: shape.width, height: shape.height };
    const call = is(bo, 'bpmn:CallChoreography') ? ' bf-call-activity' : '';
    const main = path(
      gfx,
      outlinePath('roundRect', box),
      `bf-shape bf-activity bf-choreography${call}`,
    );
    const layout = layoutBands(shape, bandsOf(shape));
    let topEnd = 0;
    let bottomStart = shape.height;
    for (const [band, abs] of layout) {
      const b = { x: 0, y: abs.y - shape.y, width: shape.width, height: abs.height };
      const shaded = !isInitiatingBand(band);
      const isTop = !bandKind(band).startsWith('bottom');
      if (isTop) topEnd = Math.max(topEnd, b.y + b.height);
      else bottomStart = Math.min(bottomStart, b.y);
      path(
        gfx,
        isTop ? `M0,${b.y + b.height}H${shape.width}` : `M0,${b.y}H${shape.width}`,
        'bf-band-divider',
      );
      if (shaded) {
        el(
          gfx,
          'rect',
          {
            x: 1,
            y: b.y + (isTop ? 1 : 0),
            width: shape.width - 2,
            height: b.height - 1,
            rx: isTop ? 0 : 0,
          },
          'bf-band-shade',
        );
      }
      const participant = getRef(band, 'bpmnElement');
      this.drawCenteredText(gfx, participant?.name ?? participant?.id, b, 'bf-label bf-band-label');
    }
    const middle = {
      x: 0,
      y: topEnd,
      width: shape.width,
      height: Math.max(10, bottomStart - topEnd),
    };
    this.drawCenteredText(gfx, bo.name, middle, 'bf-label');
    if (is(bo, 'bpmn:SubChoreography') && shape.di.get('isExpanded') === false) {
      const cx = shape.width / 2;
      const by = bottomStart - 16;
      path(gfx, `M${cx - 6},${by}h12v12h-12z`, 'bf-icon-stroke');
      path(gfx, `M${cx - 3},${by + 6}h6M${cx},${by + 3}v6`, 'bf-icon-stroke');
    }
    return main;
  }

  /** Black-box pool (no process): a plain rectangle with the name in the middle. */
  private drawBlackBoxPool(gfx: SVGElement, shape: BpmnShape): SVGElement {
    const box = { x: 0, y: 0, width: shape.width, height: shape.height };
    const main = path(gfx, outlinePath('rect', box), 'bf-shape bf-participant bf-black-box');
    const name = shape.businessObject.name;
    if (name) this.drawCenteredText(gfx, name, box, 'bf-label bf-pool-label');
    return main;
  }

  /** Pool / lane: rectangle with a header band holding the rotated name. */
  private drawPool(gfx: SVGElement, shape: BpmnShape, className: string): SVGElement {
    const horizontal = shape.di.get('isHorizontal') !== false;
    const box = { x: 0, y: 0, width: shape.width, height: shape.height };
    const main = path(gfx, outlinePath('rect', box), `bf-shape ${className}`);
    const band = 30;
    {
      path(
        gfx,
        horizontal ? `M${band},0V${shape.height}` : `M0,${band}H${shape.width}`,
        'bf-pool-divider',
      );
    }
    const name = shape.businessObject.name;
    if (name) {
      const node = this.text.createText(name, {
        box: horizontal
          ? { width: shape.height, height: band }
          : { width: shape.width, height: band },
        align: 'center-middle',
        padding: 4,
      });
      svgAttr(node, {
        transform: horizontal ? `matrix(0, -1, 1, 0, 0, ${shape.height})` : 'translate(0, 0)',
      });
      svgClasses(node).add('bf-label');
      svgClasses(node).add('bf-pool-label');
      svgAppend(gfx, node);
    }
    return main;
  }
}
