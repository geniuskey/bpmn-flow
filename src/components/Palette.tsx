import {
  Hexagon,
  CircleDashed,
  Database,
  File,
  Group,
  MessageSquareText,
  SquareDashed,
  SquarePlus,
  Circle,
  Diamond,
  Hand,
  Lasso,
  MousePointer2,
  Rows3,
  Spline,
  Square,
  Plus,
  CircleDot,
} from 'lucide-react';
import { useRef, type ComponentType, type MouseEvent as ReactMouseEvent } from 'react';
import { formatKeys, SHORTCUTS } from '@/app/shortcuts';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { EditorTool } from '@/editor/EditorController';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';

const TOOLS: {
  id: EditorTool;
  label: string;
  icon: ComponentType;
  shortcut: keyof typeof SHORTCUTS;
}[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, shortcut: 'select' },
  { id: 'pan', label: 'Pan', icon: Hand, shortcut: 'pan' },
  { id: 'lasso', label: 'Lasso select', icon: Lasso, shortcut: 'lasso' },
  { id: 'connect', label: 'Connect (sequence flow)', icon: Spline, shortcut: 'connect' },
];

// Element creation: click then click on the canvas, or drag onto the canvas.
const CREATE: { type: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { type: 'bpmn:StartEvent', label: 'Start event', icon: Circle },
  { type: 'bpmn:EndEvent', label: 'End event', icon: CircleDot },
  { type: 'bpmn:Task', label: 'Task', icon: Square },
  { type: 'bpmn:ExclusiveGateway', label: 'Exclusive gateway', icon: Diamond },
  { type: 'bpmn:ParallelGateway', label: 'Parallel gateway', icon: Plus },
  { type: 'bpmn:IntermediateThrowEvent', label: 'Intermediate event', icon: CircleDashed },
  {
    type: 'bpmn:BoundaryEvent',
    label: 'Boundary event (drop on an activity border)',
    icon: SquareDashed,
  },
  { type: 'bpmn:SubProcess', label: 'Sub-process', icon: SquarePlus },
  { type: 'bpmn:DataObjectReference', label: 'Data object', icon: File },
  { type: 'bpmn:DataStoreReference', label: 'Data store', icon: Database },
  { type: 'bpmn:TextAnnotation', label: 'Text annotation', icon: MessageSquareText },
  { type: 'bpmn:Group', label: 'Group', icon: Group },
  { type: 'bpmn:Participant', label: 'Pool', icon: Rows3 },
  { type: 'bpmn:Conversation', label: 'Conversation (in a collaboration)', icon: Hexagon },
];

const DRAG_THRESHOLD = 4;

function CreateButton({ type, label, icon: Icon }: (typeof CREATE)[number]) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  const dragged = useRef(false);

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0 || !controller) return;
    dragged.current = false;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: MouseEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      dragged.current = true;
      cleanup();
      controller.startCreate(ev, type);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', cleanup);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', cleanup);
  };

  const disabled = readOnly || !controller;
  return (
    <span
      title={
        disabled ? `${label} — not available for read-only documents` : `${label} (click or drag)`
      }
    >
      <Button
        size="icon"
        disabled={disabled}
        aria-label={`Create ${label}`}
        data-testid={`create-${type.replace('bpmn:', '')}`}
        onMouseDown={onMouseDown}
        onClick={(e) => {
          if (!dragged.current) controller?.startCreate(e.nativeEvent, type);
        }}
      >
        <Icon />
      </Button>
    </span>
  );
}

export function Palette() {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  return (
    <nav
      aria-label="Tools"
      className="flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r bg-card py-2"
    >
      {TOOLS.map(({ id, label, icon: Icon, shortcut }) => (
        <Button
          key={id}
          size="icon"
          variant={tool === id ? 'active' : 'ghost'}
          title={`${label} (${formatKeys(SHORTCUTS[shortcut]!.keys)})`}
          aria-label={label}
          aria-pressed={tool === id}
          disabled={id === 'connect' && readOnly}
          onClick={() => setTool(id)}
        >
          <Icon />
        </Button>
      ))}
      <Separator className="mx-2 w-6" />
      {CREATE.map((c) => (
        <CreateButton key={c.type} {...c} />
      ))}
    </nav>
  );
}
