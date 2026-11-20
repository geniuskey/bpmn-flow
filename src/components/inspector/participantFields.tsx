/** Participant fields: choreography bands, initiator and called element, call conversations, black-box, boundary and multiplicity of pools. */
import type { Element } from 'diagram-js/lib/model/Types';
import { humanizeType } from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { Button } from '@/components/ui/button';
import { bandOrder, takesMoreParticipants } from '@/editor/commands/ChoreographyParticipantHandler';
import { showsBandMessages } from '@/editor/modeling/choreography';
import type { BandOp, ElementDetail } from '@/editor/types';
import { useEditorStore } from '@/stores/editorStore';
import { Row, TextField } from './fields';
import { inputClass } from './shared';

const LOOP_TYPES = [
  ['None', 'None'],
  ['Standard', 'Loop'],
  ['MultiInstanceParallel', 'Multi-instance (parallel)'],
  ['MultiInstanceSequential', 'Multi-instance (sequential)'],
] as const;

const POSITION_LABEL = { top: 'Top band', middle: 'Middle band', bottom: 'Bottom band' } as const;

function rootElementsOf(el: ModdleElement): ModdleElement[] {
  let defs: ModdleElement | undefined = el;
  while (defs?.$parent) defs = defs.$parent;
  return getMany(defs, 'rootElements');
}

function encloses(outer: ModdleElement, el: ModdleElement): boolean {
  for (let p: ModdleElement | undefined = el; p; p = p.$parent) if (p === outer) return true;
  return false;
}

const optionLabel = (r: ModdleElement) =>
  r.name ? `${r.name} (${humanizeType(r.$type)})` : `${r.id} (${humanizeType(r.$type)})`;

/**
 * Choreography activity (BPMN 2.0.2 §11.5, Table 12.33): its participant
 * bands top to bottom (participant, order, message decorator, multi-instance),
 * the initiator, further participants of sub- and call choreographies, the
 * return message of a two-way task, the loop type and the called element.
 */
export function ChoreographyFields({
  elementId,
  activity,
  readOnly,
}: {
  elementId: string;
  activity: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  useEditorStore((s) => s.snapshot.revision);
  const element = controller?.getElement(elementId) as Element | undefined;
  let choreography = activity.$parent;
  while (choreography && !is(choreography, 'bpmn:Choreography'))
    choreography = choreography.$parent;
  const participants = getMany(choreography, 'participants');
  const refs = getMany(activity, 'participantRef');
  const initiator = getRef(activity, 'initiatingParticipantRef');
  const bands = element ? bandOrder(element) : [];
  const run = (op: BandOp) => controller?.updateChoreographyBands(elementId, op);
  const messages = showsBandMessages(activity);
  const isTask = is(activity, 'bpmn:ChoreographyTask');
  const flows = getMany(activity, 'messageFlowRef');
  const initiating = flows.find((f) => getRef(f, 'sourceRef') === initiator);
  const returning = flows.find((f) => getRef(f, 'sourceRef') !== initiator);
  const messageName = (f: ModdleElement | undefined) =>
    (getRef(f, 'messageRef')?.name as string | undefined) ?? '';
  return (
    <>
      <Row label="Initiator">
        <select
          aria-label="Initiating participant"
          className={inputClass}
          value={initiator?.id ?? ''}
          disabled={readOnly}
          onChange={(e) => run({ op: 'initiator', participantId: e.target.value })}
        >
          {!initiator && <option value="">(none)</option>}
          {refs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
      </Row>
      {bands.map(({ band, position }, index) => {
        const p = getRef(band, 'bpmnElement');
        return (
          <div key={band.id ?? index} className="space-y-1 rounded-md border p-2">
            <Row label={POSITION_LABEL[position]}>
              <select
                aria-label={`${POSITION_LABEL[position]} participant`}
                className={inputClass}
                value={p?.id ?? ''}
                disabled={readOnly}
                onChange={(e) => run({ op: 'participant', index, participantId: e.target.value })}
              >
                {participants
                  .filter((x) => x === p || !refs.includes(x))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name || x.id}
                    </option>
                  ))}
              </select>
            </Row>
            <div className="flex flex-wrap items-center gap-2 pl-[104px] text-xs">
              <Button
                size="sm"
                variant="outline"
                aria-label="Move band up"
                disabled={readOnly || index === 0}
                onClick={() => run({ op: 'move', index, to: index - 1 })}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label="Move band down"
                disabled={readOnly || index === bands.length - 1}
                onClick={() => run({ op: 'move', index, to: index + 1 })}
              >
                ↓
              </Button>
              {bands.length > 2 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readOnly || p === initiator}
                  onClick={() => run({ op: 'remove', index })}
                >
                  Remove
                </Button>
              )}
              {messages && position !== 'middle' && (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    aria-label={`Show message of ${p?.name ?? 'participant'}`}
                    checked={band.get('isMessageVisible') === true}
                    disabled={readOnly}
                    onChange={(e) => run({ op: 'messageVisible', index, value: e.target.checked })}
                  />
                  Message
                </label>
              )}
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`Multi-instance ${p?.name ?? 'participant'}`}
                  checked={!!getRef(p, 'participantMultiplicity')}
                  disabled={readOnly || !p}
                  onChange={(e) => run({ op: 'multiplicity', index, value: e.target.checked })}
                />
                Multi-instance
              </label>
            </div>
          </div>
        );
      })}
      <Row label="New participant">
        <TextField
          key={`${elementId}:newParticipant:${participants.length}`}
          label={takesMoreParticipants(activity) ? 'New participant' : 'New receiving participant'}
          value=""
          disabled={readOnly}
          placeholder={
            takesMoreParticipants(activity) ? 'Name (adds a band)' : 'Name (becomes receiving)'
          }
          onCommit={(v) => {
            if (!v.trim()) return;
            if (takesMoreParticipants(activity)) run({ op: 'add', newName: v });
            else {
              const receiving = bands.findIndex(
                ({ band }) => getRef(band, 'bpmnElement') !== initiator,
              );
              run({ op: 'participant', index: Math.max(0, receiving), newName: v });
            }
          }}
        />
      </Row>
      {takesMoreParticipants(activity) && participants.some((x) => !refs.includes(x)) && (
        <Row label="Add">
          <select
            aria-label="Add participant"
            className={inputClass}
            value=""
            disabled={readOnly}
            onChange={(e) => e.target.value && run({ op: 'add', participantId: e.target.value })}
          >
            <option value="">Existing participant…</option>
            {participants
              .filter((x) => !refs.includes(x))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name || x.id}
                </option>
              ))}
          </select>
        </Row>
      )}
      {isTask && (
        <>
          <Row label="Message">
            <TextField
              key={`${elementId}:initiating:${messageName(initiating)}`}
              label="Initiating message"
              value={messageName(initiating)}
              disabled={readOnly || !initiating}
              placeholder="Initiating message name"
              onCommit={(v) => run({ op: 'message', direction: 'initiating', name: v })}
            />
          </Row>
          <Row label="Two-way">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Return message"
                checked={!!returning}
                disabled={readOnly}
                onChange={(e) => run({ op: 'returnMessage', value: e.target.checked })}
              />
              <span className="text-muted-foreground">Return message</span>
            </label>
          </Row>
          {returning && (
            <Row label="Return">
              <TextField
                key={`${elementId}:return:${messageName(returning)}`}
                label="Return message"
                value={messageName(returning)}
                disabled={readOnly}
                placeholder="Return message name"
                onCommit={(v) => run({ op: 'message', direction: 'return', name: v })}
              />
            </Row>
          )}
        </>
      )}
      <Row label="Loop">
        <select
          aria-label="Loop type"
          className={inputClass}
          value={(activity.get('loopType') as string | undefined) ?? 'None'}
          disabled={readOnly}
          onChange={(e) =>
            controller?.updateProperties(elementId, {
              loopType: e.target.value === 'None' ? undefined : e.target.value,
            })
          }
        >
          {LOOP_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      {is(activity, 'bpmn:CallChoreography') && (
        <CalledElementField
          elementId={elementId}
          bo={activity}
          readOnly={readOnly}
          property="calledChoreographyRef"
          options={rootElementsOf(activity).filter(
            (r) => is(r, 'bpmn:Choreography') && !encloses(r, activity),
          )}
          create={[
            ['bpmn:GlobalChoreographyTask', 'New global choreography task'],
            ['bpmn:Choreography', 'New choreography'],
          ]}
        />
      )}
    </>
  );
}

/**
 * What a call choreography or call conversation calls (PDF 163, 363): an
 * element of this file, or a new one. Global tasks / conversations give the
 * plain thick shape, choreographies / collaborations add the [+] marker.
 */
export function CalledElementField({
  elementId,
  bo,
  readOnly,
  property,
  options,
  create,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
  property: 'calledChoreographyRef' | 'calledCollaborationRef';
  options: ModdleElement[];
  create: [Extract<ElementDetail, { kind: 'newCalledElement' }>['type'], string][];
}) {
  const controller = useEditorStore((s) => s.controller);
  const current = getRef(bo, property);
  return (
    <Row label="Calls">
      <select
        aria-label="Called element"
        className={inputClass}
        value={current?.id ?? ''}
        disabled={readOnly}
        onChange={(e) => {
          const value = e.target.value;
          const made = create.find(([type]) => `new:${type}` === value);
          if (made) {
            controller?.updateElementDetail(elementId, {
              kind: 'newCalledElement',
              type: made[0],
              ...(bo.name ? { name: bo.name } : {}),
            });
            return;
          }
          controller?.updateProperties(elementId, {
            [property]: options.find((o) => o.id === value),
          });
        }}
      >
        <option value="">(nothing)</option>
        {current && !options.includes(current) && (
          <option value={current.id}>{optionLabel(current)}</option>
        )}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {optionLabel(r)}
          </option>
        ))}
        {create.map(([type, label]) => (
          <option key={type} value={`new:${type}`}>
            {label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** Call conversation: the collaboration or global conversation it calls (Table 12.34). */
export function CallConversationFields({
  elementId,
  bo,
  readOnly,
}: {
  elementId: string;
  bo: ModdleElement;
  readOnly: boolean;
}) {
  return (
    <CalledElementField
      elementId={elementId}
      bo={bo}
      readOnly={readOnly}
      property="calledCollaborationRef"
      options={rootElementsOf(bo).filter(
        (r) => is(r, 'bpmn:Collaboration') && !is(r, 'bpmn:Choreography') && !encloses(r, bo),
      )}
      create={[
        ['bpmn:GlobalConversation', 'New global conversation'],
        ['bpmn:Collaboration', 'New collaboration'],
      ]}
    />
  );
}

/** Black-box pool: a participant without a process. Collapsing needs an empty pool. */
export function BlackBoxField({
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

/**
 * Multi-instance pool (`participantMultiplicity`, Table 9.5, PDF 147): three
 * vertical lines at the bottom of the pool when the maximum is unbounded or
 * two or more.
 */
export function MultiplicityField({
  elementId,
  pool,
  readOnly,
}: {
  elementId: string;
  pool: ModdleElement;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const m = getRef(pool, 'participantMultiplicity');
  const own = (key: string) =>
    m && Object.prototype.hasOwnProperty.call(m, key) ? (m.get(key) as number) : undefined;
  const minimum = own('minimum') ?? 0;
  const maximum = own('maximum');
  const set = (value: { minimum: number; maximum?: number } | undefined) =>
    controller?.updateElementDetail(elementId, { kind: 'multiplicity', value });
  const parse = (v: string) => (v.trim() === '' ? undefined : Number(v.trim()));
  return (
    <>
      <Row label="Multi-instance">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Multi-instance participant"
            checked={!!m}
            disabled={readOnly}
            onChange={(e) => set(e.target.checked ? { minimum: 2 } : undefined)}
          />
          <span className="text-muted-foreground">Several participants of this kind</span>
        </label>
      </Row>
      {m && (
        <>
          <Row label="Minimum">
            <TextField
              key={`${elementId}:min:${minimum}`}
              label="Minimum participants"
              value={String(minimum)}
              disabled={readOnly}
              placeholder="0"
              onCommit={(v) => set({ minimum: parse(v) ?? 0, maximum })}
            />
          </Row>
          <Row label="Maximum">
            <TextField
              key={`${elementId}:max:${maximum ?? ''}`}
              label="Maximum participants"
              value={maximum === undefined ? '' : String(maximum)}
              disabled={readOnly}
              placeholder="Unbounded"
              onCommit={(v) => set({ minimum, maximum: parse(v) })}
            />
          </Row>
        </>
      )}
    </>
  );
}

/**
 * The main pool may be drawn without its boundary, its content directly on
 * the diagram (BPMN 2.0.2 §9.3, PDF 141-143); only one pool per diagram.
 */
export function PoolBoundaryField({
  elementId,
  readOnly,
}: {
  elementId: string;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const blocker = controller?.poolBoundaryBlocker(elementId) ?? null;
  return (
    <Row label="Boundary">
      <label className="flex items-center gap-2" title={blocker ?? undefined}>
        <input
          type="checkbox"
          aria-label="Pool boundary"
          checked
          disabled={readOnly || !!blocker}
          onChange={() => controller?.setPoolBoundary(elementId, false)}
        />
        <span className="text-muted-foreground">
          {blocker ?? 'Uncheck to draw the content without a pool'}
        </span>
      </label>
    </Row>
  );
}

/** Collaboration: the pool drawn without boundary, with a way to draw its boundary again. */
export function BoundlessPoolField({ readOnly }: { readOnly: boolean }) {
  const controller = useEditorStore((s) => s.controller);
  const participant = controller?.boundlessPool();
  if (!participant?.id) return null;
  const id = participant.id;
  return (
    <Row label="Main pool">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate">{participant.name || id}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly}
          onClick={() => controller?.setPoolBoundary(id, true)}
        >
          Show boundary
        </Button>
      </div>
    </Row>
  );
}
