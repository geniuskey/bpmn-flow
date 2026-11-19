# BPMN 2.0.2 alignment

Checked against [OMG BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/PDF)
(formal/13-12-09). Page numbers are PDF pages (printed page + 30).

## Modeling constraints the editor enforces

| Rule                                                                                                                                                                                                       | Spec                  | Where                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------- |
| Start triggers depend on position: top level message/timer/signal/conditional; event sub-process adds error, escalation, compensation (non-interrupting: escalation only); embedded sub-process: none only | p. 271–272            | `allowedEventDefinitions` (elements.ts)       |
| Error, cancel and compensation triggers always interrupt; the toggle is hidden and the value forced                                                                                                        | p. 272, 287           | `interruptingIsFixed`, EventDefinitionHandler |
| Cancel end events only inside, cancel boundary events only on transactions                                                                                                                                 | p. 287, 291           | `allowedEventDefinitions`, `canAttach`        |
| Event sub-process start events need a trigger                                                                                                                                                              | p. 204                | `definitionRequired` (inspector)              |
| No sequence flows into or out of event sub-processes and compensation activities; none into link catch or instantiating event-based gateways; none out of link throw or compensation boundary events       | p. 204, 268, 288, 328 | `canBeFlowSource`, `canConnect`               |
| Event-based gateway targets: receive tasks or catch events with message / signal / timer / conditional                                                                                                     | p. 327                | `canConnect`                                  |
| Message flow ends (Table 7.4): pools and activities; message throw / end events send; message start / catch / boundary events receive; never gateways or event sub-processes                               | p. 72, 278            | `canSendMessage`, `canReceiveMessage`         |
| Conditions and default flows only from activities and exclusive / inclusive / complex gateways                                                                                                             | p. 125–126, 274       | `conditionAllowedFrom`, `canHaveDefaultFlow`  |
| Compensation associations go to an activity marked for compensation in the same process                                                                                                                    | p. 332                | `canAssociate`                                |
| No start or end events in ad-hoc sub-processes                                                                                                                                                             | p. 211                | `canContain`                                  |
| "For compensation" and "instantiate" only on elements without the sequence flows they forbid                                                                                                               | p. 268, 328           | UpdatePropertiesHandler, inspector            |

The analyzer reports the same constraints for imported files, plus the ones that
need the whole model (link pairing, event-based gateway configuration, start/end
pairing): see [analysis.md](analysis.md).

## Notation and DI (Ch. 12)

- A missing `isExpanded` means collapsed (Table 12.10); a sub-process whose
  content is drawn inside it is still shown expanded. Type changes write
  `isExpanded` explicitly.
- Message flow envelopes follow `messageVisibleKind` (Table 12.35): none when it
  is absent (bpmn-moddle's default of "initiating" is not used for this).
  Assigning a message sets it to initiating; the inspector switches it.
- Activity markers: loop / multi-instance and compensation left of the [+], ad-hoc
  tilde right of it. Call activities: [+] when calling a process, the task marker
  when calling a global task.
- Collapsed event sub-processes show their start event top left (dashed when
  non-interrupting).
- Multi-instance participants (`participantMultiplicity` maximum > 1) show three
  vertical lines on pools and choreography bands; choreography activities show
  their `loopType` marker.
- Bidirectional associations have two arrowheads; conversation links are double
  thin lines; the cancel end event marker is filled; an instantiating receive
  task shows its envelope in a circle.

## Process Modeling Conformance (Ch. 2, Tables 2.1 / 2.2)

Editable now: call activity `calledElement`, association `associationDirection`,
message flow `messageRef`, link event names, data object and data store names
(with the root `bpmn:DataStore`), default flows on inclusive / complex gateways
and activities, loop and multi-instance attributes, all documentation entries
(the first is editable).

## Known gaps

- Collapsing / expanding a sub-process and creating collapsed sub-processes.
- Nested lanes (`childLaneSet`) are shown and preserved but cannot be created;
  lanes cannot be added to vertical pools.
- Data associations with events (catch event → data, data → throw event) are not
  offered yet.
- `BPMNEdge` `sourceElement` / `targetElement` and data associations attached to
  sequence flows open read-only; `BPMNLabelStyle` fonts and label bounds of
  activities are ignored; `isMessageVisible` on choreography bands is not drawn.
- Content of a collapsed sub-process without its own diagram opens read-only.
- Common Executable attributes (Process `isExecutable`, `gatewayDirection`,
  service / user task implementation, item definitions, expression languages)
  are preserved but not editable.
