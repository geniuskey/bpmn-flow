# @geniuskey/bpmn-flow

Embeddable **BPMN 2.0** editor and analyzer — the engine behind
[BPMN Flow](https://pages.euiyun.com/bpmn-flow/).

- **Lossless XML.** Unknown attributes, extension elements and vendor namespaces
  survive import → edit → export. Every export is verified by re-importing it;
  files that cannot be round-tripped safely open read-only.
- **Headless core** (`@geniuskey/bpmn-flow`): parse, validate, export and analyze
  BPMN in Node, browsers or Web Workers.
- **Editor** (`@geniuskey/bpmn-flow/editor`): framework-agnostic canvas with
  undo/redo, copy/paste, lanes and pools, auto layout (ELK) and keyboard shortcuts.
- **React** (`@geniuskey/bpmn-flow/react`): a thin `<BpmnFlowCanvas>` component.
- Built on [diagram-js](https://github.com/bpmn-io/diagram-js) and
  [bpmn-moddle](https://github.com/bpmn-io/bpmn-moddle). Does not use bpmn-js; no
  watermark. MIT licensed.

```bash
npm install @geniuskey/bpmn-flow
```

ES modules only. The editor needs a bundler (Vite, webpack, Rollup, esbuild…);
the core also runs directly in Node ≥ 20.19.

## Headless core

```ts
import { analyze, exportBpmnXml, loadBpmnDocument } from '@geniuskey/bpmn-flow';

const doc = await loadBpmnDocument(xml, 'order.bpmn');

doc.report.mode; // 'editable' | 'readonly'
doc.report.exportAllowed; // false when re-exporting would lose content
doc.report.issues; // [{ code, severity, message, elementId? }]

const { metrics, graph, findings, counts } = analyze(doc.definitions);
for (const f of findings) console.log(f.severity, f.ruleId, f.message, f.elementIds);

const out = await exportBpmnXml(doc); // throws BpmnExportError if not lossless
```

| Export                                                                            | Purpose                                                                                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `loadBpmnDocument(xml, fileName?)`                                                | Parse, prove the round-trip, assess compatibility → `BpmnDocument`. Throws `BpmnImportError`.             |
| `exportBpmnXml(doc)`                                                              | Serialize and verify. Throws `BpmnExportError` (with `details`) instead of writing a lossy file.          |
| `createBpmnDocument({ kind? })`                                                   | New document (`'process'`: Start → Task → End, or `'choreography'`).                                      |
| `analyze(definitions)`                                                            | Structure metrics, gateway branching, lane handoffs, cycles, complexity and validation findings.          |
| `estimate(definitions, metadata)`                                                 | Best/worst-case lead time, work time, cost, critical path and waiting hotspots from `AnalysisMetadata[]`. |
| `computeStructureMetrics(definitions)`                                            | Element counts only.                                                                                      |
| `assessCompatibility(...)`, `verifyRoundTrip(moddle, definitions)`                | The building blocks of `loadBpmnDocument`.                                                                |
| `decodeXmlBytes(bytes)`                                                           | Decode file bytes honoring the XML declaration's encoding (UTF-8/16, Latin-1, …).                         |
| `is`, `isAny`, `getMany`, `getRef`, `walkContainment`, `labelOf`, `categoryOf`, … | Helpers for reading the live bpmn-moddle tree (`doc.definitions`).                                        |
| `TASK_TYPES`, `GATEWAY_TYPES`, `EVENT_TYPES`, `EDITABLE_FLOW_NODE_TYPES`, …       | BPMN type lists, e.g. to build a palette.                                                                 |

`doc.definitions` is the live `bpmn:Definitions` object of
[bpmn-moddle](https://github.com/bpmn-io/bpmn-moddle) — there is no JSON copy.

## Editor (any framework)

```ts
import { BpmnFlowEditor } from '@geniuskey/bpmn-flow/editor';
import '@geniuskey/bpmn-flow/style.css';

const container = document.getElementById('canvas')!; // give it a size
const editor = new BpmnFlowEditor(container, { keyboard: true });

const { document, shapes, warnings } = await editor.importXml(xml, 'order.bpmn');
// or: await editor.createNew();

const off = editor.subscribe((s) => {
  // s.selection (ids), s.canUndo, s.canRedo, s.dirty, s.readOnly, s.zoom, s.revision…
});
editor.onCommandError((err) => console.warn('edit rolled back', err));

const out = await editor.exportXml(); // also clears `dirty`
editor.destroy();
```

The container should be positioned (`position: relative`) with a fixed height;
the canvas fills it. Files that cannot be round-tripped open read-only
(`snapshot.readOnly`); check `document.report.issues` to tell the user why.

### Common methods

| Method                                                                                                                                                                             | What it does                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `importXml(xml, fileName?)`, `createNew(kind?)`, `open(doc)`                                                                                                                       | Show a document. On failure the previous one stays open.             |
| `exportXml()`                                                                                                                                                                      | Verified BPMN 2.0 XML.                                               |
| `undo()`, `redo()`                                                                                                                                                                 | Command stack.                                                       |
| `setTool('select' \| 'pan' \| 'lasso' \| 'connect')`                                                                                                                               | Active tool.                                                         |
| `startCreate(mouseEvent, 'bpmn:UserTask')`                                                                                                                                         | Start placing an element (call from your palette's click or drag).   |
| `select(ids)`, `selectAll()`, `reveal(ids)`, `highlight(ids)`                                                                                                                      | Selection, scroll to elements, highlight (e.g. analysis findings).   |
| `deleteSelection()`, `copy()`, `cut()`, `paste()`, `duplicate()`, `nudge(dx, dy)`                                                                                                  | Editing.                                                             |
| `updateProperties(id, { name })`, `updateDocumentation(id, text)`, `updateCondition(id, expr)`                                                                                     | Semantic edits (undoable).                                           |
| `changeType(id, 'bpmn:ServiceTask')`, `setEventDefinition(id, 'bpmn:TimerEventDefinition')`, `setLoop(id, 'parallel')`, `setDefaultFlow(gatewayId, flow)`, `addLane(poolOrLaneId)` | More semantic edits.                                                 |
| `autoLayout()`                                                                                                                                                                     | ELK layered layout (lanes kept), one undo step.                      |
| `zoomBy(f)`, `resetZoom()`, `fit()`, `setSnapToGrid(on)`                                                                                                                           | View.                                                                |
| `getDiagrams()`, `showDiagram(rootId)`, `drillDownOf(id)`                                                                                                                          | Multiple diagrams and collapsed sub-processes.                       |
| `getDocument()`, `getElement(id)`, `getElements()`                                                                                                                                 | Read the model (`element.businessObject` is the bpmn-moddle object). |

### Keyboard

`keyboard: true` binds shortcuts to the container (they apply while the canvas
has focus): Mod+Z / Mod+Shift+Z / Mod+Y, Mod+A, Mod+C/X/V/D, Delete/Backspace,
F2/Enter rename, arrows nudge (Shift ×10), V/H/L/C tools, + / − / 0 zoom,
Shift+1 fit, Mod+Shift+L auto layout, Escape. Pass
`{ keyboard: { onSave: () => save(), target: window } }` to handle Mod+S or listen
on the whole page, or call `bindKeyboard(editor, element, options)` yourself.

### Auto layout in a Web Worker

Without configuration ELK runs on the main thread, which is fine for small and
medium diagrams. To run it in a worker, pass the URL of elkjs' worker script
(add `elkjs` to your own dependencies to import it):

```ts
// Vite
import elkWorker from 'elkjs/lib/elk-worker.min.js?url';
new BpmnFlowEditor(container, { elkWorker });

// webpack 5
new BpmnFlowEditor(container, {
  elkWorker: new URL('elkjs/lib/elk-worker.min.js', import.meta.url),
});
```

`elkWorker` may also be a function returning the URL (or a promise of it), so the
file is only fetched when layout is first used.

## React

```tsx
import { useRef } from 'react';
import { BpmnFlowCanvas, type BpmnFlowEditor } from '@geniuskey/bpmn-flow/react';
import '@geniuskey/bpmn-flow/style.css';

export function ProcessEditor({ xml }: { xml: string }) {
  const editor = useRef<BpmnFlowEditor>(null);
  return (
    <>
      <button onClick={async () => save(await editor.current!.exportXml())}>Save</button>
      <BpmnFlowCanvas
        ref={editor}
        xml={xml}
        keyboard
        style={{ height: 600 }}
        onImport={({ document }) => console.log(document.report)}
        onImportError={(err) => alert(String(err))}
        onSnapshot={(s) => console.log('dirty', s.dirty)}
      />
    </>
  );
}
```

`xml` is re-imported whenever the string changes (omit it for a new diagram);
everything else goes through the editor instance (`ref` or `onReady`). Works with
React 18 and 19.

## Styling and dark mode

`style.css` contains the diagram-js base styles and the BPMN Flow shape styles,
scoped to the canvas. Put the `dark` class on any ancestor (e.g.
`<html class="dark">`) for the dark theme. Override colors with CSS variables on
any ancestor:

```css
.my-editor {
  --bf-primary: #2563eb; /* selection, context pad, connect tool */
  --bf-canvas: #fafafa;
  --bf-canvas-grid: #e5e7eb;
  --bf-card: #fff;
  --bf-foreground: #111827;
  --bf-shape-stroke: #334155; /* shapes: see --bf-shape-*, --bf-event-*, --bf-gateway* … */
}
```

## Licenses

MIT. Runtime dependencies are MIT except elkjs, which is used unmodified under
EPL-2.0 (source: https://github.com/kieler/elkjs). `style.css` includes the
diagram-js stylesheet (MIT). See NOTICE.md.
