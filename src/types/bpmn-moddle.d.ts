// `bpmn-moddle` ships generated element types under `bpmn-moddle/types`, but its
// main entry has no declaration. This declares only the API surface we use.
declare module 'bpmn-moddle' {
  import type { ModdleElement } from '../bpmn/model/moddle';

  export interface ModdleParseWarning {
    message: string;
    element?: unknown;
    property?: unknown;
    value?: unknown;
    error?: Error;
  }

  export interface ModdleParseResult {
    rootElement: ModdleElement;
    references: unknown[];
    warnings: ModdleParseWarning[];
    elementsById: Record<string, ModdleElement>;
  }

  export class BpmnModdle {
    constructor(packages?: Record<string, unknown>, options?: Record<string, unknown>);
    fromXML(
      xml: string,
      typeName?: string,
      options?: Record<string, unknown>,
    ): Promise<ModdleParseResult>;
    toXML(
      element: ModdleElement,
      options?: { format?: boolean; preamble?: boolean },
    ): Promise<{ xml: string }>;
    create(type: string, attrs?: Record<string, unknown>): ModdleElement;
  }
}
