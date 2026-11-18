// Type-checked (not run) against the installed package's declarations.
import {
  analyze,
  loadBpmnDocument,
  type AnalysisResult,
  type BpmnDocument,
  type Finding,
} from '@geniuskey/bpmn-flow';
import { BpmnFlowEditor, bindKeyboard, type EditorSnapshot } from '@geniuskey/bpmn-flow/editor';
import { BpmnFlowCanvas, type BpmnFlowCanvasProps } from '@geniuskey/bpmn-flow/react';
import { createElement } from 'react';

export async function check(container: HTMLElement, xml: string): Promise<string> {
  const doc: BpmnDocument = await loadBpmnDocument(xml);
  const result: AnalysisResult = analyze(doc.definitions);
  const first: Finding | undefined = result.findings[0];
  void first?.ruleId.toUpperCase();

  const editor = new BpmnFlowEditor(container, { keyboard: { onSave: () => {} } });
  const { document, shapes } = await editor.importXml(xml);
  void document.report.mode;
  void shapes;
  const off = editor.subscribe((s: EditorSnapshot) => void s.selection.length);
  off();
  const unbind = bindKeyboard(editor, container);
  unbind();
  // @ts-expect-error -- tools are a closed union
  editor.setTool('spray');
  const props: BpmnFlowCanvasProps = { xml, keyboard: true, onSnapshot: (s) => void s.dirty };
  void createElement(BpmnFlowCanvas, props);
  return editor.exportXml();
}
