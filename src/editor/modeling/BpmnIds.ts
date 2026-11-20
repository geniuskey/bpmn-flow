/** Generates element ids that are unique within the open document. */
import { walkContainment, type ModdleElement } from '@/bpmn/model/moddle';

const PREFIX: Record<string, string> = {
  'bpmn:SequenceFlow': 'Flow',
  'bpmn:MessageFlow': 'MessageFlow',
  'bpmn:Conversation': 'Conversation',
  'bpmn:SubConversation': 'Conversation',
  'bpmn:CallConversation': 'Conversation',
  'bpmn:ConversationLink': 'ConversationLink',
  'bpmn:ChoreographyTask': 'ChoreographyTask',
  'bpmn:SubChoreography': 'ChoreographyTask',
  'bpmn:CallChoreography': 'ChoreographyTask',
  'bpmn:Choreography': 'Choreography',
  'bpmn:GlobalChoreographyTask': 'GlobalChoreographyTask',
  'bpmn:GlobalConversation': 'GlobalConversation',
  'bpmn:ParticipantMultiplicity': 'ParticipantMultiplicity',
  'bpmn:Message': 'Message',
  'bpmndi:BPMNShape': 'Band',
  'bpmndi:BPMNPlane': 'BPMNPlane',
  'bpmndi:BPMNDiagram': 'BPMNDiagram',
  'bpmn:Participant': 'Participant',
  'bpmn:Lane': 'Lane',
  'bpmn:LaneSet': 'LaneSet',
  'bpmn:Process': 'Process',
  'bpmn:Collaboration': 'Collaboration',
  'bpmn:Documentation': 'Documentation',
  'bpmn:FormalExpression': 'Expression',
  'bpmn:MessageEventDefinition': 'MessageEventDefinition',
  'bpmn:TimerEventDefinition': 'TimerEventDefinition',
  'bpmn:TerminateEventDefinition': 'TerminateEventDefinition',
  'bpmn:DataInput': 'DataInput',
  'bpmn:DataOutput': 'DataOutput',
  'bpmn:InputOutputSpecification': 'IoSpecification',
  'bpmn:InputSet': 'InputSet',
  'bpmn:OutputSet': 'OutputSet',
  'bpmn:Resource': 'Resource',
};

function prefixFor(type: string): string {
  if (PREFIX[type]) return PREFIX[type];
  if (/EventDefinition$/.test(type)) return type.replace(/^bpmn:/, '');
  if (/Event$/.test(type)) return 'Event';
  if (/Gateway$/.test(type)) return 'Gateway';
  return 'Activity';
}

export default class BpmnIds {
  static $inject = ['bpmnDefinitions'];
  private readonly used = new Set<string>();

  constructor(definitions: ModdleElement) {
    walkContainment(definitions, (el) => {
      if (el.id) this.used.add(el.id);
    });
  }

  next(type: string): string {
    const prefix = prefixFor(type);
    for (;;) {
      const id = `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
      if (!this.used.has(id)) {
        this.used.add(id);
        return id;
      }
    }
  }

  claim(id: string): void {
    this.used.add(id);
  }
}
