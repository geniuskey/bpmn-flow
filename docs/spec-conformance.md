# BPMN 2.0.2 alignment

Checked against [OMG BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/PDF)
(formal/13-12-09). Page numbers are PDF pages (printed page + 30).

## Modeling constraints the editor enforces

| Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Spec                                     | Where                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Start triggers depend on position: top level message/timer/signal/conditional; event sub-process adds error, escalation, compensation (non-interrupting: escalation only); embedded sub-process: none only; checked on create, paste and move (an event sub-process start cannot leave it)                                                                                                                                                                         | p. 271–272                               | `allowedEventDefinitions` (elements.ts)                                                 |
| Error, cancel and compensation triggers always interrupt; the toggle is hidden and the value forced                                                                                                                                                                                                                                                                                                                                                                | p. 272, 287                              | `interruptingIsFixed`, EventDefinitionHandler                                           |
| Cancel end events only inside, cancel boundary events only on transactions (or choreography activities, Table 11.7)                                                                                                                                                                                                                                                                                                                                                | p. 287, 291                              | `allowedEventDefinitions`, `canAttach`                                                  |
| Event sub-process start events need a trigger; exactly one start event per event sub-process (create, paste, move, change type)                                                                                                                                                                                                                                                                                                                                    | p. 204                                   | `definitionRequired`, `exceedsEventSubProcessStart`                                     |
| No sequence flows into or out of event sub-processes and compensation activities; none into link catch or instantiating event-based gateways; none out of link throw or compensation boundary events                                                                                                                                                                                                                                                               | p. 204, 268, 288, 328                    | `canBeFlowSource`, `canConnect`                                                         |
| Event-based gateway targets: receive tasks or catch events with message / signal / timer / conditional                                                                                                                                                                                                                                                                                                                                                             | p. 327                                   | `canConnect`                                                                            |
| Event-based gateway configuration: its targets have no other incoming sequence flows, receive tasks among them take no boundary events, receive tasks and message catch events are not mixed                                                                                                                                                                                                                                                                       | p. 327                                   | `canConnect`, `canAttach`                                                               |
| `gatewayDirection`: a Converging gateway keeps at most one outgoing, a Diverging one at most one incoming sequence flow (the direction is refused when the flows already exceed it)                                                                                                                                                                                                                                                                                | p. 118-119                               | `canConnect`, UpdatePropertiesHandler                                                   |
| Message flow counts: a message intermediate event has one incoming or one outgoing message flow, not both; an end event with a single (Message) result sends one message flow, a Multiple end event several                                                                                                                                                                                                                                                        | p. 278, 289                              | `canMessageFlow`                                                                        |
| A conditional flow out of an activity needs another outgoing sequence flow                                                                                                                                                                                                                                                                                                                                                                                         | p. 125                                   | `conditionBlocker` (UpdateConditionHandler, ElementDetailHandler)                       |
| Executable processes have no `isImmediate="false"` flows (the flag and `isExecutable` refuse each other)                                                                                                                                                                                                                                                                                                                                                           | p. 339                                   | UpdatePropertiesHandler                                                                 |
| Call activities call a Process or Global Task: an id of another root element of the file is refused                                                                                                                                                                                                                                                                                                                                                                | p. 212                                   | UpdatePropertiesHandler                                                                 |
| Message flow ends (Table 7.4): pools and activities; message throw / end events send; message start / catch / boundary events receive; never gateways or event sub-processes                                                                                                                                                                                                                                                                                       | p. 72, 278                               | `canSendMessage`, `canReceiveMessage`                                                   |
| Conditions and default flows only from activities and exclusive / inclusive / complex gateways                                                                                                                                                                                                                                                                                                                                                                     | p. 125–126, 274                          | `conditionAllowedFrom`, `canHaveDefaultFlow`                                            |
| Compensation associations go to an activity marked for compensation in the same process                                                                                                                                                                                                                                                                                                                                                                            | p. 332                                   | `canAssociate`                                                                          |
| No start or end events in ad-hoc sub-processes                                                                                                                                                                                                                                                                                                                                                                                                                     | p. 211                                   | `canContain`                                                                            |
| "For compensation" and "instantiate" (event-based gateways, receive tasks) only on elements without the sequence flows they forbid                                                                                                                                                                                                                                                                                                                                 | p. 189, 268, 328                         | UpdatePropertiesHandler, inspector, `canConnect`                                        |
| New events from the shape library: triggers must be allowed where they are dropped; non-interrupting starts and error / escalation / compensation starts only in an event sub-process, which needs a trigger                                                                                                                                                                                                                                                       | p. 204, 271–272, 287                     | `eventFitsIn`, `canAttach`                                                              |
| Change type keeps the model valid: no incoming flows into start / link catch events or instantiating elements, no outgoing from end / link throw events, message flows keep a sender / receiver, event-based gateway targets stay catch events, no conditions out of parallel / event-based gateways, ad-hoc sub-processes without start / end events, cancel events keep their transaction, event sub-processes without flows or boundary events, no content lost | p. 72, 125, 189, 204, 211, 268, 287, 327 | `replaceBlocker` (modeling/replace.ts)                                                  |
| Data associations: data → activity / throw event, activity / catch event → data; a start event may fill process Data Inputs, an end event read process Data Outputs; a Data Object only from its process / sub-process and the sub-processes inside it, process Data Inputs / Outputs only within their process                                                                                                                                                    | p. 233, 247, 253–254                     | `dataAssociationType`, `dataVisibleFrom`                                                |
| Associations: annotations and groups with any element or sequence / message flow; data objects and stores with sequence flows (Fig 10.68)                                                                                                                                                                                                                                                                                                                          | p. 95, 253                               | `canAssociate`                                                                          |
| One and only one pool may be drawn without its boundary; pools with lanes keep theirs                                                                                                                                                                                                                                                                                                                                                                              | p. 141–143                               | `hideBoundaryBlocker`, `boundlessParticipant`                                           |
| `isCollection` of a Data Object / Input / Output equals that of its item definition                                                                                                                                                                                                                                                                                                                                                                                | p. 233, 243                              | UpdatePropertiesHandler                                                                 |
| Participant multiplicity: minimum ≥ 0, maximum ≥ 1 and ≥ minimum                                                                                                                                                                                                                                                                                                                                                                                                   | p. 147                                   | ElementDetailHandler                                                                    |
| Choreographies (Tables 11.6-11.8): start events none / timer / conditional / signal (a Multiple start combines only signals and timers); intermediate catch timer / conditional / signal / link, throw only link; end events none / terminate; boundary events on choreography activities: message (choreography tasks only, on a receiving participant’s band), timer, conditional, signal (not on a band), cancel and compensation (on a band)                   | p. 370-374                               | `allowedEventDefinitionsIn`, `definitionCombinationProblem`, `choreographyBoundaryFits` |
| Event-based gateways in a choreography lead to choreography activities or to timer / signal / conditional catch events, never message events                                                                                                                                                                                                                                                                                                                       | p. 371-372, 379                          | `validEventGatewayTarget`                                                               |
| Conditions on flows out of choreography activities (no default flow: the metamodel has no `default` attribute there)                                                                                                                                                                                                                                                                                                                                               | p. 350                                   | `conditionAllowedFrom`, `canHaveDefaultFlow`                                            |
| A choreography task has two participants and at least one message flow; a sub- or call choreography two or more; the initiator is one of them; band messages only on choreography tasks and calls of a global choreography task; call choreographies call a Choreography or Global Choreography Task, call conversations a Collaboration or Global Conversation, never one that contains them                                                                      | p. 352-355, 363, Table 12.34             | ChoreographyParticipantHandler, ChangeTypeHandler, UpdatePropertiesHandler              |
| Conversation links connect a conversation node with a pool or with an activity / event in a pool; the node’s `participantRef` follows its links                                                                                                                                                                                                                                                                                                                    | p. 159, 162                              | `canLinkConversation`, connectionSync                                                   |

The analyzer reports the same constraints for imported files, plus the ones that
need the whole model (link pairing, event-based gateway configuration, start/end
pairing): see [analysis.md](analysis.md).

## Notation and DI (Ch. 12)

- A missing `isExpanded` means collapsed (Table 12.10); a sub-process whose
  content is drawn inside it is still shown expanded. Type changes write
  `isExpanded` explicitly.
- Collapse / expand (`element.setExpanded`, context pad or the inspector's
  "Collapsed") works for sub-processes, event sub-processes, transactions,
  ad-hoc sub-processes and sub-choreographies. DI cannot hide content inside a
  collapsed shape of the same plane, so collapsing moves the content's shapes
  and edges to a drill-down BPMNDiagram whose plane references the element
  (§12.2.3.2, PDF 397; Table 12.39), starting at positive coordinates;
  expanding moves them back inside the shape and removes that diagram. The
  semantic model does not change. Content connected to elements outside it
  (associations, message flows) cannot be collapsed. A collapsed sub-process,
  transaction or ad-hoc sub-process from the library gets an empty drill-down
  diagram right away.
- Plane order is Z-order (§12.2.1, PDF 398): edges are inserted at their file
  position among their siblings (never below a pool, lane, group or
  sub-process); shapes keep containers below their content and boundary events
  above their host.
- Message flow envelopes follow `messageVisibleKind` (Table 12.35): none when it
  is absent (bpmn-moddle's default of "initiating" is not used for this).
  Assigning a message sets it to initiating; the inspector switches it.
- Activity markers: loop / multi-instance and compensation left of the [+], ad-hoc
  tilde right of it. Call activities: [+] when calling a process, the task marker
  when calling a global task.
- Collapsed event sub-processes show their start event top left (dashed when
  non-interrupting, Table 12.16), redrawn when that start event changes in the
  drill-down diagram.
- Multi-instance participants show three vertical lines on pools and
  choreography bands when a `participantMultiplicity` is present and its
  `maximum` is not set or is two or more (PDF 147); the analyzer reports a
  maximum below 1 or below the minimum (`VAL-PARTICIPANT-MULTIPLICITY`, Table
  9.5). Choreography activities show their `loopType` marker.
- Bidirectional associations have two arrowheads; conversation links are double
  thin lines; an instantiating receive task shows its envelope in a circle.
- Event markers: the timer is a clock face with twelve hour ticks and two hands
  (Fig 10.96); the cancel X is the same outline for both, filled on the end
  event and unfilled on the boundary event (Fig 10.74).
- A catching escalation intermediate event (Table 12.22, PDF 428) is drawn and
  editable. Table 10.89 has escalation caught only by boundary events and event
  sub-process starts, so the trigger is not offered for intermediate catch
  events.
- Lanes have no line between their name and their contents unless they have
  sub-lanes (PDF 334); pools keep their header line.
- Pools and lanes are horizontal or vertical (BPMNShape `isHorizontal`, Table
  12.26): a vertical pool has its name band on top and its lanes side by side;
  new lanes take the pool's orientation. Nested lanes (`childLaneSet`) sit next
  to their parent lane's name band; adding, resizing and deleting lanes keeps the
  stack closed at every level. Lanes may also be drawn on a process diagram
  without pools (PDF 334).
- A collaboration whose main pool has no BPMNShape draws that pool's process
  content on the diagram (PDF 141-143, Fig 9.5) and stays editable; the
  inspector hides or shows the boundary of a pool.
- A BPMNShape for a `bpmn:DataObject` is drawn as a data object (PDF 234); one
  for a `bpmn:Message` as an envelope with a single thin line, shaded when the
  message is non-initiating (sent by a choreography task's non-initiating
  participant, or carried by or associated with a message flow whose
  `messageVisibleKind` is `non_initiating`; PDF 121-122). The data object is
  read-only; the Message shape is created from the library on collaboration
  and choreography diagrams, moved, renamed and deleted (the Message root
  element stays while a flow, event or task references it). An association
  may join a Message and a message flow (Fig 8.28); drawing one sets the
  flow's message when it has none, and it is removed with the message flow.
- An event with shared definitions (`eventDefinitionRef`, Tables 10.82-10.83)
  shows the marker of its own and referenced definitions together.
- The message flow envelope shows the message name beside it (Fig 8.28).
- `BPMNLabel` bounds place the name of every shape, also the names drawn inside
  tasks, sub-processes, pools, lanes, groups and choreography activities
  (§12.2.3.7, PDF 406); resizing such a shape scales its label bounds with it.
  The `dc:Font` of a label's `BPMNLabelStyle` (name, size, bold, italic,
  underline, strike-through; PDF 407) is applied.
- `BPMNEdge` `sourceElement` / `targetElement` (PDF 405, 440) are read: the edge
  is drawn to that shape (e.g. a message flow to a pool border while its
  `sourceRef` is a task in the pool) and the file stays editable. They are kept
  on export; after a reconnect they follow the new end. Deleting the model end
  deletes the edge too.
- The exclusive gateway "X" (`isMarkerVisible`, Table 12.23) is switched in the
  inspector ("Marker").
- Data object / store references and data inputs / outputs show their state as
  `[state]` under the name (PDF 234, 243, 245); the inspector "State" field
  creates, renames or removes the `bpmn:DataState`.
- Several Data Object References may show one Data Object (PDF 234); the
  inspector's "Data object" switches a reference to another Data Object of its
  process or sub-process (a Data Object no reference shows any more is removed).
- An association may end at a sequence or message flow (PDF 95; a data object
  associated with a sequence flow, Fig 10.68). It is drawn to the middle of the
  flow, follows it when the flow changes and is removed with it. It is kept as
  an association (not normalized into two data associations).
- Elements the editor cannot edit are hatched (shapes) or get a wide translucent
  halo (connections). They are never dashed or dotted, since those line styles
  mean message flow, association and non-interrupting event (§2.2.3 / §7.5,
  PDF 38, 70).

## Process Modeling Conformance (Ch. 2, Tables 2.1 / 2.2)

Editable now: call activity `calledElement` (or a new Process / Global Task to call), association `associationDirection`,
message flow `messageRef`, link event names, data object and data store names
(with the root `bpmn:DataStore`), data states, the Data Object of a reference,
collection flags, participant multiplicity, lane `partitionElementRef`
(a `bpmn:Resource` by name), pool and lane orientation, nested lanes, default flows on inclusive / complex gateways
and activities, loop and multi-instance attributes, all documentation entries
(the first is editable), gateway `gatewayDirection`, complex gateway
`activationCondition`, natural-language `Expression` vs `FormalExpression` with
its `language` (conditions, activation conditions), sequence flow
`isImmediate`, text annotation `textFormat`, process `processType` /
`isClosed` / `isExecutable`, error `errorCode` and escalation
`escalationCode`, compensation `activityRef` / `waitForCompletion`, link
`source` / `target` (kept in step with the link names), group Category
(shared by name; the label shows “Category: value”) and flow element
`categoryValueRef`.

New conditional triggers start with an empty `condition` expression and new
link triggers with an empty `name`, both required by the BPMN XSD (Tables
10.95, 10.98); clearing them in the properties keeps them present. The
analyzer still reports an empty condition (VAL-INCOMPLETE-EVENT).

## Known gaps

- Expanded call activities (Table 12.20, a MAY) are not drawn as containers
  showing the called process; `isExpanded="true"` only hides the [+] marker.
  The called element field suggests the processes and global tasks of the
  file.
- Expanding a collapsed sub-process does not move neighbouring shapes out of
  the way; it may overlap them.
- Global tasks are only created together with a call activity or through the
  "Create and call…" option of the called element. `bpmn:DataObject` shapes
  from files (PDF 234) are drawn but cannot be moved or created.
- Multiple events from the library start with message + signal triggers; the
  triggers are changed in the properties.
- A process with several lane sets (`laneSets`, PDF 335) is shown and
  preserved, but new lanes always go into the first lane set; a second lane set
  cannot be created. Auto layout treats nested and vertical lanes like flat
  horizontal ones. A pool cannot wrap a process diagram whose lanes are drawn
  without a pool.
- An association between a data object and a sequence flow is not converted to
  the two data associations it stands for (PDF 253), and the analyzer does not
  read it as data flow. Edges ending at another kind of edge open read-only.
- `BPMNLabelStyle` fonts are shown but cannot be edited; a missing `BPMNLabel`
  does not hide a name (label visibility is not modeled); `sourceElement` /
  `targetElement` pointing at participant bands are ignored.
- Choreography within a collaboration (choreography activities drawn between
  pools, `choreographyRef`, ParticipantAssociation / MessageFlowAssociation,
  message flows through a choreography task; §9.7, Fig 9.13, 9.32) is not
  supported: choreography activities are only created inside a choreography.
- The participant associations of call choreographies and call conversations
  (`participantAssociations`, §9.5.6 / §11.5.3) are preserved but not edited;
  link names of a call conversation are not derived from them. A Global
  Choreography Task or Global Conversation is created empty (its participants
  are not edited), and a called choreography is not drawn inside an expanded
  call choreography (Table 12.32, the same as expanded call activities).
- Choreography activities cannot have a default flow (no `default` attribute
  in the BPMN 2.0.2 metamodel, PDF 350 draws one).
- The choreography gateway rules (§11.7, PDF 374-391) are approximated by
  the analyzer from participants only: it cannot see which message carried
  the data of a decision, so "sent or received the data" means "took part in
  a choreography activity before the gateway". They are not enforced while
  editing.
- Band messages (`isMessageVisible`) are drawn on the top and bottom band; a
  band's participant does not automatically get a taller band in other
  activities when it becomes multi-instance there.
- Lanes are not linked to conversations (§9.6, PDF 166).
- Content of a collapsed sub-process without its own diagram opens read-only.
- Execution details (service / user / script task implementation,
  `operationRef`, scripts, renderings, resource assignments, item definitions,
  `evaluatesToTypeRef`, multi-instance data inputs / outputs, ad-hoc
  `ordering` / `cancelRemainingInstances`, transaction `method`, process
  `supports`) are preserved but not editable.
- A group does not follow its contents automatically: `categoryValueRef` of
  the elements within it is set with "Assign to elements inside" (or per
  element), not when shapes are moved in or out.
- `textFormat` other than plain text and HTML / XML is shown as raw text
  (no Markdown rendering).
- An end event attached to the boundary of an expanded sub-process (the
  exception on PDF 278) is not supported.
- Events with shared event definitions (`eventDefinitionRef`) are drawn with
  their marker, but the document opens read-only: the shared definitions are
  not edited.
