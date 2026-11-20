/**
 * Fill / stroke colors of the selected element, stored as DI color extensions
 * (`color:*` and `bioc:*`; BPMN 2.0.2 itself defines no colors).
 */
import { useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { readDiColors } from '@/bpmn/di/di';
import { is, type ModdleElement } from '@/bpmn/model/moddle';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/stores/editorStore';
import { COLOR_PRESETS, toHex6 } from './colorUtils';
import { Row } from './fields';

/**
 * A native color input that commits once, when the picker is closed (the
 * `change` event), instead of on every `input` while dragging, so one pick is
 * one undo step.
 */
function ColorInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onChange = () => onCommit(input.value);
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, [onCommit]);
  useEffect(() => {
    if (ref.current) ref.current.value = toHex6(value) ?? '#ffffff';
  }, [value]);
  return (
    <input
      ref={ref}
      type="color"
      aria-label={label}
      title={value ?? 'Theme default'}
      disabled={disabled}
      defaultValue={toHex6(value) ?? '#ffffff'}
      className="h-8 w-10 cursor-default rounded-md border bg-background p-0.5 disabled:opacity-60"
    />
  );
}

export function ColorFields({
  elementId,
  di,
  readOnly,
}: {
  elementId: string;
  di: ModdleElement | undefined;
  readOnly: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  if (!is(di, 'bpmndi:BPMNShape') && !is(di, 'bpmndi:BPMNEdge')) return null;
  const shape = is(di, 'bpmndi:BPMNShape');
  const colors = readDiColors(di) ?? {};
  const set = (detail: { fill?: string | null; stroke?: string | null }) =>
    controller?.updateElementDetail(elementId, { kind: 'colors', ...detail });
  const swatch = 'size-5 rounded-full border-2 disabled:opacity-60';

  const channel = (key: 'fill' | 'stroke', label: string) => (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        <ColorInput
          label={`${label} color`}
          value={colors[key]}
          disabled={readOnly}
          onCommit={(v) => set({ [key]: v })}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {colors[key] ?? 'Default'}
        </span>
        {colors[key] && (
          <Button
            size="icon-sm"
            aria-label={`Reset ${label.toLowerCase()} color`}
            title="Back to the theme color"
            disabled={readOnly}
            onClick={() => set({ [key]: null })}
          >
            <RotateCcw />
          </Button>
        )}
      </div>
    </Row>
  );

  return (
    <>
      <Row label="Colors">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Color presets">
          <button
            type="button"
            aria-label="Default colors"
            title="Default (theme colors)"
            disabled={readOnly || (!colors.fill && !colors.stroke)}
            className={`${swatch} border-border bg-[linear-gradient(135deg,transparent_45%,var(--muted-foreground)_45%,var(--muted-foreground)_55%,transparent_55%)]`}
            onClick={() => set({ ...(shape ? { fill: null } : {}), stroke: null })}
          />
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-label={`${p.name} colors`}
              title={p.name}
              disabled={readOnly}
              className={swatch}
              style={{ background: shape ? p.fill : p.stroke, borderColor: p.stroke }}
              onClick={() => set(shape ? { fill: p.fill, stroke: p.stroke } : { stroke: p.stroke })}
            />
          ))}
        </div>
      </Row>
      {shape && channel('fill', 'Fill')}
      {channel('stroke', shape ? 'Stroke' : 'Line')}
    </>
  );
}
