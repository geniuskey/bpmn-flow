/**
 * Decides whether a parsed document can be edited without risking data loss.
 *
 * Policy (see docs/compatibility.md):
 *  - Parser warnings mean moddle dropped content → read-only, re-export blocked.
 *  - A failed self round-trip means we cannot prove preservation → read-only, re-export blocked.
 *  - Unsupported diagram elements / multiple diagrams / incomplete DI → read-only.
 *  - Extension attributes and elements are allowed when the self round-trip proves they survive.
 */
import { indexDi } from '../di/di';
import {
  CONTAINER_TYPES,
  CONVERSATION_TYPES,
  EDITABLE_ARTIFACT_TYPES,
  EDITABLE_CONNECTION_TYPES,
  EDITABLE_FLOW_NODE_TYPES,
  PASSIVE_TYPES,
  PRESERVED_ROOT_TYPES,
  humanizeType,
  isEditableConnection,
  isEditableFlowNode,
  isEditableShapeElement,
  isProcessDataIo,
} from '../model/elements';
import { getRef, is, walkContainment, type ModdleElement } from '../model/moddle';

export type IssueSeverity = 'info' | 'warning' | 'error';

export type CompatibilityCode =
  | 'PARSE_WARNING'
  | 'ROUNDTRIP_MISMATCH'
  | 'UNSUPPORTED_ELEMENT'
  | 'PRESERVED_ELEMENT'
  | 'NO_DIAGRAM'
  | 'MULTIPLE_DIAGRAMS'
  | 'MISSING_DI'
  | 'INVALID_DI'
  | 'EXTENSIONS_PRESENT';

export interface CompatibilityIssue {
  code: CompatibilityCode;
  severity: IssueSeverity;
  message: string;
  elementId?: string;
  elementType?: string;
}

export interface CompatibilityReport {
  /** `readonly` disables every editing interaction. */
  mode: 'editable' | 'readonly';
  /** Whether the model may be re-serialized. Downloading the original file is always allowed. */
  exportAllowed: boolean;
  issues: CompatibilityIssue[];
}

const KNOWN_TYPES = new Set<string>([
  ...EDITABLE_FLOW_NODE_TYPES,
  ...EDITABLE_CONNECTION_TYPES,
  ...EDITABLE_ARTIFACT_TYPES,
  ...CONVERSATION_TYPES,
  ...CONTAINER_TYPES,
  ...PASSIVE_TYPES,
]);

/** Elements that need a BPMNShape / BPMNEdge to be shown. */
function needsShape(el: ModdleElement): boolean {
  // Process data inputs / outputs are optional on the diagram.
  if (isProcessDataIo(el)) return false;
  if (isEditableShapeElement(el)) return true;
  // Choreography participants are drawn as bands of their activities, not as pools.
  if (is(el, 'bpmn:Participant')) return !is(el.$parent, 'bpmn:Choreography');
  if (is(el, 'bpmn:Lane')) return true;
  return false;
}

/** Namespace declarations and xsi:* are XML plumbing, not vendor extensions. */
function isVendorAttribute(name: string): boolean {
  return !(name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('xsi:'));
}

function isInsideExtension(el: ModdleElement): boolean {
  for (let p = el.$parent; p; p = p.$parent) if (is(p, 'bpmn:ExtensionElements')) return true;
  return false;
}

export function assessCompatibility(
  definitions: ModdleElement,
  parseWarnings: readonly string[],
  roundTripDiffs: readonly string[],
): CompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  let readonly = false;
  let exportAllowed = true;

  for (const warning of parseWarnings) {
    issues.push({ code: 'PARSE_WARNING', severity: 'error', message: warning });
    readonly = true;
    exportAllowed = false;
  }

  if (roundTripDiffs.length) {
    issues.push({
      code: 'ROUNDTRIP_MISMATCH',
      severity: 'error',
      message: `Re-serializing this file would change it (${roundTripDiffs[0]}).`,
    });
    readonly = true;
    exportAllowed = false;
  }

  const di = indexDi(definitions);
  if (di.diagramCount === 0 || !di.plane) {
    issues.push({
      code: 'NO_DIAGRAM',
      severity: 'warning',
      message: 'The file has no diagram layout (BPMN DI). It is opened read-only.',
    });
    readonly = true;
  } else {
    if (di.diagramCount > 1) {
      issues.push({
        code: 'MULTIPLE_DIAGRAMS',
        severity: 'info',
        message: `The file contains ${di.diagramCount} diagrams (e.g. collapsed sub-processes drawn on their own). Switch between them with the diagram selector.`,
      });
    }
    for (const dangling of [...di.dangling, ...di.duplicates]) {
      issues.push({
        code: 'INVALID_DI',
        severity: 'warning',
        message: `Diagram element ${dangling.id ?? '(no id)'} has a missing or duplicate bpmnElement reference.`,
        elementId: dangling.id,
      });
      readonly = true;
    }
  }

  const unsupported = new Map<string, string[]>();
  let hasExtensions = false;

  walkContainment(definitions, (el) => {
    if (isInsideExtension(el)) return;
    if (getRef(el, 'extensionElements') || Object.keys(el.$attrs ?? {}).some(isVendorAttribute)) {
      hasExtensions = true;
    }

    const isPreservedRoot =
      (PRESERVED_ROOT_TYPES as readonly string[]).includes(el.$type) &&
      is(el.$parent, 'bpmn:Definitions');
    if (isPreservedRoot) {
      issues.push({
        code: 'PRESERVED_ELEMENT',
        severity: 'info',
        message: `${humanizeType(el.$type)} "${el.name ?? el.id}" is not shown but is preserved on export.`,
        elementId: el.id,
        elementType: el.$type,
      });
      return;
    }

    const supported =
      KNOWN_TYPES.has(el.$type) &&
      (!is(el, 'bpmn:FlowNode') || isEditableFlowNode(el)) &&
      (!is(el, 'bpmn:SequenceFlow') || isEditableConnection(el)) &&
      (!is(el, 'bpmn:SubProcess') || isEditableFlowNode(el));
    if (!supported) {
      const ids = unsupported.get(el.$type) ?? [];
      ids.push(el.id ?? '(no id)');
      unsupported.set(el.$type, ids);
      return;
    }

    if (di.plane && needsShape(el) && el.id && !di.shapes.has(el.id)) {
      issues.push({
        code: 'MISSING_DI',
        severity: 'warning',
        message: `${humanizeType(el.$type)} ${el.id} has no diagram shape and cannot be displayed.`,
        elementId: el.id,
        elementType: el.$type,
      });
      readonly = true;
    }
    // Message flows of a choreography are shown through its tasks, not as edges.
    const drawnAsEdge = !(is(el, 'bpmn:MessageFlow') && is(el.$parent, 'bpmn:Choreography'));
    if (di.plane && isEditableConnection(el) && drawnAsEdge && el.id && !di.edges.has(el.id)) {
      issues.push({
        code: 'MISSING_DI',
        severity: 'warning',
        message: `${humanizeType(el.$type)} ${el.id} has no diagram edge and cannot be displayed.`,
        elementId: el.id,
        elementType: el.$type,
      });
      readonly = true;
    }
  });

  for (const [type, ids] of unsupported) {
    issues.push({
      code: 'UNSUPPORTED_ELEMENT',
      severity: 'warning',
      message: `${humanizeType(type)} is not supported for editing yet (${ids.length}: ${ids
        .slice(0, 5)
        .join(', ')}${ids.length > 5 ? ', …' : ''}).`,
      elementId: ids[0],
      elementType: type,
    });
    readonly = true;
  }

  if (hasExtensions) {
    issues.push({
      code: 'EXTENSIONS_PRESENT',
      severity: 'info',
      message: 'Vendor extension attributes/elements were found. They are preserved on export.',
    });
  }

  return { mode: readonly ? 'readonly' : 'editable', exportAllowed, issues };
}
