import { useId, type InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({ label, error, hint, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="fv-field">
      <label className="fv-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="fv-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint && (
        <span id={`${inputId}-hint`} className="fv-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${inputId}-error`} className="fv-field__error" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
