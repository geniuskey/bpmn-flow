/** Analysis metadata of an element (owner, duration, waiting, cost, ...), stored locally, not in BPMN. */
import { useMetadataStore } from '@/stores/metadataStore';
import { parseNumber, type NUMERIC_FIELDS } from '@/analysis/estimates/metadata';
import { Row, Section, TextField } from './fields';

export function MetadataSection({ elementId }: { elementId: string }) {
  const meta = useMetadataStore((s) => s.byElement[elementId]);
  const update = useMetadataStore((s) => s.update);
  const enabled = useMetadataStore((s) => !!s.documentId);
  const num = (key: (typeof NUMERIC_FIELDS)[number], label: string, unit: string) => (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] text-muted-foreground" aria-hidden="true">
        {label} <span className="opacity-70">({unit})</span>
      </span>
      <TextField
        key={`${elementId}:${key}:${meta?.[key] ?? ''}`}
        label={label}
        value={meta?.[key] === undefined ? '' : String(meta[key])}
        disabled={!enabled}
        placeholder="—"
        inputMode="decimal"
        className="tabular-nums"
        onCommit={(v) => update(elementId, { [key]: parseNumber(v) })}
      />
    </div>
  );
  return (
    <Section id="analysis" title="Analysis">
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
      <div className="grid grid-cols-2 gap-x-2 gap-y-2">
        {num('durationMinutes', 'Duration', 'min')}
        {num('waitingMinutes', 'Waiting', 'min')}
        {num('cost', 'Cost', 'each')}
        {num('frequency', 'Frequency', 'runs')}
      </div>
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
        Used by the Estimates tab. Stored in this browser only, not in the BPMN file.
      </p>
    </Section>
  );
}
