/** Shown when nothing is selected: the document and its compatibility status. */
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
      <Section title="Document">
        <Row label="Definitions">
          <code className="font-mono text-xs">{defs.id}</code>
        </Row>
        {defs.targetNamespace && (
          <Row label="Namespace">
            <code className="font-mono text-xs">{defs.targetNamespace}</code>
          </Row>
        )}
        {defs.exporter && (
          <Row label="Exporter">
            {defs.exporter} {defs.exporterVersion}
          </Row>
        )}
      </Section>
      {rootId && controller?.getElement(rootId) && <ElementDetails id={rootId} />}
      <p className="px-4 py-3 text-muted-foreground">
        Select an element on the canvas to inspect it.
      </p>
    </>
  );
}
