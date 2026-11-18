/** Analysis metadata of an element (owner, duration, waiting, cost, ...), stored locally, not in BPMN. */
import { useMetadataStore } from '@/stores/metadataStore';
import { parseNumber, type NUMERIC_FIELDS } from '@/analysis/estimates/metadata';
import { Row, Section, TextField } from './fields';

export function MetadataSection({ elementId }: { elementId: string }) {
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
