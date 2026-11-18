/**
 * Analysis metadata entered by users. Stored separately from the BPMN XML
 * (IndexedDB), keyed by document id and element id — never written into the
 * BPMN file as non-standard attributes.
 */
export interface AnalysisMetadata {
  elementId: string;
  owner?: string;
  /** Hands-on processing time per execution. */
  durationMinutes?: number;
  /** Waiting / idle time before or during the step per execution. */
  waitingMinutes?: number;
  /** Cost per execution, in the user's currency. */
  cost?: number;
  /** Executions per period (e.g. per month), as entered by the user. */
  frequency?: number;
  notes?: string;
}

export const NUMERIC_FIELDS = ['durationMinutes', 'waitingMinutes', 'cost', 'frequency'] as const;

export function isEmptyMetadata(m: AnalysisMetadata): boolean {
  return (
    !m.owner?.trim() &&
    !m.notes?.trim() &&
    NUMERIC_FIELDS.every((k) => m[k] === undefined || Number.isNaN(m[k]))
  );
}

/** Parses a user-entered number; empty or invalid input becomes undefined. */
export function parseNumber(input: string): number | undefined {
  const value = Number(input.replace(',', '.'));
  return input.trim() === '' || !Number.isFinite(value) || value < 0 ? undefined : value;
}
