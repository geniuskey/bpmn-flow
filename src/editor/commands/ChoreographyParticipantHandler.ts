/**
 * Changes a participant of a choreography activity: slot 0 is the initiating
 * participant (top band), slot 1 the other one. A participant is chosen from
 * the choreography's participants or created by name; the band follows.
 */
import type { Element } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnElementFactory from '../modeling/BpmnElementFactory';
import { ChangeLog } from '../modeling/ChangeLog';
import { bandsOf } from '../modeling/choreography';
import { choreographyOf } from '../modeling/SemanticSync';

export const SET_CHOREOGRAPHY_PARTICIPANT = 'choreography.setParticipant';

interface Context {
  element: Element;
  slot: 0 | 1;
  participantId?: string;
  newName?: string;
  created?: ModdleElement;
  log?: ChangeLog;
}

export default class ChoreographyParticipantHandler {
  static $inject = ['elementFactory'];
  constructor(private readonly factory: BpmnElementFactory) {}

  execute(context: Context): Element[] {
    const activity = bo(context.element);
    const choreography = activity && choreographyOf(activity);
    if (!activity || !choreography || !is(activity, 'bpmn:ChoreographyActivity')) return [];
    const log = new ChangeLog();
    const participants = choreography.get('participants') as ModdleElement[];
    let participant: ModdleElement | undefined;
    if (context.newName?.trim()) {
      participant = context.created ??= this.factory.createModdle('bpmn:Participant', {
        name: context.newName.trim(),
      });
      log.insert(participants, participant);
      log.setParent(participant, choreography);
    } else {
      participant = participants.find((p) => p.id === context.participantId);
    }
    if (!participant) throw new Error('Unknown participant.');

    const refs = activity.get('participantRef') as ModdleElement[];
    const old = refs[context.slot];
    const next = refs.slice();
    next[context.slot] = participant;
    log.replaceAll(refs, next);
    if (context.slot === 0) log.set(activity, 'initiatingParticipantRef', participant);
    for (const band of bandsOf(context.element)) {
      if (getRef(band, 'bpmnElement') === old) log.set(band, 'bpmnElement', participant);
    }
    // The task's message flows follow the participant change.
    for (const flow of getMany(activity, 'messageFlowRef')) {
      if (getRef(flow, 'sourceRef') === old) log.set(flow, 'sourceRef', participant);
      if (getRef(flow, 'targetRef') === old) log.set(flow, 'targetRef', participant);
    }
    context.log = log;
    return [context.element];
  }

  revert(context: Context): Element[] {
    context.log?.undo();
    return [context.element];
  }
}
