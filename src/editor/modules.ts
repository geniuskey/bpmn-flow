/** diagram-js module wiring: the renderer, the editing services (sync, rules, behaviors) and the custom command handlers. */
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type { ModuleDeclaration } from 'didi';
import MoveModule from 'diagram-js/lib/features/move';
import ModelingModule from 'diagram-js/lib/features/modeling';
import AutoScrollModule from 'diagram-js/lib/features/auto-scroll';
import CreateModule from 'diagram-js/lib/features/create';
import ConnectModule from 'diagram-js/lib/features/connect';
import ConnectionPreviewModule from 'diagram-js/lib/features/connection-preview';
import BendpointsModule from 'diagram-js/lib/features/bendpoints';
import ResizeModule from 'diagram-js/lib/features/resize';
import AttachSupportModule from 'diagram-js/lib/features/attach-support';
import GridSnappingModule from 'diagram-js/lib/features/grid-snapping';
import ContextPadModule from 'diagram-js/lib/features/context-pad';
import PopupMenuModule from 'diagram-js/lib/features/popup-menu';
import BpmnFlowRenderer from './renderer/BpmnFlowRenderer';
import BpmnFlowLayouter from './layout/BpmnFlowLayouter';
import DiSync from './commands/DiSync';
import {
  UPDATE_CONDITION,
  UPDATE_DOCUMENTATION,
  UPDATE_PROPERTIES,
  UpdateConditionHandler,
  UpdateDocumentationHandler,
  UpdatePropertiesHandler,
} from './commands/UpdatePropertiesHandler';
import ChangeTypeHandler, { CHANGE_TYPE } from './commands/ChangeTypeHandler';
import ReplaceHandler, { REPLACE_ELEMENT } from './commands/ReplaceHandler';
import ExpandHandler, { SET_EXPANDED } from './commands/ExpandHandler';
import EventDefinitionHandler, { SET_EVENT_DEFINITION } from './commands/EventDefinitionHandler';
import LoopHandler, { SET_LOOP } from './commands/LoopHandler';
import ChoreographyParticipantHandler, {
  SET_CHOREOGRAPHY_PARTICIPANT,
  UPDATE_CHOREOGRAPHY_BANDS,
} from './commands/ChoreographyParticipantHandler';
import EventDetailHandler, { UPDATE_EVENT_DETAIL } from './commands/EventDetailHandler';
import ElementDetailHandler, { UPDATE_ELEMENT_DETAIL } from './commands/ElementDetailHandler';
import {
  ADD_LANE,
  SET_POOL_BLACK_BOX,
  SetPoolBlackBoxHandler,
  AddLaneHandler,
  ROOT_TO_COLLABORATION,
  RootToCollaborationHandler,
  UPDATE_LANES,
  UpdateLanesHandler,
} from './commands/StructureHandlers';
import PoolBoundaryHandler, { SET_POOL_BOUNDARY } from './commands/PoolBoundaryHandler';
import ArrangeHandler, { ARRANGE_ELEMENTS } from './commands/ArrangeHandler';
import { APPLY_LAYOUT, ApplyLayoutHandler } from './layout/ApplyLayoutHandler';
import BpmnFlowRules from './interaction/BpmnFlowRules';
import BpmnContextPadProvider from './interaction/ContextPadProvider';
import DirectEditing from './interaction/DirectEditing';
import Clipboard from './interaction/Clipboard';
import ClickSelectsBehavior from './interaction/SelectionBehavior';
import ConnectTool from './interaction/ConnectTool';
import LaneDrop from './interaction/LaneDrop';
import ReplaceMenu from './interaction/ReplaceMenu';
import BpmnElementFactory from './modeling/BpmnElementFactory';
import BpmnIds from './modeling/BpmnIds';
import SemanticSync from './modeling/SemanticSync';
import StructureBehavior from './modeling/StructureBehavior';
import ExpandBehavior from './modeling/ExpandBehavior';

class BpmnFlowCommands {
  static $inject = ['commandStack'];
  constructor(commandStack: CommandStack) {
    commandStack.registerHandler(UPDATE_PROPERTIES, UpdatePropertiesHandler);
    commandStack.registerHandler(UPDATE_DOCUMENTATION, UpdateDocumentationHandler);
    commandStack.registerHandler(UPDATE_CONDITION, UpdateConditionHandler);
    commandStack.registerHandler(CHANGE_TYPE, ChangeTypeHandler);
    commandStack.registerHandler(REPLACE_ELEMENT, ReplaceHandler);
    commandStack.registerHandler(SET_EXPANDED, ExpandHandler);
    commandStack.registerHandler(SET_EVENT_DEFINITION, EventDefinitionHandler);
    commandStack.registerHandler(SET_LOOP, LoopHandler);
    commandStack.registerHandler(SET_CHOREOGRAPHY_PARTICIPANT, ChoreographyParticipantHandler);
    commandStack.registerHandler(UPDATE_CHOREOGRAPHY_BANDS, ChoreographyParticipantHandler);
    commandStack.registerHandler(UPDATE_EVENT_DETAIL, EventDetailHandler);
    commandStack.registerHandler(UPDATE_ELEMENT_DETAIL, ElementDetailHandler);
    commandStack.registerHandler(ROOT_TO_COLLABORATION, RootToCollaborationHandler);
    commandStack.registerHandler(UPDATE_LANES, UpdateLanesHandler);
    commandStack.registerHandler(ADD_LANE, AddLaneHandler);
    commandStack.registerHandler(SET_POOL_BLACK_BOX, SetPoolBlackBoxHandler);
    commandStack.registerHandler(SET_POOL_BOUNDARY, PoolBoundaryHandler);
    commandStack.registerHandler(APPLY_LAYOUT, ApplyLayoutHandler);
    commandStack.registerHandler(ARRANGE_ELEMENTS, ArrangeHandler);
  }
}

export const coreModule: ModuleDeclaration = {
  __init__: ['bpmnFlowRenderer', 'clickSelectsBehavior'],
  bpmnFlowRenderer: ['type', BpmnFlowRenderer],
  clickSelectsBehavior: ['type', ClickSelectsBehavior],
};

const editingModule: ModuleDeclaration = {
  __init__: [
    'diSync',
    'semanticSync',
    'structureBehavior',
    'expandBehavior',
    'bpmnFlowRules',
    'bpmnFlowCommands',
    'bpmnContextPadProvider',
    'directEditing',
    'connectTool',
    'laneDrop',
    'replaceMenu',
  ],
  elementFactory: ['type', BpmnElementFactory],
  bpmnIds: ['type', BpmnIds],
  layouter: ['type', BpmnFlowLayouter],
  diSync: ['type', DiSync],
  semanticSync: ['type', SemanticSync],
  structureBehavior: ['type', StructureBehavior],
  expandBehavior: ['type', ExpandBehavior],
  bpmnFlowRules: ['type', BpmnFlowRules],
  bpmnFlowCommands: ['type', BpmnFlowCommands],
  bpmnContextPadProvider: ['type', BpmnContextPadProvider],
  directEditing: ['type', DirectEditing],
  bpmnClipboard: ['type', Clipboard],
  connectTool: ['type', ConnectTool],
  laneDrop: ['type', LaneDrop],
  replaceMenu: ['type', ReplaceMenu],
};

export const EDITING_MODULES: ModuleDeclaration[] = [
  ModelingModule,
  MoveModule,
  AutoScrollModule,
  CreateModule,
  ConnectModule,
  ConnectionPreviewModule,
  BendpointsModule,
  ResizeModule,
  AttachSupportModule,
  GridSnappingModule,
  ContextPadModule,
  PopupMenuModule,
  editingModule,
];
