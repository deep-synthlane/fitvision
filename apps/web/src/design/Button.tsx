import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  block?: boolean;
  loading?: boolean;
}

export function Button({ variant = 'primary', block, loading, disabled, className, children, ...rest }: ButtonProps) {
  const classes = ['fv-btn', `fv-btn--${variant}`, block && 'fv-btn--block', className].filter(Boolean).join(' ');
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {children}
    </button>
  );
}
