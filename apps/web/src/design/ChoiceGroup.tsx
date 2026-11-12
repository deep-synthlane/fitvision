import { useId } from 'react';

interface ChoiceGroupProps<T extends string> {
  legend: string;
  name: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onChange: (value: T) => void;
  error?: string;
}

/** Radio group rendered as selectable cards. */
export function ChoiceGroup<T extends string>({ legend, name, options, labels, value, onChange, error }: ChoiceGroupProps<T>) {
  const errorId = useId();
  return (
    <div className="fv-field">
      <fieldset className="fv-choices" aria-describedby={error ? errorId : undefined}>
        <legend>{legend}</legend>
        {options.map((option) => (
          <label key={option} className="fv-choice">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {labels[option]}
          </label>
        ))}
      </fieldset>
      {error && (
        <span id={errorId} className="fv-field__error" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
