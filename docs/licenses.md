# License review

Run `npm run licenses` to audit, `npm run licenses -- --write` to regenerate
`THIRD_PARTY_NOTICES.md`. The audit fails on any dependency whose license is
outside the allow-list (MIT, ISC, Apache-2.0, BSD, 0BSD, …) unless it is listed,
with a reason, in `scripts/check-licenses.mjs`. The notices are shipped with every
build as `third-party-notices.txt` (linked from Settings).

| Decision                                                                    | Status                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BPMN Flow itself                                                            | **MIT** (LICENSE), chosen 2026-11-19 so the code can be used by third parties as the `@geniuskey/bpmn-flow` package. The package bundles none of its dependencies' JavaScript (all external, installed from npm under their own licenses); `style.css` inlines the diagram-js stylesheet (MIT), noted with its copyright in `packages/bpmn-flow/NOTICE.md`.  |
| bpmn-js                                                                     | **Not used.** Its license requires the bpmn.io watermark; we neither depend on it nor copy its code. No watermark is hidden or removed anywhere (E2E checks that no bpmn.io branding exists).                                                                                                                                                                |
| diagram-js 15.x                                                             | MIT (Camunda Services GmbH). No watermark requirement. Copyright notice reproduced.                                                                                                                                                                                                                                                                          |
| bpmn-moddle 10.x, moddle, moddle-xml                                        | MIT.                                                                                                                                                                                                                                                                                                                                                         |
| @bpmn-io/diagram-js-ui, preact, htm                                         | Transitive deps of diagram-js; MIT / MIT / Apache-2.0.                                                                                                                                                                                                                                                                                                       |
| idb                                                                         | ISC.                                                                                                                                                                                                                                                                                                                                                         |
| shadcn/ui                                                                   | MIT; components are adapted source (button, badge) — attribution included.                                                                                                                                                                                                                                                                                   |
| lucide-react                                                                | ISC.                                                                                                                                                                                                                                                                                                                                                         |
| lightningcss                                                                | MPL-2.0, **build-time only** (Tailwind CSS compiler); not part of the bundle.                                                                                                                                                                                                                                                                                |
| fake-indexeddb                                                              | Apache-2.0, tests only.                                                                                                                                                                                                                                                                                                                                      |
| SpiffWorkflow, pm4py, Camunda BPMN Model API, Camunda Modeler (desktop app) | LGPL-3.0 / AGPL-3.0 / Apache-2.0. External interoperability checks only (local `.venv-interop`, jars via `CAMUNDA_CLASSPATH`, the Modeler app via `CAMUNDA_MODELER`); not dependencies, not imported or bundled by BPMN Flow and not distributed. Running the official Camunda Modeler application to open exported files does not use bpmn-js in BPMN Flow. |
| OMG BPMN 2.0 XSD files                                                      | Downloaded at test time (`npm run schemas`) and **not committed**: the files carry no license statement, so redistribution terms are unclear and recorded here rather than interpreted. They are only used to validate output.                                                                                                                               |

## Removed dependencies

- elkjs (EPL-2.0) was used for auto layout until 2026-11-21; it was replaced by
  BPMN Flow's own layout engine (`src/editor/layout/engine.ts`, MIT) and is no
  longer a dependency of the app or the library.

## Dev-tool notes

- TypeScript is pinned to `~6.0` because `typescript-eslint` 8.x supports `<6.1`.
  TypeScript 7 (native) can be adopted once the lint toolchain supports it.
- `npm audit` reports a ReDoS advisory in `picomatch` (all versions, no fix released),
  reachable only through dev tooling (Vite, Vitest, typescript-eslint). Production
  dependencies have no advisories (`npm audit --omit=dev`).
