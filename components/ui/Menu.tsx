'use client';

import {MoreHorizontal, type LucideIcon} from 'lucide-react';
import {useRef, useState, type ReactNode} from 'react';

import Popover from '@/components/ui/Popover';

export type MenuItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  // A leading element instead of an icon, e.g. a status dot.
  leading?: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  selected?: boolean;
  disabled?: boolean;
};

// A small action menu: one trigger, a list of items. Arrow keys move between
// items; Enter or Space picks one.
export default function Menu({
  label,
  items,
  trigger,
  triggerClassName,
  width = 200
}: {
  label: string;
  items: MenuItem[];
  // Defaults to a "⋯" icon button.
  trigger?: ReactNode;
  triggerClassName?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function focusItem(offset: number) {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (index + offset + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
          // Focus the first item once the panel has rendered.
          requestAnimationFrame(() => requestAnimationFrame(() => focusItem(0)));
        }}
        className={
          triggerClassName ??
          'rounded p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink aria-expanded:bg-raised aria-expanded:text-ink'
        }
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />}
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={width} label={label}>
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusItem(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusItem(-1);
            }
          }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                aria-current={item.selected || undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm outline-none transition-colors disabled:opacity-40 ${
                  item.tone === 'danger'
                    ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                    : 'text-ink hover:bg-raised focus:bg-raised'
                } ${item.selected ? 'bg-raised' : ''}`}
              >
                {item.leading ??
                  (Icon ? <Icon className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} /> : null)}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.selected ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
