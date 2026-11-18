export type Severity = 'info' | 'warning' | 'error';

export interface Finding {
  severity: Severity;
  /** Stable rule identifier, e.g. `GRAPH-UNREACHABLE`. */
  ruleId: string;
  message: string;
  /** Related BPMN element ids (first one is the primary element). */
  elementIds: string[];
  recommendation: string;
}
