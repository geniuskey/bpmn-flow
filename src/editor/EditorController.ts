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
import { importDiagram } from './canvas/importDiagram';
import { exportSvg } from './canvas/svgExport';
import {
  UPDATE_CONDITION,
  UPDATE_DOCUMENTATION,
  UPDATE_PROPERTIES,
} from './commands/UpdatePropertiesHandler';
import { REPLACE_ELEMENT } from './commands/ReplaceHandler';
import { SET_EXPANDED, expandBlocker } from './commands/ExpandHandler';
import { drillDownRootOf } from './modeling/drillDown';
import {
  allowedTypeChanges,
  replaceBlocker,
  replaceOptions,
  typeChangePreset,
  type ReplaceOption,
} from './modeling/replace';
import { boundlessParticipant, containerAt } from './modeling/semantic';
import { canAttach, canAddLaneTo, choreographyBoundarySpot } from './interaction/BpmnFlowRules';
import { SET_EVENT_DEFINITION } from './commands/EventDefinitionHandler';
import { SET_LOOP } from './commands/LoopHandler';
import {
  SET_CHOREOGRAPHY_PARTICIPANT,
  UPDATE_CHOREOGRAPHY_BANDS,
} from './commands/ChoreographyParticipantHandler';
import { UPDATE_EVENT_DETAIL } from './commands/EventDetailHandler';
import { UPDATE_ELEMENT_DETAIL } from './commands/ElementDetailHandler';
import { ADD_LANE, SET_POOL_BLACK_BOX, blackBoxBlocker } from './commands/StructureHandlers';
import { SET_POOL_BOUNDARY, hideBoundaryBlocker } from './commands/PoolBoundaryHandler';
import { APPLY_LAYOUT } from './layout/ApplyLayoutHandler';
import { SET_COLORS } from './commands/ColorsHandler';
import { arrangeable, deletable } from './interaction/BpmnFlowRules';
import {
  ARRANGE_ELEMENTS,
  alignMoves,
  distributeMoves,
  type ArrangeMove,
} from './commands/ArrangeHandler';
import type DirectEditing from './interaction/DirectEditing';
import type Clipboard from './interaction/Clipboard';
import { guardCommandStack } from './commands/guardCommandStack';
import type ConnectTool from './interaction/ConnectTool';
import { bo, childrenOf, isColorable, rootOf, type BpmnData } from './model';
import { labelOf } from '@/bpmn/model/elements';
import { getMany, getRef, is } from '@/bpmn/model/moddle';
import { coreModule, EDITING_MODULES } from './modules';
import type {
  Alignment,
  CanvasImportResult,
  BandOp,
  DistributeAxis,
  DiagramInfo,
  EditorOptions,
  ElementDetail,
  EditorSnapshot,
  EditorTool,
  EventDetail,
  LayoutResult,
  Listener,
  LoopKind,
  PropertyValue,
  ShapePreset,
  SvgExport,
} from './types';
import type { ELK } from 'elkjs/lib/elk-api';

export type { DiagramInfo, EditorOptions, EditorSnapshot, EditorTool, ShapePreset } from './types';

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
  private elk: Promise<ELK> | null = null;

  constructor(
    protected readonly container: HTMLElement,
    protected readonly options: EditorOptions = {},
  ) {}

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
    // Commands may switch diagrams too (undoing a collapse shown in its own diagram).
    eventBus.on('root.set', (e: { element: Element }) => {
      if (e.element.id !== this.snapshot.activeDiagram) {
        this.update({ activeDiagram: e.element.id, revision: this.snapshot.revision + 1 });
      }
    });
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

  /** Zooms to an absolute scale around the center of the view. */
  setZoom(scale: number): void {
    this.diagram?.get<Canvas>('canvas').zoom(Math.min(4, Math.max(0.2, scale)), 'auto' as never);
  }

  /** Fits the view to the selected elements (no upscaling beyond 100%). */
  zoomToSelection(): boolean {
    const canvas = this.get<Canvas>('canvas');
    const elements = this.selected();
    if (!canvas || !elements.length) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of elements) {
      const points = (el as Connection).waypoints ?? [
        { x: (el as Shape).x, y: (el as Shape).y },
        { x: (el as Shape).x + (el as Shape).width, y: (el as Shape).y + (el as Shape).height },
      ];
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const pad = 60;
    const box = {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    };
    const { outer } = canvas.viewbox();
    const scale = Math.min(1, outer.width / box.width, outer.height / box.height);
    const width = outer.width / scale;
    const height = outer.height / scale;
    canvas.viewbox({
      x: box.x + box.width / 2 - width / 2,
      y: box.y + box.height / 2 - height / 2,
      width,
      height,
    });
    return true;
  }

  /** Standalone SVG image of the visible diagram (light theme, no editor chrome). */
  toSvg(): SvgExport | null {
    const canvas = this.get<Canvas>('canvas');
    const registry = this.get<ElementRegistry>('elementRegistry');
    return canvas && registry ? exportSvg(canvas, registry) : null;
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

  /**
   * Starts placing a new element (palette click or drag). `preset` selects a
   * notation variant (trigger, interrupting, collection, ...); the drop is
   * checked by the modeling rules (e.g. error start events only inside an
   * event sub-process, boundary events on an activity border).
   */
  startCreate(event: MouseEvent | PointerEvent, type: string, preset?: ShapePreset): void {
    const create = this.get<Create>('create');
    const factory = this.get<ElementFactory>('elementFactory');
    if (!create || !factory) return;
    const shape = factory.createShape({ type, ...(preset ? { preset: { ...preset, type } } : {}) });
    create.start(event as MouseEvent, shape);
  }

  /**
   * Places a new element without the mouse (palette from the keyboard): in
   * the middle of the visible area, inside the container found there; a
   * boundary event on the selected activity; a lane in the selected pool.
   * Returns false when the element does not fit there.
   */
  createInView(type: string, preset?: ShapePreset): boolean {
    const canvas = this.get<Canvas>('canvas');
    const factory = this.get<ElementFactory>('elementFactory');
    const modeling = this.get<Modeling>('modeling');
    const rules = this.get<Rules>('rules');
    if (!canvas || !factory || !modeling || !rules || this.snapshot.readOnly) return false;
    const full = { ...preset, type };
    const [selected] = this.selected();
    if (type === 'bpmn:Lane') {
      // The selected pool or lane, or a process diagram without pools.
      const target = selected ?? rootOf(canvas);
      if (!canAddLaneTo(target)) return false;
      this.exec(ADD_LANE, { target });
      return true;
    }
    const shape = factory.createShape({ type, preset: full }) as Shape;
    if (type === 'bpmn:BoundaryEvent') {
      const host = selected as Shape | undefined;
      if (!host || !canAttach([shape], host)) return false;
      // On a choreography activity the trigger decides the band (Table 11.7).
      const position = is(bo(host), 'bpmn:ChoreographyActivity')
        ? choreographyBoundarySpot(host, bo(shape)!)
        : { x: host.x + host.width / 2, y: host.y + host.height };
      modeling.createShape(shape, position, host, { attach: true } as never);
      this.select([shape.id], false);
      return true;
    }
    const box = canvas.viewbox();
    const position = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    const root = rootOf(canvas);
    // Pools and conversations go on the diagram itself, the rest into the container there.
    const onRoot = type === 'bpmn:Participant' || /Conversation$/.test(type);
    const target = onRoot
      ? root
      : (containerAt(root, {
          x: position.x - shape.width / 2,
          y: position.y - shape.height / 2,
          width: shape.width,
          height: shape.height,
        }) ?? root);
    if (!rules.allowed('shape.create', { shape, target, position })) return false;
    modeling.createShape(shape, position, target as Shape);
    this.select([shape.id], false);
    return true;
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

  /** Number of selected shapes that align / distribute would move (2+ to align, 3+ to distribute). */
  arrangeableCount(): number {
    return this.snapshot.readOnly ? 0 : arrangeable(this.selected()).length;
  }

  /** Aligns the selected shapes; returns how many moved. */
  alignSelection(type: Alignment): number {
    return this.arrange(alignMoves(arrangeable(this.selected()), type));
  }

  /** Spaces the selected shapes evenly; returns how many moved. */
  distributeSelection(axis: DistributeAxis): number {
    return this.arrange(distributeMoves(arrangeable(this.selected()), axis));
  }

  private arrange(moves: ArrangeMove[]): number {
    const rules = this.get<Rules>('rules');
    if (this.snapshot.readOnly || !rules) return 0;
    // The same check as a drag of each shape (container changes, pool bounds, ...).
    const allowed = moves.filter((m) =>
      rules.allowed('elements.move', { shapes: [m.shape], delta: m.delta }),
    );
    if (allowed.length) this.exec(ARRANGE_ELEMENTS, { moves: allowed });
    return allowed.length;
  }

  /**
   * Fill / stroke of every selected drawn element that can be edited, as one
   * undo step (connections take the stroke only). Returns how many changed.
   */
  setSelectionColors(colors: { fill?: string | null; stroke?: string | null }): number {
    if (this.snapshot.readOnly) return 0;
    const changes = this.selected()
      .filter((e) => isColorable(e))
      .map((element) => {
        const edge = !!(element as Connection).waypoints;
        return { element, ...(edge ? {} : { fill: colors.fill }), stroke: colors.stroke };
      })
      .filter((c) => c.fill !== undefined || c.stroke !== undefined);
    if (changes.length) this.exec(SET_COLORS, { changes });
    return changes.length;
  }

  /** Whether the inspector may edit the size of a shape (activities, pools, lanes, ...). */
  canResize(id: string): boolean {
    const shape = this.getElement(id);
    const rules = this.get<Rules>('rules');
    if (this.snapshot.readOnly || !shape || (shape as Connection).waypoints || !rules) return false;
    return rules.allowed('shape.resize', { shape }) === true;
  }

  /**
   * Moves and / or resizes a shape to exact bounds, under the same rules as a
   * drag or a resize with the mouse. Returns false when the rules refuse it.
   */
  setBounds(id: string, bounds: { x: number; y: number; width: number; height: number }): boolean {
    const shape = this.getElement(id) as Shape | undefined;
    const modeling = this.get<Modeling>('modeling');
    const rules = this.get<Rules>('rules');
    if (this.snapshot.readOnly || !shape || (shape as unknown as Connection).waypoints)
      return false;
    if (!modeling || !rules) return false;
    const delta = { x: bounds.x - shape.x, y: bounds.y - shape.y };
    const resized = bounds.width !== shape.width || bounds.height !== shape.height;
    if (resized) {
      if (rules.allowed('shape.resize', { shape, newBounds: bounds }) !== true) return false;
      modeling.resizeShape(shape, bounds);
      return true;
    }
    if (!delta.x && !delta.y) return true;
    if (!rules.allowed('elements.move', { shapes: [shape], delta })) return false;
    modeling.moveElements([shape], delta);
    return true;
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

  /** Changes the BPMN type (same family); triggers the new type cannot have are dropped. */
  changeType(id: string, newType: string): void {
    const element = this.getElement(id);
    const preset = element && typeChangePreset(element, newType);
    if (element && preset) this.exec(REPLACE_ELEMENT, { element, preset });
  }

  /** Types the element may change to where it is (inspector "Type", context menu). */
  typeChangeOptions(id: string): string[] {
    const element = this.getElement(id);
    return element && !this.snapshot.readOnly ? allowedTypeChanges(element) : [];
  }

  /** Turns the element into another notation variant (one undo step). */
  replace(id: string, preset: ShapePreset): void {
    const element = this.getElement(id);
    if (element) this.exec(REPLACE_ELEMENT, { element, preset });
  }

  /** Why the element cannot become `preset`, or null when it can. */
  replaceBlocker(id: string, preset: ShapePreset): string | null {
    const element = this.getElement(id);
    return element ? replaceBlocker(element, preset) : 'Not available.';
  }

  /** The library variants the element can be turned into ("Change type" menu). */
  replaceOptions(id: string): ReplaceOption[] {
    const element = this.getElement(id);
    return element && !this.snapshot.readOnly ? replaceOptions(element) : [];
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

  /** Message flow message, loop / multi-instance attributes (see `ElementDetail`). */
  updateElementDetail(id: string, detail: ElementDetail): void {
    const element = this.getElement(id);
    if (element) this.exec(UPDATE_ELEMENT_DETAIL, { element, detail });
  }

  setChoreographyParticipant(
    id: string,
    slot: 0 | 1,
    choice: { participantId?: string; newName?: string },
  ): void {
    const element = this.getElement(id);
    if (element) this.exec(SET_CHOREOGRAPHY_PARTICIPANT, { element, slot, ...choice });
  }

  /** Participants and bands of a choreography activity (see `BandOp`). One undo step. */
  updateChoreographyBands(id: string, op: BandOp): void {
    const element = this.getElement(id);
    if (element) this.exec(UPDATE_CHOREOGRAPHY_BANDS, { element, op });
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

  /**
   * Collapses (content moves to the element's own drill-down diagram) or
   * expands (content moves back into the shape) a sub-process, transaction,
   * ad-hoc sub-process or sub-choreography. One undo step.
   */
  /**
   * Shows the pool `id` without its boundary (BPMN 2.0.2 PDF 141-143), or
   * (`visible`) draws the pool shown without boundary with one again.
   */
  setPoolBoundary(id: string, visible: boolean): void {
    if (visible) {
      const participant = this.boundlessPool();
      if (participant?.id === id) this.exec(SET_POOL_BOUNDARY, { participant, visible: true });
      return;
    }
    const element = this.getElement(id) as Shape | undefined;
    if (element) this.exec(SET_POOL_BOUNDARY, { element, visible: false });
  }

  poolBoundaryBlocker(id: string): string | null {
    if (this.snapshot.readOnly) return 'The document is read-only.';
    return hideBoundaryBlocker(this.getElement(id));
  }

  /** The participant of the shown collaboration diagram that is drawn without its pool boundary. */
  boundlessPool(): ModdleElement | undefined {
    const canvas = this.get<Canvas>('canvas');
    return canvas ? boundlessParticipant(canvas.getRootElement() as Element) : undefined;
  }

  setExpanded(id: string, expanded: boolean): void {
    const shape = this.getElement(id);
    if (shape) this.exec(SET_EXPANDED, { shape, expanded });
  }

  /** Why the element cannot be expanded / collapsed, or null when it can. */
  expandBlocker(id: string, expanded: boolean): string | null {
    if (this.snapshot.readOnly) return 'The document is read-only.';
    return expandBlocker(this.getElement(id), expanded);
  }

  /** Adds a lane after a lane or at the end of a pool; `inside` adds a sub-lane to a lane. */
  addLane(targetId: string, inside = false): void {
    const target = this.getElement(targetId);
    if (target) this.exec(ADD_LANE, { target, ...(inside ? { inside: true } : {}) });
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
    this.elk ??= createElk(this.options.elkWorker);
    let elk: ELK;
    try {
      elk = await this.elk;
    } catch (err) {
      this.elk = null; // let a later attempt retry (e.g. the worker file failed to load)
      throw err;
    }
    const layout = await computeLayout(elk, containers);
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

  /**
   * The fill and stroke an element is drawn with right now, as computed CSS
   * colors — theme defaults included, so the Inspector can show what an
   * element without DI colors actually looks like.
   */
  getRenderedColors(id: string): { fill?: string; stroke?: string } {
    const gfx = this.get<ElementRegistry>('elementRegistry')?.getGraphics(id) as
      SVGElement | undefined;
    const body =
      gfx?.querySelector<SVGElement>('.djs-visual > .bf-shape, .djs-visual > .bf-connection') ??
      gfx?.querySelector<SVGElement>('.djs-visual > :first-child');
    if (!body) return {};
    const style = getComputedStyle(body);
    const paint = (value: string) =>
      value && value !== 'none' && !value.startsWith('url(') ? value : undefined;
    return { fill: paint(style.fill), stroke: paint(style.stroke) };
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
    const canvas = this.get<Canvas>('canvas');
    if (!element?.parent || !canvas || !this.document) return null;
    return drillDownRootOf(canvas, element.businessObject, this.document.definitions)?.id ?? null;
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
