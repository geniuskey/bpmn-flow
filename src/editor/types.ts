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

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** A standalone SVG image of a diagram and its size in pixels. */
export interface SvgExport {
  svg: string;
  width: number;
  height: number;
}

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
  /** Show documents read-only even when they could be edited. */
  readOnly?: boolean;
  /**
   * @deprecated Auto layout no longer uses ELK; the option is accepted and
   * ignored.
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
  /** Target bounds by element id (pools, lanes, flow nodes, artifacts, groups). */
  shapes: Record<string, Box>;
  /** Waypoints by connection id; connections left out are routed by the editor. */
  connections?: Record<string, { x: number; y: number }[]>;
  /** BPMNLabel bounds by element id (external labels of shapes, flow names). */
  labels?: Record<string, Box>;
}

export type LoopKind = 'none' | 'standard' | 'parallel' | 'sequential';

export type TimerType = 'timeDuration' | 'timeDate' | 'timeCycle';

export type EventDetail =
  | { kind: 'timer'; timerType: TimerType; value: string }
  | { kind: 'reference'; name: string }
  | { kind: 'condition'; value: string }
  /** Link events are paired by the name of their LinkEventDefinition (BPMN 2.0.2 §10.5.5). */
  | { kind: 'link'; name: string }
  /**
   * errorCode / escalationCode of the referenced bpmn:Error / bpmn:Escalation
   * (Tables 8.41-8.42, PDF 110-111); empty clears it.
   */
  | { kind: 'code'; value: string }
  /**
   * Compensation (Table 10.94, PDF 293, 312): the activity to compensate
   * (`activityRef`, an activity id or null for all) and `waitForCompletion`.
   */
  | { kind: 'compensateActivity'; activityId: string | null }
  | { kind: 'waitForCompletion'; value: boolean };

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
  | { kind: 'loop'; field: LoopField; value: string | boolean }
  /** State of a data object / store reference or data input / output (`dataState`); empty removes it. */
  | { kind: 'dataState'; name: string }
  /** Exclusive gateway "X" marker (DI isMarkerVisible, BPMN 2.0.2 Table 12.23). */
  | { kind: 'markerVisible'; value: boolean }
  /**
   * The Data Object a Data Object Reference shows (`dataObjectRef`, PDF 234):
   * the id of another Data Object of the same process / sub-process, or null
   * for a new one of its own.
   */
  | { kind: 'dataObject'; id: string | null }
  /** Multi-instance pool (`participantMultiplicity`, Table 9.5); undefined removes it. */
  | { kind: 'multiplicity'; value: { minimum: number; maximum?: number } | undefined }
  /**
   * What a lane partitions by (`partitionElementRef`, Table 10.135): a
   * `bpmn:Resource` found or created by name; empty clears it.
   */
  | { kind: 'partition'; name: string }
  /**
   * An expression-valued attribute: a sequence flow's `conditionExpression`
   * or a complex gateway's `activationCondition` (Table 10.125). `formal`
   * false makes it a natural-language bpmn:Expression, true a
   * bpmn:FormalExpression with an optional `language` URI (§8.4.6, PDF
   * 112-114). An empty body removes it.
   */
  | {
      kind: 'expression';
      property: 'conditionExpression' | 'activationCondition';
      body: string;
      formal: boolean;
      language?: string;
    }
  /**
   * The Category of a group's CategoryValue (Tables 8.21-8.23, PDF 98-99),
   * found or created by name; several groups may share one Category.
   */
  | { kind: 'groupCategory'; name: string }
  /**
   * Fill / stroke color of the element's DI, written as both the OMG
   * non-normative `color:*` and the bpmn.io `bioc:*` extension attributes
   * (BPMN 2.0.2 defines no colors). Undefined leaves a color as it is, null
   * removes it. Edges have a stroke only.
   */
  | { kind: 'colors'; fill?: string | null; stroke?: string | null }
  /** Adds (true) or removes a CategoryValue from a flow element's categoryValueRef (Table 8.44). */
  | { kind: 'categoryValue'; id: string; assigned: boolean }
  /**
   * Gives the elements within a group's bounds its CategoryValue and takes it
   * from those outside ("The graphical elements within the Group will be
   * assigned the CategoryValue", PDF 98).
   */
  | { kind: 'categorizeContents' }
  /**
   * A new root element for a call choreography / call conversation / call
   * activity to call: a Global Choreography Task or Choreography (PDF 363), a
   * Global Conversation or Collaboration (PDF 163), a Process or Global Task
   * (PDF 212). It gets `name`.
   */
  | {
      kind: 'newCalledElement';
      type:
        | 'bpmn:GlobalChoreographyTask'
        | 'bpmn:Choreography'
        | 'bpmn:GlobalConversation'
        | 'bpmn:Collaboration'
        /** Call activities call a Process or a Global Task (§10.3.5, PDF 212-215). */
        | 'bpmn:Process'
        | 'bpmn:GlobalTask'
        | 'bpmn:GlobalUserTask'
        | 'bpmn:GlobalManualTask'
        | 'bpmn:GlobalScriptTask'
        | 'bpmn:GlobalBusinessRuleTask';
      name?: string;
    };

/**
 * An edit of a choreography activity's participants and bands (see
 * ChoreographyParticipantHandler). Band indexes count top to bottom.
 */
export type BandOp =
  | { op: 'participant'; index: number; participantId?: string; newName?: string }
  | { op: 'initiator'; participantId: string }
  | { op: 'move'; index: number; to: number }
  | { op: 'add'; participantId?: string; newName?: string }
  | { op: 'remove'; index: number }
  | { op: 'messageVisible'; index: number; value: boolean }
  | { op: 'multiplicity'; index: number; value: boolean }
  | { op: 'returnMessage'; value: boolean }
  | { op: 'message'; direction: 'initiating' | 'return'; name: string };

export type PropertyValue = string | number | boolean | ModdleElement | undefined;

/**
 * What to create (palette, library users) or what to turn an element into
 * (replace menu): a BPMN type plus the attributes that change its notation.
 * Omitted fields keep the BPMN defaults.
 */
export interface ShapePreset {
  /** BPMN type, e.g. 'bpmn:IntermediateCatchEvent'. */
  type: string;
  /** Event triggers; none = a none event, several = a Multiple event. */
  eventDefinitions?: readonly string[];
  /** Several triggers that must all occur (catching events only). */
  parallelMultiple?: boolean;
  /** Boundary events: false = non-interrupting. */
  cancelActivity?: boolean;
  /** Event sub-process start events: false = non-interrupting. */
  isInterrupting?: boolean;
  /** Sub-process: an event sub-process. */
  triggeredByEvent?: boolean;
  /** Activity: a compensation activity. */
  isForCompensation?: boolean;
  loop?: LoopKind;
  /** Data object / input / output: a collection. */
  isCollection?: boolean;
  /** Receive task / event-based gateway that starts the process. */
  instantiate?: boolean;
  /** Instantiating event-based gateway: exclusive (default) or parallel. */
  eventGatewayType?: 'Exclusive' | 'Parallel';
  /** Sub-processes: expanded (default) or collapsed. */
  isExpanded?: boolean;
  /** Exclusive gateway: show the "X" marker (default) or not. */
  isMarkerVisible?: boolean;
  /** Pool without a process (black box). */
  blackBox?: boolean;
  /** Pool: false = vertical (name band on top, lanes side by side; BPMNShape isHorizontal). */
  isHorizontal?: boolean;
  /** Call activity: creates a global task of this type and calls it, e.g. 'bpmn:GlobalUserTask'. */
  calledGlobalTask?: string;
  /** Call choreography: creates and calls a 'bpmn:GlobalChoreographyTask' or 'bpmn:Choreography' (PDF 363). */
  calledChoreography?: 'bpmn:GlobalChoreographyTask' | 'bpmn:Choreography';
  /** Call conversation: creates and calls a 'bpmn:GlobalConversation' or 'bpmn:Collaboration' (Table 12.34). */
  calledCollaboration?: 'bpmn:GlobalConversation' | 'bpmn:Collaboration';
}
