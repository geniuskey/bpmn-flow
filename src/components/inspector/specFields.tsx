/**
 * Notation-relevant BPMN 2.0.2 attributes: gateway direction and activation
 * condition, expression kind and language, sequence flow isImmediate, text
 * annotation format, process type / isClosed / isExecutable, group categories
 * and the categories of flow elements, error / escalation codes, compensation
 * targets, and new processes / global tasks for call activities.
 */
import {
  conditionAllowedFrom,
  conditionBlocker,
  humanizeType,
  sequenceFlowsAt,
} from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { CALLABLE_TYPES, categoryValues } from '@/editor/commands/ElementDetailHandler';
import { compensableActivities } from '@/editor/commands/EventDetailHandler';
import type { ElementDetail } from '@/editor/types';
import { useEditorStore } from '@/stores/editorStore';
import { CheckField, Row, TextField } from './fields';
import { inputClass } from './shared';

type Props = { elementId: string; bo: ModdleElement; readOnly: boolean };

const DIRECTIONS = ['Unspecified', 'Converging', 'Diverging', 'Mixed'] as const;

/** Gateway direction (Table 8.46, PDF 118-119) and a complex gateway's activation condition. */
export function GatewayFields({ elementId, bo, readOnly }: Props) {
  const controller = useEditorStore((s) => s.controller);
  const count = (key: 'incoming' | 'outgoing') => sequenceFlowsAt(bo, key).length;
  const current = String(bo.get('gatewayDirection') ?? 'Unspecified');
  const fits = (d: string) =>
    d === current ||
    ((d !== 'Converging' || count('outgoing') <= 1) &&
      (d !== 'Diverging' || count('incoming') <= 1));
  return (
    <>
      <Row label="Direction">
        <select
          aria-label="Gateway direction"
          className={inputClass}
          value={current}
          disabled={readOnly}
          onChange={(e) =>
            controller?.updateProperties(elementId, { gatewayDirection: e.target.value })
          }
        >
          {DIRECTIONS.map((d) => (
            <option key={d} value={d} disabled={!fits(d)}>
              {d}
            </option>
          ))}
        </select>
      </Row>
      {is(bo, 'bpmn:ComplexGateway') && (
        <ExpressionFields
          elementId={elementId}
          owner={bo}
          property="activationCondition"
          label="Activation"
          placeholder="e.g. 3 of 5 branches arrived"
          disabled={readOnly}
        />
      )}
    </>
  );
}

/**
 * An expression attribute: its text, whether it is a natural-language
 * Expression or a FormalExpression, and the formal expression's language
 * (§8.4.6, PDF 112-114).
 */
export function ExpressionFields({
  elementId,
  owner,
  property,
  label,
  placeholder,
  disabled,
  blocker,
}: {
  elementId: string;
  owner: ModdleElement;
  property: 'conditionExpression' | 'activationCondition';
  label: string;
  placeholder: string;
  disabled: boolean;
  /** Why a new expression cannot be added (it can still be edited or removed). */
  blocker?: string | null;
}) {
  const controller = useEditorStore((s) => s.controller);
  const expr = getRef<ModdleElement & { body?: string }>(owner, property);
  const body = expr?.body ?? '';
  const formal = !expr || is(expr, 'bpmn:FormalExpression');
  const language = (expr?.get('language') as string | undefined) ?? '';
  const set = (next: Partial<Extract<ElementDetail, { kind: 'expression' }>>) =>
    controller?.updateElementDetail(elementId, {
      kind: 'expression',
      property,
      body,
      formal,
      language: language || undefined,
      ...next,
    });
  return (
    <>
      <Row label={label}>
        <span className="w-full" title={!expr && blocker ? blocker : undefined}>
          <TextField
            key={`${elementId}:${property}:${body}`}
            label={
              property === 'conditionExpression' ? 'Condition expression' : 'Activation condition'
            }
            value={body}
            disabled={disabled || (!expr && !!blocker)}
            placeholder={placeholder}
            onCommit={(v) => set({ body: v })}
          />
        </span>
      </Row>
      {expr && (
        <Row label="Expression">
          <select
            aria-label={`${label} kind`}
            className={inputClass}
            value={formal ? 'formal' : 'natural'}
            disabled={disabled}
            onChange={(e) => set({ formal: e.target.value === 'formal' })}
          >
            <option value="natural">Natural language</option>
            <option value="formal">Formal expression</option>
          </select>
        </Row>
      )}
      {expr && formal && (
        <Row label="Language">
          <TextField
            key={`${elementId}:${property}:language:${language}`}
            label={`${label} language`}
            value={language}
            disabled={disabled}
            placeholder="Default: XPath (URI)"
            onCommit={(v) => set({ language: v || undefined })}
          />
        </Row>
      )}
    </>
  );
}

/** Sequence flow condition (with its kind and language) and isImmediate (PDF 125, 338-339). */
export function SequenceFlowFields({ elementId, bo, readOnly }: Props) {
  const controller = useEditorStore((s) => s.controller);
  const executable = (() => {
    for (let p = bo.$parent; p; p = p.$parent) {
      if (is(p, 'bpmn:Process')) return p.get('isExecutable') === true;
    }
    return false;
  })();
  const immediate = bo.get('isImmediate') as boolean | undefined;
  const conditional =
    conditionAllowedFrom(getRef(bo, 'sourceRef')) || !!getRef(bo, 'conditionExpression');
  return (
    <>
      {conditional && (
        <ExpressionFields
          elementId={elementId}
          owner={bo}
          property="conditionExpression"
          label="Condition"
          placeholder="e.g. ${approved}"
          disabled={readOnly}
          blocker={conditionBlocker(bo)}
        />
      )}
      <Row label="Immediate">
        <select
          aria-label="Immediate"
          className={inputClass}
          value={immediate === undefined ? '' : String(immediate)}
          disabled={readOnly}
          onChange={(e) =>
            controller?.updateProperties(elementId, {
              isImmediate: e.target.value === '' ? undefined : e.target.value === 'true',
            })
          }
        >
          <option value="">Not set</option>
          <option value="true">Immediate: nothing unmodeled in between</option>
          {/* Executable processes cannot have isImmediate="false" (PDF 339). */}
          <option value="false" disabled={executable && immediate !== false}>
            Not immediate: unmodeled steps may occur
          </option>
        </select>
      </Row>
    </>
  );
}

const TEXT_FORMATS = ['text/plain', 'text/html', 'text/markdown'];

/** Text annotation textFormat (Table 8.24, PDF 100). */
export function TextFormatField({ elementId, bo, readOnly }: Props) {
  const controller = useEditorStore((s) => s.controller);
  const current = (bo.get('textFormat') as string | undefined) ?? 'text/plain';
  const formats = TEXT_FORMATS.includes(current) ? TEXT_FORMATS : [...TEXT_FORMATS, current];
  return (
    <Row label="Text format">
      <select
        aria-label="Text format"
        className={inputClass}
        value={current}
        disabled={readOnly}
        onChange={(e) => controller?.updateProperties(elementId, { textFormat: e.target.value })}
      >
        {formats.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** Process type, isClosed and isExecutable (Table 10.1, PDF 341); on a pool, of its process. */
export function ProcessFields({ elementId, bo, readOnly }: Props) {
  const controller = useEditorStore((s) => s.controller);
  const process = is(bo, 'bpmn:Participant') ? getRef(bo, 'processRef') : bo;
  if (!process || !is(process, 'bpmn:Process') || is(process, 'bpmn:Choreography')) return null;
  const type = String(process.get('processType') ?? 'None');
  return (
    <>
      <Row label="Process type">
        <select
          aria-label="Process type"
          className={inputClass}
          value={type}
          disabled={readOnly}
          onChange={(e) =>
            controller?.updateProperties(elementId, {
              processType: e.target.value === 'None' ? undefined : e.target.value,
            })
          }
        >
          <option value="None">None (undefined)</option>
          <option value="Private">Private (internal)</option>
          <option value="Public">Public (visible to partners)</option>
        </select>
      </Row>
      <Row label="Closed">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Closed process"
            checked={process.get('isClosed') === true}
            disabled={readOnly}
            onChange={(e) =>
              controller?.updateProperties(elementId, { isClosed: e.target.checked || undefined })
            }
          />
          <span className="text-muted-foreground">Only modeled interactions occur</span>
        </label>
      </Row>
      <Row label="Executable">
        <CheckField
          label="Executable process"
          text="Can be run by a process engine"
          checked={process.get('isExecutable') === true}
          disabled={readOnly}
          onChange={(checked) => controller?.updateProperties(elementId, { isExecutable: checked })}
        />
      </Row>
    </>
  );
}

/** A group's Category, shared by name between groups (PDF 98-99), and categorizing its contents. */
export function GroupFields({ elementId, bo, readOnly }: Props) {
  const controller = useEditorStore((s) => s.controller);
  const value = getRef(bo, 'categoryValueRef');
  const category = is(value?.$parent, 'bpmn:Category') ? value!.$parent : undefined;
  let definitions: ModdleElement | undefined = bo;
  while (definitions?.$parent) definitions = definitions.$parent;
  const categories = getMany(definitions, 'rootElements').filter(
    (r) => is(r, 'bpmn:Category') && r.name,
  );
  const name = (category?.name as string | undefined) ?? '';
  return (
    <>
      <Row label="Category">
        <TextField
          key={`${elementId}:category:${name}`}
          label="Category"
          value={name}
          disabled={readOnly}
          placeholder="Shown as “Category: name”"
          list={`${elementId}-categories`}
          onCommit={(v) =>
            controller?.updateElementDetail(elementId, { kind: 'groupCategory', name: v })
          }
        />
        <datalist id={`${elementId}-categories`}>
          {categories.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      </Row>
      <Row label="Contents">
        <button
          type="button"
          className="h-8 rounded-md border px-2.5 hover:bg-muted disabled:opacity-60"
          disabled={readOnly || !value}
          onClick={() => controller?.updateElementDetail(elementId, { kind: 'categorizeContents' })}
        >
          Assign to elements inside
        </button>
      </Row>
    </>
  );
}

/** The CategoryValues a flow element carries (categoryValueRef, Table 8.44). */
export function CategoryValueFields({ elementId, bo, readOnly }: Props) {
  const controller = useEditorStore((s) => s.controller);
  let definitions: ModdleElement | undefined = bo;
  while (definitions?.$parent) definitions = definitions.$parent;
  const values = definitions ? categoryValues(definitions).filter((v) => v.id) : [];
  if (!values.length) return null;
  const assigned = getMany(bo, 'categoryValueRef');
  return (
    <Row label="Categories">
      <div className="flex flex-col gap-1">
        {values.map((v) => {
          const category = v.$parent?.name as string | undefined;
          const text = (v.get('value') as string | undefined) || v.id;
          return (
            <label key={v.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Category ${text}`}
                checked={assigned.includes(v)}
                disabled={readOnly}
                onChange={(e) =>
                  controller?.updateElementDetail(elementId, {
                    kind: 'categoryValue',
                    id: v.id!,
                    assigned: e.target.checked,
                  })
                }
              />
              <span>{category ? `${category}: ${text}` : text}</span>
            </label>
          );
        })}
      </div>
    </Row>
  );
}

/** Error / escalation code of the referenced Error / Escalation (Tables 8.41-8.42). */
export function EventCodeField({
  elementId,
  definition,
  definitionIndex,
  readOnly,
}: {
  elementId: string;
  definition: ModdleElement;
  definitionIndex: number;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const error = is(definition, 'bpmn:ErrorEventDefinition');
  const ref = getRef(definition, error ? 'errorRef' : 'escalationRef');
  const code = (ref?.get(error ? 'errorCode' : 'escalationCode') as string | undefined) ?? '';
  const label = error ? 'Error code' : 'Escalation code';
  return (
    <Row label={label}>
      <TextField
        key={`${elementId}:${definitionIndex}:code:${code}`}
        label={label}
        value={code}
        disabled={readOnly || !ref}
        placeholder={ref ? 'Matched by catching events' : 'Name it first'}
        onCommit={(v) =>
          controller?.updateEventDetail(elementId, { kind: 'code', value: v }, definitionIndex)
        }
      />
    </Row>
  );
}

/** Compensation throw: the activity to compensate and waitForCompletion (Table 10.94). */
export function CompensationFields({
  elementId,
  event,
  definition,
  definitionIndex,
  readOnly,
}: {
  elementId: string;
  event: ModdleElement;
  definition: ModdleElement;
  definitionIndex: number;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const current = getRef(definition, 'activityRef');
  const options = compensableActivities(event);
  const update = (detail: Parameters<NonNullable<typeof controller>['updateEventDetail']>[1]) =>
    controller?.updateEventDetail(elementId, detail, definitionIndex);
  return (
    <>
      <Row label="Compensate">
        <select
          aria-label="Activity to compensate"
          className={inputClass}
          value={current?.id ?? ''}
          disabled={readOnly}
          onChange={(e) =>
            update({ kind: 'compensateActivity', activityId: e.target.value || null })
          }
        >
          <option value="">All completed activities</option>
          {current && !options.includes(current) && (
            <option value={current.id}>{current.name || current.id}</option>
          )}
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || `${humanizeType(a.$type)} ${a.id}`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Wait">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Wait for completion"
            checked={definition.get('waitForCompletion') !== false}
            disabled={readOnly}
            onChange={(e) => update({ kind: 'waitForCompletion', value: e.target.checked })}
          />
          <span className="text-muted-foreground">Continue after compensation is done</span>
        </label>
      </Row>
    </>
  );
}

const CALLABLE_LABELS: Record<string, string> = {
  'bpmn:Process': 'New process',
  'bpmn:GlobalTask': 'New global task',
  'bpmn:GlobalUserTask': 'New global user task',
  'bpmn:GlobalManualTask': 'New global manual task',
  'bpmn:GlobalScriptTask': 'New global script task',
  'bpmn:GlobalBusinessRuleTask': 'New global business rule task',
};

/** Creates a process or global task for a call activity to call (§10.3.5, PDF 212-215). */
export function NewCalledElementField({
  elementId,
  readOnly,
}: {
  elementId: string;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  return (
    <Row label="">
      <select
        aria-label="Create called element"
        className={inputClass}
        value=""
        disabled={readOnly}
        onChange={(e) => {
          if (!e.target.value) return;
          controller?.updateElementDetail(elementId, {
            kind: 'newCalledElement',
            type: e.target.value as Extract<ElementDetail, { kind: 'newCalledElement' }>['type'],
          });
        }}
      >
        <option value="">Create and call…</option>
        {CALLABLE_TYPES.map((t) => (
          <option key={t} value={t}>
            {CALLABLE_LABELS[t]}
          </option>
        ))}
      </select>
    </Row>
  );
}
