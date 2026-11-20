/**
 * Application command registry shared by keyboard shortcuts, the command
 * palette (⌘/Ctrl+K) and the canvas context menu.
 */
import {
  downloadOriginal,
  exportImage,
  exportXml,
  newChoreographyDocument,
  newDocument,
  pickFile,
  restorePreviousSession,
  runAutoLayout,
} from './actions';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import type { EditorController } from '@/editor/EditorController';

export interface AppCommand {
  id: string;
  label: string;
  group: 'File' | 'Edit' | 'View' | 'Arrange' | 'Tools';
  keys?: string;
  /** Requires an editable document. */
  editing?: boolean;
  /** Requires a selection. */
  selection?: boolean;
  run(ctrl: EditorController): void | Promise<unknown>;
}

export const COMMANDS: AppCommand[] = [
  {
    id: 'file.new',
    label: 'New diagram',
    group: 'File',
    keys: 'Mod+Alt+N',
    run: () => newDocument(),
  },
  {
    id: 'file.newChoreography',
    label: 'New choreography diagram',
    group: 'File',
    run: () => newChoreographyDocument(),
  },
  {
    id: 'file.open',
    label: 'Open BPMN file…',
    group: 'File',
    keys: 'Mod+O',
    run: () => pickFile(),
  },
  {
    id: 'file.export',
    label: 'Export BPMN 2.0 XML',
    group: 'File',
    keys: 'Mod+S',
    run: () => exportXml(),
  },
  {
    id: 'file.exportSvg',
    label: 'Export as SVG image',
    group: 'File',
    run: () => exportImage('svg'),
  },
  {
    id: 'file.exportPng',
    label: 'Export as PNG image',
    group: 'File',
    run: () => exportImage('png'),
  },
  {
    id: 'file.restorePrevious',
    label: 'Restore previous autosave',
    group: 'File',
    run: () => restorePreviousSession(),
  },
  {
    id: 'file.original',
    label: 'Download original file',
    group: 'File',
    run: () => downloadOriginal(),
  },
  {
    id: 'edit.undo',
    label: 'Undo',
    group: 'Edit',
    keys: 'Mod+Z',
    editing: true,
    run: (c) => c.undo(),
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    group: 'Edit',
    keys: 'Mod+Shift+Z',
    editing: true,
    run: (c) => c.redo(),
  },
  {
    id: 'edit.rename',
    label: 'Rename',
    group: 'Edit',
    keys: 'F2',
    editing: true,
    selection: true,
    run: (c) => void c.renameSelection(),
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    group: 'Edit',
    keys: 'Mod+C',
    editing: true,
    selection: true,
    run: (c) => void c.copy(),
  },
  {
    id: 'edit.cut',
    label: 'Cut',
    group: 'Edit',
    keys: 'Mod+X',
    editing: true,
    selection: true,
    run: (c) => void c.cut(),
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    group: 'Edit',
    keys: 'Mod+V',
    editing: true,
    run: (c) => void c.paste(),
  },
  {
    id: 'edit.duplicate',
    label: 'Duplicate',
    group: 'Edit',
    keys: 'Mod+D',
    editing: true,
    selection: true,
    run: (c) => void c.duplicate(),
  },
  {
    id: 'edit.delete',
    label: 'Delete',
    group: 'Edit',
    keys: 'Del',
    editing: true,
    selection: true,
    run: (c) => void c.deleteSelection(),
  },
  {
    id: 'edit.selectAll',
    label: 'Select all',
    group: 'Edit',
    keys: 'Mod+A',
    run: (c) => c.selectAll(),
  },
  {
    id: 'arrange.layout',
    label: 'Auto layout',
    group: 'Arrange',
    keys: 'Mod+Shift+L',
    editing: true,
    run: () => runAutoLayout(),
  },
  {
    id: 'arrange.addLane',
    label: 'Add lane below',
    group: 'Arrange',
    editing: true,
    selection: true,
    run: (c) => {
      const id = useEditorStore.getState().snapshot.selection[0];
      if (id) c.addLane(id);
    },
  },
  {
    id: 'arrange.addSubLane',
    label: 'Add sub-lane',
    group: 'Arrange',
    editing: true,
    selection: true,
    run: (c) => {
      const id = useEditorStore.getState().snapshot.selection[0];
      if (id) c.addLane(id, true);
    },
  },
  ...(
    [
      ['alignLeft', 'Align left', 'left'],
      ['alignCenter', 'Align centers horizontally', 'center'],
      ['alignRight', 'Align right', 'right'],
      ['alignTop', 'Align top', 'top'],
      ['alignMiddle', 'Align centers vertically', 'middle'],
      ['alignBottom', 'Align bottom', 'bottom'],
    ] as const
  ).map(([id, label, type]): AppCommand => ({
    id: `arrange.${id}`,
    label,
    group: 'Arrange',
    editing: true,
    selection: true,
    run: (c) => void c.alignSelection(type),
  })),
  {
    id: 'arrange.distributeHorizontal',
    label: 'Distribute horizontally',
    group: 'Arrange',
    editing: true,
    selection: true,
    run: (c) => void c.distributeSelection('horizontal'),
  },
  {
    id: 'arrange.distributeVertical',
    label: 'Distribute vertically',
    group: 'Arrange',
    editing: true,
    selection: true,
    run: (c) => void c.distributeSelection('vertical'),
  },
  {
    id: 'tools.select',
    label: 'Select tool',
    group: 'Tools',
    keys: 'V',
    run: () => useUiStore.getState().setTool('select'),
  },
  {
    id: 'tools.pan',
    label: 'Pan tool',
    group: 'Tools',
    keys: 'H',
    run: () => useUiStore.getState().setTool('pan'),
  },
  {
    id: 'tools.lasso',
    label: 'Lasso tool',
    group: 'Tools',
    keys: 'L',
    run: () => useUiStore.getState().setTool('lasso'),
  },
  {
    id: 'tools.connect',
    label: 'Connect tool',
    group: 'Tools',
    keys: 'C',
    editing: true,
    run: () => useUiStore.getState().setTool('connect'),
  },
  { id: 'view.zoomIn', label: 'Zoom in', group: 'View', keys: '+', run: (c) => c.zoomBy(1.2) },
  {
    id: 'view.zoomOut',
    label: 'Zoom out',
    group: 'View',
    keys: '-',
    run: (c) => c.zoomBy(1 / 1.2),
  },
  {
    id: 'view.zoomReset',
    label: 'Zoom to 100%',
    group: 'View',
    keys: '0',
    run: (c) => c.resetZoom(),
  },
  {
    id: 'view.zoomSelection',
    label: 'Zoom to selection',
    group: 'View',
    selection: true,
    run: (c) => void c.zoomToSelection(),
  },
  { id: 'view.fit', label: 'Fit to view', group: 'View', keys: 'Shift+1', run: (c) => c.fit() },
  {
    id: 'view.theme',
    label: 'Toggle dark mode',
    group: 'View',
    run: () => {
      const ui = useUiStore.getState();
      ui.setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
    },
  },
  {
    id: 'view.library',
    label: 'Toggle shape library',
    group: 'View',
    keys: 'Mod+B',
    run: () => useUiStore.getState().toggleLibrary(),
  },
  {
    id: 'view.inspector',
    label: 'Toggle properties panel',
    group: 'View',
    keys: 'Mod+Alt+B',
    run: () => useUiStore.getState().toggleInspector(),
  },
  {
    id: 'view.analysis',
    label: 'Toggle analysis panel',
    group: 'View',
    run: () => useUiStore.getState().toggleAnalysis(),
  },
];

export function isEnabled(cmd: AppCommand): boolean {
  const { snapshot, controller } = useEditorStore.getState();
  if (!controller) return false;
  if (cmd.editing && snapshot.readOnly) return false;
  if (cmd.selection && snapshot.selection.length === 0) return false;
  if (cmd.id === 'file.exportSvg' || cmd.id === 'file.exportPng') {
    return !!useDocumentStore.getState().doc;
  }
  if (cmd.id === 'file.original') return !!useDocumentStore.getState().doc;
  if (cmd.id === 'file.export') return !!useDocumentStore.getState().doc?.report.exportAllowed;
  if (cmd.id === 'edit.undo') return snapshot.canUndo;
  if (cmd.id === 'edit.redo') return snapshot.canRedo;
  if (cmd.id.startsWith('arrange.align')) return controller.arrangeableCount() >= 2;
  if (cmd.id.startsWith('arrange.distribute')) return controller.arrangeableCount() >= 3;
  if (cmd.id === 'arrange.addLane') return isPoolOrLane(controller, snapshot.selection[0]);
  if (cmd.id === 'arrange.addSubLane') {
    return controller.getElement(snapshot.selection[0] ?? '')?.type === 'bpmn:Lane';
  }
  return true;
}

/** Lanes can be added to a pool with a process (not a black box) or to a lane. */
function isPoolOrLane(controller: EditorController, id: string | undefined): boolean {
  const element = id
    ? (controller.getElement(id) as
        { type?: string; businessObject?: { get(key: string): unknown } } | undefined)
    : undefined;
  if (element?.type === 'bpmn:Lane') return true;
  return element?.type === 'bpmn:Participant' && !!element.businessObject?.get('processRef');
}

export function runCommand(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id);
  const controller = useEditorStore.getState().controller;
  if (!cmd || !controller || !isEnabled(cmd)) return;
  void cmd.run(controller);
}
