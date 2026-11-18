/** Public types of the editor controller (what the React shell sees). */

export interface DiagramInfo {
  rootId: string;
  name: string;
  type: string;
  active: boolean;
}

export type EditorTool = 'select' | 'pan' | 'lasso' | 'connect';

export interface EditorSnapshot {
  selection: string[];
  canUndo: boolean;
  canRedo: boolean;
  /** Increments on every model change (execute / undo / redo). */
  revision: number;
  /** True when the model changed since it was opened or last exported. */
  dirty: boolean;
  zoom: number;
  readOnly: boolean;
  /** Root id of the BPMN diagram that is shown. */
  activeDiagram: string;
  /** Tool currently active inside diagram-js (tools end themselves, e.g. after one connection). */
  activeTool: EditorTool;
}

export type Listener = (snapshot: EditorSnapshot) => void;
