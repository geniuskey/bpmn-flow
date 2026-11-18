/** Building blocks of the properties panel: sections, rows and text fields that commit on blur. */
import { type ReactNode } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { inputClass, useDraft } from './shared';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-start gap-2">
      <span className="flex h-8 items-center text-muted-foreground">{label}</span>
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
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  placeholder?: string;
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
    <input {...props} className={inputClass} />
  );
}
