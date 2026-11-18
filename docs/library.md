# Library package

BPMN Flow is also published as **`@geniuskey/bpmn-flow`** so other applications
can embed the editor or use the BPMN core. User-facing documentation (API,
examples, styling) is the package README: [packages/bpmn-flow/README.md](../packages/bpmn-flow/README.md).

## Layout

| Path                                      | Role                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/sdk/index.ts`                        | `@geniuskey/bpmn-flow` — headless core (re-exports `src/bpmn` and `src/analysis`)             |
| `src/sdk/editor.ts`                       | `/editor` — `BpmnFlowEditor` (extends `EditorController`: `importXml`, `createNew`, keyboard) |
| `src/sdk/keyboard.ts`                     | `bindKeyboard`, container-scoped version of the app shortcuts                                 |
| `src/sdk/react.tsx`                       | `/react` — `<BpmnFlowCanvas>`                                                                 |
| `src/sdk/style.css`, `tokens.css`         | `/style.css` — diagram-js CSS + canvas tokens scoped to `.bf-canvas-host` + `canvas.css`      |
| `packages/bpmn-flow/`                     | The published package: `package.json`, README, NOTICE; `dist/` is generated                   |
| `vite.lib.config.ts`, `tsconfig.lib.json` | Library build (ES modules, dependencies external) and declarations                            |
| `scripts/build-lib.mjs`                   | Runs both builds, rewrites `@/…` and adds `.js` extensions in the declarations                |
| `scripts/lib-smoke.mjs`                   | Packs and installs the tarball into a fresh project and tests it (Node, tsc, Vite, Chromium)  |

Rules that keep the package usable:

- The app shell (`src/app`, `src/components`, `src/stores`, `src/persistence`) is
  not part of the package. The SDK must not import from it.
- All runtime dependencies stay external (`vite.lib.config.ts`); the package's
  `dependencies` list is maintained by hand — add a dependency there when the
  editor or core starts importing a new package.
- Public types live in `src/editor/types.ts` and must not reference diagram-js
  internals other than `diagram-js/lib/model/Types` (diagram-js' class
  declarations do not type-check under `moduleResolution: nodenext`). The smoke
  test type-checks a consumer with `skipLibCheck: false` in both resolutions.
- The ELK worker is injected (`elkWorker` option); the library never bundles elkjs.

## Release

```bash
npm run test:lib                 # build, pack, install, test
# bump "version" in packages/bpmn-flow/package.json
cd packages/bpmn-flow && npm publish --access public
```

`npm publish` publishes the `dist/` that is on disk, so run `npm run build:lib`
(or `test:lib`) right before it.
