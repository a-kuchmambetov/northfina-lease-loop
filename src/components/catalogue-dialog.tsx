'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function CatalogueDialog({
  title,
  closeLabel,
  onClose,
  className,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Added to the dialog's own class, e.g. to make it larger. */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `catalogue-dialog ${className}` : 'catalogue-dialog'}
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-content">
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label={closeLabel}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
