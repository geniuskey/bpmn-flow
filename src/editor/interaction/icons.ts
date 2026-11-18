/** Inline SVG icons (Lucide-style strokes) for canvas overlays. Colored via currentColor. */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  task: svg('<rect x="3" y="5" width="18" height="14" rx="3"/>'),
  gateway: svg('<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>'),
  endEvent: svg('<circle cx="12" cy="12" r="8" stroke-width="3.5"/>'),
  startEvent: svg('<circle cx="12" cy="12" r="8"/>'),
  connect: svg('<path d="M5 19 19 5"/><path d="M11 5h8v8"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>'),
  laneBelow: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/><path d="M12 15v3M10.5 16.5h3"/>',
  ),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
};
