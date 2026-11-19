/** Event fields: trigger type, timer, condition and the referenced message/signal/error/escalation. */
import { canBeParallelMultiple, definitionRequired, humanizeType } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { Badge } from '@/components/ui/badge';
import {
  REFERENCES,
  TIMER_TYPES,
  timerOf,
  type EventDetail,
  type TimerType,
} from '@/editor/commands/EventDetailHandler';
import { useEditorStore } from '@/stores/editorStore';
import { Row, TextField } from './fields';
import { inputClass, triggerLabel } from './shared';

const TIMER_LABELS: Record<TimerType, string> = {
  timeDuration: 'Duration (e.g. PT2H)',
  timeDate: 'Date (e.g. 2026-12-01T09:00)',
  timeCycle: 'Cycle (e.g. R/P1W)',
};

/** Timer expression, referenced message/signal/error/escalation, or condition. */
export function EventDetailFields({
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
  if (is(definition, 'bpmn:LinkEventDefinition')) {
    const name = (definition.get('name') as string | undefined) ?? '';
    return (
      <Row label={rowLabel('Link name')}>
        <TextField
          key={`${elementId}:${definitionIndex}:link:${name}`}
          label="Link name"
          value={name}
          disabled={readOnly}
          placeholder="Pairs a throwing and a catching link"
          onCommit={(v) => update({ kind: 'link', name: v })}
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

/**
 * Event trigger: none, one definition, or several (BPMN "Multiple"; catching
 * events can also be "Parallel Multiple").
 */
export function EventTriggerFields({
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
  const required = definitionRequired(event) && types.length > 0;
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
