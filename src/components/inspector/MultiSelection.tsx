/** Several elements selected: arranging them, their colors in one step, and what they are. */
import { Trash } from 'lucide-react';
import { COMMANDS, isEnabled, runCommand } from '@/app/commands';
import { humanizeType } from '@/bpmn/model/elements';
import type { ModdleElement } from '@/bpmn/model/moddle';
import { Button } from '@/components/ui/button';
import { isColorable } from '@/editor/model';
import { useEditorStore } from '@/stores/editorStore';
import { ARRANGE_ITEMS } from '../arrangeItems';
import { ColorPresetSwatches } from './colorFields';
import { Row, Section } from './fields';

export function MultiSelection({ ids }: { ids: string[] }) {
  const controller = useEditorStore((s) => s.controller);
  const readOnly = useEditorStore((s) => s.snapshot.readOnly);
  if (!controller) return null;
  const elements = ids
    .map((id) => controller.getElement(id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  // Element ids by type; a type row narrows the selection to its elements.
  const counts = new Map<string, string[]>();
  for (const e of elements) {
    const type = (e as { businessObject?: ModdleElement }).businessObject?.$type;
    const label = type ? humanizeType(type) : 'Other';
    counts.set(label, [...(counts.get(label) ?? []), e.id]);
  }
  const colorable = elements.filter(isColorable);
  const shapes = colorable.filter((e) => !(e as { waypoints?: unknown }).waypoints).length;
  const edges = colorable.length - shapes;
  const command = (id: string) => COMMANDS.find((c) => c.id === id)!;
  const remove = command('edit.delete');

  return (
    <>
      <Section id="arrange" title="Arrange">
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Arrange">
          {ARRANGE_ITEMS.map(({ id, icon: Icon, separated }) => {
            const cmd = command(id);
            return (
              <span key={id} className="contents">
                {separated && <span className="mx-1 h-5 w-px bg-border" />}
                <Button
                  size="icon-sm"
                  aria-label={cmd.label}
                  title={cmd.label}
                  disabled={!isEnabled(cmd)}
                  onClick={() => runCommand(id)}
                >
                  <Icon />
                </Button>
              </span>
            );
          })}
        </div>
        <Button
          variant="outline"
          className="h-8 w-full"
          disabled={!isEnabled(remove)}
          onClick={() => runCommand(remove.id)}
        >
          <Trash /> Delete {ids.length} elements
        </Button>
      </Section>

      {colorable.length > 0 && (
        <Section id="appearance" title="Appearance">
          <Row label="Colors">
            <ColorPresetSwatches
              shape={shapes > 0}
              disabled={readOnly}
              canReset
              onPick={(colors) => controller.setSelectionColors(colors)}
            />
          </Row>
          <p className="text-[11px] text-muted-foreground">
            Applies to {colorable.length} element{colorable.length === 1 ? '' : 's'}
            {edges > 0 && shapes > 0 ? '; connections take the line color only' : ''}.
          </p>
        </Section>
      )}
      <Section id="selection" title="Selection">
        <ul className="-mx-1 space-y-px" aria-label="Selected element types">
          {[...counts]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .map(([label, members]) => (
              <li key={label}>
                <button
                  type="button"
                  title={`Select only the ${label.toLowerCase()} elements`}
                  className="flex h-7 w-full items-center justify-between gap-2 rounded-md px-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => controller.select(members, false)}
                >
                  <span className="truncate">{label}</span>
                  <span className="tabular-nums text-muted-foreground">{members.length}</span>
                </button>
              </li>
            ))}
        </ul>
      </Section>
    </>
  );
}
