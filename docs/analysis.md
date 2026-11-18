# Process analysis

The analysis layer (`src/analysis`) is pure TypeScript. It reads the BPMN
semantic model and never changes it; it has no dependency on React or the canvas.

## Overview and Metrics tabs

**Overview** shows element counts and a summary of validation, findings and
compatibility. **Metrics** shows counts of events, activities, gateways, sequence flows, pools and lanes; lane
handoffs (sequence flows whose endpoints are in different lanes); number of loops
(strongly connected components); cyclomatic complexity (`flows − nodes + 2 ×
processes`); a table of gateways with their incoming/outgoing branch counts.

## Validation and Findings tabs

**Validation** lists the `VAL-*` rules (model correctness); **Findings** lists the
graph, gateway and style rules (improvement candidates). Each finding has a severity (info / warning / error), a rule id, a message, the
related element ids and a recommendation. Clicking a finding selects and
highlights the elements on the canvas.

| Rule                                    | Severity        | Checks                                                                                                   |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `VAL-MISSING-START` / `VAL-MISSING-END` | warning         | a process with flow nodes has no start / end event                                                       |
| `GRAPH-ISOLATED`                        | warning         | node without incoming and outgoing flows                                                                 |
| `GRAPH-UNREACHABLE`                     | warning         | node not reachable from any start event                                                                  |
| `GRAPH-DEAD-END`                        | warning         | non-end node without outgoing flow                                                                       |
| `GRAPH-NO-END-PATH`                     | warning         | no path from the node to any end event (e.g. a loop without exit)                                        |
| `GRAPH-CYCLE`                           | info            | cyclic path (strongly connected component or self-loop)                                                  |
| `GW-PASS-THROUGH`                       | info            | gateway with one incoming and one outgoing flow                                                          |
| `GW-MIXED`                              | info            | gateway that both merges and splits                                                                      |
| `GW-MISSING-CONDITION`                  | warning         | exclusive split with outgoing flows that have neither a condition nor default status                     |
| `VAL-INVALID-CONNECTION`                | error           | sequence flow into a start event, out of an end event, or across processes; message flow inside one pool |
| `VAL-BROKEN-REFERENCE`                  | error / warning | flow without source/target, or missing from its endpoints’ incoming/outgoing                             |
| `VAL-DUPLICATE-ID`                      | error           | the same id used twice                                                                                   |
| `VAL-INVALID-DI` / `VAL-MISSING-DI`     | error / warning | diagram elements pointing nowhere, or visible elements without DI                                        |
| `VAL-INCOMPLETE-EVENT`                  | warning         | timer without duration/date/cycle, conditional event without condition                                   |
| `STYLE-UNREFERENCED-EVENT`              | info            | message/signal/error/escalation event without a named reference                                          |
| `STYLE-UNNAMED-ACTIVITY`                | info            | activity without a name                                                                                  |

Analysis runs synchronously after each change; a 3000-node process is analyzed in
well under 100 ms (unit test), a 1000-task diagram in ~8 ms in the browser (E2E),
so a Web Worker is not needed for analysis. Auto layout (ELK) does run in a worker.

## Limits

These are static structure checks. They point to candidates for review; they do
not detect runtime bottlenecks, and they do not estimate execution time on their
own.

## Analysis metadata and estimates (Estimates tab)

Per element, users can enter owner, duration, waiting time, cost, frequency and
notes in the Properties panel. The data is stored in IndexedDB, keyed by document
id (`bpmn:definitions/@id`) and element id. It is **not** written into the BPMN
XML; no non-standard attributes are added to BPMN elements. If storing it inside
BPMN is ever required, it must use a dedicated namespace and a moddle extension.

Estimates are explicit, assumption-based calculations from that data:

- elapsed time per step = duration + waiting;
- parallel branches overlap: a parallel join waits for its slowest branch (max,
  never the sum);
- alternative paths (exclusive joins, multiple incoming flows) produce a best
  case (fastest alternative) and a worst case (slowest alternative);
- loops are counted once (back edges ignored and reported);
- missing durations count as 0 and are reported as coverage;
- cost = Σ cost × frequency (frequency defaults to 1);
- “Longest waiting times” lists the steps with the most entered waiting time.

The worst-case path can be highlighted on the canvas.
