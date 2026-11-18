/** Shapes with their own structure: events, choreography activities with bands, pools (incl. black-box pools). */
import { append as svgAppend, attr as svgAttr, classes as svgClasses } from 'tiny-svg';
import { getRef, is } from '@/bpmn/model/moddle';
import type { BpmnShape } from '../model';
import { outlinePath } from './geometry';
import { bandKind, bandsOf, isInitiatingBand, layoutBands } from '../modeling/choreography';
import { drawEventMarker } from './markers';
import { el, path } from './svg';
import { TEXT, drawCenteredText } from './text';

/** Event circle(s) by event type, plus the definition marker. */
export function drawEvent(gfx: SVGElement, shape: BpmnShape): SVGElement {
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
  drawEventMarker(gfx, shape);
  return main;
}

/** Choreography activity: rounded box with participant bands (shaded when not initiating). */
export function drawChoreography(gfx: SVGElement, shape: BpmnShape): SVGElement {
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
    drawCenteredText(gfx, participant?.name ?? participant?.id, b, 'bf-label bf-band-label');
  }
  const middle = {
    x: 0,
    y: topEnd,
    width: shape.width,
    height: Math.max(10, bottomStart - topEnd),
  };
  drawCenteredText(gfx, bo.name, middle, 'bf-label');
  if (is(bo, 'bpmn:SubChoreography') && shape.di.get('isExpanded') === false) {
    const cx = shape.width / 2;
    const by = bottomStart - 16;
    path(gfx, `M${cx - 6},${by}h12v12h-12z`, 'bf-icon-stroke');
    path(gfx, `M${cx - 3},${by + 6}h6M${cx},${by + 3}v6`, 'bf-icon-stroke');
  }
  return main;
}

/** Black-box pool (no process): a plain rectangle with the name in the middle. */
export function drawBlackBoxPool(gfx: SVGElement, shape: BpmnShape): SVGElement {
  const box = { x: 0, y: 0, width: shape.width, height: shape.height };
  const main = path(gfx, outlinePath('rect', box), 'bf-shape bf-participant bf-black-box');
  const name = shape.businessObject.name;
  if (name) drawCenteredText(gfx, name, box, 'bf-label bf-pool-label');
  return main;
}

/** Pool / lane: rectangle with a header band holding the rotated name. */
export function drawPool(gfx: SVGElement, shape: BpmnShape, className: string): SVGElement {
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
    const node = TEXT.createText(name, {
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
