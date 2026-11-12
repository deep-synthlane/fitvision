import {
  BODY_MEASUREMENTS,
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  fromDisplayLength,
  profileInputSchema,
  fromDisplayWeight,
  lengthUnitLabel,
  toDisplayLength,
  toDisplayWeight,
  weightUnitLabel,
  type BodyMeasurements,
  type ClothingPreference,
  type MeasurementKey,
  type MeasurementUnit,
  type Profile,
  type ProfileInput,
} from '@fitvision/shared';
import { validate } from '../../lib/forms';

/**
 * Form state for the profile and measurement forms. Numbers are kept as strings in the
 * user's display unit while editing and converted to metric (cm/kg) on submit.
 */
export interface BasicsDraft {
  name: string;
  birthYear: string;
  clothingPreference: ClothingPreference | undefined;
  /** Metric height in cm. */
  height: string;
  /** Imperial height, entered as feet + inches. */
  heightFt: string;
  heightIn: string;
  weight: string;
  country: string;
  measurementUnit: MeasurementUnit;
}

/** Height is captured with the profile, so the measurement form covers the rest. */
export const MEASUREMENT_INPUTS = BODY_MEASUREMENTS.filter((m) => m.key !== 'heightCm');
export type MeasurementInputKey = Exclude<MeasurementKey, 'heightCm'>;
export type MeasurementsDraft = Record<MeasurementInputKey, string>;

export const emptyMeasurements = (): MeasurementsDraft =>
  Object.fromEntries(MEASUREMENT_INPUTS.map((m) => [m.key, ''])) as MeasurementsDraft;

const show = (n: number | null | undefined, unit: MeasurementUnit, kind: 'length' | 'weight') =>
  n == null ? '' : String(kind === 'length' ? toDisplayLength(n, unit) : toDisplayWeight(n, unit));

function heightFields(cm: number | null, unit: MeasurementUnit): Pick<BasicsDraft, 'height' | 'heightFt' | 'heightIn'> {
  if (cm == null || Number.isNaN(cm)) return { height: '', heightFt: '', heightIn: '' };
  if (unit === 'metric') return { height: show(cm, unit, 'length'), heightFt: '', heightIn: '' };
  const { feet, inches } = cmToFeetInches(cm);
  return { height: '', heightFt: String(feet), heightIn: String(inches) };
}

export function basicsFromProfile(p: Profile, name: string): BasicsDraft {
  return {
    name,
    birthYear: p.birthYear == null ? '' : String(p.birthYear),
    clothingPreference: p.clothingPreference,
    ...heightFields(p.heightCm, p.measurementUnit),
    weight: show(p.weightKg, p.measurementUnit, 'weight'),
    country: p.country,
    measurementUnit: p.measurementUnit,
  };
}

export function measurementsFromApi(m: BodyMeasurements | null, unit: MeasurementUnit): MeasurementsDraft {
  const draft = emptyMeasurements();
  if (m) for (const { key } of MEASUREMENT_INPUTS) draft[key] = show(m[key], unit, 'length');
  return draft;
}

/** '' → null (not provided); anything else → number (NaN when not numeric, which validation rejects). */
const parse = (v: string) => (v.trim() === '' ? null : Number(v.trim()));

/**
 * Height in cm from the draft: undefined when not entered, NaN when not a valid number.
 * Imperial needs feet; inches are optional (0–11.9).
 */
function draftHeightCm(d: BasicsDraft): number | undefined {
  if (d.measurementUnit === 'metric') {
    const cm = parse(d.height);
    return cm === null ? undefined : cm;
  }
  const feet = parse(d.heightFt);
  const inches = parse(d.heightIn) ?? 0;
  if (feet === null) return d.heightIn.trim() === '' ? undefined : NaN;
  if (!Number.isInteger(feet) || inches < 0 || inches >= 12) return NaN;
  return feetInchesToCm(feet, inches);
}

/** Candidate input for `profileInputSchema`; missing required values become undefined. */
export function basicsToInput(d: BasicsDraft) {
  const weight = parse(d.weight);
  return {
    name: d.name,
    birthYear: parse(d.birthYear),
    clothingPreference: d.clothingPreference,
    heightCm: draftHeightCm(d),
    weightKg: weight === null ? undefined : fromDisplayWeight(weight, d.measurementUnit),
    country: d.country || undefined,
    measurementUnit: d.measurementUnit,
  };
}

/** Candidate input for `bodyMeasurementsInputSchema`. */
export function measurementsToInput(d: MeasurementsDraft, unit: MeasurementUnit, heightCm: number | null) {
  const input: Record<MeasurementKey, number | null> = { heightCm } as Record<MeasurementKey, number | null>;
  for (const { key } of MEASUREMENT_INPUTS) {
    const n = parse(d[key]);
    input[key] = n === null ? null : fromDisplayLength(n, unit);
  }
  return input;
}

export const hasAnyMeasurement = (d: MeasurementsDraft) => MEASUREMENT_INPUTS.some(({ key }) => d[key].trim() !== '');

function convert(value: string, from: MeasurementUnit, to: MeasurementUnit, kind: 'length' | 'weight'): string {
  const n = parse(value);
  if (n === null || Number.isNaN(n) || from === to) return value;
  const metric = kind === 'length' ? fromDisplayLength(n, from) : fromDisplayWeight(n, from);
  return show(metric, to, kind);
}

/** Re-expresses every entered value in the new unit so switching units never changes the data. */
export function switchUnits(
  basics: BasicsDraft,
  measurements: MeasurementsDraft,
  to: MeasurementUnit,
): { basics: BasicsDraft; measurements: MeasurementsDraft } {
  const from = basics.measurementUnit;
  const nextMeasurements = { ...measurements };
  for (const { key } of MEASUREMENT_INPUTS) nextMeasurements[key] = convert(measurements[key], from, to, 'length');
  return {
    basics: {
      ...basics,
      measurementUnit: to,
      ...(from === to ? {} : heightFields(draftHeightCm(basics) ?? null, to)),
      weight: convert(basics.weight, from, to, 'weight'),
    },
    measurements: nextMeasurements,
  };
}

/** Range errors from the shared schemas are in cm/kg; restate them in the user's unit. */
export function localiseErrors(errors: Record<string, string>, unit: MeasurementUnit): Record<string, string> {
  if (unit === 'metric') return errors;
  const out = { ...errors };
  const ranges: Record<string, { label: string; min: number; max: number; kind: 'length' | 'weight' }> = {
    weightKg: { label: 'Weight', min: 30, max: 300, kind: 'weight' },
  };
  for (const m of BODY_MEASUREMENTS) ranges[m.key] = { label: m.label, min: m.min, max: m.max, kind: 'length' };
  for (const [key, msg] of Object.entries(out)) {
    const r = ranges[key];
    if (!r || !/ must be /.test(msg)) continue;
    const fmt = r.kind === 'length' ? toDisplayLength : toDisplayWeight;
    const label = r.kind === 'length' ? lengthUnitLabel(unit) : weightUnitLabel(unit);
    out[key] = `${r.label} must be ${fmt(r.min, unit)}–${fmt(r.max, unit)} ${label}`;
  }
  return out;
}

/** Validates the profile form, with range errors in the user's unit. */
export function validateBasics(d: BasicsDraft): { data: ProfileInput; errors: null } | { data: null; errors: Record<string, string> } {
  const result = validate(profileInputSchema, basicsToInput(d));
  if (result.data) return result;
  const errors = localiseErrors(result.errors, d.measurementUnit);
  if (d.measurementUnit === 'imperial' && errors.heightCm) {
    if (/ must be /.test(errors.heightCm)) {
      errors.heightCm = `Height must be ${formatHeight(100, 'imperial')} – ${formatHeight(250, 'imperial')}`;
    } else if (Number.isNaN(draftHeightCm(d))) {
      errors.heightCm = 'Enter whole feet and 0–11.9 inches';
    }
  }
  return { data: null, errors };
}

const ERROR_KEY: Record<string, string> = { height: 'heightCm', heightFt: 'heightCm', heightIn: 'heightCm', weight: 'weightKg' };

/** Drops errors for the fields being edited so stale messages don't linger until the next submit. */
export function clearEditedErrors(errors: Record<string, string>, patch: object): Record<string, string> {
  const keys = Object.keys(patch).map((k) => ERROR_KEY[k] ?? k);
  if (!keys.some((k) => k in errors) && !('_' in errors)) return errors;
  const next = { ...errors };
  for (const k of [...keys, '_']) delete next[k];
  return next;
}
