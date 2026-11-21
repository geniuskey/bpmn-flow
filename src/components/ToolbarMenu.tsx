import { Check, ChevronDown } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatKeys } from '@/app/shortcuts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ToolbarMenuItem {
  label: string;
  icon?: ComponentType;
  keys?: string;
  disabled?: boolean;
  /** Draws a divider above the item. */
  separated?: boolean;
  /** A radio item: shown with a check mark when selected. */
  checked?: boolean;
  onSelect(): void;
}

/**
 * A header dropdown. The header scrolls horizontally (overflow clips), so the
 * menu is portaled to <body> and anchored to the trigger. Focus moves into the
 * menu: ↑/↓/Home/End move between enabled items, Escape (or picking one)
 * closes it and returns focus to the trigger.
 */
export function ToolbarMenu({
  label,
  title,
  disabled,
  items,
  trigger,
  className,
  variant = 'ghost',
  testId,
  chevron = true,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  items: ToolbarMenuItem[];
  /** Trigger content. */
  trigger: ReactNode;
  className?: string;
  variant?: 'ghost' | 'default' | 'outline';
  testId?: string;
  /** Adds a chevron after the trigger content. */
  chevron?: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const anyIcon = items.some((i) => i.icon || i.checked !== undefined);

  const close = () => {
    setPos(null);
    buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const r = buttonRef.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
    if (left !== pos.left) setPos({ top: pos.top, left });
    menu.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [open, pos]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const enabled = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => enabled[(n + enabled.length) % enabled.length]?.focus();
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(enabled.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <Button
        ref={buttonRef}
        title={title ?? label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        variant={open && variant === 'ghost' ? 'active' : variant}
        className={cn('gap-0.5 px-1.5', className)}
        data-testid={testId}
        onClick={() => {
          if (open) return close();
          const r = buttonRef.current!.getBoundingClientRect();
          setPos({ top: r.bottom + 4, left: r.left });
        }}
      >
        {trigger}
        {chevron && <ChevronDown className="!size-3 opacity-60" />}
      </Button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setPos(null)} />
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-50 max-h-[calc(100vh-4rem)] min-w-52 overflow-y-auto rounded-lg border bg-card p-1 shadow-xl"
              onKeyDown={onKeyDown}
            >
              {items.map((item) => (
                <div key={item.label}>
                  {item.separated && <div className="my-1 h-px bg-border" />}
                  <button
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={item.checked}
                    tabIndex={-1}
                    disabled={item.disabled}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0"
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                  >
                    {item.checked ? (
                      <Check />
                    ) : item.icon ? (
                      <item.icon />
                    ) : (
                      anyIcon && <span className="size-4 shrink-0" />
                    )}
                    <span className="flex-1">{item.label}</span>
                    {item.keys && (
                      <span className="text-[11px] text-muted-foreground">
                        {formatKeys(item.keys)}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
