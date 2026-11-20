# Compatibility and data-loss policy

BPMN Flow targets **BPMN 2.0.2 XML** (namespace `http://www.omg.org/spec/BPMN/20100524/MODEL`)
with BPMN DI. We do not claim compatibility with every BPMN file. Instead, every
file is checked when it is opened, and the editor refuses to do anything it cannot
prove is lossless.

## When a file is opened

| Condition                                                                                                                                                                                         | Mode      | Re-export           | Why                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------- | ------------------------------------------------------------------ |
| bpmn-moddle reports a warning (unknown element outside `extensionElements`, unresolved reference, duplicate id, …)                                                                                | read-only | **blocked**         | moddle drops that content; re-exporting would silently delete it   |
| Serialize → re-parse does not reproduce the identical canonical model                                                                                                                             | read-only | **blocked**         | preservation cannot be proven                                      |
| Unsupported diagram elements (see bpmn-support.md)                                                                                                                                                | read-only | allowed (unchanged) | editing around unknown semantics could break them                  |
| XML comments or processing instructions (other than the XML declaration)                                                                                                                          | read-only | **blocked**         | the parser drops them, so the round-trip check cannot see the loss |
| No BPMN DI, dangling or duplicate DI, or structurally invalid DI (diagram without BPMN element, shape without bounds, edge with < 2 waypoints, edge whose ends are not drawn in the same diagram) | read-only | allowed (unchanged) | it could not be displayed or edited correctly                      |
| More than one diagram                                                                                                                                                                             | editable  | allowed             | switch diagrams with the selector in the header                    |
| Missing DI for a supported element                                                                                                                                                                | read-only | allowed (unchanged) | it could not be shown                                              |
| Vendor attributes / extension elements                                                                                                                                                            | editable  | allowed             | preserved and proven by the round-trip check                       |
| Root-level Message, Signal, …                                                                                                                                                                     | editable  | allowed             | not reachable by MVP edits                                         |

"Download original" always returns the exact bytes that were opened, also after
the document was restored from the autosave.

Files are decoded with the encoding of their byte-order mark or XML declaration
(UTF-8 by default, as in XML). Bytes that are not valid in that encoding are
rejected with an error instead of being replaced; exports are always UTF-8.

Findings are listed under **Analysis → Compatibility**; clicking one selects the element.

## When a file is exported

`exportBpmnXml` serializes the live moddle tree, re-parses the output and compares
the canonical forms (`src/bpmn/model/canonical.ts`). If anything differs, the export
is aborted with the differences listed. A successful export therefore guarantees that
re-importing the file yields the same model.

XML text identity is not a goal: attribute order, whitespace and namespace prefix
order may change, `xsi:type` is compared through the element type, attributes
written with their schema default value (e.g. `testBefore="false"`) may be omitted,
and a `<formalExpression>` element may be written as the equivalent
`<expression xsi:type="tFormalExpression">`, and namespace declarations that are no longer used by any element
or attribute (for example `xmlns:di` after the last sequence flow is deleted) are
omitted. Element ids, types, names, references, parent/child relations,
DI bounds/waypoints/labels, namespaces and extension content are preserved.

## Verification

- `tests/roundtrip/xsd.test.ts` and the editing E2E tests validate exported XML
  against the official OMG BPMN 2.0 XSD with `xmllint` (`npm run schemas` downloads
  the schemas; the tests are skipped when they are not available).
- Fixtures cover plain processes, all MVP elements, collaborations with lanes,
  vendor extensions (custom namespaces, CDATA, extension attributes on DI), a
  Camunda-style export (camunda/bioc/color extensions, `BPMNLabelStyle`), unsupported
  elements, lossy content, missing DI and malformed XML.

- `tests/roundtrip/roundtrip.test.ts`: Original → Import → Export → Re-import, and
  Original → Import → Edit (rename, move with label, re-route) → Export → Re-import,
  for every editable fixture, comparing `snapshotModel` (ids, types, names,
  source/target, parents, DI bounds, labels, waypoints, namespaces, extensions,
  documentation, lane membership).
- `tests/unit/compatibility.test.ts`: classification of extension, unsupported,
  lossy, DI-less and malformed files.
- `tests/e2e/editor.spec.ts`: the same flow through the real UI in Chromium,
  including re-importing the exported file.

## External tool checks (SpiffWorkflow, pm4py, Camunda engine parser, Camunda Modeler)

`npm run interop` exports every editable fixture (after an edit through the model
API) plus the diagrams created through the UI in the E2E tests, and reads them
with three independent BPMN implementations (none is a project dependency):

- [SpiffWorkflow](https://github.com/sartography/SpiffWorkflow) 3.1.2 (Python BPMN
  engine, LGPL-3.0): parse, then try to run every process;
- [pm4py](https://github.com/process-intelligence-solutions/pm4py) 2.7 (process
  mining, AGPL-3.0): parse and convert to a Petri net;
- **Camunda BPMN Model API 7.24** (Apache-2.0, the parser of the commercial Camunda 7
  engine): read with schema validation, `validateModel`, and resolve every flow
  node, sequence flow and message flow. Set `CAMUNDA_CLASSPATH` (the
  `camunda-bpmn-model` and `camunda-xml-model` jars from Maven Central) and
  `JAVA` (Java 17+);
- **Camunda Modeler 5.53** (commercial vendor's desktop modeler, downloaded
  separately): each file is opened in the real application (driven by Playwright
  in Electron mode) and checked for import warnings and rendered elements. Set
  `CAMUNDA_MODELER` to the application's executable. The first-start privacy
  dialog is left untouched — nothing is consented to.

Python tools live in a local `.venv-interop`
(`python3 -m venv .venv-interop && .venv-interop/bin/pip install SpiffWorkflow pm4py`).

Result on 2026-11-18 (latest run: 19 files, 12 edited fixtures and 7 diagrams built in the UI):

| File                                                                                                                                                                    | SpiffWorkflow                                                                                                                                                                                           | pm4py                                           | Camunda Model API                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| simple-process, collaboration-lanes (edited)                                                                                                                            | parsed, **ran to completion**                                                                                                                                                                           | ✅ Petri net                                    | ✅                                                            |
| E2E: elements created/connected/appended in the UI                                                                                                                      | parsed, **ran to completion**                                                                                                                                                                           | ✅                                              | ✅                                                            |
| E2E: pool + lanes created in the UI, auto layout                                                                                                                        | parsed, **ran to completion**                                                                                                                                                                           | ✅                                              | ✅                                                            |
| E2E: message flows, event types, cross-pool move                                                                                                                        | parsed                                                                                                                                                                                                  | ✅                                              | ✅ (3 message flows)                                          |
| E2E: boundary event, sub-process, data, annotation, group                                                                                                               | parsed                                                                                                                                                                                                  | ✅                                              | ✅                                                            |
| extensions, vendor-camunda-style, mvp-elements, collaboration-messages                                                                                                  | parsed (JUEL conditions are not Python; `id="Start"` collides with a Spiff-internal name)                                                                                                               | ✅                                              | ✅                                                            |
| all-elements (every event/task/gateway type, data, artifacts)                                                                                                           | tool limit: no complex gateway, no business-rule task without DMN, data stores need a registered implementation                                                                                         | tool limit: no call activity / complex gateway  | ✅                                                            |
| advanced-elements + E2E edit (transaction, ad-hoc, compensation, cancel, loops, I/O spec, potential owner)                                                              | parsed                                                                                                                                                                                                  | tool limit: no transaction / ad-hoc sub-process | tool limit: no ad-hoc sub-process type (with it replaced, ✅) |
| notation + E2E edits (Multiple / Parallel Multiple events, event-based gateway variants, collections, black-box pool, message envelopes, process data inputs / outputs) | tool limit: Spiff resolves data associations only to data object / store references, not to process data inputs / outputs (BPMN allows any item-aware element); with those associations skipped, parsed | ✅                                              | ✅ (9 flow nodes, 8 sequence flows, 2 message flows)          |

**Camunda Modeler 5.53 result (19 files):** 18 files open without any import
warning and render all their diagram elements, with 0 errors and 0 warnings from
Camunda's engine lint — including all files built through the BPMN Flow UI
(created elements, pools/lanes with auto layout, message flows and cross-pool
moves, boundary events/sub-processes/data/artifacts, loops/transactions/ad-hoc,
multi-diagram drill-down, conversations, and the notation sample with its UI
edits: Multiple / Parallel Multiple events, event-based gateway variants,
collections, black-box pool, message envelopes, process data inputs / outputs). Tool limit: Camunda Modeler does not
support choreography diagrams (it does not draw choreography tasks and reports
participant bands shared by two tasks as “multiple DI elements” for the
participant, although the file is valid against the OMG XSD).

Every tool limit was confirmed by substituting only the named element types, after
which the file is read successfully. Failures to _execute_ in Spiff come from
expression languages or runtime configuration, not from the file format. The
checks surfaced two real issues that were fixed: timer events created in the
editor had no time expression (now editable, and flagged by
`VAL-INCOMPLETE-EVENT`), and explicit default attribute values (e.g.
`testBefore="false"`) made files open read-only.

## Known gaps

- Camunda Modeler is checked as the commercial desktop modeler (the official
  application, run unmodified; BPMN Flow itself does not use bpmn-js). Signavio and
  ARIS are proprietary SaaS products that require accounts and are not tested.
- Label bounds are moved with their shape but not resized after renaming.
- Vendor color extensions are rendered and preserved: `color:background-color` /
  `color:border-color` / `color:color` (OMG non-normative) and `bioc:fill` / `bioc:stroke`
  (bpmn.io); the OMG attributes win when both are present. BPMN 2.0.2 itself defines no
  colors (§7.5). The editor has no UI to set colors, and labels outside a shape keep the
  theme color unless `color:color` is set.
