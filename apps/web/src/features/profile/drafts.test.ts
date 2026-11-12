import { describe, expect, it } from 'vitest';
import { clearEditedErrors, emptyMeasurements, switchUnits, validateBasics, type BasicsDraft } from './drafts';

const base: BasicsDraft = {
  name: 'A',
  birthYear: '',
  clothingPreference: 'unisex',
  height: '170',
  heightFt: '',
  heightIn: '',
  weight: '70',
  country: 'GB',
  measurementUnit: 'metric',
};

describe('switchUnits', () => {
  it('re-expresses entered values without changing the underlying data', () => {
    const toImperial = switchUnits(base, { ...emptyMeasurements(), waistCm: '81.3', chestCm: 'abc' }, 'imperial');
    expect(toImperial.basics).toMatchObject({ heightFt: '5', heightIn: '6.9', weight: '154.3', measurementUnit: 'imperial' });
    expect(toImperial.measurements.waistCm).toBe('32');
    expect(toImperial.measurements.chestCm).toBe('abc'); // invalid input is left for validation to flag
    expect(toImperial.measurements.hipsCm).toBe('');

    const back = switchUnits(toImperial.basics, toImperial.measurements, 'metric');
    expect(back.basics).toMatchObject({ height: '169.9', weight: '70' });
    expect(back.measurements.waistCm).toBe('81.3');
  });
});

describe('validateBasics (imperial height)', () => {
  const imperial = { ...base, height: '', measurementUnit: 'imperial' as const, weight: '154' };

  it('accepts feet with or without inches', () => {
    expect(validateBasics({ ...imperial, heightFt: '5', heightIn: '9' }).data?.heightCm).toBe(175.3);
    expect(validateBasics({ ...imperial, heightFt: '6', heightIn: '' }).data?.heightCm).toBe(182.9);
  });

  it('requires height and rejects invalid feet/inches', () => {
    expect(validateBasics(imperial).errors?.heightCm).toBe('Enter your height');
    expect(validateBasics({ ...imperial, heightFt: '5', heightIn: '14' }).errors?.heightCm).toBe(
      'Enter whole feet and 0–11.9 inches',
    );
    expect(validateBasics({ ...imperial, heightFt: '5.5' }).errors?.heightCm).toBe('Enter whole feet and 0–11.9 inches');
  });

  it('states the allowed range in feet and inches', () => {
    expect(validateBasics({ ...imperial, heightFt: '9' }).errors?.heightCm).toBe('Height must be 3′ 3.4″ – 8′ 2.4″');
  });
});

describe('clearEditedErrors', () => {
  it('clears the error for the edited field, mapping draft keys to error keys', () => {
    const errors = { heightCm: 'Enter your height', name: 'Name is required' };
    expect(clearEditedErrors(errors, { heightIn: '5' })).toEqual({ name: 'Name is required' });
    expect(clearEditedErrors(errors, { country: 'IN' })).toBe(errors);
  });
});
