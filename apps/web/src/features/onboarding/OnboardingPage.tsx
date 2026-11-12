import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  bodyMeasurementsInputSchema,
  type MeasurementUnit,
  type ProfileInput,
  type ProfileResponse,
  type PublicUser,
} from '@fitvision/shared';
import { Alert, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { validate } from '../../lib/forms';
import { defaultUnitFor, guessCountry } from '../../lib/locale';
import { useAuth } from '../../lib/useAuth';
import { BasicsFields } from '../profile/BasicsFields';
import {
  clearEditedErrors,
  emptyMeasurements,
  hasAnyMeasurement,
  localiseErrors,
  measurementsToInput,
  switchUnits,
  validateBasics,
  type BasicsDraft,
  type MeasurementsDraft,
} from '../profile/drafts';
import { MeasurementFields } from '../profile/MeasurementFields';
import { ScanGuide } from './ScanGuide';

const STEPS = [
  { title: 'Basic profile', subtitle: 'Tell us a little about you so we can size clothes correctly.' },
  {
    title: 'Body measurements',
    subtitle: 'All optional — add what you know. A body scan can fill these in later.',
  },
  { title: 'Body scan setup', subtitle: 'How the scan that builds your avatar works.' },
] as const;

export function OnboardingPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [basics, setBasics] = useState<BasicsDraft>(() => {
    const country = guessCountry();
    return {
      name: user?.name ?? '',
      birthYear: '',
      clothingPreference: undefined,
      height: '',
      heightFt: '',
      heightIn: '',
      weight: '',
      country,
      measurementUnit: defaultUnitFor(country),
    };
  });
  const [measurements, setMeasurements] = useState<MeasurementsDraft>(emptyMeasurements);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Checked once on entry: finishing onboarding flips `onboarded`, and that must not redirect
  // away before our own navigation (to the scan or dashboard) runs.
  const [alreadyOnboarded] = useState(() => Boolean(user?.onboarded));

  const unit = basics.measurementUnit;
  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  function onUnitChange(to: MeasurementUnit) {
    const next = switchUnits(basics, measurements, to);
    setBasics(next.basics);
    setMeasurements(next.measurements);
  }

  function validateProfile(): ProfileInput | null {
    const result = validateBasics(basics);
    if (!result.data) setErrors(result.errors);
    return result.data;
  }

  /** Measurements are optional; returns false only when something entered is invalid. */
  function validateMeasurements(heightCm: number): boolean {
    if (!hasAnyMeasurement(measurements)) return true;
    const result = validate(bodyMeasurementsInputSchema, measurementsToInput(measurements, unit, heightCm));
    if (!result.data) setErrors(localiseErrors(result.errors, unit));
    return Boolean(result.data);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The final step has two submit buttons: start the body scan, or skip to the dashboard.
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const next = submitter?.getAttribute('value') === 'skip' ? '/' : '/scan';
    setFormError(null);
    setErrors({});
    const profile = validateProfile();
    if (!profile) {
      setStep(0);
      return;
    }
    if (step >= 1 && !validateMeasurements(profile.heightCm)) {
      setStep(1);
      return;
    }
    if (!isLast) {
      setStep(step + 1);
      return;
    }

    setSaving(true);
    try {
      // Measurements first: the profile save is what marks onboarding complete.
      if (hasAnyMeasurement(measurements)) {
        await apiFetch('/measurements', {
          method: 'POST',
          body: { ...measurementsToInput(measurements, unit, profile.heightCm), source: 'manual' },
        });
      }
      const res = await apiFetch<ProfileResponse & { user: PublicUser }>('/profile', { method: 'PUT', body: profile });
      setUser(res.user);
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save your profile');
      if (err instanceof ApiError) setErrors(localiseErrors(err.fields, unit));
    } finally {
      setSaving(false);
    }
  }

  if (alreadyOnboarded) return <Navigate to="/" replace />;

  return (
    <div className="fv-auth">
      <Card className="fv-auth__card fv-auth__card--wide">
        <form className="fv-stack" onSubmit={onSubmit} noValidate aria-labelledby="onboarding-title">
          <div className="fv-steps" aria-hidden="true">
            {STEPS.map((s, i) => (
              <div key={s.title} className={`fv-steps__bar${i <= step ? ' fv-steps__bar--done' : ''}`} />
            ))}
          </div>
          <p className="fv-muted fv-eyebrow">
            Step {step + 1} of {STEPS.length}
          </p>
          <div>
            <h1 id="onboarding-title">{current.title}</h1>
            <p className="fv-muted">{current.subtitle}</p>
          </div>
          {formError && <Alert tone="error">{formError}</Alert>}
          {step === 0 && (
            <BasicsFields
              draft={basics}
              errors={errors}
              onChange={(patch) => {
                setBasics((d) => ({ ...d, ...patch }));
                setErrors((e) => clearEditedErrors(e, patch));
              }}
              onUnitChange={onUnitChange}
            />
          )}
          {step === 1 && (
            <MeasurementFields
              draft={measurements}
              unit={unit}
              errors={errors}
              onChange={(patch) => {
                setMeasurements((d) => ({ ...d, ...patch }));
                setErrors((e) => clearEditedErrors(e, patch));
              }}
            />
          )}
          {step === 2 && <ScanGuide />}
          <div className="fv-actions">
            {step > 0 && (
              <Button type="button" variant="secondary" onClick={() => setStep(step - 1)} disabled={saving}>
                Back
              </Button>
            )}
            {isLast ? (
              <>
                <Button type="submit" variant="secondary" disabled={saving} value="skip">
                  Skip scan for now
                </Button>
                <Button type="submit" loading={saving} value="scan">
                  {saving ? 'Saving…' : 'Finish & start body scan'}
                </Button>
              </>
            ) : (
              <Button type="submit">Continue</Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
