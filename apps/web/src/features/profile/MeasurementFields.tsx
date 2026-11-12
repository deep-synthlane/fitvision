import { lengthUnitLabel, type MeasurementUnit } from '@fitvision/shared';
import { TextField } from '../../design';
import { MEASUREMENT_INPUTS, type MeasurementsDraft } from './drafts';

interface MeasurementFieldsProps {
  draft: MeasurementsDraft;
  unit: MeasurementUnit;
  errors: Record<string, string>;
  onChange: (patch: Partial<MeasurementsDraft>) => void;
}

/** All fields are optional; a body scan will fill them in later. */
export function MeasurementFields({ draft, unit, errors, onChange }: MeasurementFieldsProps) {
  return (
    <div className="fv-measure-grid">
      {MEASUREMENT_INPUTS.map(({ key, label }) => (
        <TextField
          key={key}
          label={`${label} (${lengthUnitLabel(unit)})`}
          inputMode="decimal"
          value={draft[key]}
          onChange={(e) => onChange({ [key]: e.target.value })}
          error={errors[key]}
        />
      ))}
    </div>
  );
}
