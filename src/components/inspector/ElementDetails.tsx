/** Properties of the selected element: identity, type, semantics specific to its kind, and DI. */
import { Check, Copy, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readBounds } from '@/bpmn/di/di';
import {
  humanizeType,
  labelOf,
  allowedEventDefinitions,
  interruptingIsFixed,
} from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { Badge } from '@/components/ui/badge';
import { canExpand, isColorable, isEditableElement, type BpmnData } from '@/editor/model';
import { alternativeTypes } from '@/editor/commands/ChangeTypeHandler';
import { hasDataState } from '@/editor/commands/ElementDetailHandler';
import { useEditorStore } from '@/stores/editorStore';
import { MetadataSection } from './MetadataSection';
import { BoundsFields } from './boundsFields';
import { ColorFields } from './colorFields';
import { EventDetailFields, EventTriggerFields } from './eventFields';
import { NameField, Row, Section, TextField } from './fields';
import {
  BlackBoxField,
  BoundlessPoolField,
  CallConversationFields,
  ChoreographyFields,
  MultiplicityField,
  PoolBoundaryField,
} from './participantFields';
import { inputClass, standardAttributes, triggerLabel } from './shared';
import {
  ActivityFields,
  CollectionField,
  DataObjectField,
  DataStateField,
  EventGatewayFields,
  GatewayMarkerField,
  FlowProperties,
  InterruptingField,
  LanePartitionField,
  SubProcessFields,
} from './kindFields';
import {
  CategoryValueFields,
  CompensationFields,
  EventCodeField,
  GatewayFields,
  GroupFields,
  ProcessFields,
  TextFormatField,
} from './specFields';

export function ElementDetails({ id }: { id: string }) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  const element = controller?.getElement(id) as (BpmnData & { id: string }) | undefined;
  if (!element?.businessObject) return null;
  const bo = element.businessObject;
  const supported = isEditableElement(bo);
  const docs = getMany<ModdleElement & { text?: string }>(bo, 'documentation');
  const attrs = Object.entries(bo.$attrs ?? {}).filter(([k]) => !k.startsWith('xmlns'));
  const bounds = readBounds(element.di);
  // Colors are a DI extension: any drawn element may have them, editable when supported.
  const colorable = isColorable(element as unknown as Parameters<typeof isColorable>[0]);
  const source = getRef(bo, 'sourceRef');
  const target = getRef(bo, 'targetRef');
  // Only types the element may become where it is (start events have no incoming flows, ...).
  const alternatives = !supported
    ? []
    : readOnly
      ? alternativeTypes(bo.$type)
      : (controller?.typeChangeOptions(id) ?? []);
  // Triggers allowed where the event is, plus the ones it has (so they can be removed).
  const eventDefs =
    supported && is(bo, 'bpmn:Event')
      ? [
          ...new Set([
            ...allowedEventDefinitions(bo),
            ...getMany(bo, 'eventDefinitions').map((d) => d.$type),
          ]),
        ]
      : [];

  return (
    <>
      <Section id="general" title="General">
        {!supported && (
          <Badge variant="warning">
            <Lock className="size-3" /> Not editable
          </Badge>
        )}
        <Row label="ID">
          <IdValue id={bo.id ?? ''} />
        </Row>
        <Row label="Name">
          <NameField
            key={`${element.id}:${labelOf(bo) ?? ''}`}
            id={element.id}
            value={labelOf(bo) ?? ''}
            disabled={readOnly || !supported}
          />
        </Row>
        {alternatives.length > 0 && (
          <Row label="Type">
            <select
              aria-label="Element type"
              className={inputClass}
              value={bo.$type}
              disabled={readOnly}
              onChange={(e) => controller?.changeType(element.id, e.target.value)}
            >
              {[bo.$type, ...alternatives].map((t) => (
                <option key={t} value={t}>
                  {humanizeType(t)}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Description">
          <TextField
            key={`${element.id}:doc:${docs[0]?.text ?? ''}`}
            label="Description"
            multiline
            value={docs[0]?.text ?? ''}
            disabled={readOnly || !supported}
            placeholder="Add a description"
            onCommit={(v) => controller?.updateDocumentation(element.id, v)}
          />
        </Row>
        {docs.slice(1).map((doc, i) => (
          <Row key={i} label={`Description ${i + 2}`}>
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">{doc.text}</p>
          </Row>
        ))}
      </Section>

      <Section id="details" title={detailsTitle(bo)}>
        {eventDefs.length > 0 && (
          <EventTriggerFields
            elementId={element.id}
            event={bo}
            allowed={eventDefs}
            readOnly={readOnly}
          />
        )}
        {supported && is(bo, 'bpmn:EventBasedGateway') && (
          <EventGatewayFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {is(bo, 'bpmn:Participant') && is(bo.$parent, 'bpmn:Collaboration') && (
          <BlackBoxField elementId={element.id} pool={bo} readOnly={readOnly} />
        )}
        {is(bo, 'bpmn:Participant') &&
          is(bo.$parent, 'bpmn:Collaboration') &&
          !is(bo.$parent, 'bpmn:Choreography') && (
            <MultiplicityField elementId={element.id} pool={bo} readOnly={readOnly} />
          )}
        {is(bo, 'bpmn:Participant') &&
          is(bo.$parent, 'bpmn:Collaboration') &&
          !is(bo.$parent, 'bpmn:Choreography') &&
          getRef(bo, 'processRef') && (
            <PoolBoundaryField elementId={element.id} readOnly={readOnly} />
          )}
        {is(bo, 'bpmn:Collaboration') && !is(bo, 'bpmn:Choreography') && (
          <BoundlessPoolField readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:Lane') && (
          <LanePartitionField elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:DataObjectReference') && (
          <DataObjectField elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported &&
          ((is(bo, 'bpmn:DataObjectReference') && getRef(bo, 'dataObjectRef')) ||
            is(bo, 'bpmn:DataInput') ||
            is(bo, 'bpmn:DataOutput')) && (
            <CollectionField elementId={element.id} bo={bo} readOnly={readOnly} />
          )}
        {supported && hasDataState(bo) && (
          <DataStateField elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:Gateway') && (
          <GatewayFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:TextAnnotation') && (
          <TextFormatField elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:Group') && (
          <GroupFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {(is(bo, 'bpmn:Process') || is(bo, 'bpmn:Participant')) && (
          <ProcessFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:ExclusiveGateway') && (
          <GatewayMarkerField
            elementId={element.id}
            di={(element as { di?: ModdleElement }).di}
            readOnly={readOnly}
          />
        )}
        {supported && is(bo, 'bpmn:ChoreographyActivity') && (
          <ChoreographyFields elementId={element.id} activity={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:CallConversation') && (
          <CallConversationFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && canExpand(bo) && (
          <SubProcessFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {supported && is(bo, 'bpmn:Activity') && (
          <ActivityFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {eventDefs.length > 0 &&
          getMany(bo, 'eventDefinitions').map((definition, index, all) => (
            <EventDetailFields
              key={`${definition.$type}:${index}`}
              elementId={element.id}
              definition={definition}
              definitionIndex={index}
              prefix={all.length > 1 ? triggerLabel(definition.$type) : undefined}
              readOnly={readOnly}
            />
          ))}
        {eventDefs.length > 0 &&
          getMany(bo, 'eventDefinitions').map((definition, index) =>
            is(definition, 'bpmn:ErrorEventDefinition') ||
            is(definition, 'bpmn:EscalationEventDefinition') ? (
              <EventCodeField
                key={`code:${index}`}
                elementId={element.id}
                definition={definition}
                definitionIndex={index}
                readOnly={readOnly}
              />
            ) : is(definition, 'bpmn:CompensateEventDefinition') &&
              (is(bo, 'bpmn:IntermediateThrowEvent') || is(bo, 'bpmn:EndEvent')) ? (
              <CompensationFields
                key={`compensate:${index}`}
                elementId={element.id}
                event={bo}
                definition={definition}
                definitionIndex={index}
                readOnly={readOnly}
              />
            ) : null,
          )}
        {supported && is(bo, 'bpmn:FlowElement') && (
          <CategoryValueFields elementId={element.id} bo={bo} readOnly={readOnly} />
        )}
        {(is(bo, 'bpmn:BoundaryEvent') ||
          (is(bo, 'bpmn:StartEvent') && bo.$parent?.get('triggeredByEvent') === true)) &&
          !interruptingIsFixed(bo) && (
            <InterruptingField elementId={element.id} bo={bo} readOnly={readOnly} />
          )}
      </Section>

      {(source || target || standardAttributes(bo).length > 0) && (
        <FlowProperties elementId={element.id} bo={bo} readOnly={readOnly} supported={supported} />
      )}

      {(bounds || colorable) && (
        <Section id="appearance" title="Appearance">
          {colorable && <ColorFields elementId={element.id} di={element.di} readOnly={readOnly} />}
          {bounds && (
            <BoundsFields
              elementId={element.id}
              bounds={bounds}
              readOnly={readOnly || !supported}
            />
          )}
        </Section>
      )}

      {(is(bo, 'bpmn:FlowNode') || is(bo, 'bpmn:Participant') || is(bo, 'bpmn:Lane')) && bo.id && (
        <MetadataSection elementId={bo.id} />
      )}

      {attrs.length > 0 && (
        <Section id="extensions" title="Extension attributes">
          {attrs.map(([k, v]) => (
            <Row key={k} label={k}>
              <code className="font-mono text-xs">{v}</code>
            </Row>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Preserved on export. Not editable here.
          </p>
        </Section>
      )}
    </>
  );
}

/** Title of the section with the fields specific to the element's kind. */
function detailsTitle(b: ModdleElement): string {
  const kinds: [string, string][] = [
    ['bpmn:Event', 'Event'],
    ['bpmn:Gateway', 'Gateway'],
    ['bpmn:SubProcess', 'Sub-process'],
    ['bpmn:ChoreographyActivity', 'Choreography'],
    ['bpmn:Activity', 'Activity'],
    ['bpmn:Participant', 'Pool'],
    ['bpmn:Lane', 'Lane'],
    ['bpmn:DataObjectReference', 'Data'],
    ['bpmn:DataStoreReference', 'Data'],
    ['bpmn:DataInput', 'Data'],
    ['bpmn:DataOutput', 'Data'],
    ['bpmn:TextAnnotation', 'Annotation'],
    ['bpmn:Group', 'Group'],
    ['bpmn:ConversationNode', 'Conversation'],
    ['bpmn:Process', 'Process'],
    ['bpmn:Choreography', 'Choreography'],
    ['bpmn:Collaboration', 'Collaboration'],
  ];
  return kinds.find(([type]) => is(b, type))?.[1] ?? 'Details';
}

/** The element id, with a button that copies it. */
function IdValue({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
        {id}
      </code>
      <Button
        size="icon-sm"
        className="size-6 [&_svg]:size-3.5"
        aria-label="Copy ID"
        title={copied ? 'Copied' : 'Copy ID'}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(id)
            .then(() => setCopied(true))
            .catch(() => undefined)
        }
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
