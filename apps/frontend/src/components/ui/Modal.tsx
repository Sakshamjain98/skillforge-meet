'use client';
import { useEffect, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';

interface ModalProps {
  open:        boolean;
  onClose:     () => void;
  title?:      string;
  children:    ReactNode;
  size?:       'sm' | 'md' | 'lg';
  className?:  string;
}

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Trap focus inside modal
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={clsx(
          'relative w-full rounded-2xl bg-gray-900 border border-gray-800',
          'shadow-2xl animate-slide-up focus:outline-none',
          sizeMap[size],
          className
        )}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <h2 className="text-white font-semibold text-lg">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors rounded-lg p-1 hover:bg-gray-800"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className={clsx('p-6', !title && 'pt-10')}>
          {!title && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors rounded-lg p-1 hover:bg-gray-800"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}