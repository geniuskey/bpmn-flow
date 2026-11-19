/**
 * Public types of the editor controller (what the React shell and library
 * users see). Kept free of diagram-js internals so the published declarations
 * only depend on diagram-js' element types.
 */
import type { ModdleElement } from '@/bpmn/model/moddle';

export interface DiagramInfo {
  rootId: string;
  name: string;
  type: string;
  active: boolean;
}

export type EditorTool = 'select' | 'pan' | 'lasso' | 'connect';

export interface EditorSnapshot {
  selection: string[];
  canUndo: boolean;
  canRedo: boolean;
  /** Increments on every model change (execute / undo / redo). */
  revision: number;
  /** True when the model changed since it was opened or last exported. */
  dirty: boolean;
  zoom: number;
  readOnly: boolean;
  /** Root id of the BPMN diagram that is shown. */
  activeDiagram: string;
  /** Tool currently active inside diagram-js (tools end themselves, e.g. after one connection). */
  activeTool: EditorTool;
}

export type Listener = (snapshot: EditorSnapshot) => void;

/**
 * Where the ELK worker script comes from: a URL, or a function that resolves
 * one (so the worker file is only fetched when layout is first used).
 */
export type ElkWorkerSource = string | URL | (() => string | URL | Promise<string | URL>);

export interface EditorOptions {
  /**
   * Source of the ELK worker script used by auto layout. Without it, layout
   * runs ELK on the main thread (fine for small and medium diagrams).
   */
  elkWorker?: ElkWorkerSource;
}

export interface CanvasImportResult {
  shapes: number;
  connections: number;
  warnings: string[];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  /** Target bounds by element id (pools, lanes and flow nodes). */
  shapes: Record<string, Box>;
}

export type LoopKind = 'none' | 'standard' | 'parallel' | 'sequential';

export type TimerType = 'timeDuration' | 'timeDate' | 'timeCycle';

export type EventDetail =
  | { kind: 'timer'; timerType: TimerType; value: string }
  | { kind: 'reference'; name: string }
  | { kind: 'condition'; value: string }
  /** Link events are paired by the name of their LinkEventDefinition (BPMN 2.0.2 §10.5.5). */
  | { kind: 'link'; name: string };

/** Loop / multi-instance attributes (BPMN 2.0.2 §10.3.8). Empty strings clear them. */
export type LoopField =
  | 'loopCondition'
  | 'loopMaximum'
  | 'testBefore'
  | 'loopCardinality'
  | 'completionCondition'
  | 'behavior';

/** Details of non-event elements edited through `element.updateDetail`. */
export type ElementDetail =
  /** Message carried by a message flow (`messageRef`), found or created by name. */
  | { kind: 'message'; name: string }
  /** Envelope decorator of a message flow (DI messageVisibleKind); undefined hides it. */
  | { kind: 'messageVisibleKind'; value: 'initiating' | 'non_initiating' | undefined }
  | { kind: 'loop'; field: LoopField; value: string | boolean };

export type PropertyValue = string | number | boolean | ModdleElement | undefined;
