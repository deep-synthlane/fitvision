import { useId, type SelectHTMLAttributes } from 'react';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  hint?: string;
}

export function SelectField({ label, options, placeholder, error, hint, id, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="fv-field">
      <label className="fv-field__label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="fv-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint && `${selectId}-hint`, error && `${selectId}-error`].filter(Boolean).join(' ') || undefined}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <span id={`${selectId}-hint`} className="fv-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${selectId}-error`} className="fv-field__error" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
