/**
 * `@geniuskey/bpmn-flow` — headless core.
 *
 * Load, validate, export and analyze BPMN 2.0 XML. No DOM, no React, no
 * diagram-js: runs in Node, browsers and Web Workers.
 */
import { loadBpmnDocument, type BpmnDocument } from '@/bpmn/document';
import { newChoreographyXml, newDiagramXml } from '@/bpmn/model/newDiagram';

export {
  loadBpmnDocument,
  exportBpmnXml,
  verifyRoundTrip,
  BpmnExportError,
  type BpmnDocument,
} from '@/bpmn/document';
export { parseBpmnXml, BpmnImportError, MAX_XML_BYTES, type ParsedBpmn } from '@/bpmn/import/parse';
export { decodeXmlBytes } from '@/bpmn/import/encoding';
export { newDiagramXml, newChoreographyXml } from '@/bpmn/model/newDiagram';
export {
  assessCompatibility,
  type CompatibilityCode,
  type CompatibilityIssue,
  type CompatibilityReport,
  type IssueSeverity,
} from '@/bpmn/validation/compatibility';
export {
  createModdle,
  is,
  isAny,
  isModdleElement,
  getMany,
  getRef,
  walkContainment,
  containedChildren,
  type BpmnModdleInstance,
  type ModdleElement,
  type ModdleDescriptor,
  type ModdlePropertyDescriptor,
  type GenericElement,
} from '@/bpmn/model/moddle';
export {
  BPMN_NS,
  BPMNDI_NS,
  DC_NS,
  DI_NS,
  TASK_TYPES,
  GATEWAY_TYPES,
  EVENT_TYPES,
  EVENT_DEFINITIONS,
  EDITABLE_FLOW_NODE_TYPES,
  EDITABLE_CONNECTION_TYPES,
  EDITABLE_ARTIFACT_TYPES,
  CHOREOGRAPHY_ACTIVITY_TYPES,
  CONVERSATION_TYPES,
  supportedEventDefinitions,
  categoryOf,
  labelOf,
  humanizeType,
  type ElementCategory,
  type EditableFlowNodeType,
} from '@/bpmn/model/elements';
export {
  snapshotModel,
  type ModelSnapshot,
  type ElementSnapshot,
  type ShapeSnapshot,
  type EdgeSnapshot,
} from '@/bpmn/model/snapshot';

export {
  analyze,
  type AnalysisResult,
  type GraphMetrics,
  type GatewayBranching,
  type Finding,
  type Severity,
} from '@/analysis/analyze';
export {
  computeStructureMetrics,
  type StructureMetrics,
} from '@/analysis/metrics/structureMetrics';
export {
  estimate,
  type EstimateResult,
  type ProcessEstimate,
  type WaitingHotspot,
} from '@/analysis/estimates/estimate';
export { isEmptyMetadata, type AnalysisMetadata } from '@/analysis/estimates/metadata';

/** Creates a new, editable document (a process with Start → Task → End, or a choreography). */
export function createBpmnDocument(
  options: { kind?: 'process' | 'choreography'; fileName?: string } = {},
): Promise<BpmnDocument> {
  const xml = options.kind === 'choreography' ? newChoreographyXml() : newDiagramXml();
  return loadBpmnDocument(xml, options.fileName ?? 'diagram.bpmn');
}
