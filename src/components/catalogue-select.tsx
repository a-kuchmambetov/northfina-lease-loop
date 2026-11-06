'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function CatalogueSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    function outside(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <div
      className="catalogue-select"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          ref.current?.querySelector('button')?.focus();
        }
        if (open && event.key === 'Tab') setOpen(false);
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          (open && (event.key === 'Home' || event.key === 'End'))
        ) {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const buttons = Array.from(
            ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
          );
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : current < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : buttons.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
          buttons[next]?.focus();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="filter-trigger"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        {label} <span aria-hidden="true">{open ? '↑' : '↓'}</span>
      </button>
      {open && (
        <div id={id} className="filter-menu" role="menu" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                ref.current?.querySelector('button')?.focus();
              }}
            >
              {option.label}
              <span aria-hidden="true">{option.value === value ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
