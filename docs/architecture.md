# Architecture

BPMN Flow is a static single-page app. There is no backend.

```
┌──────────────────────────── Application layer (React, src/app, src/components) ───┐
│ Header · Palette · Canvas host · Properties · Analysis · Notices · Shortcuts      │
│            │ commands (open/export/undo…)          ▲ EditorSnapshot (zustand)      │
└────────────┼───────────────────────────────────────┼───────────────────────────────┘
             ▼                                       │
┌──────────── Integration layer: src/editor/EditorController.ts ─────────────────────┐
│ Owns the diagram-js instance; React never touches canvas DOM.                     │
└────────────┬───────────────────────────────────────────────────────────────────────┘
             ▼
┌──────────── Diagram layer (diagram-js, src/editor) ────────────────────────────────┐
│ renderer/  BpmnFlowRenderer (BPMN shapes, theme via CSS classes)                   │
│ canvas/    importDiagram (DI → diagram elements)                                   │
│ modeling/  BpmnElementFactory, BpmnIds, SemanticSync, StructureBehavior, ChangeLog │
│ commands/  DiSync, property/documentation/condition/type, lanes, collaboration     │
│ layout/    BpmnFlowLayouter (orthogonal), engine (BPMN grid layout), extract, apply │
│ interaction/ rules, context pad, inline rename, clipboard, connect tool            │
└────────────┬───────────────────────────────────────────────────────────────────────┘
             ▼ live references (businessObject / di)
┌──────────── BPMN semantic + XML layer (bpmn-moddle, src/bpmn) ─────────────────────┐
│ model/ moddle facade, support matrix, canonical form, snapshot                    │
│ import/ parse · export (document.ts) · di/ DI index & mutations                   │
│ validation/ compatibility assessment                                              │
└────────────▲───────────────────────────────────────────────────────────────────────┘
             │ read-only
┌──────────── Analysis layer (pure TS, src/analysis) ────────────────────────────────┐
│ graph/ process graph, reachability, SCC · rules/ findings · metrics/ · estimates/ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

The editor, analysis and BPMN layers are also published as a library
(`src/sdk`, see [library.md](library.md)); the application layer is not.

Dependencies point downwards only. `src/bpmn` and `src/analysis` import neither
React nor diagram-js, so they run in Node (unit tests) and could run in a Web Worker.

Where the larger pieces live:

- `src/editor/EditorController.ts` is the facade the React shell talks to;
  `modules.ts` wires the diagram-js modules and command handlers, `types.ts` holds
  the public types (`EditorSnapshot`, `EditorTool`, `DiagramInfo`).
- `src/editor/renderer/BpmnFlowRenderer.ts` dispatches per element kind to
  `shapes.ts` (events, choreography activities, pools), `markers.ts` (gateway,
  event and activity markers, task icons) and `text.ts` (labels); `svg.ts` has the
  SVG helpers.
- `src/editor/modeling/SemanticSync.ts` only registers the command hooks; the BPMN
  changes are in `shapeSync.ts` and `connectionSync.ts`, which share the services
  and DI/containment helpers of `semanticModel.ts`.
- `src/editor/library.ts` is the BPMN shape library (palette entries as
  `ShapePreset`s); `modeling/presets.ts` builds elements from presets,
  `renderer/preview.ts` draws their icons with the canvas renderer, and
  `modeling/replace.ts` decides which variants an element may become
  (`element.replace`, "Change type" popup menu in `interaction/ReplaceMenu.ts`).
- `modeling/laneLayout.ts` holds the geometry of horizontal / vertical pools and
  nested lanes (used by `lane.add`, StructureBehavior and the resize rules);
  `modeling/dataIo.ts` creates and removes the Data Inputs / Outputs that data
  associations connect to; `commands/PoolBoundaryHandler.ts` draws the main pool
  with or without its boundary (`boundlessParticipant` in `modeling/semantic.ts`
  makes the diagram root stand for that pool's process).
- `modeling/choreography.ts` lays out the participant bands of choreography
  activities (upper / lower section, top / middle / bottom kinds);
  `commands/ChoreographyParticipantHandler.ts` (`choreography.updateBands`)
  edits participants, initiator, band order, band messages, multi-instance
  participants and the return message of two-way tasks in one undo step.
- `src/components/Inspector.tsx` picks the panel; the sections are in
  `src/components/inspector/` (`ElementDetails`, `kindFields`, `eventFields`,
  `participantFields`, `specFields` (gateway direction, expressions, process /
  flow / annotation attributes, categories, event codes, compensation, new
  called elements), `MetadataSection`, `DocumentDetails`, shared `fields` and
  `shared` helpers).

## Single source of truth

The `bpmn:Definitions` moddle tree is the only document model.

- Every diagram-js element holds `businessObject` (the semantic element) and `di`
  (its `BPMNShape`/`BPMNEdge`), both live moddle objects — never copies.
- diagram-js keeps geometry (`x/y/width/height`, `waypoints`) because its
  interaction features need it. `DiSync` writes geometry back to DI on every
  `elements.changed` event (fired after execute, undo and redo). It runs before the
  graphics are redrawn and only touches DI that actually changed.
- diagram-js modeling commands (create, delete, connect, reconnect, move…) only
  change the diagram graph. `SemanticSync` hooks into each command's `executed`
  event (also fired on redo) and applies the matching BPMN change — containment
  in `flowElements`/`participants`/`laneSets`, `sourceRef`/`targetRef`,
  `incoming`/`outgoing`, DI plane membership. Every mutation is logged in a
  `ChangeLog` stored in the command context and replayed backwards on `reverted`,
  so undo restores the exact previous model (array positions included).
- `StructureBehavior` adds compound behavior (wrap content into the first pool,
  keep lanes aligned with their pool, grow a pool or expanded sub-process to fit a
  shape created outside it, recompute lane membership) through nested commands, so
  each user action is still one undo step.
- Keyboard moves and context-pad appends ask the same rules as mouse edits
  (`elements.move`, `canAppend`); there is no second code path that skips them.
- `guardCommandStack` makes a failing command recoverable: it reverts the steps the
  command had completed, clears diagram-js' stuck in-progress state and reports the
  error, instead of leaving every later edit merged into the broken command.
- `element.changeType` re-parents every contained child and re-points every
  reference to the replaced object (generic walk over the definitions).
- `BpmnElementFactory` creates the business object and DI for every element that
  diagram-js features create (palette, append, paste), with ids from `BpmnIds`;
  a `preset` selects the notation variant (trigger, interrupting, collection...).
- `element.setExpanded` collapses / expands a sub-process kind: the content's
  diagram elements and DI move between the shape and the element's drill-down
  diagram (a diagram-js root per BPMNDiagram, `modeling/drillDown.ts`); a root
  whose diagram was removed stays registered and is reused.
- `element.replace` turns an element into another variant in one undo step:
  `element.changeType`, then the flags, then `event.setDefinition` (nested).
- Semantic edits from the inspector are commands too (`element.updateProperties`,
  `element.updateDocumentation`, `element.updateCondition`, `element.changeType`).
- There is no JSON conversion step: export serializes the same moddle tree that
  was imported, so unknown attributes, extension elements and references survive.

## Lifecycle

1. **Load** (`loadBpmnDocument`): parse with bpmn-moddle → serialize and re-parse to
   prove the round-trip is lossless → `assessCompatibility` decides `editable` or
   `readonly` and whether re-export is allowed.
2. **Open** (`EditorController.open`): builds a fresh `Diagram` (with editing modules
   only when editable), imports shapes from DI, then swaps it in. If import throws,
   the previously open document is untouched.
3. **Edit**: diagram-js commands → `DiSync` → DI. `BpmnFlowRules` rejects any edit
   that would need a semantic change not yet implemented (re-parenting, lane
   membership, create/delete, resize).
4. **Export** (`exportBpmnXml`): refuses lossy documents; otherwise serializes,
   re-parses and compares the canonical form. Any difference aborts the export.

## React ↔ diagram-js boundary

- `CanvasView` creates one `EditorController` per mount and never re-renders the
  canvas DOM.
- The controller publishes a small `EditorSnapshot` (selection ids, undo/redo
  state, revision, dirty, zoom, read-only). Components subscribe to the fields they
  need via zustand selectors, so canvas interaction does not re-render the shell.
- Components that display model data (inspector, metrics) read the moddle tree on
  render and use `revision` as the invalidation signal.

## Styling

Shapes carry `bf-*` CSS classes; colors live in CSS variables (`src/styles/canvas.css`).
DI color extensions (`color:*`, `bioc:*`) redefine those variables on the element's own
visual group (`src/editor/renderer/colors.ts`): stroke → lines, markers and text; fill →
interior only, uniformly across element types.
Switching light/dark toggles a class on `<html>` and needs no redraw. BPMN notation is
kept (circle/rounded rectangle/diamond, thin start and thick end event borders,
gateway markers); only the visual treatment is modernized.

## Local data

`src/persistence/db.ts` (IndexedDB via `idb`) stores the autosaved document
(verified export, or the untouched original for lossy files) and analysis metadata
keyed by `[documentId, elementId]`. All storage calls fail soft: the editor keeps
working when IndexedDB is unavailable.

Autosave (`src/app/useAutosave.ts`, `src/app/actions.ts`):

- Every change is saved 1 s after the last edit, independent of `dirty`
  (which means "differs from the last export"). Saves run one at a time, in order.
- Pending saves are flushed when the page is hidden or another document is opened;
  leaving the page while a save is pending asks for confirmation.
- Opening a different document (including a `?sample=` link, or a new diagram after a
  session failed to restore) first copies the stored session to a `previous` slot.
  "Restore previous autosave" in the command palette swaps the two back.
- `dirty` compares the undo-stack entry on top of the stack with the one at the last
  export, so "export, undo, different edit" still counts as unsaved.

## Performance

Measured in `tests/e2e/performance.spec.ts` (1000 tasks, Chromium, Apple M-series):
open + render ≈ 0.3 s, analysis ≈ 8 ms, export with verification ≈ 0.1 s. Auto
layout of the same diagram takes well under a second on the main thread (unit test);
the engine is plain TypeScript, loaded only when layout is first used.

## Auto layout

`src/editor/layout/engine.ts` works on a plain description of the diagram
(`graph.ts`, built by `extract.ts`), so it runs headless. Flow nodes get a cell in
a grid of layers (along the flow) and tracks (across it); tracks belong to bands
(one per leaf lane, or per pool / process), and the layers are shared by all
pools. Layers come from the longest path over sequence flows (loops broken by
DFS; exception flows leave from their host; message flows keep their target no
earlier than their source). The main path (longest start → end) is the first
track of its band; branches and exception paths stack below. Artifacts take a
free cell next to the node they are associated with. Flows are routed through
the grid (free tracks and the channels between layers), never through a cell
holding a node; channels and tracks are sized for the shapes, external labels
and flow names in them. Expanded sub-processes are laid out first and become
large nodes. `ApplyLayoutHandler` applies the result as one command; BPMNLabel
bounds are set by `LayoutLabelsHandler` (relative to DiSync's label move).

The reflow view (`src/sdk/viewer.ts`, `BpmnFlowViewer`) is read-only and works on
a private copy of the document: the copy is opened, its layout input extracted
once, then for the container's size both directions are laid out and the one
shown larger wins; `project.ts` writes the result straight into the copy's DI
(no commands) and the copy is opened again. Pools and lanes turn with the flow
(`isHorizontal`). The app shows it over the canvas (`components/ReflowView.tsx`);
the edited document is untouched.
