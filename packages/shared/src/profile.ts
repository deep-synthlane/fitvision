import { z } from 'zod';
import { isCountryCode } from './countries.js';
import { MEASUREMENT_UNITS } from './units.js';

export const CLOTHING_PREFERENCES = ['womenswear', 'menswear', 'unisex'] as const;
export type ClothingPreference = (typeof CLOTHING_PREFERENCES)[number];

export const CLOTHING_PREFERENCE_LABELS: Record<ClothingPreference, string> = {
  womenswear: 'Womenswear',
  menswear: 'Menswear',
  unisex: 'Both / unisex',
};

const currentYear = new Date().getFullYear();

/** Profile values are always metric (cm, kg); `measurementUnit` only controls display. */
export const profileInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  birthYear: z
    .number({ message: 'Enter a valid birth year' })
    .int()
    .min(currentYear - 100, 'Enter a valid birth year')
    .max(currentYear - 13, 'You must be at least 13 years old')
    .nullable(),
  clothingPreference: z.enum(CLOTHING_PREFERENCES, { message: 'Select a clothing preference' }),
  heightCm: z.number({ message: 'Enter your height' }).min(100, 'Height must be 100–250 cm').max(250, 'Height must be 100–250 cm'),
  weightKg: z.number({ message: 'Enter your weight' }).min(30, 'Weight must be 30–300 kg').max(300, 'Weight must be 30–300 kg'),
  country: z.string({ message: 'Select your country' }).refine(isCountryCode, 'Select your country'),
  measurementUnit: z.enum(MEASUREMENT_UNITS, { message: 'Select a unit' }),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export type Profile = Omit<ProfileInput, 'name'> & {
  onboardedAt: string;
  updatedAt: string;
};

export interface ProfileResponse {
  profile: Profile | null;
}
