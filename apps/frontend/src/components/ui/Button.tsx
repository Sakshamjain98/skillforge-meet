'use client';
import { forwardRef, ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
type Size    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  Variant;
  size?:     Size;
  loading?:  boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white border-transparent',
  secondary:
    'bg-gray-800 hover:bg-gray-700 active:bg-gray-900 text-gray-100 border-gray-700',
  danger:
    'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white border-transparent',
  ghost:
    'bg-transparent hover:bg-gray-800 active:bg-gray-900 text-gray-300 border-transparent',
  icon:
    'bg-gray-800 hover:bg-gray-700 active:scale-95 text-gray-200 border-gray-700 rounded-xl',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2   text-sm gap-2',
  lg: 'px-6 py-2.5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant   = 'primary',
      size      = 'md',
      loading   = false,
      fullWidth = false,
      className,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={clsx(
          'inline-flex items-center justify-center font-medium rounded-xl border',
          'transition-all duration-150 focus:outline-none focus:ring-2',
          'focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {loading && (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';