/** Participant fields: choreography initiator / participants and the black-box pool toggle. */
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { useEditorStore } from '@/stores/editorStore';
import { Row, TextField } from './fields';
import { inputClass } from './shared';

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
