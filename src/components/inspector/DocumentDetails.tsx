/** Shown when nothing is selected: the document and the properties of its process / collaboration. */
import { MousePointerClick } from 'lucide-react';
import { type ModdleElement } from '@/bpmn/model/moddle';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { ElementDetails } from './ElementDetails';
import { Row, Section } from './fields';

export function DocumentDetails() {
  const doc = useDocumentStore((s) => s.doc);
  const controller = useEditorStore((s) => s.controller);
  if (!doc) return <p className="p-4 text-muted-foreground">No document open.</p>;
  const defs = doc.definitions as ModdleElement & {
    targetNamespace?: string;
    exporter?: string;
    exporterVersion?: string;
  };
  const rootId = controller?.getRootId();
  return (
    <>
      <p className="flex gap-2 border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <MousePointerClick className="mt-px size-3.5 shrink-0" />
        <span>
          Nothing selected. Click an element on the canvas to edit it; below are the document and
          the diagram it shows.
        </span>
      </p>
      <Section id="document" title="Document">
        <Row label="File">
          <span className="truncate">{doc.fileName}</span>
        </Row>
        <Row label="Definitions">
          <code className="font-mono text-xs">{defs.id}</code>
        </Row>
        {defs.targetNamespace && (
          <Row label="Namespace">
            <code className="font-mono text-xs break-all">{defs.targetNamespace}</code>
          </Row>
        )}
        {defs.exporter && (
          <Row label="Exporter">
            {defs.exporter} {defs.exporterVersion}
          </Row>
        )}
      </Section>
      {rootId && controller?.getElement(rootId) && <ElementDetails id={rootId} />}
    </>
  );
}
