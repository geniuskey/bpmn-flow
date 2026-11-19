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

| Rule                                       | Severity        | Checks                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VAL-MISSING-START` / `VAL-MISSING-END`    | error / info    | a process level with an end event but no start event, or the reverse (error, BPMN 2.0.2 p. 268, 276); neither (info: both are optional). An instantiating event-based gateway or receive task counts as a start                                                                       |
| `GRAPH-ISOLATED`                           | warning         | node without incoming and outgoing flows                                                                                                                                                                                                                                              |
| `GRAPH-UNREACHABLE`                        | warning         | node not reachable from any start event (or instantiating gateway / receive task)                                                                                                                                                                                                     |
| `GRAPH-DEAD-END`                           | warning         | node without outgoing flow that is neither an end event nor a link throw event                                                                                                                                                                                                        |
| `GRAPH-NO-END-PATH`                        | warning         | no path from the node to any end event (e.g. a loop without exit)                                                                                                                                                                                                                     |
| `GRAPH-CYCLE`                              | info            | cyclic path (strongly connected component or self-loop)                                                                                                                                                                                                                               |
| `GW-PASS-THROUGH`                          | warning         | gateway with one incoming and one outgoing flow (a gateway must merge or split, p. 319)                                                                                                                                                                                               |
| `GW-MIXED`                                 | info            | gateway that both merges and splits                                                                                                                                                                                                                                                   |
| `GW-MISSING-CONDITION`                     | warning         | exclusive, inclusive or complex split with outgoing flows that have neither a condition nor default status                                                                                                                                                                            |
| `VAL-INVALID-CONNECTION`                   | error           | sequence flow into a start, boundary or link catch event; out of an end, compensation boundary or link throw event; to or from an event sub-process or compensation activity; across processes (p. 204, 268, 288); message flow inside one pool                                       |
| `VAL-MESSAGE-FLOW`                         | error / warning | message flow endpoints per Table 7.4 (p. 72): senders are pools, activities and message throw / end events, receivers pools, activities and message start / catch / boundary events (error); an event of the right kind without a message trigger (warning, p. 278)                   |
| `VAL-CONDITION`                            | error / warning | condition on a flow out of an event or a parallel / event-based gateway, or on the only outgoing flow of an activity (error, p. 125, 274, 326); on a default flow (warning, p. 322)                                                                                                   |
| `VAL-EVENT-GATEWAY`                        | error           | event-based gateway with fewer than two outgoing flows; targets that are not receive tasks or message / signal / timer / conditional catch events; receive tasks mixed with message events; targets with other incoming flows; receive-task targets with boundary events (p. 326–327) |
| `VAL-INSTANTIATE-INCOMING`                 | error           | instantiating event-based gateway or receive task with incoming sequence flows (p. 189, 328)                                                                                                                                                                                          |
| `VAL-START-TRIGGER`                        | error           | start event trigger not allowed at its position: top level — none, message, timer, conditional, signal; embedded sub-process — none; event sub-process — adds error, escalation, compensation, and error / compensation only when interrupting (p. 271–272)                           |
| `VAL-EVENT-SUBPROCESS`                     | error           | event sub-process without exactly one start event, or whose start event has no trigger (p. 204)                                                                                                                                                                                       |
| `VAL-ADHOC-START-END`                      | error           | start or end event inside an ad-hoc sub-process (p. 211)                                                                                                                                                                                                                              |
| `VAL-LINK-UNPAIRED` / `VAL-LINK-AMBIGUOUS` | error           | link throw event with no, or several, matching link catch events at the same level (p. 288)                                                                                                                                                                                           |
| `VAL-CANCEL-OUTSIDE-TRANSACTION`           | error           | cancel end event outside, or cancel boundary event not on, a transaction (p. 287, 291)                                                                                                                                                                                                |
| `VAL-NON-INTERRUPTING`                     | error           | non-interrupting error or cancel boundary event (p. 288)                                                                                                                                                                                                                              |
| `VAL-BROKEN-REFERENCE`                     | error / warning | flow without source/target, or missing from its endpoints’ incoming/outgoing                                                                                                                                                                                                          |
| `VAL-DUPLICATE-ID`                         | error           | the same id used twice                                                                                                                                                                                                                                                                |
| `VAL-INVALID-DI` / `VAL-MISSING-DI`        | error / warning | diagram elements pointing nowhere, or visible elements without DI                                                                                                                                                                                                                     |
| `VAL-INCOMPLETE-EVENT`                     | warning         | timer without duration/date/cycle, conditional event without condition                                                                                                                                                                                                                |
| `STYLE-UNREFERENCED-EVENT`                 | info            | message/signal/error/escalation event without a named reference                                                                                                                                                                                                                       |
| `STYLE-UNNAMED-ACTIVITY`                   | info            | activity without a name                                                                                                                                                                                                                                                               |

Page numbers are PDF pages of the BPMN 2.0.2 specification (formal/13-12-09);
the spec constraints live in `src/analysis/rules/specRules.ts`.

Constructs that are correct without sequence flows are not reported by the
connectivity rules (`GRAPH-*`, `VAL-MISSING-*`): a link throw event continues at
its link catch event (paired by the definition's `target`/`source` or by name),
event sub-processes are started by their trigger (inside one, only its start event
is an entry), compensation boundary events and
compensation activities are connected by an association, and the content of an
ad-hoc sub-process needs no flow structure. Event rules check every definition of
a multiple event.

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
- a sub-process takes its own time plus its content's elapsed time (estimated
  recursively); an ad-hoc sub-process's activities are assumed to run all in
  parallel (best case) or one after another (worst case);
- a boundary event starts with its host: in the worst case it fires when the host
  ends, in the best case at once. The best case is taken over the normal paths
  only, not over paths that leave through a boundary event;
- work, waiting and cost totals and the coverage include sub-process content;
- missing durations count as 0 and are reported as coverage;
- cost = Σ cost × frequency (frequency defaults to 1);
- “Longest waiting times” lists the steps with the most entered waiting time.

The worst-case path can be highlighted on the canvas.
