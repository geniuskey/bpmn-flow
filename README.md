# BPMN Flow

**Live app: https://pages.euiyun.com/bpmn-flow/**

Modern BPMN Process Editor & Analyzer — a static web app that opens, edits,
analyzes and exports standard **BPMN 2.0 XML** without losing data it does not
understand.

- Built on [diagram-js](https://github.com/bpmn-io/diagram-js) (canvas) and
  [bpmn-moddle](https://github.com/bpmn-io/bpmn-moddle) (BPMN model + XML). `bpmn-js`
  is not used, and nothing is hidden or removed to avoid a watermark.
- The BPMN moddle tree is the single source of truth. Every edit is an undoable
  command that updates the semantic model and the diagram interchange (DI).
- Exports are verified by re-importing them before a file is written, and are
  validated against the official BPMN 2.0 XSD in tests.
- Files the editor cannot round-trip safely open read-only; lossy files cannot be
  re-exported (the original can always be downloaded).

## Features

| Area          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files         | Open (picker, drag & drop), new, export BPMN 2.0 XML (verified), download original, autosave/restore (IndexedDB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Modeling      | All BPMN event types (start, end, intermediate catch/throw, boundary) with message, timer, signal, error, escalation, conditional, link and terminate definitions; nine task/activity types incl. call activity; expanded and collapsed sub-processes and event sub-processes; five gateway types; sequence and message flows; data objects/stores with data associations; text annotations, associations and groups. Create from palette, append from contextual toolbar, connect tool, bendpoints, reconnect, resize, inline rename, change type, copy/cut/paste/duplicate, delete, multi-select, arrow-key nudge, grid snapping, undo/redo |
| Structure     | First pool converts a process into a collaboration; add/resize/delete lanes; lane membership follows node positions; move nodes between pools; message flows between pools; message/timer start and message/terminate end events                                                                                                                                                                                                                                                                                                                                                                                                              |
| Layout        | ELK auto layout (lanes preserved), orthogonal connection routing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Properties    | Name, description, type, condition expressions, default flow, BPMN attributes, extension attributes (read-only), analysis metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Analysis      | Structure metrics, gateway branches, lane handoffs, loops, complexity; findings (unreachable, isolated, dead ends, no path to end, cycles, gateway issues, invalid connections, broken references, duplicate ids, DI problems) with click-to-highlight; time/cost estimates from user data                                                                                                                                                                                                                                                                                                                                                    |
| UX            | Command palette (⌘/Ctrl+K), context menu, keyboard shortcuts, light/dark/system theme, resizable/collapsible panels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Compatibility | Compatibility report; unsupported content shown as dashed placeholders and opened read-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

See [docs/bpmn-support.md](docs/bpmn-support.md) for the exact support matrix.

## Use it as a library

The editor and the BPMN core are published as
[`@geniuskey/bpmn-flow`](packages/bpmn-flow/README.md) (MIT):

```bash
npm install @geniuskey/bpmn-flow
```

```ts
import { analyze, loadBpmnDocument } from '@geniuskey/bpmn-flow'; // headless, Node or browser
import { BpmnFlowEditor } from '@geniuskey/bpmn-flow/editor'; // any framework
import { BpmnFlowCanvas } from '@geniuskey/bpmn-flow/react'; // React component
import '@geniuskey/bpmn-flow/style.css';

const editor = new BpmnFlowEditor(document.getElementById('canvas')!, { keyboard: true });
await editor.importXml(xml);
const out = await editor.exportXml();
```

See the [package README](packages/bpmn-flow/README.md) for the API and
[docs/library.md](docs/library.md) for how the package is built and released.

## Getting started

```bash
npm install
npm run dev            # http://localhost:5173
```

Samples: `?sample=mvp-elements`, `collaboration-lanes`, `analysis-issues`,
`extensions`, `vendor-camunda-style`, `unsupported-elements`, `lossy-unknown-content`.

## Scripts

| Command                           | Purpose                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`               | TypeScript (strict)                                                                                                               |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                                                                 |
| `npm test`                        | Unit, round-trip and XSD tests (Vitest)                                                                                           |
| `npm run schemas`                 | Download the OMG BPMN 2.0 XSDs used by the XSD tests (not committed)                                                              |
| `npm run test:e2e`                | Browser tests (Playwright, Chromium) incl. performance                                                                            |
| `npm run build`                   | Static build in `dist/` (`BASE_PATH=/repo/` for GitHub Pages)                                                                     |
| `npm run build:lib`               | Library build in `packages/bpmn-flow/dist/`                                                                                       |
| `npm run test:lib`                | Pack the library, install it into a fresh project and test it (Node, TypeScript, Vite, Chromium)                                  |
| `npm run interop`                 | External checks: SpiffWorkflow, pm4py, the Camunda BPMN Model API and the Camunda Modeler desktop app (see docs/compatibility.md) |
| `npm run licenses`                | Dependency license audit (`-- --write` regenerates THIRD_PARTY_NOTICES.md)                                                        |
| `npm run verify`                  | typecheck + lint + test + build                                                                                                   |

Deployment: `.github/workflows/pages.yml` builds and publishes to GitHub Pages on
pushes to `main` (enable Pages → “GitHub Actions” in the repository settings).

## Keyboard shortcuts

| Action                              | Shortcut                           |
| ----------------------------------- | ---------------------------------- |
| Command palette                     | ⌘/Ctrl+K                           |
| Open / Export / New                 | ⌘/Ctrl+O · ⌘/Ctrl+S · ⌘/Ctrl+Alt+N |
| Undo / Redo                         | ⌘/Ctrl+Z · ⌘/Ctrl+Shift+Z          |
| Copy / Cut / Paste / Duplicate      | ⌘/Ctrl+C · X · V · D               |
| Delete / Rename                     | Del, Backspace · F2, Enter         |
| Move selection                      | Arrow keys (Shift = 10 px)         |
| Select all                          | ⌘/Ctrl+A                           |
| Select / Pan / Lasso / Connect tool | V · H · L · C                      |
| Auto layout                         | ⌘/Ctrl+Shift+L                     |
| Zoom in / out / 100% / fit          | + · − · 0 · Shift+1                |

## Documentation

- [Architecture](docs/architecture.md)
- [BPMN support matrix](docs/bpmn-support.md)
- [Compatibility and data-loss policy](docs/compatibility.md)
- [Process analysis](docs/analysis.md)
- [Library package](docs/library.md)
- [License review](docs/licenses.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

BPMN Flow is released under the [MIT License](LICENSE). Third-party components keep
their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
