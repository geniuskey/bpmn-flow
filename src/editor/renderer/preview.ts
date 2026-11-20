/**
 * Small SVG previews of shape presets for the palette and the replace menu.
 * They are drawn by the canvas renderer itself (`drawBpmnShape`) from a real,
 * detached BPMN element, so every icon is the exact notation the canvas shows.
 */
import { createModdle, type BpmnModdleInstance, type ModdleElement } from '@/bpmn/model/moddle';
import type { Shape } from 'diagram-js/lib/model/Types';
import { buildFromPreset } from '../modeling/presets';
import type { ShapePreset } from '../types';
import { drawBpmnShape } from './BpmnFlowRenderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

let moddle: BpmnModdleInstance | null = null;
let counter = 0;
const cache = new Map<string, string>();

/** Preview size per kind: small enough for an icon, large enough for the markers. */
function previewSize(preset: ShapePreset): { width: number; height: number } {
  const t = preset.type;
  if (/Event$/.test(t)) return { width: 36, height: 36 };
  if (/Gateway$/.test(t)) return { width: 40, height: 40 };
  if (t === 'bpmn:Participant') {
    const size = preset.blackBox ? { width: 96, height: 32 } : { width: 96, height: 56 };
    return preset.isHorizontal === false ? { width: size.height, height: size.width } : size;
  }
  if (t === 'bpmn:Lane') return { width: 96, height: 40 };
  if (/^bpmn:Data(ObjectReference|Input|Output)$/.test(t)) return { width: 30, height: 40 };
  if (t === 'bpmn:DataStoreReference') return { width: 40, height: 36 };
  if (t === 'bpmn:TextAnnotation') return { width: 44, height: 32 };
  if (t === 'bpmn:Group') return { width: 56, height: 40 };
  if (/Conversation$/.test(t)) return { width: 40, height: 35 };
  if (/Choreography|ChoreographyTask/.test(t)) return { width: 64, height: 56 };
  return { width: 52, height: 40 };
}

function presetKey(preset: ShapePreset): string {
  return JSON.stringify(preset, Object.keys(preset).sort());
}

/** Choreography activities show two participant bands (initiating on top). */
function fakeBands(m: BpmnModdleInstance): ModdleElement[] {
  return (['top_initiating', 'bottom_non_initiating'] as const).map((kind) =>
    m.create('bpmndi:BPMNShape', {
      participantBandKind: kind,
      bounds: m.create('dc:Bounds', { x: 0, y: 0, width: 64, height: 14 }),
    }),
  );
}

/** SVG markup of a preset's shape, `size` pixels on its longer side. */
export function renderPreview(preset: ShapePreset, size = 28): string {
  const key = `${size}:${presetKey(preset)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = (moddle ??= createModdle());
  const built = buildFromPreset(
    {
      moddle: m,
      create: (type, attrs) => m.create(type, { id: `Preview_${++counter}`, ...attrs }),
    },
    preset,
  );
  const bo = built.businessObject;
  // A call activity finds its global task through the definitions (see iconType).
  if (built.created.calledElement) {
    const definitions = m.create('bpmn:Definitions', {
      rootElements: [built.created.calledElement],
    });
    bo.$parent = definitions;
  }
  const { width, height } = previewSize(preset);
  const shape = {
    id: bo.id,
    type: preset.type,
    x: 0,
    y: 0,
    width,
    height,
    businessObject: bo,
    di: built.di,
    ...(/Choreography|ChoreographyTask/.test(preset.type) ? { bands: fakeBands(m) } : {}),
  } as unknown as Shape;
  const pad = 3;
  const svg = document.createElementNS(SVG_NS, 'svg');
  const scale = size / Math.max(width + 2 * pad, height + 2 * pad);
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`);
  svg.setAttribute('width', String(Math.round((width + 2 * pad) * scale)));
  svg.setAttribute('height', String(Math.round((height + 2 * pad) * scale)));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'bf-preview');
  svg.setAttribute('focusable', 'false');
  const g = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(g);
  drawBpmnShape(g as unknown as SVGElement, shape);
  const markup = svg.outerHTML;
  cache.set(key, markup);
  return markup;
}
