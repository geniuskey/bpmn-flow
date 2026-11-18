import { Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { readBounds } from '@/bpmn/di/di';
import {
  canBeParallelMultiple,
  DEFINITION_REQUIRED,
  humanizeType,
  isEditableConnection,
  isEditableShapeElement,
  labelOf,
  supportedEventDefinitions,
} from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { isCollection } from '@/editor/renderer/visuals';
import { Badge } from '@/components/ui/badge';
import type { BpmnData } from '@/editor/model';
import { alternativeTypes } from '@/editor/commands/ChangeTypeHandler';
import { loopKindOf, type LoopKind } from '@/editor/commands/LoopHandler';
import {
  REFERENCES,
  TIMER_TYPES,
  timerOf,
  type EventDetail,
  type TimerType,
} from '@/editor/commands/EventDetailHandler';
import { useDocumentStore } from '@/stores/documentStore';
import { useMetadataStore } from '@/stores/metadataStore';
import { parseNumber, type NUMERIC_FIELDS } from '@/analysis/estimates/metadata';
import { useEditorStore } from '@/stores/editorStore';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-start gap-2">
      <span className="flex h-8 items-center text-muted-foreground">{label}</span>
      <div className="flex min-h-8 min-w-0 items-center break-words">{children}</div>
    </div>
  );
}

const inputClass =
  'h-8 w-full rounded-md border bg-background px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

function NameField({ id, value, disabled }: { id: string; value: string; disabled: boolean }) {
  const controller = useEditorStore((s) => s.controller);
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) controller?.updateProperties(id, { name: draft });
  };
  return (
    <input
      aria-label="Name"
      className={inputClass}
      value={draft}
      disabled={disabled}
      placeholder={disabled ? '' : 'Unnamed'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function TextField({
  label,
  value,
  disabled,
  multiline,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const props = {
    'aria-label': label,
    value: draft,
    disabled,
    placeholder: disabled ? '' : placeholder,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea {...props} rows={3} className={`${inputClass} h-auto resize-y py-1.5`} />
  ) : (
    <input
      {...props}
      className={inputClass}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function formatValue(value: unknown): string {
  if (value && typeof value === 'object' && 'id' in value)
    return String((value as { id: unknown }).id);
  return String(value);
}

/** Standard BPMN attributes that are set on the element (read-only in Phase 1). */
function standardAttributes(bo: ModdleElement): [string, string][] {
  const record = bo as unknown as Record<string, unknown>;
  const out: [string, string][] = [];
  for (const prop of bo.$descriptor.properties) {
    if (
      ['id', 'name', 'incoming', 'outgoing', 'sourceRef', 'targetRef', 'flowNodeRef'].includes(
        prop.name,
      )
    )
      continue;
    if (!(prop.isAttr || prop.isReference) || prop.isMany) continue;
    if (!Object.prototype.hasOwnProperty.call(record, prop.name)) continue;
    const value = record[prop.name];
    if (value === undefined) continue;
    out.push([prop.name, formatValue(value)]);
  }
  return out;
}

function ElementDetails({ id }: { id: string }) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  const element = controller?.getElement(id) as (BpmnData & { id: string }) | undefined;
  if (!element?.businessObject) return null;
  const bo = element.businessObject;
  const supported =
    isEditableShapeElement(bo) ||
    isEditableConnection(bo) ||
    ['bpmn:Participant', 'bpmn:Lane', 'bpmn:Process', 'bpmn:Collaboration'].includes(bo.$type);
  const docs = getMany<ModdleElement & { text?: string }>(bo, 'documentation');
  const attrs = Object.entries(bo.$attrs ?? {}).filter(([k]) => !k.startsWith('xmlns'));
  const bounds = readBounds(element.di);
  const condition = getRef<ModdleElement & { body?: string }>(bo, 'conditionExpression');
  const source = getRef(bo, 'sourceRef');
  const target = getRef(bo, 'targetRef');
  const alternatives = supported ? alternativeTypes(bo.$type) : [];
  const eventDefs = supported ? supportedEventDefinitions(bo.$type) : [];

  return (
    <>
      <Section title="Element">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{humanizeType(bo.$type)}</span>
          {!supported && (
            <Badge variant="warning">
              <Lock className="size-3" /> Not editable
            </Badge>
          )}
        </div>
        <Row label="ID">
          <code className="font-mono text-xs">{bo.id}</code>
        </Row>
        <Row label="Name">
          <NameField
            key={`${element.id}:${labelOf(bo) ?? ''}`}
            id={element.id}
            value={labelOf(bo) ?? ''}
            disabled={readOnly || !supported}
          />
        </Row>
        {alternatives.length > 0 && (
          <Row label="Type">
            <select
              aria-label="Element type"
              className={inputClass}
              value={bo.$type}
              disabled={readOnly}
              onChange={(e) => controller?.changeType(element.id, e.target.value)}
            >
              {[bo.$type, ...alternatives].map((t) => (
                <option key={t} value={t}>
                  {humanizeType(t)}
                </option>
              ))}
            </select>
          </Row>
        )}
        {eventDefs.length > 0 && (
          <EventTriggerFields
            elementId={element.id}
            event={bo}
            allowed={eventDefs}
            readOnly={readOnly}
          />
        )}
        {supported && is(bo, 'bpmn:EventBasedGateway') && (
          <>
            <Row label="Instantiate">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Instantiate"
                  checked={bo.get('instantiate') === true}
                  disabled={readOnly}
                  onChange={(e) =>
                    controller?.updateProperties(element.id, {
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
                    controller?.updateProperties(element.id, {
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
        )}
        {is(bo, 'bpmn:Participant') && is(bo.$parent, 'bpmn:Collaboration') && (
          <BlackBoxField elementId={element.id} pool={bo} readOnly={readOnly} />
        )}
        {supported &&
          ((is(bo, 'bpmn:DataObjectReference') && getRef(bo, 'dataObjectRef')) ||
            is(bo, 'bpmn:DataInput') ||
            is(bo, 'bpmn:DataOutput')) && (
            <Row label="Collection">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Collection"
                  checked={isCollection(bo)}
                  disabled={readOnly}
                  onChange={(e) =>
                    controller?.updateProperties(element.id, {
                      isCollection: e.target.checked || undefined,
                    })
                  }
                />
                <span className="text-muted-foreground">Collection of data</span>
              </label>
            </Row>
          )}
        {supported && is(bo, 'bpmn:ChoreographyActivity') && (
          <ChoreographyFields elementId={element.id} activity={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:Activity') && (
          <>
            <Row label="Loop">
              <select
                aria-label="Loop"
                className={inputClass}
                value={loopKindOf(bo)}
                disabled={readOnly}
                onChange={(e) => controller?.setLoop(element.id, e.target.value as LoopKind)}
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
                    controller?.updateProperties(element.id, {
                      isForCompensation: e.target.checked || undefined,
                    })
                  }
                />
                <span className="text-muted-foreground">Compensation activity</span>
              </label>
            </Row>
          </>
        )}
        {eventDefs.length > 0 &&
          getMany(bo, 'eventDefinitions').map((definition, index, all) => (
            <EventDetailFields
              key={`${definition.$type}:${index}`}
              elementId={element.id}
              definition={definition}
              definitionIndex={index}
              prefix={all.length > 1 ? triggerLabel(definition.$type) : undefined}
              readOnly={readOnly}
            />
          ))}
        {(is(bo, 'bpmn:BoundaryEvent') ||
          (is(bo, 'bpmn:StartEvent') && bo.$parent?.get('triggeredByEvent') === true)) && (
          <Row label="Interrupting">
            <input
              type="checkbox"
              aria-label="Interrupting"
              checked={
                bo.get(is(bo, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting') !== false
              }
              disabled={readOnly}
              onChange={(e) =>
                controller?.updateProperties(element.id, {
                  [is(bo, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting']:
                    e.target.checked,
                })
              }
            />
          </Row>
        )}
        <Row label="Description">
          <TextField
            key={`${element.id}:doc:${docs[0]?.text ?? ''}`}
            label="Description"
            multiline
            value={docs[0]?.text ?? ''}
            disabled={readOnly || !supported}
            placeholder="Add a description"
            onCommit={(v) => controller?.updateDocumentation(element.id, v)}
          />
        </Row>
      </Section>

      {(source || target || standardAttributes(bo).length > 0) && (
        <Section title="BPMN properties">
          {source && <Row label="Source">{source.name || source.id}</Row>}
          {target && <Row label="Target">{target.name || target.id}</Row>}
          {is(bo, 'bpmn:SequenceFlow') && (
            <Row label="Condition">
              <TextField
                key={`${element.id}:cond:${condition?.body ?? ''}`}
                label="Condition expression"
                value={condition?.body ?? ''}
                disabled={readOnly || !supported}
                placeholder="e.g. ${approved}"
                onCommit={(v) => controller?.updateCondition(element.id, v)}
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
      )}

      {attrs.length > 0 && (
        <Section title="Extension attributes">
          {attrs.map(([k, v]) => (
            <Row key={k} label={k}>
              <code className="font-mono text-xs">{v}</code>
            </Row>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Preserved on export. Not editable here.
          </p>
        </Section>
      )}

      {(is(bo, 'bpmn:FlowNode') || is(bo, 'bpmn:Participant') || is(bo, 'bpmn:Lane')) && bo.id && (
        <MetadataSection elementId={bo.id} />
      )}

      {bounds && (
        <Section title="Diagram">
          <Row label="Position">
            <span className="tabular-nums">
              {bounds.x}, {bounds.y}
            </span>
          </Row>
          <Row label="Size">
            <span className="tabular-nums">
              {bounds.width} × {bounds.height}
            </span>
          </Row>
        </Section>
      )}
    </>
  );
}

function ChoreographyFields({
  elementId,
  activity,
  readOnly,
}: {
  elementId: string;
  activity: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  let choreography = activity.$parent;
  while (choreography && !is(choreography, 'bpmn:Choreography'))
    choreography = choreography.$parent;
  const participants = getMany(choreography, 'participants');
  const refs = getMany(activity, 'participantRef');
  return (
    <>
      {(['Initiating', 'Receiving'] as const).map((label, slot) => (
        <Row key={label} label={label}>
          <select
            aria-label={`${label} participant`}
            className={inputClass}
            value={refs[slot]?.id ?? ''}
            disabled={readOnly}
            onChange={(e) =>
              controller?.setChoreographyParticipant(elementId, slot as 0 | 1, {
                participantId: e.target.value,
              })
            }
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </Row>
      ))}
      <Row label="New participant">
        <TextField
          key={`${elementId}:newParticipant:${participants.length}`}
          label="New receiving participant"
          value=""
          disabled={readOnly}
          placeholder="Name (becomes receiving)"
          onCommit={(v) =>
            v.trim() && controller?.setChoreographyParticipant(elementId, 1, { newName: v })
          }
        />
      </Row>
    </>
  );
}

const TIMER_LABELS: Record<TimerType, string> = {
  timeDuration: 'Duration (e.g. PT2H)',
  timeDate: 'Date (e.g. 2026-12-01T09:00)',
  timeCycle: 'Cycle (e.g. R/P1W)',
};

/** Timer expression, referenced message/signal/error/escalation, or condition. */
function EventDetailFields({
  elementId,
  definition,
  definitionIndex,
  prefix,
  readOnly,
}: {
  elementId: string;
  definition: ModdleElement;
  definitionIndex: number;
  /** Trigger name shown before each label on Multiple events. */
  prefix?: string;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const update = (detail: EventDetail) =>
    controller?.updateEventDetail(elementId, detail, definitionIndex);
  const rowLabel = (label: string) => (prefix ? `${prefix} ${label.toLowerCase()}` : label);
  if (is(definition, 'bpmn:TimerEventDefinition')) {
    const timer = timerOf(definition) ?? { timerType: 'timeDuration' as TimerType, value: '' };
    return (
      <>
        <Row label={rowLabel('Timer')}>
          <select
            aria-label="Timer type"
            className={inputClass}
            value={timer.timerType}
            disabled={readOnly}
            onChange={(e) =>
              update({
                kind: 'timer',
                timerType: e.target.value as TimerType,
                value: timer.value,
              })
            }
          >
            {TIMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TIMER_LABELS[t]}
              </option>
            ))}
          </select>
        </Row>
        <Row label={rowLabel('Expression')}>
          <TextField
            key={`${elementId}:${definitionIndex}:timer:${timer.timerType}:${timer.value}`}
            label="Timer expression"
            value={timer.value}
            disabled={readOnly}
            placeholder="ISO 8601"
            onCommit={(v) =>
              update({
                kind: 'timer',
                timerType: timer.timerType,
                value: v,
              })
            }
          />
        </Row>
      </>
    );
  }
  if (is(definition, 'bpmn:ConditionalEventDefinition')) {
    const condition =
      getRef<ModdleElement & { body?: string }>(definition, 'condition')?.body ?? '';
    return (
      <Row label={rowLabel('Condition')}>
        <TextField
          key={`${elementId}:${definitionIndex}:condition:${condition}`}
          label="Event condition"
          value={condition}
          disabled={readOnly}
          onCommit={(v) => update({ kind: 'condition', value: v })}
        />
      </Row>
    );
  }
  const reference = REFERENCES[definition.$type];
  if (!reference) return null;
  const current = getRef(definition, reference[0]);
  const label = humanizeType(reference[1]);
  return (
    <Row label={rowLabel(label)}>
      <TextField
        key={`${elementId}:${definitionIndex}:ref:${current?.name ?? ''}`}
        label={`${label} name`}
        value={current?.name ?? ''}
        disabled={readOnly}
        placeholder={`${label} name`}
        onCommit={(v) => update({ kind: 'reference', name: v })}
      />
    </Row>
  );
}

/** Black-box pool: a participant without a process. Collapsing needs an empty pool. */
function BlackBoxField({
  elementId,
  pool,
  readOnly,
}: {
  elementId: string;
  pool: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const blackBox = !getRef(pool, 'processRef');
  const blocker = blackBox ? null : (controller?.poolBlackBoxBlocker(elementId) ?? null);
  return (
    <Row label="Black box">
      <label className="flex items-center gap-2" title={blocker ?? undefined}>
        <input
          type="checkbox"
          aria-label="Black-box pool"
          checked={blackBox}
          disabled={readOnly || !!blocker}
          onChange={(e) => controller?.setPoolBlackBox(elementId, e.target.checked)}
        />
        <span className="text-muted-foreground">{blocker ?? 'No process; content hidden'}</span>
      </label>
    </Row>
  );
}

/** "bpmn:TimerEventDefinition" -> "Timer" */
function triggerLabel(type: string): string {
  return humanizeType(type).replace(/ Event Definition$/, '');
}

/**
 * Event trigger: none, one definition, or several (BPMN "Multiple"; catching
 * events can also be "Parallel Multiple").
 */
function EventTriggerFields({
  elementId,
  event,
  allowed,
  readOnly,
}: {
  elementId: string;
  event: ModdleElement;
  allowed: readonly string[];
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const types = getMany(event, 'eventDefinitions').map((d) => d.$type);
  const multiple = types.length > 1;
  const remaining = allowed.filter((t) => !types.includes(t));
  const required = DEFINITION_REQUIRED.includes(event.$type);
  const set = (next: string[]) => controller?.setEventDefinitions(elementId, next);
  return (
    <>
      <Row label="Event type">
        <select
          aria-label="Event definition"
          className={inputClass}
          value={multiple ? '__multiple' : (types[0] ?? '')}
          disabled={readOnly}
          onChange={(e) => {
            if (e.target.value !== '__multiple') set(e.target.value ? [e.target.value] : []);
          }}
        >
          {!required && <option value="">None</option>}
          {allowed.map((t) => (
            <option key={t} value={t}>
              {triggerLabel(t)}
            </option>
          ))}
          {multiple && (
            <option value="__multiple">
              {event.get('parallelMultiple') === true ? 'Parallel multiple' : 'Multiple'}
            </option>
          )}
        </select>
      </Row>
      {multiple && (
        <Row label="Triggers">
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <Badge key={t} className="gap-1">
                {triggerLabel(t)}
                <button
                  type="button"
                  aria-label={`Remove ${triggerLabel(t)} trigger`}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => set(types.filter((x) => x !== t))}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        </Row>
      )}
      {types.length > 0 && remaining.length > 0 && (
        <Row label={multiple ? 'Add trigger' : 'Multiple'}>
          <select
            aria-label="Add trigger"
            className={inputClass}
            value=""
            disabled={readOnly}
            onChange={(e) => {
              if (e.target.value) set([...types, e.target.value]);
            }}
          >
            <option value="">Add trigger…</option>
            {remaining.map((t) => (
              <option key={t} value={t}>
                {triggerLabel(t)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {multiple && canBeParallelMultiple(event) && (
        <Row label="Parallel">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Parallel multiple"
              checked={event.get('parallelMultiple') === true}
              disabled={readOnly}
              onChange={(e) =>
                controller?.updateProperties(elementId, {
                  parallelMultiple: e.target.checked || undefined,
                })
              }
            />
            <span className="text-muted-foreground">All triggers required</span>
          </label>
        </Row>
      )}
    </>
  );
}

function MetadataSection({ elementId }: { elementId: string }) {
  const meta = useMetadataStore((s) => s.byElement[elementId]);
  const update = useMetadataStore((s) => s.update);
  const enabled = useMetadataStore((s) => !!s.documentId);
  const num = (key: (typeof NUMERIC_FIELDS)[number], label: string, unit: string) => (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        <TextField
          key={`${elementId}:${key}:${meta?.[key] ?? ''}`}
          label={label}
          value={meta?.[key] === undefined ? '' : String(meta[key])}
          disabled={!enabled}
          placeholder="—"
          onCommit={(v) => update(elementId, { [key]: parseNumber(v) })}
        />
        <span className="w-10 shrink-0 text-[11px] text-muted-foreground">{unit}</span>
      </div>
    </Row>
  );
  return (
    <Section title="Analysis metadata">
      <Row label="Owner">
        <TextField
          key={`${elementId}:owner:${meta?.owner ?? ''}`}
          label="Owner"
          value={meta?.owner ?? ''}
          disabled={!enabled}
          placeholder="Role or team"
          onCommit={(v) => update(elementId, { owner: v.trim() || undefined })}
        />
      </Row>
      {num('durationMinutes', 'Duration', 'min')}
      {num('waitingMinutes', 'Waiting', 'min')}
      {num('cost', 'Cost', 'each')}
      {num('frequency', 'Frequency', 'runs')}
      <Row label="Notes">
        <TextField
          key={`${elementId}:notes:${meta?.notes ?? ''}`}
          label="Notes"
          multiline
          value={meta?.notes ?? ''}
          disabled={!enabled}
          onCommit={(v) => update(elementId, { notes: v.trim() || undefined })}
        />
      </Row>
      <p className="text-[11px] text-muted-foreground">
        Stored in this browser only, not in the BPMN file.
      </p>
    </Section>
  );
}

function DocumentDetails() {
  const doc = useDocumentStore((s) => s.doc);
  const controller = useEditorStore((s) => s.controller);
  if (!doc) return <p className="p-4 text-muted-foreground">No document open.</p>;
  const defs = doc.definitions as ModdleElement & {
    targetNamespace?: string;
    exporter?: string;
    exporterVersion?: string;
  };
  const rootId = controller?.getRootId();
  return (
    <>
      <Section title="Document">
        <Row label="Definitions">
          <code className="font-mono text-xs">{defs.id}</code>
        </Row>
        {defs.targetNamespace && (
          <Row label="Namespace">
            <code className="font-mono text-xs">{defs.targetNamespace}</code>
          </Row>
        )}
        {defs.exporter && (
          <Row label="Exporter">
            {defs.exporter} {defs.exporterVersion}
          </Row>
        )}
      </Section>
      {rootId && controller?.getElement(rootId) && <ElementDetails id={rootId} />}
      <p className="px-4 py-3 text-muted-foreground">
        Select an element on the canvas to inspect it.
      </p>
    </>
  );
}

export function Inspector() {
  const selection = useEditorStore((s) => s.snapshot.selection);
  // Re-render on model changes so values reflect undo/redo.
  useEditorStore((s) => s.snapshot.revision);

  return (
    <aside
      aria-label="Properties"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-card"
      data-testid="inspector"
    >
      <div className="flex h-9 shrink-0 items-center border-b px-4 font-semibold">Properties</div>
      {selection.length === 0 && <DocumentDetails />}
      {selection.length === 1 && <ElementDetails id={selection[0]!} />}
      {selection.length > 1 && (
        <p className="p-4 text-muted-foreground">{selection.length} elements selected.</p>
      )}
    </aside>
  );
}
