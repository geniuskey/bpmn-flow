/** Shapes with their own structure: events, choreography activities with bands, pools (incl. black-box pools). */
import { append as svgAppend, attr as svgAttr, classes as svgClasses } from 'tiny-svg';
import { readLabelFont } from '@/bpmn/di/di';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { isExpandedShape, type BpmnShape } from '../model';
import { outlinePath } from './geometry';
import {
  bandPosition,
  bandSections,
  bandsOf,
  callsComposite,
  isInitiatingBand,
  layoutBands,
  nameBand,
  sentFlows,
  showsBandMessages,
} from '../modeling/choreography';
import { drawEventMarker } from './markers';
import { el, path } from './svg';
import { TEXT, drawCenteredText, drawShapeName, fontCss, labelBoxOf } from './text';

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

/**
 * Choreography activity: rounded box with participant bands (shaded when not
 * initiating; middle bands are plain rectangles, Table 12.33), the name band
 * between them with its markers, and the message decorators of bands with
 * `isMessageVisible` (PDF 355).
 */
export function drawChoreography(gfx: SVGElement, shape: BpmnShape): SVGElement {
  const bo = shape.businessObject;
  const box = { x: 0, y: 0, width: shape.width, height: shape.height };
  const call = is(bo, 'bpmn:CallChoreography') ? ' bf-call-activity' : '';
  const main = path(
    gfx,
    outlinePath('roundRect', box),
    `bf-shape bf-activity bf-choreography${call}`,
  );
  const bands = bandsOf(shape);
  const { upper } = bandSections(bands);
  const layout = layoutBands(shape, bands);
  const messages = showsBandMessages(bo);
  for (const [band, abs] of layout) {
    const b = { x: 0, y: abs.y - shape.y, width: shape.width, height: abs.height };
    const isUpper = upper.includes(band);
    const position = bandPosition(band);
    path(
      gfx,
      isUpper ? `M0,${b.y + b.height}H${shape.width}` : `M0,${b.y}H${shape.width}`,
      'bf-band-divider',
    );
    if (!isInitiatingBand(band)) {
      el(
        gfx,
        'rect',
        {
          x: 1,
          y: b.y + (isUpper ? 1 : 0),
          width: shape.width - 2,
          height: b.height - 1,
        },
        'bf-band-shade',
      );
    }
    const participant = getRef(band, 'bpmnElement');
    const multi = isMultiParticipant(participant);
    // A multi-instance band keeps room for its marker under the name (PDF 357).
    const labelBox = multi ? { ...b, height: Math.max(10, b.height - 8) } : b;
    drawCenteredText(gfx, participant?.name ?? participant?.id, labelBox, 'bf-label bf-band-label');
    if (multi) drawMultiplicity(gfx, shape.width / 2, b.y + b.height - 12);
    if (messages && band.get('isMessageVisible') === true && position !== 'middle') {
      drawBandMessage(gfx, shape, band, b, position === 'top');
    }
  }
  const middle = nameBand({ ...box }, bands);
  const expanded = isExpandedShape(shape);
  // Bottom of the name band: loop marker (loopType, PDF 355) left of the [+].
  const markers: string[] = [];
  const loopType = bo.get('loopType');
  if (loopType === 'Standard') markers.push('loop');
  if (loopType === 'MultiInstanceParallel') markers.push('parallel');
  if (loopType === 'MultiInstanceSequential') markers.push('sequential');
  // [+]: collapsed sub-choreography, or a call choreography calling a choreography (Fig 11.25).
  const collapsible =
    (is(bo, 'bpmn:SubChoreography') && !expanded) ||
    (callsComposite(bo) && shape.di?.get('isExpanded') !== true);
  if (collapsible) markers.push('collapsed');
  // The name keeps clear of the markers; an expanded sub-choreography shows it
  // at the top of its content (Fig 11.19).
  const nameBox = expanded
    ? { ...middle, height: Math.min(middle.height, 40) }
    : { ...middle, height: Math.max(10, middle.height - (markers.length ? 14 : 0)) };
  drawShapeName(
    gfx,
    shape,
    bo.name,
    nameBox,
    'bf-label',
    expanded ? 'center-top' : 'center-middle',
  );
  let x = shape.width / 2 - (markers.length * 12 + (markers.length - 1) * 4) / 2;
  const by = middle.y + middle.height - 16;
  for (const m of markers) {
    if (m === 'collapsed') {
      path(gfx, `M${x},${by}h12v12h-12z`, 'bf-icon-stroke');
      path(gfx, `M${x + 3},${by + 6}h6M${x + 6},${by + 3}v6`, 'bf-icon-stroke');
    } else if (m === 'loop') {
      path(gfx, `M${x + 10},${by + 3.5}A5,5 0 1 0 ${x + 11},${by + 8}`, 'bf-icon-stroke');
      path(gfx, `M${x + 8},${by + 3.5}h2.5v-2.5`, 'bf-icon-stroke');
    } else if (m === 'parallel') {
      path(gfx, `M${x + 2},${by}v12M${x + 6},${by}v12M${x + 10},${by}v12`, 'bf-icon-stroke');
    } else {
      path(gfx, `M${x},${by + 2}h12M${x},${by + 6}h12M${x},${by + 10}h12`, 'bf-icon-stroke');
    }
    x += 16;
  }
  return main;
}

const ENVELOPE = { width: 20, height: 14, gap: 12 };

/**
 * Band message decorator (Table 12.33, Fig 11.10): an envelope above the top
 * band or below the bottom band, tethered by a dotted line; unfilled for the
 * initiating participant's message, lightly filled for the return message.
 * The message name is written beside it.
 */
function drawBandMessage(
  gfx: SVGElement,
  shape: BpmnShape,
  band: ModdleElement,
  b: { y: number; height: number },
  above: boolean,
): void {
  const cx = shape.width / 2;
  const top = above ? b.y - ENVELOPE.gap - ENVELOPE.height : b.y + b.height + ENVELOPE.gap;
  const shaded = !isInitiatingBand(band);
  const g = el(gfx, 'g', {}, shaded ? 'bf-band-message bf-non-initiating' : 'bf-band-message');
  path(
    g,
    above ? `M${cx},${top + ENVELOPE.height}V${b.y}` : `M${cx},${b.y + b.height}V${top}`,
    'bf-band-tether',
  );
  const x = cx - ENVELOPE.width / 2;
  path(
    g,
    `M${x},${top}h${ENVELOPE.width}v${ENVELOPE.height}h-${ENVELOPE.width}z`,
    'bf-envelope-body',
  );
  path(g, `M${x},${top}L${cx},${top + 7}L${x + ENVELOPE.width},${top}`, 'bf-envelope-flap');
  const participant = getRef(band, 'bpmnElement');
  const message = participant
    ? sentFlows(shape.businessObject, participant)
        .map((f) => getRef(f, 'messageRef'))
        .find((m) => m?.name)
    : undefined;
  if (message?.name) {
    drawCenteredText(
      g,
      message.name,
      { x: cx + ENVELOPE.width / 2 + 2, y: top - 3, width: 110, height: ENVELOPE.height + 6 },
      'bf-label bf-band-label',
      'left-middle',
    );
  }
}

/**
 * A multi-instance participant: it has a participantMultiplicity whose maximum
 * is either not set or two or more (BPMN 2.0.2 PDF 147).
 */
export function isMultiParticipant(participant: ModdleElement | undefined): boolean {
  const m = participant && getRef(participant, 'participantMultiplicity');
  if (!m) return false;
  // bpmn-moddle reports maximum's default (1) for a missing attribute.
  if (!Object.prototype.hasOwnProperty.call(m, 'maximum')) return true;
  const max = m.get('maximum');
  return typeof max !== 'number' || max >= 2;
}

/** Multi-instance participant marker: three vertical lines, bottom center. */
function drawMultiplicity(gfx: SVGElement, cx: number, top: number): void {
  path(gfx, `M${cx - 4},${top}v10M${cx},${top}v10M${cx + 4},${top}v10`, 'bf-icon-stroke');
}

/** Black-box pool (no process): a plain rectangle with the name in the middle. */
export function drawBlackBoxPool(gfx: SVGElement, shape: BpmnShape): SVGElement {
  const box = { x: 0, y: 0, width: shape.width, height: shape.height };
  const main = path(gfx, outlinePath('rect', box), 'bf-shape bf-participant bf-black-box');
  drawShapeName(gfx, shape, shape.businessObject.name, box, 'bf-label bf-pool-label');
  if (isMultiParticipant(shape.businessObject)) {
    drawMultiplicity(gfx, shape.width / 2, shape.height - 14);
  }
  return main;
}

/** Pool / lane: rectangle with a header band holding the rotated name. */
export function drawPool(gfx: SVGElement, shape: BpmnShape, className: string): SVGElement {
  const horizontal = shape.di.get('isHorizontal') !== false;
  const box = { x: 0, y: 0, width: shape.width, height: shape.height };
  const main = path(gfx, outlinePath('rect', box), `bf-shape ${className}`);
  const band = 30;
  // A lane's name is not separated from its contents by a line unless it has
  // sub-lanes (PDF 334); a pool keeps its header line.
  const bo = shape.businessObject;
  const subLanes = getMany(getRef(bo, 'childLaneSet'), 'lanes').length > 0;
  if (!is(bo, 'bpmn:Lane') || subLanes) {
    path(
      gfx,
      horizontal ? `M${band},0V${shape.height}` : `M0,${band}H${shape.width}`,
      'bf-pool-divider',
    );
  }
  const name = bo.name;
  const labelBox = labelBoxOf(shape);
  const font = readLabelFont(shape.di);
  if (name && labelBox) {
    // BPMNLabel bounds (PDF 406): vertical text when the box is taller than wide.
    if (labelBox.height > labelBox.width) {
      const node = drawCenteredText(
        gfx,
        name,
        { x: 0, y: 0, width: labelBox.height, height: labelBox.width },
        'bf-label bf-pool-label',
        'center-middle',
        font,
      );
      if (node) {
        svgAttr(node, {
          transform: `matrix(0, -1, 1, 0, ${labelBox.x}, ${labelBox.y + labelBox.height})`,
        });
      }
    } else {
      drawCenteredText(gfx, name, labelBox, 'bf-label bf-pool-label', 'center-middle', font);
    }
  } else if (name) {
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
    const css = fontCss(font);
    if (css) svgAttr(node, { style: css });
    svgAppend(gfx, node);
  }
  if (is(shape.businessObject, 'bpmn:Participant') && isMultiParticipant(shape.businessObject)) {
    if (horizontal) drawMultiplicity(gfx, (band + shape.width) / 2, shape.height - 14);
    else drawMultiplicity(gfx, shape.width / 2, shape.height - 14);
  }
  return main;
}
