import { useEditorStore } from '@/stores/editorStore';
import { DocumentDetails } from './inspector/DocumentDetails';
import { ElementDetails } from './inspector/ElementDetails';

export function Inspector() {
  const selection = useEditorStore((s) => s.snapshot.selection);
  // Re-render on model changes so values reflect undo/redo.
  useEditorStore((s) => s.snapshot.revision);

  return (
    <aside
      aria-label="Properties"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-card"
      data-testid="inspector"
    >
      <div className="flex h-9 shrink-0 items-center border-b px-4 font-semibold">Properties</div>
      {selection.length === 0 && <DocumentDetails />}
      {selection.length === 1 && <ElementDetails id={selection[0]!} />}
      {selection.length > 1 && (
        <p className="p-4 text-muted-foreground">{selection.length} elements selected.</p>
      )}
    </aside>
  );
}
