/**
 * The integration layer between React and diagram-js.
 *
 * React owns the application shell; diagram-js owns the canvas DOM. React talks
 * to the canvas only through this controller, and the controller reports back
 * through a small, serializable `EditorSnapshot`, so the canvas never re-renders
 * because of React state and React never re-renders on every canvas event.
 */
import Diagram from 'diagram-js';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementFactory from 'diagram-js/lib/core/ElementFactory';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import type Modeling from 'diagram-js/lib/features/modeling/Modeling';
import type Create from 'diagram-js/lib/features/create/Create';
import type Rules from 'diagram-js/lib/features/rules/Rules';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import type { ModuleDeclaration } from 'didi';
import SelectionModule from 'diagram-js/lib/features/selection';
import OutlineModule from 'diagram-js/lib/features/outline';
import LassoToolModule from 'diagram-js/lib/features/lasso-tool';
import HandToolModule from 'diagram-js/lib/features/hand-tool';
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll';
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas';
import type { BpmnDocument } from '@/bpmn/document';
import { exportBpmnXml } from '@/bpmn/document';
import type { ModdleElement } from '@/bpmn/model/moddle';
import { importDiagram, type CanvasImportResult } from './canvas/importDiagram';
import {
  UPDATE_CONDITION,
  UPDATE_DOCUMENTATION,
  UPDATE_PROPERTIES,
  type PropertyValue,
} from './commands/UpdatePropertiesHandler';
import { CHANGE_TYPE } from './commands/ChangeTypeHandler';
import { SET_EVENT_DEFINITION } from './commands/EventDefinitionHandler';
import { SET_LOOP, type LoopKind } from './commands/LoopHandler';
import { SET_CHOREOGRAPHY_PARTICIPANT } from './commands/ChoreographyParticipantHandler';
import { UPDATE_EVENT_DETAIL, type EventDetail } from './commands/EventDetailHandler';
import { ADD_LANE, SET_POOL_BLACK_BOX, blackBoxBlocker } from './commands/StructureHandlers';
import { APPLY_LAYOUT, type LayoutResult } from './layout/ApplyLayoutHandler';
import { deletable } from './interaction/BpmnFlowRules';
import type DirectEditing from './interaction/DirectEditing';
import type Clipboard from './interaction/Clipboard';
import { guardCommandStack } from './commands/guardCommandStack';
import type ConnectTool from './interaction/ConnectTool';
import { bo, childrenOf, rootOf, type BpmnData } from './model';
import { labelOf } from '@/bpmn/model/elements';
import { getMany, getRef } from '@/bpmn/model/moddle';
import { coreModule, EDITING_MODULES } from './modules';
import type { DiagramInfo, EditorSnapshot, EditorTool, Listener } from './types';

export type { DiagramInfo, EditorSnapshot, EditorTool } from './types';

export class EditorController {
  private diagram: Diagram | null = null;
  private document: BpmnDocument | null = null;
  private listeners = new Set<Listener>();
  private errorListeners = new Set<(error: unknown) => void>();
  private snapshot: EditorSnapshot = {
    selection: [],
    canUndo: false,
    canRedo: false,
    revision: 0,
    dirty: false,
    zoom: 1,
    readOnly: true,
    activeTool: 'select',
    activeDiagram: '__root',
  };
  /** Undo-stack entry that was on top when the document was last exported (null: none). */
  private savedAction: unknown = null;
  private tool: EditorTool = 'select';

  constructor(private readonly container: HTMLElement) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  /** Called when an edit failed and was rolled back (see guardCommandStack). */
  onCommandError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  getSnapshot(): EditorSnapshot {
    return this.snapshot;
  }

  getDocument(): BpmnDocument | null {
    return this.document;
  }

  /** Replaces the displayed document. The previous diagram is only destroyed once the new one imported. */
  open(doc: BpmnDocument): CanvasImportResult {
    const readOnly = doc.report.mode === 'readonly';
    const host = document.createElement('div');
    host.className = 'bf-canvas-host';
    const modules: ModuleDeclaration[] = [
      SelectionModule,
      OutlineModule,
      ZoomScrollModule,
      MoveCanvasModule,
      HandToolModule,
      LassoToolModule,
      coreModule,
      { moddle: ['value', doc.moddle], bpmnDefinitions: ['value', doc.definitions] },
    ];
    if (!readOnly) modules.push(...EDITING_MODULES);

    const diagram = new Diagram({ canvas: { container: host }, modules });
    let result: CanvasImportResult;
    try {
      result = importDiagram(
        {
          canvas: diagram.get<Canvas>('canvas'),
          elementFactory: diagram.get<ElementFactory>('elementFactory'),
          elementRegistry: diagram.get<ElementRegistry>('elementRegistry'),
        },
        doc.definitions,
      );
    } catch (err) {
      diagram.destroy();
      throw err;
    }

    this.diagram?.destroy();
    this.container.replaceChildren(host);
    this.diagram = diagram;
    this.document = doc;
    this.savedAction = null;
    this.wireEvents(diagram, readOnly);
    this.setTool(this.tool);
    this.fit();
    return result;
  }

  private wireEvents(diagram: Diagram, readOnly: boolean): void {
    const eventBus = diagram.get<EventBus>('eventBus');
    eventBus.on('selection.changed', (e: { newSelection: Element[] }) => {
      this.update({ selection: e.newSelection.map((el) => el.id) });
    });
    eventBus.on('commandStack.changed', () => this.refreshStack());
    if (!readOnly) {
      guardCommandStack(diagram.get<CommandStack>('commandStack'), eventBus, (error) => {
        for (const l of this.errorListeners) l(error);
      });
    }
    eventBus.on('bpmnflow.showDiagram', (e: { rootId: string }) => this.showDiagram(e.rootId));
    eventBus.on('tool-manager.update', (e: { tool: string | null }) => {
      if (this.get<ConnectTool>('connectTool')?.isActive()) return;
      const map: Record<string, EditorTool> = { hand: 'pan', lasso: 'lasso' };
      this.update({ activeTool: (e.tool && map[e.tool]) || 'select' });
    });
    eventBus.on('canvas.viewbox.changed', (e: { viewbox: { scale: number } }) => {
      this.update({ zoom: e.viewbox.scale });
    });
    this.update({
      selection: [],
      canUndo: false,
      canRedo: false,
      dirty: false,
      readOnly,
      activeDiagram: '__root',
      revision: this.snapshot.revision + 1,
    });
  }

  private stack(): CommandStack | null {
    if (!this.diagram || this.snapshot.readOnly) return null;
    return this.diagram.get<CommandStack>('commandStack', false) ?? null;
  }

  /**
   * The undo-stack entry on top of the stack. Comparing entries rather than
   * positions keeps `dirty` true after "undo, then a different edit", which
   * returns to the same position with different content.
   */
  private topAction(): unknown {
    const stack = this.stack() as unknown as { _stack?: unknown[]; _stackIdx?: number } | null;
    const idx = stack?._stackIdx ?? -1;
    return idx >= 0 ? (stack?._stack?.[idx] ?? null) : null;
  }

  private refreshStack(): void {
    const stack = this.stack();
    this.update({
      canUndo: !!stack?.canUndo(),
      canRedo: !!stack?.canRedo(),
      dirty: this.topAction() !== this.savedAction,
      revision: this.snapshot.revision + 1,
    });
  }

  private update(patch: Partial<EditorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }

  undo(): void {
    this.stack()?.undo();
  }

  redo(): void {
    this.stack()?.redo();
  }

  zoomBy(factor: number): void {
    if (!this.diagram) return;
    const canvas = this.diagram.get<Canvas>('canvas');
    const scale = Math.min(4, Math.max(0.2, canvas.zoom() * factor));
    canvas.zoom(scale, 'auto' as never);
  }

  resetZoom(): void {
    this.diagram?.get<Canvas>('canvas').zoom(1);
  }

  fit(): void {
    if (!this.diagram) return;
    const canvas = this.diagram.get<Canvas>('canvas');
    const registry = this.diagram.get<ElementRegistry>('elementRegistry');
    if (registry.getAll().length <= 1) return;
    canvas.zoom('fit-viewport', 'auto' as never);
    // diagram-js never upscales beyond 100%; add breathing room only when the diagram was shrunk.
    const scale = canvas.zoom();
    if (scale < 1) canvas.zoom(scale * 0.94, 'auto' as never);
  }

  setTool(tool: EditorTool): void {
    this.tool = tool;
    if (!this.diagram) return;
    const dragging = this.get<{ cancel(): void }>('dragging');
    dragging?.cancel();
    const connectTool = this.get<ConnectTool>('connectTool');
    connectTool?.setActive(tool === 'connect' && !this.snapshot.readOnly);
    if (tool === 'connect') {
      this.update({ activeTool: connectTool ? 'connect' : 'select' });
      return;
    }
    if (tool === 'select') return;
    // diagram-js tools start from a pointer event; synthesize one at the canvas center.
    const rect = this.container.getBoundingClientRect();
    const event = new MouseEvent('mousemove', {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    if (tool === 'pan') {
      this.get<{ activateHand(e: MouseEvent, autoActivate?: boolean): void }>(
        'handTool',
      )?.activateHand(event, true);
    } else if (tool === 'lasso') {
      this.get<{ activateSelection(e: MouseEvent, autoActivate?: boolean): void }>(
        'lassoTool',
      )?.activateSelection(event, true);
    }
  }

  private get<T>(name: string): T | null {
    return (this.diagram?.get<T>(name, false) as T | undefined) ?? null;
  }

  setSnapToGrid(active: boolean): void {
    this.get<{ setActive(a: boolean): void }>('gridSnapping')?.setActive(active);
  }

  getRootId(): string | null {
    return this.get<Canvas>('canvas')?.getRootElement().id ?? null;
  }

  /** Starts placing a new element (palette click or drag). */
  startCreate(event: MouseEvent | PointerEvent, type: string): void {
    const create = this.get<Create>('create');
    const factory = this.get<ElementFactory>('elementFactory');
    if (!create || !factory) return;
    create.start(event as MouseEvent, factory.createShape({ type }));
  }

  canCreateIn(type: string): boolean {
    const rules = this.get<Rules>('rules');
    const canvas = this.get<Canvas>('canvas');
    if (!rules || !canvas) return false;
    const root = rootOf(canvas);
    if (type === 'bpmn:Participant') return true;
    if (bo(root)?.$type === 'bpmn:Process') return true;
    return childrenOf(root).some((c) => bo(c)?.$type === 'bpmn:Participant');
  }

  private selected(): Element[] {
    return (this.get<Selection>('selection')?.get() as Element[] | undefined) ?? [];
  }

  deleteSelection(): number {
    const modeling = this.get<Modeling>('modeling');
    if (!modeling) return 0;
    const elements = deletable(this.selected());
    if (elements.length) modeling.removeElements(elements);
    return elements.length;
  }

  copy(): number {
    return this.get<Clipboard>('bpmnClipboard')?.copy() ?? 0;
  }

  paste(): number {
    return this.get<Clipboard>('bpmnClipboard')?.paste().length ?? 0;
  }

  duplicate(): number {
    return this.get<Clipboard>('bpmnClipboard')?.duplicate().length ?? 0;
  }

  cut(): number {
    return this.get<Clipboard>('bpmnClipboard')?.cut() ?? 0;
  }

  nudge(dx: number, dy: number): void {
    const modeling = this.get<Modeling>('modeling');
    const shapes = this.selected().filter((e) => !(e as Connection).waypoints);
    const delta = { x: dx, y: dy };
    // The same rule as a mouse drag: it also checks container changes (sequence
    // flows cannot cross into a sub-process, data objects keep their scope, ...).
    const rules = this.get<Rules>('rules');
    if (!modeling || !shapes.length || !rules?.allowed('elements.move', { shapes, delta })) return;
    modeling.moveElements(shapes as Shape[], delta);
  }

  renameSelection(): boolean {
    const [element] = this.selected();
    const editing = this.get<DirectEditing>('directEditing');
    if (!element || !editing?.canEdit(element)) return false;
    editing.activate(element);
    return true;
  }

  isEditingText(): boolean {
    return !!this.get<DirectEditing>('directEditing')?.isActive();
  }
  private exec(command: string, context: Record<string, unknown>): void {
    const stack = this.stack();
    if (stack) stack.execute(command, context);
  }

  updateDocumentation(id: string, text: string): void {
    const element = this.getElement(id);
    if (element) this.exec(UPDATE_DOCUMENTATION, { element, text });
  }

  updateCondition(id: string, body: string): void {
    const element = this.getElement(id);
    if (element) this.exec(UPDATE_CONDITION, { element, body });
  }

  changeType(id: string, newType: string): void {
    const element = this.getElement(id);
    if (element) this.exec(CHANGE_TYPE, { element, newType });
  }

  setEventDefinition(id: string, definitionType: string | undefined): void {
    const element = this.getElement(id);
    if (element) this.exec(SET_EVENT_DEFINITION, { element, definitionType });
  }

  /** Sets all triggers at once: several definitions make a "Multiple" event. */
  setEventDefinitions(id: string, definitionTypes: string[]): void {
    const element = this.getElement(id);
    if (element) this.exec(SET_EVENT_DEFINITION, { element, definitionTypes });
  }

  updateEventDetail(id: string, detail: EventDetail, definitionIndex = 0): void {
    const element = this.getElement(id);
    if (element) this.exec(UPDATE_EVENT_DETAIL, { element, detail, definitionIndex });
  }

  setChoreographyParticipant(
    id: string,
    slot: 0 | 1,
    choice: { participantId?: string; newName?: string },
  ): void {
    const element = this.getElement(id);
    if (element) this.exec(SET_CHOREOGRAPHY_PARTICIPANT, { element, slot, ...choice });
  }

  setLoop(id: string, loop: LoopKind): void {
    const element = this.getElement(id);
    if (element) this.exec(SET_LOOP, { element, loop });
  }

  setDefaultFlow(gatewayId: string, flow: ModdleElement | undefined): void {
    const element = this.getElement(gatewayId);
    if (element) this.exec(UPDATE_PROPERTIES, { element, properties: { default: flow } });
  }

  /** Black-box pool: a participant without a process (only for empty pools). */
  setPoolBlackBox(id: string, blackBox: boolean): void {
    const element = this.getElement(id);
    if (element) this.exec(SET_POOL_BLACK_BOX, { element, blackBox });
  }

  /** Why the pool cannot become a black box, or null when it can. */
  poolBlackBoxBlocker(id: string): string | null {
    const element = this.getElement(id) as Shape | undefined;
    const definitions = this.document?.definitions;
    if (!element || !definitions) return 'Not available.';
    return blackBoxBlocker(element, definitions);
  }

  addLane(targetId: string): void {
    const target = this.getElement(targetId);
    if (target) this.exec(ADD_LANE, { target });
  }

  applyLayout(layout: LayoutResult): void {
    this.exec(APPLY_LAYOUT, { layout });
  }

  /** Runs ELK auto layout on the whole diagram as one undoable step. */
  async autoLayout(): Promise<boolean> {
    const canvas = this.get<Canvas>('canvas');
    if (!canvas || this.snapshot.readOnly) return false;
    const [{ computeLayout, createElk }, { extractLayoutContainers }] = await Promise.all([
      import('./layout/autoLayout'),
      import('./layout/extract'),
    ]);
    const containers = extractLayoutContainers(rootOf(canvas));
    if (!containers.some((c) => c.nodes.length)) return false;
    const layout = await computeLayout(await createElk(), containers);
    this.applyLayout(layout);
    this.fit();
    return true;
  }

  /** Root-level graph of the current diagram for auto layout. */
  getElements(): Element[] {
    return (this.get<ElementRegistry>('elementRegistry')?.getAll() ?? []) as Element[];
  }

  /** Maps BPMN ids (including process ids) to diagram element ids. */
  resolveIds(ids: string[]): string[] {
    const registry = this.get<ElementRegistry>('elementRegistry');
    if (!registry) return [];
    const out: string[] = [];
    for (const id of ids) {
      if (registry.get(id)) {
        out.push(id);
        continue;
      }
      const owner = registry.find((e) => {
        const b = bo(e as Element);
        return (
          !!b && (b.id === id || (b.get?.('processRef') as ModdleElement | undefined)?.id === id)
        );
      });
      if (owner) out.push(owner.id);
    }
    return [...new Set(out)];
  }

  /** Selects and highlights the elements of an analysis finding. */
  reveal(ids: string[]): void {
    const resolved = this.resolveIds(ids);
    const canvas = this.get<Canvas>('canvas');
    // Switch to the diagram that draws the first element.
    const first = resolved.map((id) => this.getElement(id)).find(Boolean);
    if (first && canvas) {
      let root: Element = first;
      while (root.parent) root = root.parent;
      if (root !== (canvas.getRootElement() as unknown as Element)) this.showDiagram(root.id);
    }
    const selectable = resolved.filter((id) => this.getElement(id)?.parent);
    this.select(selectable, false);
    this.highlight(resolved);
    const elements = selectable.map((id) => this.getElement(id)!).filter(Boolean);
    if (canvas && elements.length) canvas.scrollToElement(elements[0]!, 120);
  }

  highlight(ids: string[]): void {
    const canvas = this.get<Canvas>('canvas');
    const registry = this.get<ElementRegistry>('elementRegistry');
    if (!canvas || !registry) return;
    for (const el of registry.getAll()) canvas.removeMarker(el.id, 'bf-highlight');
    for (const id of ids) if (registry.get(id)) canvas.addMarker(id, 'bf-highlight');
  }

  select(ids: string[], scroll = true): void {
    if (!this.diagram) return;
    const registry = this.diagram.get<ElementRegistry>('elementRegistry');
    const elements = ids.map((id) => registry.get(id)).filter((e): e is Element => !!e);
    this.diagram.get<Selection>('selection').select(elements);
    if (scroll && elements.length) {
      this.diagram.get<Canvas>('canvas').scrollToElement(elements[0]!, 80);
    }
  }

  selectAll(): void {
    if (!this.diagram) return;
    const canvas = this.diagram.get<Canvas>('canvas');
    // Only the elements of the diagram that is shown.
    const all: Element[] = [];
    const visit = (parent: Element) => {
      for (const child of childrenOf(parent)) {
        all.push(child);
        visit(child);
      }
    };
    visit(rootOf(canvas));
    this.diagram.get<Selection>('selection').select(all);
  }

  /** BPMN diagrams of the document (each is a diagram-js root). */
  getDiagrams(): DiagramInfo[] {
    const canvas = this.get<Canvas>('canvas');
    const doc = this.document;
    if (!canvas || !doc) return [];
    const live = new Set(getMany(doc.definitions, 'diagrams').map((d) => getRef(d, 'plane')));
    const active = canvas.getRootElement();
    return (canvas.getRootElements() as unknown as (Element & BpmnData)[])
      .filter((root) => live.has(root.di))
      .map((root) => {
        const b = root.businessObject;
        const diagram = root.di.$parent;
        return {
          rootId: root.id,
          name: (diagram?.name as string | undefined) || labelOf(b) || b.id || 'Diagram',
          type: b.$type,
          active: root === (active as unknown as Element),
        };
      });
  }

  /** Shows another BPMN diagram (e.g. the content of a collapsed sub-process). */
  showDiagram(rootId: string): void {
    const canvas = this.get<Canvas>('canvas');
    const root = canvas?.getRootElements().find((r) => r.id === rootId);
    if (!canvas || !root || root === canvas.getRootElement()) return;
    this.get<Selection>('selection')?.select([]);
    canvas.setRootElement(root);
    this.fit();
    this.update({ revision: this.snapshot.revision + 1, activeDiagram: rootId });
  }

  /** The diagram that draws the content of a collapsed sub-process, if any. */
  drillDownOf(id: string): string | null {
    const element = this.getElement(id) as (Element & BpmnData) | undefined;
    if (!element) return null;
    const canvas = this.get<Canvas>('canvas');
    const root = canvas
      ?.getRootElements()
      .find(
        (r) =>
          (r as unknown as BpmnData).businessObject === element.businessObject && r.id !== '__root',
      );
    return root && this.getDiagrams().some((d) => d.rootId === root.id) ? root.id : null;
  }

  getElement(id: string): Element | undefined {
    return this.diagram?.get<ElementRegistry>('elementRegistry').get(id) as Element | undefined;
  }

  updateProperties(id: string, properties: Record<string, PropertyValue>): void {
    const element = this.getElement(id);
    if (element) this.exec(UPDATE_PROPERTIES, { element, properties });
  }

  async exportXml(): Promise<string> {
    if (!this.document) throw new Error('No document is open.');
    const xml = await exportBpmnXml(this.document);
    this.savedAction = this.topAction();
    this.refreshStack();
    return xml;
  }

  destroy(): void {
    this.diagram?.destroy();
    this.diagram = null;
    this.listeners.clear();
    this.errorListeners.clear();
  }
}
