/** Field state and formatting helpers shared by the properties panel. */
import { useRef, useState, type KeyboardEvent } from 'react';
import { humanizeType } from '@/bpmn/model/elements';
import type { ModdleElement } from '@/bpmn/model/moddle';

export const inputClass =
  'h-8 w-full rounded-md border bg-background px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/**
 * Draft state for a text field that commits on blur or Enter. Escape restores
 * the stored value and leaves without committing: the blur that follows must
 * not commit the stale draft its handler still closes over.
 */
export function useDraft(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      if (cancelled.current) {
        cancelled.current = false;
        return;
      }
      if (draft !== value) onCommit(draft);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, multiline = false) => {
      if (e.key === 'Enter' && !multiline) e.currentTarget.blur();
      if (e.key === 'Escape') {
        cancelled.current = true;
        setDraft(value);
        e.currentTarget.blur();
      }
    },
  };
}

export function formatValue(value: unknown): string {
  if (value && typeof value === 'object' && 'id' in value)
    return String((value as { id: unknown }).id);
  return String(value);
}

/** "bpmn:TimerEventDefinition" -> "Timer" */
export function triggerLabel(type: string): string {
  return humanizeType(type).replace(/ Event Definition$/, '');
}

/** Standard BPMN attributes that are set on the element (read-only in Phase 1). */
export function standardAttributes(bo: ModdleElement): [string, string][] {
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
