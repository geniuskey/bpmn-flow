/** Properties specific to one kind of element: gateways, data, activities, events, flows. */
import { getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { isCollection } from '@/editor/renderer/visuals';
import { loopKindOf, type LoopKind } from '@/editor/commands/LoopHandler';
import { useEditorStore } from '@/stores/editorStore';
import { Row, Section, TextField } from './fields';
import { inputClass, standardAttributes } from './shared';

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
            disabled={readOnly}
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
  return (
    <>
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
      <Row label="Compensation">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="For compensation"
            checked={bo.get('isForCompensation') === true}
            disabled={readOnly}
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
      {is(bo, 'bpmn:SequenceFlow') && (
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
      {source && is(source, 'bpmn:ExclusiveGateway') && (
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
      {standardAttributes(bo).map(([k, v]) => (
        <Row key={k} label={k}>
          <code className="font-mono text-xs">{v}</code>
        </Row>
      ))}
    </Section>
  );
}
