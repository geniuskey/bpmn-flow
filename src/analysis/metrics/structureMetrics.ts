/**
 * Structural counts over the BPMN semantic model. Pure; no UI or canvas dependency.
 */
import { categoryOf } from '@/bpmn/model/elements';
import { is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';

export interface StructureMetrics {
  totalElements: number;
  events: number;
  activities: number;
  gateways: number;
  sequenceFlows: number;
  messageFlows: number;
  pools: number;
  lanes: number;
  processes: number;
}

export function computeStructureMetrics(definitions: ModdleElement): StructureMetrics {
  const m: StructureMetrics = {
    totalElements: 0,
    events: 0,
    activities: 0,
    gateways: 0,
    sequenceFlows: 0,
    messageFlows: 0,
    pools: 0,
    lanes: 0,
    processes: 0,
  };
  walkContainment(definitions, (el) => {
    if (is(el, 'bpmn:ExtensionElements') || !is(el, 'bpmn:BaseElement')) return;
    if (is(el, 'bpmn:Process')) m.processes++;
    else if (is(el, 'bpmn:Participant')) m.pools++;
    else if (is(el, 'bpmn:Lane')) m.lanes++;
    else if (is(el, 'bpmn:SequenceFlow')) m.sequenceFlows++;
    else if (is(el, 'bpmn:MessageFlow')) m.messageFlows++;
    else {
      const category = categoryOf(el);
      if (category === 'event') m.events++;
      else if (category === 'activity') m.activities++;
      else if (category === 'gateway') m.gateways++;
      else return;
    }
    m.totalElements++;
  });
  return m;
}
