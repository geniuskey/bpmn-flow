import { FileText, Layers, Spline, Square, X } from 'lucide-react';
import { formatKeys, SHORTCUTS } from '@/app/shortcuts';
import { humanizeType, labelOf } from '@/bpmn/model/elements';
import type { ModdleElement } from '@/bpmn/model/moddle';
import { Button } from '@/components/ui/button';
import { entryForElement } from '@/editor/library';
import { renderPreview } from '@/editor/renderer/preview';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { DocumentDetails } from './inspector/DocumentDetails';
import { ElementDetails } from './inspector/ElementDetails';
import { MultiSelection } from './inspector/MultiSelection';

/** What the panel shows: the selected element (icon, type, name), the selection, or the document. */
function InspectorHeader({ selection }: { selection: string[] }) {
  const controller = useEditorStore((s) => s.controller);
  const fileName = useDocumentStore((s) => s.doc?.fileName);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const element =
    selection.length === 1
      ? (controller?.getElement(selection[0]!) as
          { businessObject?: ModdleElement; waypoints?: unknown } | undefined)
      : undefined;
  const b = element?.businessObject;
  // Not memoized: a trigger change keeps the element but changes its icon
  // (renderPreview caches the markup).
  const entry = b ? entryForElement(b) : undefined;
  const icon = entry ? renderPreview(entry.preset, 26) : null;

  let title: string;
  let subtitle: string | undefined;
  let Fallback = FileText;
  if (selection.length > 1) {
    title = `${selection.length} elements selected`;
    Fallback = Layers;
  } else if (b) {
    title = humanizeType(b.$type);
    subtitle = labelOf(b) || b.id;
    Fallback = element?.waypoints ? Spline : Square;
  } else {
    title = 'Document';
    subtitle = fileName;
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b pr-2 pl-4">
      <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        {icon ? (
          <span
            className="flex items-center justify-center text-foreground"
            dangerouslySetInnerHTML={{ __html: icon }}
          />
        ) : (
          <Fallback className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1" data-testid="inspector-title">
        <p className="truncate leading-tight font-semibold">{title}</p>
        {subtitle && (
          <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <Button
        size="icon-sm"
        aria-label="Close properties panel"
        title={`Close properties panel (${formatKeys(SHORTCUTS.inspector!.keys)})`}
        onClick={() => toggleInspector(false)}
      >
        <X />
      </Button>
    </div>
  );
}

export function Inspector() {
  const selection = useEditorStore((s) => s.snapshot.selection);
  // Re-render on model changes so values reflect undo/redo.
  useEditorStore((s) => s.snapshot.revision);

  return (
    <aside
      aria-label="Properties"
      className="flex h-full min-h-0 flex-col bg-card"
      data-testid="inspector"
    >
      <InspectorHeader selection={selection} />
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="inspector-body">
        {selection.length === 0 && <DocumentDetails />}
        {selection.length === 1 && <ElementDetails id={selection[0]!} />}
        {selection.length > 1 && <MultiSelection ids={selection} />}
      </div>
    </aside>
  );
}
