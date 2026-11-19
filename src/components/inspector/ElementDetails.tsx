/** Properties of the selected element: identity, type, semantics specific to its kind, and DI. */
import { Lock } from 'lucide-react';
import { readBounds } from '@/bpmn/di/di';
import {
  humanizeType,
  isEditableConnection,
  isEditableShapeElement,
  labelOf,
  allowedEventDefinitions,
  interruptingIsFixed,
} from '@/bpmn/model/elements';
import { getMany, getRef, is, type ModdleElement } from '@/bpmn/model/moddle';
import { Badge } from '@/components/ui/badge';
import type { BpmnData } from '@/editor/model';
import { alternativeTypes } from '@/editor/commands/ChangeTypeHandler';
import { useEditorStore } from '@/stores/editorStore';
import { MetadataSection } from './MetadataSection';
import { EventDetailFields, EventTriggerFields } from './eventFields';
import { NameField, Row, Section, TextField } from './fields';
import { BlackBoxField, ChoreographyFields } from './participantFields';
import { inputClass, standardAttributes, triggerLabel } from './shared';
import {
  ActivityFields,
  CollectionField,
  EventGatewayFields,
  FlowProperties,
  InterruptingField,
} from './kindFields';

export function ElementDetails({ id }: { id: string }) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  const element = controller?.getElement(id) as (BpmnData & { id: string }) | undefined;
  if (!element?.businessObject) return null;
  const bo = element.businessObject;
  const supported =
    isEditableShapeElement(bo) ||
    isEditableConnection(bo) ||
    ['bpmn:Participant', 'bpmn:Lane', 'bpmn:Process', 'bpmn:Collaboration'].includes(bo.$type);
  const docs = getMany<ModdleElement & { text?: string }>(bo, 'documentation');
  const attrs = Object.entries(bo.$attrs ?? {}).filter(([k]) => !k.startsWith('xmlns'));
  const bounds = readBounds(element.di);
  const source = getRef(bo, 'sourceRef');
  const target = getRef(bo, 'targetRef');
  const alternatives = supported ? alternativeTypes(bo.$type) : [];
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
      <Section title="Element">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{humanizeType(bo.$type)}</span>
          {!supported && (
            <Badge variant="warning">
              <Lock className="size-3" /> Not editable
            </Badge>
          )}
        </div>
        <Row label="ID">
          <code className="font-mono text-xs">{bo.id}</code>
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
        {supported &&
          ((is(bo, 'bpmn:DataObjectReference') && getRef(bo, 'dataObjectRef')) ||
            is(bo, 'bpmn:DataInput') ||
            is(bo, 'bpmn:DataOutput')) && (
            <CollectionField elementId={element.id} bo={bo} readOnly={readOnly} />
          )}
        {supported && is(bo, 'bpmn:ChoreographyActivity') && (
          <ChoreographyFields elementId={element.id} activity={bo} readOnly={readOnly} />
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
        {(is(bo, 'bpmn:BoundaryEvent') ||
          (is(bo, 'bpmn:StartEvent') && bo.$parent?.get('triggeredByEvent') === true)) &&
          !interruptingIsFixed(bo) && (
            <InterruptingField elementId={element.id} bo={bo} readOnly={readOnly} />
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

      {(source || target || standardAttributes(bo).length > 0) && (
        <FlowProperties elementId={element.id} bo={bo} readOnly={readOnly} supported={supported} />
      )}

      {attrs.length > 0 && (
        <Section title="Extension attributes">
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

      {(is(bo, 'bpmn:FlowNode') || is(bo, 'bpmn:Participant') || is(bo, 'bpmn:Lane')) && bo.id && (
        <MetadataSection elementId={bo.id} />
      )}

      {bounds && (
        <Section title="Diagram">
          <Row label="Position">
            <span className="tabular-nums">
              {bounds.x}, {bounds.y}
            </span>
          </Row>
          <Row label="Size">
            <span className="tabular-nums">
              {bounds.width} × {bounds.height}
            </span>
          </Row>
        </Section>
      )}
    </>
  );
}
