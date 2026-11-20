/**
 * The BPMN 2.0.2 shape library shown in the palette and the replace menu:
 * every notation variant the editor can create, grouped like the event,
 * activity, gateway, data, artifact and swimlane tables of the specification
 * (BPMN 2.0.2 Table 10.89 for the event variants, Chapter 12 for the rest).
 */
import type { ShapePreset } from './types';

export interface LibraryEntry {
  /** Stable id; also the palette test id (`create-<testId ?? id>`). */
  id: string;
  label: string;
  preset: ShapePreset;
  /** Where the entry can be dropped, when that is not obvious ("drop on an activity border"). */
  hint?: string;
  /** Extra search words. */
  keywords?: string;
  /** Palette test id kept from the flat palette (`create-<testId>`). */
  testId?: string;
  /** False for marker-only variants that the replace menu does not switch (loop, collection...). */
  replace?: boolean;
}

export interface LibraryGroup {
  id: string;
  label: string;
  entries: LibraryEntry[];
}

const MESSAGE = 'bpmn:MessageEventDefinition';
const TIMER = 'bpmn:TimerEventDefinition';
const CONDITIONAL = 'bpmn:ConditionalEventDefinition';
const SIGNAL = 'bpmn:SignalEventDefinition';
const ERROR = 'bpmn:ErrorEventDefinition';
const ESCALATION = 'bpmn:EscalationEventDefinition';
const COMPENSATE = 'bpmn:CompensateEventDefinition';
const CANCEL = 'bpmn:CancelEventDefinition';
const LINK = 'bpmn:LinkEventDefinition';
const TERMINATE = 'bpmn:TerminateEventDefinition';
/** Two triggers make a "Multiple" event; the user picks the real ones in the inspector. */
const MULTIPLE = [MESSAGE, SIGNAL];

type Trigger = [key: string, label: string, defs: string[], parallel?: boolean];

const T = {
  message: ['message', 'Message', [MESSAGE]],
  timer: ['timer', 'Timer', [TIMER]],
  conditional: ['conditional', 'Conditional', [CONDITIONAL]],
  signal: ['signal', 'Signal', [SIGNAL]],
  error: ['error', 'Error', [ERROR]],
  escalation: ['escalation', 'Escalation', [ESCALATION]],
  compensation: ['compensation', 'Compensation', [COMPENSATE]],
  cancel: ['cancel', 'Cancel', [CANCEL]],
  link: ['link', 'Link', [LINK]],
  terminate: ['terminate', 'Terminate', [TERMINATE]],
  multiple: ['multiple', 'Multiple', MULTIPLE],
  parallel: ['parallel-multiple', 'Parallel multiple', MULTIPLE, true],
} satisfies Record<string, Trigger>;

function events(
  prefix: string,
  type: string,
  noun: string,
  triggers: Trigger[],
  extra: Partial<ShapePreset> = {},
  hint?: string,
): LibraryEntry[] {
  return triggers.map(([key, label, defs, parallel]) => ({
    id: `${prefix}-${key}`,
    label: `${label} ${noun}`,
    preset: {
      type,
      eventDefinitions: defs,
      ...(parallel ? { parallelMultiple: true } : {}),
      ...extra,
    },
    ...(hint ? { hint } : {}),
  }));
}

const IN_EVENT_SUB_PROCESS = 'drop into an event sub-process';
const ON_ACTIVITY = 'drop on an activity border';

const START: LibraryEntry[] = [
  {
    id: 'start-none',
    label: 'Start event',
    testId: 'StartEvent',
    preset: { type: 'bpmn:StartEvent', eventDefinitions: [] },
  },
  ...events('start', 'bpmn:StartEvent', 'start event', [
    T.message,
    T.timer,
    T.conditional,
    T.signal,
    T.multiple,
    T.parallel,
  ]),
  // Event sub-process only (BPMN 2.0.2 Table 10.89, PDF 271-272).
  ...events(
    'start',
    'bpmn:StartEvent',
    'start event',
    [T.error, T.escalation, T.compensation],
    {},
    IN_EVENT_SUB_PROCESS,
  ),
  ...events(
    'start-non-interrupting',
    'bpmn:StartEvent',
    'start event (non-interrupting)',
    [T.message, T.timer, T.conditional, T.signal, T.escalation, T.multiple, T.parallel],
    { isInterrupting: false },
    IN_EVENT_SUB_PROCESS,
  ),
];

const INTERMEDIATE_CATCH = events(
  'catch',
  'bpmn:IntermediateCatchEvent',
  'intermediate catch event',
  [T.message, T.timer, T.conditional, T.link, T.signal, T.multiple, T.parallel],
);

const INTERMEDIATE_THROW: LibraryEntry[] = [
  {
    id: 'throw-none',
    label: 'Intermediate event',
    testId: 'IntermediateThrowEvent',
    keywords: 'none throw',
    preset: { type: 'bpmn:IntermediateThrowEvent', eventDefinitions: [] },
  },
  ...events('throw', 'bpmn:IntermediateThrowEvent', 'intermediate throw event', [
    T.message,
    T.escalation,
    T.link,
    T.compensation,
    T.signal,
    T.multiple,
  ]),
];

const BOUNDARY: LibraryEntry[] = [
  ...events(
    'boundary',
    'bpmn:BoundaryEvent',
    'boundary event',
    [
      T.message,
      T.timer,
      T.escalation,
      T.conditional,
      T.error,
      T.cancel,
      T.compensation,
      T.signal,
      T.multiple,
      T.parallel,
    ],
    {},
    ON_ACTIVITY,
  ).map((e) =>
    e.id === 'boundary-timer'
      ? { ...e, testId: 'BoundaryEvent' }
      : e.id === 'boundary-cancel'
        ? { ...e, hint: 'drop on a transaction border' }
        : e,
  ),
  ...events(
    'boundary-non-interrupting',
    'bpmn:BoundaryEvent',
    'boundary event (non-interrupting)',
    [T.message, T.timer, T.escalation, T.conditional, T.signal, T.multiple, T.parallel],
    { cancelActivity: false },
    ON_ACTIVITY,
  ),
];

const END: LibraryEntry[] = [
  {
    id: 'end-none',
    label: 'End event',
    testId: 'EndEvent',
    preset: { type: 'bpmn:EndEvent', eventDefinitions: [] },
  },
  ...events('end', 'bpmn:EndEvent', 'end event', [
    T.message,
    T.escalation,
    T.error,
    T.compensation,
    T.signal,
    T.multiple,
    T.terminate,
  ]),
  ...events('end', 'bpmn:EndEvent', 'end event', [T.cancel], {}, 'drop into a transaction'),
];

const TASKS: [string, string, string, string?][] = [
  ['task', 'Task', 'bpmn:Task', 'Task'],
  ['user-task', 'User task', 'bpmn:UserTask'],
  ['service-task', 'Service task', 'bpmn:ServiceTask'],
  ['send-task', 'Send task', 'bpmn:SendTask'],
  ['receive-task', 'Receive task', 'bpmn:ReceiveTask'],
  ['manual-task', 'Manual task', 'bpmn:ManualTask'],
  ['business-rule-task', 'Business rule task', 'bpmn:BusinessRuleTask'],
  ['script-task', 'Script task', 'bpmn:ScriptTask'],
  ['call-activity', 'Call activity', 'bpmn:CallActivity'],
];

const ACTIVITIES: LibraryEntry[] = [
  ...TASKS.map(([id, label, type, testId]) => ({
    id,
    label,
    preset: { type },
    ...(testId ? { testId } : {}),
  })),
  {
    id: 'receive-task-instantiate',
    label: 'Receive task (instantiating)',
    keywords: 'start process',
    preset: { type: 'bpmn:ReceiveTask', instantiate: true },
  },
  // Call activities calling a global task show its marker (BPMN 2.0.2 Table 12.18).
  ...(
    [
      ['user', 'User', 'bpmn:GlobalUserTask'],
      ['manual', 'Manual', 'bpmn:GlobalManualTask'],
      ['script', 'Script', 'bpmn:GlobalScriptTask'],
      ['business-rule', 'Business rule', 'bpmn:GlobalBusinessRuleTask'],
    ] as const
  ).map(([key, label, global]) => ({
    id: `call-activity-${key}`,
    label: `Call activity (global ${label.toLowerCase()} task)`,
    keywords: 'global task',
    replace: false,
    preset: { type: 'bpmn:CallActivity', calledGlobalTask: global },
  })),
  {
    id: 'sub-process',
    label: 'Sub-process (expanded)',
    testId: 'SubProcess',
    preset: { type: 'bpmn:SubProcess' },
  },
  {
    id: 'sub-process-collapsed',
    label: 'Sub-process (collapsed)',
    replace: false,
    preset: { type: 'bpmn:SubProcess', isExpanded: false },
  },
  {
    id: 'event-sub-process',
    label: 'Event sub-process',
    keywords: 'triggered by event',
    preset: { type: 'bpmn:SubProcess', triggeredByEvent: true },
  },
  { id: 'transaction', label: 'Transaction', preset: { type: 'bpmn:Transaction' } },
  // Collapsed transaction / ad-hoc sub-process (BPMN 2.0.2 Tables 12.12, 12.14).
  {
    id: 'transaction-collapsed',
    label: 'Transaction (collapsed)',
    replace: false,
    preset: { type: 'bpmn:Transaction', isExpanded: false },
  },
  {
    id: 'ad-hoc-sub-process',
    label: 'Ad-hoc sub-process',
    preset: { type: 'bpmn:AdHocSubProcess' },
  },
  {
    id: 'ad-hoc-sub-process-collapsed',
    label: 'Ad-hoc sub-process (collapsed)',
    replace: false,
    preset: { type: 'bpmn:AdHocSubProcess', isExpanded: false },
  },
  {
    id: 'task-loop',
    label: 'Task (loop)',
    keywords: 'standard loop marker',
    replace: false,
    preset: { type: 'bpmn:Task', loop: 'standard' },
  },
  {
    id: 'task-mi-parallel',
    label: 'Task (parallel multi-instance)',
    keywords: 'multiple instance marker',
    replace: false,
    preset: { type: 'bpmn:Task', loop: 'parallel' },
  },
  {
    id: 'task-mi-sequential',
    label: 'Task (sequential multi-instance)',
    keywords: 'multiple instance marker',
    replace: false,
    preset: { type: 'bpmn:Task', loop: 'sequential' },
  },
  {
    id: 'task-compensation',
    label: 'Compensation task',
    keywords: 'for compensation marker',
    replace: false,
    preset: { type: 'bpmn:Task', isForCompensation: true },
  },
];

const GATEWAYS: LibraryEntry[] = [
  {
    id: 'exclusive-gateway',
    label: 'Exclusive gateway',
    testId: 'ExclusiveGateway',
    keywords: 'xor decision',
    preset: { type: 'bpmn:ExclusiveGateway' },
  },
  {
    id: 'exclusive-gateway-no-marker',
    label: 'Exclusive gateway (without marker)',
    keywords: 'xor decision',
    preset: { type: 'bpmn:ExclusiveGateway', isMarkerVisible: false },
  },
  {
    id: 'inclusive-gateway',
    label: 'Inclusive gateway',
    keywords: 'or',
    preset: { type: 'bpmn:InclusiveGateway' },
  },
  {
    id: 'parallel-gateway',
    label: 'Parallel gateway',
    testId: 'ParallelGateway',
    keywords: 'and fork join',
    preset: { type: 'bpmn:ParallelGateway' },
  },
  { id: 'complex-gateway', label: 'Complex gateway', preset: { type: 'bpmn:ComplexGateway' } },
  {
    id: 'event-based-gateway',
    label: 'Event-based gateway',
    preset: { type: 'bpmn:EventBasedGateway' },
  },
  {
    id: 'event-based-gateway-instantiate',
    label: 'Exclusive event-based gateway (instantiating)',
    keywords: 'start process',
    preset: { type: 'bpmn:EventBasedGateway', instantiate: true },
  },
  {
    id: 'event-based-gateway-parallel',
    label: 'Parallel event-based gateway (instantiating)',
    keywords: 'start process',
    preset: { type: 'bpmn:EventBasedGateway', instantiate: true, eventGatewayType: 'Parallel' },
  },
];

const IN_PROCESS = 'in a process or pool';

const DATA: LibraryEntry[] = [
  {
    id: 'data-object',
    label: 'Data object',
    testId: 'DataObjectReference',
    preset: { type: 'bpmn:DataObjectReference' },
  },
  {
    id: 'data-object-collection',
    replace: false,
    label: 'Data object (collection)',
    preset: { type: 'bpmn:DataObjectReference', isCollection: true },
  },
  {
    id: 'data-input',
    label: 'Data input',
    testId: 'DataInput',
    hint: IN_PROCESS,
    preset: { type: 'bpmn:DataInput' },
  },
  {
    id: 'data-input-collection',
    replace: false,
    label: 'Data input (collection)',
    hint: IN_PROCESS,
    preset: { type: 'bpmn:DataInput', isCollection: true },
  },
  {
    id: 'data-output',
    label: 'Data output',
    testId: 'DataOutput',
    hint: IN_PROCESS,
    preset: { type: 'bpmn:DataOutput' },
  },
  {
    id: 'data-output-collection',
    replace: false,
    label: 'Data output (collection)',
    hint: IN_PROCESS,
    preset: { type: 'bpmn:DataOutput', isCollection: true },
  },
  {
    id: 'data-store',
    label: 'Data store',
    testId: 'DataStoreReference',
    preset: { type: 'bpmn:DataStoreReference' },
  },
  {
    // BPMN 2.0.2 §8.4.11, Fig 8.26-8.28 (PDF 121-122).
    id: 'message',
    replace: false,
    label: 'Message',
    hint: 'in a collaboration; associate it with a message flow',
    keywords: 'envelope',
    preset: { type: 'bpmn:Message' },
  },
];

const ARTIFACTS: LibraryEntry[] = [
  {
    id: 'text-annotation',
    label: 'Text annotation',
    testId: 'TextAnnotation',
    keywords: 'comment note',
    preset: { type: 'bpmn:TextAnnotation' },
  },
  { id: 'group', label: 'Group', testId: 'Group', preset: { type: 'bpmn:Group' } },
];

const SWIMLANES: LibraryEntry[] = [
  {
    id: 'pool',
    label: 'Pool',
    testId: 'Participant',
    keywords: 'participant',
    preset: { type: 'bpmn:Participant' },
  },
  {
    id: 'pool-black-box',
    replace: false,
    label: 'Black-box pool',
    hint: 'next to another pool',
    keywords: 'participant empty collapsed',
    preset: { type: 'bpmn:Participant', blackBox: true },
  },
  {
    id: 'pool-vertical',
    replace: false,
    label: 'Vertical pool',
    keywords: 'participant column',
    preset: { type: 'bpmn:Participant', isHorizontal: false },
  },
  {
    id: 'pool-black-box-vertical',
    replace: false,
    label: 'Vertical black-box pool',
    hint: 'next to another pool',
    keywords: 'participant empty collapsed column',
    preset: { type: 'bpmn:Participant', blackBox: true, isHorizontal: false },
  },
  {
    id: 'lane',
    label: 'Lane',
    hint: 'drop on a pool, a lane or a process diagram',
    keywords: 'swimlane',
    preset: { type: 'bpmn:Lane' },
  },
];

const IN_COLLABORATION = 'in a collaboration';
const IN_CHOREOGRAPHY = 'in a choreography';

const CONVERSATIONS: LibraryEntry[] = [
  {
    id: 'conversation',
    label: 'Conversation',
    testId: 'Conversation',
    hint: IN_COLLABORATION,
    preset: { type: 'bpmn:Conversation' },
  },
  {
    id: 'sub-conversation',
    label: 'Sub-conversation',
    hint: IN_COLLABORATION,
    preset: { type: 'bpmn:SubConversation' },
  },
  {
    id: 'call-conversation',
    label: 'Call conversation',
    hint: IN_COLLABORATION,
    keywords: 'global conversation',
    preset: { type: 'bpmn:CallConversation', calledCollaboration: 'bpmn:GlobalConversation' },
  },
  {
    id: 'call-conversation-collaboration',
    label: 'Call conversation (collaboration)',
    hint: IN_COLLABORATION,
    replace: false,
    preset: { type: 'bpmn:CallConversation', calledCollaboration: 'bpmn:Collaboration' },
  },
];

const CHOREOGRAPHY: LibraryEntry[] = [
  {
    id: 'choreography-task',
    label: 'Choreography task',
    testId: 'ChoreographyTask',
    hint: IN_CHOREOGRAPHY,
    preset: { type: 'bpmn:ChoreographyTask' },
  },
  {
    id: 'sub-choreography',
    label: 'Sub-choreography (collapsed)',
    hint: IN_CHOREOGRAPHY,
    preset: { type: 'bpmn:SubChoreography', isExpanded: false },
  },
  {
    id: 'sub-choreography-expanded',
    label: 'Sub-choreography (expanded)',
    hint: IN_CHOREOGRAPHY,
    replace: false,
    preset: { type: 'bpmn:SubChoreography' },
  },
  // Call choreography: thick border; task look when calling a global
  // choreography task, [+] when calling a choreography (PDF 363, Fig 11.24/11.25).
  {
    id: 'call-choreography-global-task',
    label: 'Call choreography (global choreography task)',
    hint: IN_CHOREOGRAPHY,
    keywords: 'global task',
    replace: false,
    preset: { type: 'bpmn:CallChoreography', calledChoreography: 'bpmn:GlobalChoreographyTask' },
  },
  {
    id: 'call-choreography',
    label: 'Call choreography (choreography)',
    hint: IN_CHOREOGRAPHY,
    replace: false,
    preset: { type: 'bpmn:CallChoreography', calledChoreography: 'bpmn:Choreography' },
  },
];

export const SHAPE_LIBRARY: LibraryGroup[] = [
  { id: 'start', label: 'Start events', entries: START },
  {
    id: 'intermediate',
    label: 'Intermediate events',
    entries: [...INTERMEDIATE_CATCH, ...INTERMEDIATE_THROW],
  },
  { id: 'boundary', label: 'Boundary events', entries: BOUNDARY },
  { id: 'end', label: 'End events', entries: END },
  { id: 'activities', label: 'Activities', entries: ACTIVITIES },
  { id: 'gateways', label: 'Gateways', entries: GATEWAYS },
  { id: 'data', label: 'Data', entries: DATA },
  { id: 'artifacts', label: 'Artifacts', entries: ARTIFACTS },
  { id: 'swimlanes', label: 'Swimlanes', entries: SWIMLANES },
  { id: 'conversations', label: 'Conversations', entries: CONVERSATIONS },
  { id: 'choreography', label: 'Choreography', entries: CHOREOGRAPHY },
];

export const LIBRARY_ENTRIES: LibraryEntry[] = SHAPE_LIBRARY.flatMap((g) => g.entries);

/** Case-insensitive search over labels, keywords, hints and the BPMN type. */
export function searchLibrary(query: string): LibraryGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return SHAPE_LIBRARY;
  return SHAPE_LIBRARY.map((g) => ({
    ...g,
    entries: g.entries.filter((e) => {
      const text = [e.label, e.keywords, e.hint, e.preset.type, g.label].join(' ').toLowerCase();
      return words.every((w) => text.includes(w));
    }),
  })).filter((g) => g.entries.length);
}

/** The shapes most diagrams are made of, shown first in the palette. */
const COMMON_IDS = [
  'start-none',
  'task',
  'user-task',
  'service-task',
  'sub-process',
  'exclusive-gateway',
  'parallel-gateway',
  'catch-timer',
  'catch-message',
  'end-none',
  'data-object',
  'data-store',
  'text-annotation',
  'pool',
  'lane',
];

export const COMMON_GROUP: LibraryGroup = {
  id: 'common',
  label: 'Common',
  entries: COMMON_IDS.map((id) => LIBRARY_ENTRIES.find((e) => e.id === id)).filter(
    (e): e is LibraryEntry => !!e,
  ),
};

/**
 * The library entry that draws like an element (same type and triggers, and
 * the same interrupting / instantiating flags), for its icon.
 */
export function entryForElement(b: {
  $type: string;
  get(name: string): unknown;
}): LibraryEntry | undefined {
  const defs = ((b.get('eventDefinitions') as { $type: string }[] | undefined) ?? [])
    .map((d) => d.$type)
    .sort()
    .join();
  const flag = (preset: ShapePreset, key: keyof ShapePreset, attr = key as string) =>
    (preset[key] ?? true) === (b.get(attr) ?? true);
  const candidates = LIBRARY_ENTRIES.filter(
    (e) =>
      e.preset.type === b.$type && [...(e.preset.eventDefinitions ?? [])].sort().join() === defs,
  );
  return (
    candidates.find(
      (e) =>
        flag(e.preset, 'cancelActivity') &&
        flag(e.preset, 'isInterrupting') &&
        (e.preset.triggeredByEvent ?? false) === (b.get('triggeredByEvent') ?? false),
    ) ?? candidates[0]
  );
}
