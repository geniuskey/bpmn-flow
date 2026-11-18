/**
 * Keeps the BPMN semantic model in sync with diagram-js modeling commands.
 *
 * diagram-js only changes the diagram graph. For each command that adds,
 * removes, reconnects, re-parents or (re-)attaches elements, this interceptor
 * applies the matching change to the moddle tree (containment, references, DI
 * plane) on `executed` (also fired on redo) and reverts it exactly on
 * `reverted`, using a ChangeLog stored in the command context.
 */
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types';
import { is, type ModdleElement } from '@/bpmn/model/moddle';
import { bo } from '../model';
import type BpmnElementFactory from './BpmnElementFactory';
import { ChangeLog } from './ChangeLog';
import { addConnection, reconnect, removeConnection, syncContainer } from './connectionSync';
import { SemanticModel } from './semanticModel';
import { addShape, removeShape } from './shapeSync';

type Ctx = Record<string, unknown>;

type Hook = (context: Ctx, log: ChangeLog) => void;

export default class SemanticSync extends CommandInterceptor {
  static override $inject = ['eventBus', 'canvas', 'elementFactory', 'bpmnDefinitions'];

  constructor(
    eventBus: EventBus,
    canvas: Canvas,
    factory: BpmnElementFactory,
    definitions: ModdleElement,
  ) {
    super(eventBus);
    const m = new SemanticModel(canvas, factory, definitions);

    this.track('shape.create', 'semanticCreate', (ctx, log) =>
      addShape(m, ctx.shape as Shape, log),
    );
    this.track('shape.delete', 'semanticDelete', (ctx, log) =>
      removeShape(m, ctx.shape as Shape, log),
    );
    this.track('connection.create', 'semanticCreate', (ctx, log) =>
      addConnection(m, ctx.connection as Connection, log),
    );
    this.track('connection.delete', 'semanticDelete', (ctx, log) =>
      removeConnection(m, ctx.connection as Connection, log),
    );
    this.track('connection.reconnect', 'semanticReconnect', (ctx, log) =>
      reconnect(ctx.connection as Connection, log),
    );
    this.track(['shape.move', 'connection.move'], 'semanticMove', (ctx, log) =>
      syncContainer(m, (ctx.shape ?? ctx.connection) as Element, log),
    );
    this.track('element.updateAttachment', 'semanticAttach', (ctx, log) => {
      const shape = ctx.shape as Shape;
      const b = bo(shape);
      if (b && is(b, 'bpmn:BoundaryEvent')) {
        log.set(b, 'attachedToRef', shape.host ? bo(shape.host) : undefined);
      }
    });
  }

  private track(commands: string | string[], key: string, hook: Hook): void {
    this.executed(commands, (event: { context: Ctx }) => {
      const log = new ChangeLog();
      hook(event.context, log);
      event.context[key] = log;
    });
    this.reverted(commands, (event: { context: Ctx }) => {
      (event.context[key] as ChangeLog | undefined)?.undo();
    });
  }

  // ---------------------------------------------------------------- shapes

  // ----------------------------------------------------------- connections
}
