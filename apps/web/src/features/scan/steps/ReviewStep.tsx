import { useState, type FormEvent } from 'react';
import {
  BODY_MEASUREMENTS,
  BODY_SCAN_DISCLAIMER,
  BODY_SHAPE_LABELS,
  ESTIMATED_MEASUREMENTS,
  LOW_CONFIDENCE_THRESHOLD,
  MANUAL_ONLY_MEASUREMENTS,
  deriveScanSource,
  formatHeight,
  fromDisplayLength,
  lengthUnitLabel,
  measurementValuesSchema,
  toDisplayLength,
  type BodyMeasurements,
  type MeasurementKey,
  type MeasurementUnit,
  type MeasurementValues,
  type ScanEstimates,
} from '@fitvision/shared';
import { Alert, Badge, Button } from '../../../design';
import { validate } from '../../../lib/forms';
import { localiseErrors } from '../../profile/drafts';

type EditableKey = (typeof ESTIMATED_MEASUREMENTS)[number] | (typeof MANUAL_ONLY_MEASUREMENTS)[number];

interface ReviewStepProps {
  result: ScanEstimates;
  unit: MeasurementUnit;
  heightCm: number;
  previous: BodyMeasurements | null;
  saving: boolean;
  saveError: string | null;
  onSave: (values: MeasurementValues) => void;
  onRetake: () => void;
}

const LABEL = Object.fromEntries(BODY_MEASUREMENTS.map((m) => [m.key, m.label])) as Record<MeasurementKey, string>;

function confidenceLabel(c: number) {
  if (c >= 0.75) return { text: 'High confidence', className: 'fv-confidence--high' };
  if (c >= LOW_CONFIDENCE_THRESHOLD) return { text: 'Medium confidence', className: '' };
  return { text: 'Low confidence — please check', className: 'fv-confidence--low' };
}

const display = (cm: number | null | undefined, unit: MeasurementUnit) => (cm == null ? '' : String(toDisplayLength(cm, unit)));

export function ReviewStep({ result, unit, heightCm, previous, saving, saveError, onSave, onRetake }: ReviewStepProps) {
  const initial: Record<EditableKey, string> = {
    shoulderCm: display(result.estimates.shoulderCm?.valueCm, unit),
    chestCm: display(result.estimates.chestCm?.valueCm, unit),
    waistCm: display(result.estimates.waistCm?.valueCm, unit),
    hipsCm: display(result.estimates.hipsCm?.valueCm, unit),
    inseamCm: display(previous?.inseamCm, unit),
    armLengthCm: display(previous?.armLengthCm, unit),
  };
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Untouched estimates are sent as the exact metric value, so display rounding never counts as a correction. */
  function values(): MeasurementValues {
    const v = { heightCm, inseamCm: null, armLengthCm: null } as MeasurementValues;
    for (const key of [...ESTIMATED_MEASUREMENTS, ...MANUAL_ONLY_MEASUREMENTS]) {
      const raw = draft[key].trim();
      const estimate = key in result.estimates ? result.estimates[key as keyof typeof result.estimates] : undefined;
      if (raw === '') v[key] = null;
      else if (estimate && raw === initial[key]) v[key] = estimate.valueCm;
      else v[key] = Number.isNaN(Number(raw)) ? Number.NaN : fromDisplayLength(Number(raw), unit);
    }
    return v;
  }

  const current = values();
  const source = deriveScanSource(result.estimates, current);
  const lowCount = ESTIMATED_MEASUREMENTS.filter((k) => {
    const e = result.estimates[k];
    return e && e.confidence < LOW_CONFIDENCE_THRESHOLD;
  }).length;

  function submit(e: FormEvent) {
    e.preventDefault();
    const checked = validate(measurementValuesSchema, current);
    if (!checked.data) {
      setErrors(localiseErrors(checked.errors, unit));
      return;
    }
    setErrors({});
    onSave(checked.data);
  }

  function row(key: EditableKey) {
    const estimate = (ESTIMATED_MEASUREMENTS as readonly string[]).includes(key)
      ? result.estimates[key as (typeof ESTIMATED_MEASUREMENTS)[number]]
      : undefined;
    const manualOnly = (MANUAL_ONLY_MEASUREMENTS as readonly string[]).includes(key);
    const low = estimate && estimate.confidence < LOW_CONFIDENCE_THRESHOLD;
    const edited = estimate && draft[key] !== initial[key];
    const conf = estimate && confidenceLabel(estimate.confidence);
    const id = `review-${key}`;
    return (
      <div key={key} className={`fv-review__row${low && !edited ? ' fv-review__row--low' : ''}`}>
        <div>
          <label htmlFor={id} className="fv-field__label">
            {LABEL[key]} ({lengthUnitLabel(unit)})
          </label>
          <div className="fv-review__meta">
            {conf && <span className={`fv-badge ${conf.className}`}>{conf.text}</span>}
            {estimate && <span>Estimated {display(estimate.valueCm, unit)}</span>}
            {edited && <Badge>Edited</Badge>}
            {!estimate && !manualOnly && <span>Couldn’t estimate — enter manually</span>}
            {manualOnly && <span>Not estimated from the scan — enter manually{previous?.[key] != null ? ' (pre-filled from your profile)' : ''}</span>}
          </div>
        </div>
        <input
          id={id}
          className="fv-input"
          inputMode="decimal"
          value={draft[key]}
          aria-invalid={errors[key] ? true : undefined}
          onChange={(e) => {
            setDraft((d) => ({ ...d, [key]: e.target.value }));
            setErrors((er) => {
              const { [key]: _removed, ...rest } = er;
              return rest;
            });
          }}
        />
        {errors[key] && <span className="fv-field__error">{errors[key]}</span>}
      </div>
    );
  }

  const shape = result.proportions.bodyShape;

  return (
    <form className="fv-stack" onSubmit={submit} noValidate aria-labelledby="review-title">
      <div>
        <p className="fv-muted fv-eyebrow">Body scan</p>
        <h1 id="review-title">Review your measurements</h1>
      </div>
      <Alert tone="warning">{BODY_SCAN_DISCLAIMER}</Alert>
      {result.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {lowCount > 0 && (
        <p className="fv-small">
          {lowCount} measurement{lowCount === 1 ? ' has' : 's have'} low confidence and {lowCount === 1 ? 'is' : 'are'} highlighted. A tape
          measure gives the best result.
        </p>
      )}
      {saveError && <Alert tone="error">{saveError}</Alert>}

      <div className="fv-review">
        <div className="fv-review__row">
          <div>
            <span className="fv-field__label">Height</span>
            <div className="fv-review__meta">From your profile — used to scale the scan</div>
          </div>
          <strong>{formatHeight(heightCm, unit)}</strong>
        </div>
        {ESTIMATED_MEASUREMENTS.map(row)}
        {MANUAL_ONLY_MEASUREMENTS.map(row)}
      </div>

      {shape && (
        <p className="fv-small">
          <strong>Body proportions:</strong> {BODY_SHAPE_LABELS[shape]}
          {result.proportions.waistToHipRatio !== null && ` · waist-to-hip ${result.proportions.waistToHipRatio}`}
        </p>
      )}

      <p className="fv-muted fv-small">
        {source === 'corrected'
          ? 'You changed at least one estimate, so these will be saved as corrected measurements.'
          : 'These will be saved as body-scan measurements.'}
      </p>
      <div className="fv-actions fv-actions--wrap">
        <Button type="button" variant="secondary" onClick={onRetake} disabled={saving}>
          Retake photos
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Saving…' : 'Save scan & measurements'}
        </Button>
      </div>
    </form>
  );
}
