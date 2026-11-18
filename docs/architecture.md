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
│ layout/    BpmnFlowLayouter (orthogonal), autoLayout (ELK in a worker), apply      │
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

Dependencies point downwards only. `src/bpmn` and `src/analysis` import neither
React nor diagram-js, so they run in Node (unit tests) and could run in a Web Worker.

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
  keep lanes aligned with their pool, recompute lane membership) through nested
  commands, so each user action is still one undo step.
- `BpmnElementFactory` creates the business object and DI for every element that
  diagram-js features create (palette, append, paste), with ids from `BpmnIds`.
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
open + render ≈ 0.3 s, analysis ≈ 8 ms, export with verification ≈ 0.1 s. The ELK
layout engine (≈1.5 MB) is loaded only when auto layout is used and runs in a Web
Worker.
