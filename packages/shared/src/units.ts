export const MEASUREMENT_UNITS = ['metric', 'imperial'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const MEASUREMENT_UNIT_LABELS: Record<MeasurementUnit, string> = {
  metric: 'Metric (cm, kg)',
  imperial: 'Imperial (ft/in, lb)',
};

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Values are always stored in cm/kg; these convert to and from the user's display unit. */
export const toDisplayLength = (cm: number, unit: MeasurementUnit) => round1(unit === 'metric' ? cm : cm / CM_PER_IN);
export const fromDisplayLength = (value: number, unit: MeasurementUnit) => round1(unit === 'metric' ? value : value * CM_PER_IN);
export const toDisplayWeight = (kg: number, unit: MeasurementUnit) => round1(unit === 'metric' ? kg : kg / KG_PER_LB);
export const fromDisplayWeight = (value: number, unit: MeasurementUnit) => round1(unit === 'metric' ? value : value * KG_PER_LB);

export const lengthUnitLabel = (unit: MeasurementUnit) => (unit === 'metric' ? 'cm' : 'in');
export const weightUnitLabel = (unit: MeasurementUnit) => (unit === 'metric' ? 'kg' : 'lb');

export const formatLength = (cm: number, unit: MeasurementUnit) => `${toDisplayLength(cm, unit)} ${lengthUnitLabel(unit)}`;
export const formatWeight = (kg: number, unit: MeasurementUnit) => `${toDisplayWeight(kg, unit)} ${weightUnitLabel(unit)}`;

/** Splits a height into whole feet and inches (one decimal), e.g. 175 cm → { feet: 5, inches: 8.9 }. */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / CM_PER_IN;
  let feet = Math.floor(totalInches / 12);
  let inches = round1(totalInches - feet * 12);
  if (inches >= 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

export const feetInchesToCm = (feet: number, inches: number) => round1((feet * 12 + inches) * CM_PER_IN);

/** Height for display: "175 cm" or "5′ 8.9″". */
export function formatHeight(cm: number, unit: MeasurementUnit): string {
  if (unit === 'metric') return formatLength(cm, unit);
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}′ ${inches}″`;
}
