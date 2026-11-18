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
import EventDefinitionHandler, { SET_EVENT_DEFINITION } from './commands/EventDefinitionHandler';
import LoopHandler, { SET_LOOP } from './commands/LoopHandler';
import ChoreographyParticipantHandler, {
  SET_CHOREOGRAPHY_PARTICIPANT,
} from './commands/ChoreographyParticipantHandler';
import EventDetailHandler, { UPDATE_EVENT_DETAIL } from './commands/EventDetailHandler';
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
import { APPLY_LAYOUT, ApplyLayoutHandler } from './layout/ApplyLayoutHandler';
import BpmnFlowRules from './interaction/BpmnFlowRules';
import BpmnContextPadProvider from './interaction/ContextPadProvider';
import DirectEditing from './interaction/DirectEditing';
import Clipboard from './interaction/Clipboard';
import ClickSelectsBehavior from './interaction/SelectionBehavior';
import ConnectTool from './interaction/ConnectTool';
import BpmnElementFactory from './modeling/BpmnElementFactory';
import BpmnIds from './modeling/BpmnIds';
import SemanticSync from './modeling/SemanticSync';
import StructureBehavior from './modeling/StructureBehavior';

class BpmnFlowCommands {
  static $inject = ['commandStack'];
  constructor(commandStack: CommandStack) {
    commandStack.registerHandler(UPDATE_PROPERTIES, UpdatePropertiesHandler);
    commandStack.registerHandler(UPDATE_DOCUMENTATION, UpdateDocumentationHandler);
    commandStack.registerHandler(UPDATE_CONDITION, UpdateConditionHandler);
    commandStack.registerHandler(CHANGE_TYPE, ChangeTypeHandler);
    commandStack.registerHandler(SET_EVENT_DEFINITION, EventDefinitionHandler);
    commandStack.registerHandler(SET_LOOP, LoopHandler);
    commandStack.registerHandler(SET_CHOREOGRAPHY_PARTICIPANT, ChoreographyParticipantHandler);
    commandStack.registerHandler(UPDATE_EVENT_DETAIL, EventDetailHandler);
    commandStack.registerHandler(ROOT_TO_COLLABORATION, RootToCollaborationHandler);
    commandStack.registerHandler(UPDATE_LANES, UpdateLanesHandler);
    commandStack.registerHandler(ADD_LANE, AddLaneHandler);
    commandStack.registerHandler(SET_POOL_BLACK_BOX, SetPoolBlackBoxHandler);
    commandStack.registerHandler(APPLY_LAYOUT, ApplyLayoutHandler);
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
    'bpmnFlowRules',
    'bpmnFlowCommands',
    'bpmnContextPadProvider',
    'directEditing',
    'connectTool',
  ],
  elementFactory: ['type', BpmnElementFactory],
  bpmnIds: ['type', BpmnIds],
  layouter: ['type', BpmnFlowLayouter],
  diSync: ['type', DiSync],
  semanticSync: ['type', SemanticSync],
  structureBehavior: ['type', StructureBehavior],
  bpmnFlowRules: ['type', BpmnFlowRules],
  bpmnFlowCommands: ['type', BpmnFlowCommands],
  bpmnContextPadProvider: ['type', BpmnContextPadProvider],
  directEditing: ['type', DirectEditing],
  bpmnClipboard: ['type', Clipboard],
  connectTool: ['type', ConnectTool],
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
  editingModule,
];
