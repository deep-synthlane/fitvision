import {
  CLOTHING_PREFERENCE_LABELS,
  CLOTHING_PREFERENCES,
  MEASUREMENT_UNIT_LABELS,
  MEASUREMENT_UNITS,
  lengthUnitLabel,
  weightUnitLabel,
  type MeasurementUnit,
} from '@fitvision/shared';
import { useId } from 'react';
import { ChoiceGroup, SelectField, TextField } from '../../design';
import { COUNTRY_OPTIONS } from '../../lib/locale';
import type { BasicsDraft } from './drafts';

interface BasicsFieldsProps {
  draft: BasicsDraft;
  errors: Record<string, string>;
  onChange: (patch: Partial<BasicsDraft>) => void;
  onUnitChange: (unit: MeasurementUnit) => void;
}

function FeetInchesField({
  draft,
  error,
  onChange,
}: {
  draft: BasicsDraft;
  error?: string;
  onChange: (patch: Partial<BasicsDraft>) => void;
}) {
  const id = useId();
  return (
    <fieldset className="fv-field fv-fieldset" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="fv-field__label">Height</legend>
      <div className="fv-inline-inputs">
        <label className="fv-inline-input">
          <input
            className="fv-input"
            inputMode="numeric"
            placeholder="5"
            aria-label="Height feet"
            aria-invalid={error ? true : undefined}
            value={draft.heightFt}
            onChange={(e) => onChange({ heightFt: e.target.value })}
          />
          <span aria-hidden="true">ft</span>
        </label>
        <label className="fv-inline-input">
          <input
            className="fv-input"
            inputMode="decimal"
            placeholder="8"
            aria-label="Height inches"
            aria-invalid={error ? true : undefined}
            value={draft.heightIn}
            onChange={(e) => onChange({ heightIn: e.target.value })}
          />
          <span aria-hidden="true">in</span>
        </label>
      </div>
      {error && (
        <span id={`${id}-error`} className="fv-field__error">
          {error}
        </span>
      )}
    </fieldset>
  );
}

export function BasicsFields({ draft, errors, onChange, onUnitChange }: BasicsFieldsProps) {
  const unit = draft.measurementUnit;
  return (
    <div className="fv-stack">
      <TextField label="Name" autoComplete="name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} error={errors.name} />
      <ChoiceGroup
        legend="Clothing preference"
        name="clothingPreference"
        options={CLOTHING_PREFERENCES}
        labels={CLOTHING_PREFERENCE_LABELS}
        value={draft.clothingPreference}
        onChange={(clothingPreference) => onChange({ clothingPreference })}
        error={errors.clothingPreference}
      />
      <ChoiceGroup
        legend="Measurement unit"
        name="measurementUnit"
        options={MEASUREMENT_UNITS}
        labels={MEASUREMENT_UNIT_LABELS}
        value={unit}
        onChange={onUnitChange}
        error={errors.measurementUnit}
      />
      <div className="fv-row">
        {unit === 'metric' ? (
          <TextField
            label={`Height (${lengthUnitLabel(unit)})`}
            inputMode="decimal"
            placeholder="e.g. 172"
            value={draft.height}
            onChange={(e) => onChange({ height: e.target.value })}
            error={errors.heightCm}
          />
        ) : (
          <FeetInchesField draft={draft} error={errors.heightCm} onChange={onChange} />
        )}
        <TextField
          label={`Weight (${weightUnitLabel(unit)})`}
          inputMode="decimal"
          placeholder={unit === 'metric' ? 'e.g. 68' : 'e.g. 150'}
          value={draft.weight}
          onChange={(e) => onChange({ weight: e.target.value })}
          error={errors.weightKg}
        />
      </div>
      <div className="fv-row">
        <SelectField
          label="Country"
          placeholder="Select country"
          options={COUNTRY_OPTIONS}
          value={draft.country}
          onChange={(e) => onChange({ country: e.target.value })}
          error={errors.country}
        />
        <TextField
          label="Birth year (optional)"
          inputMode="numeric"
          autoComplete="bday-year"
          placeholder="e.g. 1994"
          value={draft.birthYear}
          onChange={(e) => onChange({ birthYear: e.target.value })}
          error={errors.birthYear}
        />
      </div>
    </div>
  );
}
