/**
 * Input of the layout engine: a plain description of a diagram, independent of
 * diagram-js so the engine runs headless (Node, workers, tests).
 */

export type LayoutDirection = 'LR' | 'TB';
export type LayoutDensity = 'compact' | 'normal' | 'spacious';

export interface LayoutOptions {
  /** Direction of the flow: left → right (default) or top → bottom. */
  direction?: LayoutDirection;
  /** Spacing preset (default 'normal'). */
  density?: LayoutDensity;
  /**
   * Reorder pools so that message flows cross as few pools as possible
   * (default true; the current order is kept when no order is better).
   */
  reorderPools?: boolean;
}

export interface LabelMeasure {
  (text: string, maxWidth: number): { width: number; height: number };
}

export type LNodeKind = 'activity' | 'event' | 'gateway' | 'other';

export interface LBoundary {
  id: string;
  width: number;
  height: number;
  label?: string;
  /** Original position around the host, used to keep their order. */
  order: number;
}

export interface LNode {
  id: string;
  kind: LNodeKind;
  width: number;
  height: number;
  /** Name drawn outside the shape (events, gateways). */
  label?: string;
  /** Leaf lane id when the container has lanes. */
  lane?: string;
  /** Content of an expanded sub-process, laid out first to size the shape. */
  content?: LContainer;
  /** Event sub-processes are not part of the flow: they go below it. */
  strip?: boolean;
  boundary?: LBoundary[];
}

export interface LEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** Boundary event the flow leaves from; `source` is then its host. */
  from?: string;
}

export interface LArtifact {
  id: string;
  width: number;
  height: number;
  label?: string;
  /** Flow node the artifact is associated with (placed next to it). */
  anchor?: string;
  /** Associations / data associations between the artifact and its anchor. */
  links: string[];
}

export interface LLane {
  id: string;
  children: LLane[];
}

export interface LContainer {
  /** Pool id; undefined for a process diagram or sub-process content. */
  id?: string;
  lanes: LLane[];
  nodes: LNode[];
  edges: LEdge[];
  artifacts: LArtifact[];
  /** Current extent across the flow; black-box pools keep it. */
  crossSize?: number;
}

export interface LGroup {
  id: string;
  members: string[];
}

export interface LDiagram {
  containers: LContainer[];
  /** Message flows between pools (node or pool ends). */
  messages: LEdge[];
  groups: LGroup[];
  /** Top-left corner the laid-out diagram starts at. */
  origin: { x: number; y: number };
}
