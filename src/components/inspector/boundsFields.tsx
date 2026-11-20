/** Position and size of a shape, editable as numbers (same rules as dragging and resizing). */
import { useState } from 'react';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { Row, TextField } from './fields';

type Bounds = { x: number; y: number; width: number; height: number };

const SHORT: Record<keyof Bounds, string> = { x: 'X', y: 'Y', width: 'W', height: 'H' };
const LABEL: Record<keyof Bounds, string> = {
  x: 'X position',
  y: 'Y position',
  width: 'Width',
  height: 'Height',
};

export function BoundsFields({
  elementId,
  bounds,
  readOnly,
}: {
  elementId: string;
  bounds: Bounds;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const notify = useDocumentStore((s) => s.notify);
  // Bumped when a value is refused, so the field shows the stored value again.
  const [attempt, setAttempt] = useState(0);
  const resizable = !readOnly && !!controller?.canResize(elementId);

  const commit = (key: keyof Bounds, raw: string) => {
    const value = Math.round(Number(raw.trim()));
    const ok =
      raw.trim() !== '' &&
      Number.isFinite(value) &&
      !!controller?.setBounds(elementId, { ...bounds, [key]: value });
    if (ok) return;
    setAttempt((n) => n + 1);
    if (raw.trim() !== '' && Number.isFinite(value)) {
      notify({
        kind: 'info',
        title:
          key === 'x' || key === 'y'
            ? 'The element cannot be moved there'
            : 'The element cannot have that size',
        details: ['The same rules apply as when dragging with the mouse.'],
      });
    }
  };

  const field = (key: keyof Bounds, disabled: boolean) => (
    <div className="relative flex min-w-0 flex-1 items-center">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 text-[11px] text-muted-foreground"
      >
        {SHORT[key]}
      </span>
      <TextField
        key={`${elementId}:${key}:${bounds[key]}:${attempt}`}
        label={LABEL[key]}
        value={String(bounds[key])}
        disabled={disabled}
        inputMode="numeric"
        className="pl-6 tabular-nums"
        onCommit={(v) => commit(key, v)}
      />
    </div>
  );

  return (
    <>
      <Row label="Position">
        <div className="flex w-full gap-1.5">
          {field('x', readOnly)}
          {field('y', readOnly)}
        </div>
      </Row>
      <Row label="Size">
        <div
          className="flex w-full gap-1.5"
          title={resizable || readOnly ? undefined : 'This element is drawn at a fixed size'}
        >
          {field('width', !resizable)}
          {field('height', !resizable)}
        </div>
      </Row>
    </>
  );
}
