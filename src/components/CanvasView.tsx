import { useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { openFile } from '@/app/actions';
import { EditorController } from '@/editor/EditorController';
import { ContextMenu } from './ContextMenu';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Hosts the diagram-js canvas. The controller is created once; React never
 * re-renders the canvas DOM, it only forwards commands to the controller.
 */
export function CanvasView({ onReady }: { onReady: (controller: EditorController) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const tool = useUiStore((s) => s.tool);
  const controller = useEditorStore((s) => s.controller);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setHostEl(host);
    const ctrl = new EditorController(host);
    const { setController, setSnapshot } = useEditorStore.getState();
    const unsubscribe = ctrl.subscribe(setSnapshot);
    setController(ctrl);
    onReady(ctrl);
    return () => {
      unsubscribe();
      setController(null);
      ctrl.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create exactly once per mount
  }, []);

  const activeTool = useEditorStore((s) => s.snapshot.activeTool);
  const revision0 = useEditorStore((s) => s.snapshot.readOnly);
  useEffect(() => {
    controller?.setSnapToGrid(snapToGrid);
  }, [controller, snapToGrid, revision0]);
  useEffect(() => {
    controller?.setTool(tool);
  }, [controller, tool]);
  // diagram-js ends tools on its own (e.g. after one connection): reflect that in the palette.
  useEffect(() => {
    if (useUiStore.getState().tool !== activeTool) useUiStore.getState().setTool(activeTool);
  }, [activeTool]);

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <div ref={hostRef} className="absolute inset-0" data-testid="canvas" />
      <ContextMenu host={hostEl} />
      {dragging && (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
          <div className="flex items-center gap-2 rounded-lg bg-card px-4 py-2 font-medium shadow">
            <FileUp className="size-4 text-primary" /> Drop a .bpmn file to open it
          </div>
        </div>
      )}
    </div>
  );
}
