/** Properties specific to one kind of element: gateways, data, activities, events, flows. */
import { canHaveDefaultFlow, humanizeType } from '@/bpmn/model/elements';
import { messageVisibleKind } from '@/bpmn/di/di';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { isCollection } from '@/editor/renderer/visuals';
import { loopKindOf, type LoopKind } from '@/editor/commands/LoopHandler';
import {
  dataObjectsFor,
  loopFieldValue,
  MI_BEHAVIORS,
} from '@/editor/commands/ElementDetailHandler';
import type { LoopField } from '@/editor/types';
import { isExpandedShape } from '@/editor/model';
import type { Element } from 'diagram-js/lib/model/Types';
import { useEditorStore } from '@/stores/editorStore';
import { CheckField, Row, Section, TextField } from './fields';
import { inputClass, standardAttributes } from './shared';
import { NewCalledElementField, SequenceFlowFields } from './specFields';

/** Instantiating gateways and compensation activities have no sequence flows there (PDF 268, 328). */
function hasSequenceFlows(el: ModdleElement, key: 'incoming' | 'outgoing'): boolean {
  return getMany(el, key).some((f) => is(f, 'bpmn:SequenceFlow'));
}

/** Root elements a call activity may call: processes and global tasks. */
function callableElements(activity: ModdleElement): ModdleElement[] {
  let defs: ModdleElement | undefined = activity;
  while (defs?.$parent) defs = defs.$parent;
  return getMany(defs, 'rootElements').filter(
    (r) => !!r.id && (is(r, 'bpmn:Process') || is(r, 'bpmn:GlobalTask')),
  );
}

/** Event-based gateway: whether it instantiates the process, and how. */
export function EventGatewayFields({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  return (
    <>
      <Row label="Instantiate">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Instantiate"
            checked={bo.get('instantiate') === true}
            disabled={
              readOnly || (bo.get('instantiate') !== true && hasSequenceFlows(bo, 'incoming'))
            }
            onChange={(e) =>
              controller?.updateProperties(elementId, {
                instantiate: e.target.checked || undefined,
                eventGatewayType: e.target.checked
                  ? (bo.get('eventGatewayType') as string | undefined)
                  : undefined,
              })
            }
          />
          <span className="text-muted-foreground">Starts the process</span>
        </label>
      </Row>
      {bo.get('instantiate') === true && (
        <Row label="Gateway type">
          <select
            aria-label="Event gateway type"
            className={inputClass}
            value={bo.get('eventGatewayType') === 'Parallel' ? 'Parallel' : 'Exclusive'}
            disabled={readOnly}
            onChange={(e) =>
              controller?.updateProperties(elementId, {
                eventGatewayType: e.target.value === 'Parallel' ? 'Parallel' : undefined,
              })
            }
          >
            <option value="Exclusive">Exclusive</option>
            <option value="Parallel">Parallel</option>
          </select>
        </Row>
      )}
    </>
  );
}

/**
 * Sub-process kinds: expanded or collapsed (BPMN DI isExpanded; collapsed
 * content is drawn in its own diagram), and for a plain sub-process whether
 * it is an event sub-process (`triggeredByEvent`, BPMN 2.0.2 PDF 204).
 */
export function SubProcessFields({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  useEditorStore((s) => s.snapshot.revision);
  const element = controller?.getElement(elementId) as Element | undefined;
  const expanded = !!element && isExpandedShape(element);
  const expandBlocker = controller?.expandBlocker(elementId, !expanded) ?? 'Not available.';
  const eventSub = bo.get('triggeredByEvent') === true;
  const eventPreset = { type: bo.$type, triggeredByEvent: !eventSub || undefined };
  const eventBlocker =
    is(bo, 'bpmn:SubProcess') && bo.$type === 'bpmn:SubProcess'
      ? (controller?.replaceBlocker(elementId, eventPreset) ?? 'Not available.')
      : null;
  return (
    <>
      {bo.$type === 'bpmn:SubProcess' && (
        <Row label="Event sub-process">
          <label className="flex items-center gap-2" title={eventBlocker ?? undefined}>
            <input
              type="checkbox"
              aria-label="Event sub-process"
              checked={eventSub}
              disabled={readOnly || !!eventBlocker}
              onChange={() => controller?.replace(elementId, eventPreset)}
            />
            <span className="text-muted-foreground">Triggered by an event</span>
          </label>
        </Row>
      )}
      <Row label="Collapsed">
        <label
          className="flex items-center gap-2"
          title={readOnly ? undefined : (expandBlocker ?? undefined)}
        >
          <input
            type="checkbox"
            aria-label="Collapsed"
            checked={!expanded}
            disabled={readOnly || !!expandBlocker}
            onChange={() => controller?.setExpanded(elementId, !expanded)}
          />
          <span className="text-muted-foreground">Content in its own diagram</span>
        </label>
      </Row>
    </>
  );
}

/** Data object / input / output: collection marker. */
export function CollectionField({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  return (
    <Row label="Collection">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Collection"
          checked={isCollection(bo)}
          disabled={readOnly}
          onChange={(e) =>
            controller?.updateProperties(elementId, {
              isCollection: e.target.checked || undefined,
            })
          }
        />
        <span className="text-muted-foreground">Collection of data</span>
      </label>
    </Row>
  );
}

/** Data object / store reference, data input / output: state shown as "[state]" (PDF 234, 243). */
export function DataStateField({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const state = (getRef(bo, 'dataState')?.name as string | undefined) ?? '';
  return (
    <Row label="State">
      <TextField
        key={`${elementId}:state:${state}`}
        label="Data state"
        value={state}
        disabled={readOnly}
        placeholder="e.g. approved"
        onCommit={(v) => controller?.updateElementDetail(elementId, { kind: 'dataState', name: v })}
      />
    </Row>
  );
}

/**
 * Data object reference: which Data Object it shows. Several references may
 * show the same Data Object (PDF 234: "visual representations of Data
 * Objects"); "New data object" gives the reference one of its own.
 */
export function DataObjectField({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const current = getRef(bo, 'dataObjectRef');
  const options = dataObjectsFor(bo);
  const references = (d: ModdleElement) =>
    getMany(d.$parent, 'flowElements').filter(
      (f) => is(f, 'bpmn:DataObjectReference') && getRef(f, 'dataObjectRef') === d,
    ).length;
  return (
    <Row label="Data object">
      <select
        aria-label="Data object"
        className={inputClass}
        value={current?.id ?? ''}
        disabled={readOnly}
        onChange={(e) =>
          controller?.updateElementDetail(elementId, {
            kind: 'dataObject',
            id: e.target.value === '__new' ? null : e.target.value,
          })
        }
      >
        {!current && <option value="">(none)</option>}
        {options.map((d) => {
          const n = references(d);
          return (
            <option key={d.id} value={d.id}>
              {`${d.name || d.id}${n > 1 ? ` (${n} references)` : ''}`}
            </option>
          );
        })}
        <option value="__new">New data object</option>
      </select>
    </Row>
  );
}

/** Lane: what it partitions by, a resource such as a role or department (Table 10.135). */
export function LanePartitionField({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const ref = getRef(bo, 'partitionElementRef');
  const value = (ref?.name as string | undefined) ?? ref?.id ?? '';
  let definitions: ModdleElement | undefined = bo;
  while (definitions?.$parent) definitions = definitions.$parent;
  const resources = getMany(definitions, 'rootElements').filter(
    (r) => is(r, 'bpmn:Resource') && r.name,
  );
  // An imported partitionElementRef to something else than a named resource stays as it is.
  const editable = !ref || (is(ref, 'bpmn:Resource') && !!ref.name);
  return (
    <Row label="Partition">
      <TextField
        key={`${elementId}:partition:${value}`}
        label="Partition element"
        value={value}
        disabled={readOnly || !editable}
        placeholder="Resource, e.g. Sales"
        list={`${elementId}-resources`}
        onCommit={(v) => controller?.updateElementDetail(elementId, { kind: 'partition', name: v })}
      />
      <datalist id={`${elementId}-resources`}>
        {resources.map((r) => (
          <option key={r.id} value={r.name} />
        ))}
      </datalist>
    </Row>
  );
}

/** Exclusive gateway: the optional "X" marker (DI isMarkerVisible, Table 12.23). */
export function GatewayMarkerField({
  elementId,
  di,
  readOnly,
}: {
  elementId: string;
  di: ModdleElement | undefined;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  return (
    <Row label="Marker">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Show X marker"
          checked={di?.get('isMarkerVisible') === true}
          disabled={readOnly || !di}
          onChange={(e) =>
            controller?.updateElementDetail(elementId, {
              kind: 'markerVisible',
              value: e.target.checked,
            })
          }
        />
        <span className="text-muted-foreground">Show the “X” inside the diamond</span>
      </label>
    </Row>
  );
}

/** Activity: loop / multi-instance and compensation. */
export function ActivityFields({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const loopKind = loopKindOf(bo);
  return (
    <>
      {is(bo, 'bpmn:CallActivity') && (
        <Row label="Called element">
          <TextField
            key={`${elementId}:called:${String(bo.get('calledElement') ?? '')}`}
            label="Called element"
            value={String(bo.get('calledElement') ?? '')}
            disabled={readOnly}
            placeholder="Process or global task id"
            list={`${elementId}-callable`}
            onCommit={(v) => controller?.updateProperties(elementId, { calledElement: v })}
          />
          {/* Processes and global tasks of this file (BPMN 2.0.2 §10.3.5). */}
          <datalist id={`${elementId}-callable`}>
            {callableElements(bo).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ? `${r.name} (${humanizeType(r.$type)})` : humanizeType(r.$type)}
              </option>
            ))}
          </datalist>
        </Row>
      )}
      {is(bo, 'bpmn:CallActivity') && (
        <NewCalledElementField elementId={elementId} readOnly={readOnly} />
      )}
      {is(bo, 'bpmn:ReceiveTask') && (
        <Row label="Instantiate">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Instantiate"
              checked={bo.get('instantiate') === true}
              // An instantiating receive task has no incoming sequence flows (BPMN 2.0.2 PDF 189).
              disabled={
                readOnly || (bo.get('instantiate') !== true && hasSequenceFlows(bo, 'incoming'))
              }
              onChange={(e) =>
                controller?.updateProperties(elementId, {
                  instantiate: e.target.checked || undefined,
                })
              }
            />
            <span className="text-muted-foreground">Starts the process</span>
          </label>
        </Row>
      )}
      <Row label="Loop">
        <select
          aria-label="Loop"
          className={inputClass}
          value={loopKindOf(bo)}
          disabled={readOnly}
          onChange={(e) => controller?.setLoop(elementId, e.target.value as LoopKind)}
        >
          <option value="none">None</option>
          <option value="standard">Loop</option>
          <option value="parallel">Multi-instance (parallel)</option>
          <option value="sequential">Multi-instance (sequential)</option>
        </select>
      </Row>
      {loopKind !== 'none' && (
        <LoopDetailFields elementId={elementId} activity={bo} readOnly={readOnly} />
      )}
      <Row label="Compensation">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="For compensation"
            checked={bo.get('isForCompensation') === true}
            disabled={
              readOnly ||
              (bo.get('isForCompensation') !== true &&
                (hasSequenceFlows(bo, 'incoming') || hasSequenceFlows(bo, 'outgoing')))
            }
            onChange={(e) =>
              controller?.updateProperties(elementId, {
                isForCompensation: e.target.checked || undefined,
              })
            }
          />
          <span className="text-muted-foreground">Compensation activity</span>
        </label>
      </Row>
    </>
  );
}

const LOOP_TEXT_FIELDS: { field: LoopField; label: string; placeholder: string }[] = [
  { field: 'loopCondition', label: 'Loop condition', placeholder: 'e.g. ${count < 3}' },
  { field: 'loopMaximum', label: 'Loop maximum', placeholder: 'Whole number' },
  { field: 'loopCardinality', label: 'Instances', placeholder: 'e.g. ${items.size()}' },
  { field: 'completionCondition', label: 'Completion', placeholder: 'e.g. ${done >= 2}' },
];

/** Loop condition / maximum / test before, or multi-instance cardinality, completion, behavior. */
function LoopDetailFields({
  elementId,
  activity,
  readOnly,
}: {
  elementId: string;
  activity: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const loop = getRef(activity, 'loopCharacteristics');
  if (!loop) return null;
  const standard = is(loop, 'bpmn:StandardLoopCharacteristics');
  const fields = LOOP_TEXT_FIELDS.filter((f) =>
    standard
      ? f.field === 'loopCondition' || f.field === 'loopMaximum'
      : f.field === 'loopCardinality' || f.field === 'completionCondition',
  );
  const set = (field: LoopField, value: string | boolean) =>
    controller?.updateElementDetail(elementId, { kind: 'loop', field, value });
  return (
    <>
      {fields.map(({ field, label, placeholder }) => (
        <Row key={field} label={label}>
          <TextField
            key={`${elementId}:${field}:${loopFieldValue(loop, field)}`}
            label={label}
            value={loopFieldValue(loop, field)}
            disabled={readOnly}
            placeholder={placeholder}
            onCommit={(v) => set(field, v)}
          />
        </Row>
      ))}
      {standard ? (
        <Row label="Test before">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Test before"
              checked={loop.get('testBefore') === true}
              disabled={readOnly}
              onChange={(e) => set('testBefore', e.target.checked)}
            />
            <span className="text-muted-foreground">Check the condition before each run</span>
          </label>
        </Row>
      ) : (
        <Row label="Behavior">
          <select
            aria-label="Multi-instance behavior"
            className={inputClass}
            value={String(loop.get('behavior') ?? 'All')}
            disabled={readOnly}
            onChange={(e) => set('behavior', e.target.value)}
          >
            {MI_BEHAVIORS.map((b) => (
              <option key={b} value={b}>
                {b === 'All' ? 'All (throw events for every instance)' : b}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}

/** Boundary event or event sub-process start: interrupting or not. */
export function InterruptingField({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  return (
    <Row label="Interrupting">
      <CheckField
        label="Interrupting"
        text={
          is(bo, 'bpmn:BoundaryEvent')
            ? 'Cancels the activity it is attached to'
            : 'Cancels the enclosing process'
        }
        checked={
          bo.get(is(bo, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting') !== false
        }
        disabled={readOnly}
        onChange={(checked) =>
          controller?.updateProperties(elementId, {
            [is(bo, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting']: checked,
          })
        }
      />
    </Row>
  );
}

/** "attachedToRef" -> "Attached to", "cancelActivity" -> "Cancel activity". */
function attributeLabel(name: string): string {
  const words = name
    .replace(/Ref$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Attributes FlowProperties edits itself (not repeated as read-only rows). */
const FLOW_FIELDS = [
  'messageRef',
  'associationDirection',
  'calledElement',
  'isImmediate',
  'gatewayDirection',
  'textFormat',
  'processType',
  'isClosed',
  'isExecutable',
  // Edited by the event, activity, gateway and data fields above.
  'cancelActivity',
  'isInterrupting',
  'parallelMultiple',
  'eventGatewayType',
  'instantiate',
  'isCollection',
  'isForCompensation',
  'triggeredByEvent',
];

/** Connection ends, condition and default flow, and the standard attributes that are set. */
export function FlowProperties({
  elementId,
  bo,
  readOnly,
  supported,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
  supported: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const source = getRef(bo, 'sourceRef');
  const target = getRef(bo, 'targetRef');
  return (
    <Section id="connection" title={source || target ? 'Connection' : 'BPMN attributes'}>
      {source && <Row label="Source">{source.name || source.id}</Row>}
      {target && <Row label="Target">{target.name || target.id}</Row>}
      {is(bo, 'bpmn:SequenceFlow') && (
        <SequenceFlowFields elementId={elementId} bo={bo} readOnly={readOnly || !supported} />
      )}
      {source && is(bo, 'bpmn:SequenceFlow') && canHaveDefaultFlow(source) && (
        <Row label="Default flow">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Default flow"
              checked={getRef(source, 'default') === bo}
              disabled={readOnly}
              onChange={(e) =>
                source.id &&
                controller?.setDefaultFlow(source.id, e.target.checked ? bo : undefined)
              }
            />
            <span className="text-muted-foreground">Taken when no condition matches</span>
          </label>
        </Row>
      )}
      {is(bo, 'bpmn:MessageFlow') && (
        <Row label="Message">
          <TextField
            key={`${elementId}:message:${getRef(bo, 'messageRef')?.name ?? ''}`}
            label="Message name"
            value={getRef(bo, 'messageRef')?.name ?? ''}
            disabled={readOnly || !supported}
            placeholder="Message name"
            onCommit={(v) =>
              controller?.updateElementDetail(elementId, { kind: 'message', name: v })
            }
          />
        </Row>
      )}
      {is(bo, 'bpmn:MessageFlow') && getRef(bo, 'messageRef') && (
        <Row label="Envelope">
          <select
            aria-label="Message envelope"
            className={inputClass}
            value={
              messageVisibleKind(
                (controller?.getElement(elementId) as { di?: ModdleElement } | undefined)?.di,
              ) ?? ''
            }
            disabled={readOnly || !supported}
            onChange={(e) =>
              controller?.updateElementDetail(elementId, {
                kind: 'messageVisibleKind',
                value: (e.target.value || undefined) as 'initiating' | 'non_initiating' | undefined,
              })
            }
          >
            <option value="">Hidden</option>
            <option value="initiating">Initiating</option>
            <option value="non_initiating">Non-initiating (shaded)</option>
          </select>
        </Row>
      )}
      {is(bo, 'bpmn:Association') && (
        <Row label="Direction">
          <select
            aria-label="Association direction"
            className={inputClass}
            value={String(bo.get('associationDirection') ?? 'None')}
            disabled={readOnly || !supported}
            onChange={(e) =>
              controller?.updateProperties(elementId, {
                associationDirection: e.target.value === 'None' ? undefined : e.target.value,
              })
            }
          >
            <option value="None">None</option>
            <option value="One">One (arrow at the target)</option>
            <option value="Both">Both</option>
          </select>
        </Row>
      )}
      {standardAttributes(bo)
        .filter(([k]) => !FLOW_FIELDS.includes(k))
        .map(([k, v]) => (
          <Row key={k} label={attributeLabel(k)} title={k}>
            <code className="font-mono text-xs">{v}</code>
          </Row>
        ))}
    </Section>
  );
}
