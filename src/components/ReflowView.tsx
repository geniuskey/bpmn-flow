import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { serializeDocument } from '@/bpmn/document';
import type { LayoutDirection } from '@/editor/layout/graph';
import { BpmnFlowViewer } from '@/sdk/viewer';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Read-only view over the canvas: a copy of the current document re-laid out
 * to fit the canvas area (top → bottom when it is narrow), reflowing when the
 * window is resized. The document and its layout are not changed.
 */
export function ReflowView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controller = useEditorStore((s) => s.controller);
  const density = useUiStore((s) => s.layoutDensity);
  const focusMode = useUiStore((s) => s.focusMode);
  const setReflowView = useUiStore((s) => s.setReflowView);
  const [viewer, setViewer] = useState<BpmnFlowViewer | null>(null);
  const [direction, setDirection] = useState<LayoutDirection | null>(null);
  const [selection, setSelection] = useState<string[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    const doc = controller?.getDocument();
    if (!host || !doc) return;
    const instance = new BpmnFlowViewer(host, { density });
    const off = instance.subscribe((s) => {
      setSelection(s.selection);
      setDirection(instance.getDirection());
    });
    let cancelled = false;
    void serializeDocument(doc)
      .then((xml) => instance.importXml(xml, doc.fileName))
      .then((r) => !cancelled && setDirection(r.direction))
      .catch((err: unknown) => console.error(err));
    setViewer(instance);
    return () => {
      cancelled = true;
      off();
      instance.destroy();
      setViewer(null);
    };
  }, [controller, density]);

  useEffect(() => {
    viewer?.focus(focusMode ? selection : []);
  }, [viewer, focusMode, selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReflowView(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setReflowView]);

  return (
    <div className="absolute inset-0 z-10 bg-background" data-testid="reflow-view">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center px-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-3 text-xs shadow">
          <span className="font-medium">Reflow view</span>
          <span className="text-muted-foreground">
            {direction === 'TB' ? 'top → bottom' : direction === 'LR' ? 'left → right' : ''} ·
            read-only · the file keeps its layout
          </span>
          <Button
            size="icon"
            className="size-6"
            title="Back to editing (Esc)"
            aria-label="Close reflow view"
            onClick={() => setReflowView(false)}
          >
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}
