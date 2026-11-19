/** Properties specific to one kind of element: gateways, data, activities, events, flows. */
import { canHaveDefaultFlow, conditionAllowedFrom } from '@/bpmn/model/elements';
import { messageVisibleKind } from '@/bpmn/di/di';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { isCollection } from '@/editor/renderer/visuals';
import { loopKindOf, type LoopKind } from '@/editor/commands/LoopHandler';
import { loopFieldValue, MI_BEHAVIORS } from '@/editor/commands/ElementDetailHandler';
import type { LoopField } from '@/editor/types';
import { useEditorStore } from '@/stores/editorStore';
import { Row, Section, TextField } from './fields';
import { inputClass, standardAttributes } from './shared';

/** Instantiating gateways and compensation activities have no sequence flows there (PDF 268, 328). */
function hasSequenceFlows(el: ModdleElement, key: 'incoming' | 'outgoing'): boolean {
  return getMany(el, key).some((f) => is(f, 'bpmn:SequenceFlow'));
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
            onCommit={(v) => controller?.updateProperties(elementId, { calledElement: v })}
          />
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
      <input
        type="checkbox"
        aria-label="Interrupting"
        checked={
          bo.get(is(bo, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting') !== false
        }
        disabled={readOnly}
        onChange={(e) =>
          controller?.updateProperties(elementId, {
            [is(bo, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting']: e.target.checked,
          })
        }
      />
    </Row>
  );
}

/** Attributes FlowProperties edits itself (not repeated as read-only rows). */
const FLOW_FIELDS = ['messageRef', 'associationDirection', 'calledElement'];

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
  const condition = getRef<ModdleElement & { body?: string }>(bo, 'conditionExpression');
  const source = getRef(bo, 'sourceRef');
  const target = getRef(bo, 'targetRef');
  return (
    <Section title="BPMN properties">
      {source && <Row label="Source">{source.name || source.id}</Row>}
      {target && <Row label="Target">{target.name || target.id}</Row>}
      {is(bo, 'bpmn:SequenceFlow') && (conditionAllowedFrom(source) || !!condition) && (
        <Row label="Condition">
          <TextField
            key={`${elementId}:cond:${condition?.body ?? ''}`}
            label="Condition expression"
            value={condition?.body ?? ''}
            disabled={readOnly || !supported}
            placeholder="e.g. ${approved}"
            onCommit={(v) => controller?.updateCondition(elementId, v)}
          />
        </Row>
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
          <Row key={k} label={k}>
            <code className="font-mono text-xs">{v}</code>
          </Row>
        ))}
    </Section>
  );
}
