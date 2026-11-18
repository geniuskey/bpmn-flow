// Bundled by Vite from the installed package (what a consumer app does).
import { BpmnFlowEditor } from '@geniuskey/bpmn-flow/editor';
import { BpmnFlowCanvas } from '@geniuskey/bpmn-flow/react';
import '@geniuskey/bpmn-flow/style.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import sample from './sample.bpmn?raw';
// elkjs is a dependency of the package; a consumer that imports it directly lists it too.
import elkWorker from 'elkjs/lib/elk-worker.min.js?url';

const editor = new BpmnFlowEditor(document.getElementById('vanilla'), {
  keyboard: true,
  elkWorker,
});
window.editor = editor;
window.ready = editor.importXml(sample, 'sample.bpmn').then((r) => r.shapes);

window.reactSnapshots = 0;
window.reactImported = new Promise((resolve) => {
  createRoot(document.getElementById('react')).render(
    createElement(BpmnFlowCanvas, {
      xml: sample,
      style: { width: '100%', height: '100%' },
      onImport: (r) => resolve(r.shapes),
      onSnapshot: () => window.reactSnapshots++,
      ref: (instance) => (window.reactEditor = instance),
    }),
  );
});
