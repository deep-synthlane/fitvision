import { COUNTRY_CODES, isCountryCode, type MeasurementUnit } from '@fitvision/shared';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export const countryName = (code: string) => regionNames.of(code) ?? code;

export const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) =>
  a.label.localeCompare(b.label),
);

/** Best guess at the user's country from the browser locale, e.g. "en-IN" → "IN". */
export function guessCountry(language = typeof navigator === 'undefined' ? '' : navigator.language): string {
  try {
    const region = new Intl.Locale(language).maximize().region ?? '';
    return isCountryCode(region) ? region : '';
  } catch {
    return '';
  }
}

const IMPERIAL_COUNTRIES = ['US', 'LR', 'MM'];
export const defaultUnitFor = (country: string): MeasurementUnit => (IMPERIAL_COUNTRIES.includes(country) ? 'imperial' : 'metric');
