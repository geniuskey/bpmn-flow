/** Building blocks of the properties panel: sections, rows and text fields that commit on blur. */
import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import { inputClass, useDraft } from './shared';

/**
 * A titled group of rows. With an `id` the title collapses it (remembered per
 * id across selections and sessions). A section whose fields all render
 * nothing is hidden.
 */
export function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  const collapsed = useUiStore((s) => !!id && s.inspectorCollapsed.includes(id));
  const toggle = useUiStore((s) => s.toggleInspectorSection);
  const bodyId = useId();
  const heading = 'text-[11px] font-semibold tracking-wide text-muted-foreground uppercase';
  return (
    <section className="border-b px-4 py-3 has-[>div:empty]:hidden" data-section={id}>
      {id ? (
        <h3 className={cn(!collapsed && 'mb-2')}>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className={cn(
              heading,
              '-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1 rounded px-1 py-0.5 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            )}
            onClick={() => toggle(id)}
          >
            <span className="flex-1">{title}</span>
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')}
            />
          </button>
        </h3>
      ) : (
        <h3 className={cn(heading, 'mb-2')}>{title}</h3>
      )}
      <div id={bodyId} className="space-y-2" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

/** Checkbox with a short explanation next to it (the row label names the property). */
export function CheckField({
  label,
  text,
  checked,
  disabled,
  title,
  onChange,
}: {
  /** Accessible name. */
  label: string;
  text: ReactNode;
  checked: boolean;
  disabled: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2" title={title}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-muted-foreground">{text}</span>
    </label>
  );
}

export function Row({
  label,
  title,
  children,
}: {
  label: string;
  /** Tooltip of the label (e.g. the XML attribute name). */
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-start gap-2">
      <span className="flex min-h-8 items-center leading-tight text-muted-foreground" title={title}>
        {label}
      </span>
      <div className="flex min-h-8 min-w-0 items-center break-words">{children}</div>
    </div>
  );
}

export function NameField({
  id,
  value,
  disabled,
}: {
  id: string;
  value: string;
  disabled: boolean;
}) {
  const controller = useEditorStore((s) => s.controller);
  const draft = useDraft(value, (name) => controller?.updateProperties(id, { name }));
  return (
    <input
      aria-label="Name"
      className={inputClass}
      disabled={disabled}
      placeholder={disabled ? '' : 'Unnamed'}
      {...draft}
    />
  );
}

export function TextField({
  label,
  value,
  disabled,
  multiline,
  placeholder,
  list,
  className,
  inputMode,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  placeholder?: string;
  /** Id of a <datalist> with suggestions (single-line fields). */
  list?: string;
  className?: string;
  inputMode?: 'decimal' | 'numeric';
  onCommit: (value: string) => void;
}) {
  const draft = useDraft(value, onCommit);
  const props = {
    'aria-label': label,
    disabled,
    placeholder: disabled ? '' : placeholder,
    ...draft,
  };
  return multiline ? (
    <textarea
      {...props}
      rows={3}
      className={`${inputClass} h-auto resize-y py-1.5`}
      onKeyDown={(e) => draft.onKeyDown(e, true)}
    />
  ) : (
    <input
      {...props}
      list={list}
      inputMode={inputMode}
      className={className ? `${inputClass} ${className}` : inputClass}
    />
  );
}
