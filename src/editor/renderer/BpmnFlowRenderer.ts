/**
 * Renders BPMN shapes with a modern, theme-aware style while keeping the BPMN
 * notation (circle = event, rounded rectangle = activity, diamond = gateway).
 *
 * Colors are not hard-coded: every SVG node gets `bf-*` classes that are styled
 * by CSS variables in src/styles/canvas.css, so theme switches need no redraw.
 */
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { append as svgAppend, attr as svgAttr, classes as svgClasses } from 'tiny-svg';
import { messageVisibleKind, readLabelBounds, readLabelFont } from '@/bpmn/di/di';
import { getRef, is } from '@/bpmn/model/moddle';
import { annotationText, groupLabel } from '@/bpmn/model/elements';
import type { BpmnConnection, BpmnShape } from '../model';
import { arrowHeadPath, outlinePath, polylineMid, polylinePath, startMarkerPath } from './geometry';
import {
  hasExternalLabel,
  isCollection,
  isExpanded,
  isNonInitiatingMessage,
  visualFor,
} from './visuals';
import {
  drawActivityMarkers,
  drawEventSubProcessTrigger,
  drawGatewayMarker,
  drawTaskIcon,
  iconType,
} from './markers';
import { callsComposite } from '../modeling/choreography';
import { drawBlackBoxPool, drawChoreography, drawEvent, drawPool } from './shapes';
import { el, path } from './svg';
import {
  TEXT,
  drawCaption,
  drawCenteredText,
  drawExternalLabel,
  drawShapeName,
  drawTitle,
  labelBoxOf,
} from './text';

/** Draws one BPMN shape into `gfx` (also used for the palette and replace-menu previews). */
export function drawBpmnShape(gfx: SVGElement, element: Shape): SVGElement {
  const shape = element as BpmnShape;
  const bo = shape.businessObject;
  const visual = visualFor(bo, false);
  const box = { x: 0, y: 0, width: shape.width, height: shape.height };
  const unsupported = visual.kind === 'unsupportedShape' ? ' bf-unsupported' : '';
  let main: SVGElement;

  switch (visual.kind) {
    case 'event':
      main = drawEvent(gfx, shape);
      break;
    case 'activity': {
      const call = is(bo, 'bpmn:CallActivity') ? ' bf-call-activity' : '';
      main = path(gfx, outlinePath('roundRect', box), `bf-shape bf-activity${call}`);
      drawTaskIcon(gfx, iconType(bo), bo);
      drawShapeName(gfx, shape, bo.name, box, 'bf-label');
      drawActivityMarkers(gfx, shape, []);
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
      drawActivityMarkers(gfx, shape, extra);
      if (eventSub && !isExpanded(shape)) drawEventSubProcessTrigger(gfx, bo);
      if (isExpanded(shape)) {
        drawShapeName(
          gfx,
          shape,
          bo.name,
          { x: 0, y: 0, width: shape.width, height: 26 },
          'bf-label',
          'center-top',
        );
      } else {
        drawShapeName(gfx, shape, bo.name, box, 'bf-label');
      }
      break;
    }
    case 'gateway':
      main = path(gfx, outlinePath('diamond', box), 'bf-shape bf-gateway');
      drawGatewayMarker(gfx, shape);
      break;
    case 'participant':
      main = getRef(bo, 'processRef')
        ? drawPool(gfx, shape, 'bf-participant')
        : drawBlackBoxPool(gfx, shape);
      break;
    case 'lane':
      main = drawPool(gfx, shape, 'bf-lane');
      break;
    case 'textAnnotation': {
      main = path(gfx, outlinePath('rect', box), 'bf-annotation-hit');
      path(gfx, `M14,0H0V${shape.height}H14`, 'bf-annotation');
      const text = annotationText(bo);
      if (text && labelBoxOf(shape)) {
        drawShapeName(gfx, shape, text, box, 'bf-label');
      } else if (text) {
        const node = TEXT.createText(text, {
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
      const label = groupLabel(bo);
      if (label) {
        drawShapeName(
          gfx,
          shape,
          label,
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
      // bpmn:DataObject drawn directly (not through a reference) is read-only here.
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
      main = drawChoreography(gfx, shape);
      break;
    }
    case 'message': {
      // Envelope drawn with a single thin line; shaded when non-initiating (PDF 91).
      const shaded = isNonInitiatingMessage(bo) ? ' bf-non-initiating' : '';
      const g = el(gfx, 'g', {}, `bf-message-shape${shaded}`);
      main = path(g, outlinePath('rect', box), 'bf-envelope-body');
      path(g, `M0,0L${shape.width / 2},${shape.height / 2}L${shape.width},0`, 'bf-envelope-flap');
      break;
    }
    case 'conversation': {
      const call = is(bo, 'bpmn:CallConversation') ? ' bf-call-conversation' : '';
      main = path(gfx, outlinePath('hexagon', box), `bf-shape bf-conversation${call}`);
      // [+]: sub-conversation, or a call conversation calling a collaboration (Table 12.34).
      if (is(bo, 'bpmn:SubConversation') || callsComposite(bo)) {
        const cx = shape.width / 2;
        const by = shape.height - 14;
        path(gfx, `M${cx - 5},${by}h10v10h-10z`, 'bf-icon-stroke');
        path(gfx, `M${cx - 3},${by + 5}h6M${cx},${by + 2}v6`, 'bf-icon-stroke');
      }
      break;
    }
    default:
      main = path(gfx, outlinePath(visual.outline, box), `bf-shape${unsupported}`);
      // Hatched, so it cannot be read as BPMN notation (e.g. a none event) (PDF 38, 70).
      if (unsupported) drawHatch(gfx, outlinePath(visual.outline, box));
      if (visual.outline === 'roundRect' || visual.outline === 'rect') {
        drawCenteredText(gfx, bo.name, box, 'bf-label');
        drawCaption(gfx, visual.caption ?? bo.$type);
      }
      drawTitle(gfx, `${visual.caption ?? bo.$type} — not editable in BPMN Flow yet`);
  }

  if (hasExternalLabel(bo)) drawExternalLabel(gfx, shape);
  return main;
}

/** Diagonal hatch over an unsupported shape (a tool-specific style no BPMN element uses). */
function drawHatch(gfx: SVGElement, outline: string): void {
  const id = 'bf-unsupported-hatch';
  const defs = el(gfx, 'defs', {}, '');
  const pattern = el(
    defs,
    'pattern',
    { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    '',
  );
  path(pattern, 'M0,0V6', 'bf-hatch-line');
  const hatch = path(gfx, outline, 'bf-unsupported-hatch');
  svgAttr(hatch, { fill: `url(#${id})` });
}

export default class BpmnFlowRenderer extends BaseRenderer {
  static $inject = ['eventBus'];

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
    return drawBpmnShape(gfx, element);
  }

  override drawConnection(gfx: SVGElement, element: Connection): SVGElement {
    const connection = element as BpmnConnection;
    const bo = connection.businessObject;
    const visual = visualFor(bo, true);
    const points = connection.waypoints;
    const unsupported = visual.kind === 'unsupportedConnection' ? ' bf-unsupported' : '';
    const message = visual.kind === 'messageFlow' ? ' bf-message-flow' : '';
    // Not dashed / dotted: those styles mean message flow and association (PDF 38, 70).
    if (unsupported) path(gfx, polylinePath(points), 'bf-unsupported-halo');
    const line = path(gfx, polylinePath(points), `bf-connection${unsupported}${message}`);
    if (message && points.length > 1) {
      const a = points[0]!;
      el(gfx, 'circle', { cx: a.x, cy: a.y, r: 4 }, 'bf-message-start');
      const head = arrowHeadPath(points);
      if (head) path(gfx, head, 'bf-message-arrow');
      const kind = messageVisibleKind(connection.di);
      // BPMN 2.0.2 Table 12.35: the envelope decorator is shown only when DI
      // messageVisibleKind is set; shaded for a non-initiating (reply) message.
      if (kind === 'initiating' || kind === 'non_initiating') {
        const mid = polylineMid(points);
        const shaded = kind === 'non_initiating';
        const g = el(
          gfx,
          'g',
          { transform: `translate(${mid.x - 10}, ${mid.y - 7})` },
          shaded ? 'bf-message-envelope bf-non-initiating' : 'bf-message-envelope',
        );
        path(g, 'M0,0h20v14h-20z', 'bf-envelope-body');
        path(g, 'M0,0L10,7L20,0', 'bf-envelope-flap');
        // The message name beside the envelope (Fig 8.28, PDF 92).
        const messageName = getRef(bo, 'messageRef')?.name;
        if (messageName) {
          drawCenteredText(
            gfx,
            messageName,
            { x: mid.x + 8, y: mid.y - 9, width: 140, height: 18 },
            'bf-label bf-flow-label bf-message-name',
            'left-middle',
          );
        }
      }
    }
    if (unsupported) drawTitle(gfx, `${bo.$type} — not editable in BPMN Flow yet`);
    if (visual.kind === 'association') {
      svgClasses(line).add('bf-association');
      const direction = bo.get('associationDirection');
      if (direction === 'One' || direction === 'Both') {
        const head = arrowHeadPath(points, 9, 5);
        if (head) path(gfx, head, 'bf-open-arrow');
      }
      if (direction === 'Both') {
        const tail = arrowHeadPath([...points].reverse(), 9, 5);
        if (tail) path(gfx, tail, 'bf-open-arrow');
      }
    }
    if (visual.kind === 'conversationLink') {
      // "Conversation Links MUST be drawn with double thin lines" (PDF 161).
      svgClasses(line).add('bf-conversation-link');
      path(gfx, polylinePath(points), 'bf-conversation-link-gap');
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
        !!getRef(bo, 'conditionExpression') &&
        source &&
        (is(source, 'bpmn:Activity') || is(source, 'bpmn:ChoreographyActivity'));
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
      drawCenteredText(
        gfx,
        bo.name,
        box,
        'bf-label bf-flow-label',
        label ? 'center-top' : 'center-middle',
        readLabelFont(connection.di),
      );
    }
    return line;
  }
}
