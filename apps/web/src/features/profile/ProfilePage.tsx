import { useEffect, useState, type FormEvent } from 'react';
import {
  bodyMeasurementsInputSchema,
  BODY_SCAN_DISCLAIMER,
  type BodyMeasurements,
  type CurrentMeasurementsResponse,
  type MeasurementUnit,
  type Profile,
  type ProfileResponse,
  type PublicUser,
} from '@fitvision/shared';
import { Alert, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { validate } from '../../lib/forms';
import { useAuth } from '../../lib/useAuth';
import { BasicsFields } from './BasicsFields';
import {
  basicsFromProfile,
  clearEditedErrors,
  emptyMeasurements,
  localiseErrors,
  measurementsFromApi,
  measurementsToInput,
  switchUnits,
  validateBasics,
  type BasicsDraft,
  type MeasurementsDraft,
} from './drafts';
import { MeasurementFields } from './MeasurementFields';
import { ScanSummaryCard } from '../scan/ScanSummaryCard';

type Status = { tone: 'info' | 'error'; text: string } | null;

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [basics, setBasics] = useState<BasicsDraft | null>(null);
  const [measurements, setMeasurements] = useState<MeasurementsDraft>(emptyMeasurements);
  const [measurementSource, setMeasurementSource] = useState<BodyMeasurements['source'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [basicsErrors, setBasicsErrors] = useState<Record<string, string>>({});
  const [basicsStatus, setBasicsStatus] = useState<Status>(null);
  const [savingBasics, setSavingBasics] = useState(false);

  const [measureErrors, setMeasureErrors] = useState<Record<string, string>>({});
  const [measureStatus, setMeasureStatus] = useState<Status>(null);
  const [savingMeasures, setSavingMeasures] = useState(false);

  // Captured once so later name changes (from our own save) don't trigger a reload.
  const [initialName] = useState(user?.name ?? '');
  useEffect(() => {
    Promise.all([
      apiFetch<ProfileResponse>('/profile'),
      apiFetch<CurrentMeasurementsResponse>('/measurements/current'),
    ])
      .then(([p, m]) => {
        if (!p.profile) return;
        setProfile(p.profile);
        setBasics(basicsFromProfile(p.profile, initialName));
        setMeasurements(measurementsFromApi(m.measurements, p.profile.measurementUnit));
        setMeasurementSource(m.measurements?.source ?? null);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : 'Could not load your profile'));
  }, [initialName]);

  if (loadError) return <Alert tone="error">{loadError}</Alert>;
  if (!basics || !profile) return <p className="fv-muted">Loading profile…</p>;

  const unit = basics.measurementUnit;

  function onUnitChange(to: MeasurementUnit) {
    const next = switchUnits(basics!, measurements, to);
    setBasics(next.basics);
    setMeasurements(next.measurements);
  }

  async function saveBasics(e: FormEvent) {
    e.preventDefault();
    setBasicsStatus(null);
    const result = validateBasics(basics!);
    if (!result.data) {
      setBasicsErrors(result.errors);
      return;
    }
    setBasicsErrors({});
    setSavingBasics(true);
    try {
      const res = await apiFetch<ProfileResponse & { user: PublicUser }>('/profile', { method: 'PUT', body: result.data });
      setUser(res.user);
      if (res.profile) setProfile(res.profile);
      setBasicsStatus({ tone: 'info', text: 'Profile saved.' });
    } catch (err) {
      if (err instanceof ApiError) setBasicsErrors(localiseErrors(err.fields, unit));
      setBasicsStatus({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not save your profile' });
    } finally {
      setSavingBasics(false);
    }
  }

  async function saveMeasurements(e: FormEvent) {
    e.preventDefault();
    setMeasureStatus(null);
    const result = validate(bodyMeasurementsInputSchema, measurementsToInput(measurements, unit, profile!.heightCm));
    if (!result.data) {
      setMeasureErrors(localiseErrors(result.errors, unit));
      if (result.errors._) setMeasureStatus({ tone: 'error', text: result.errors._ });
      return;
    }
    setMeasureErrors({});
    setSavingMeasures(true);
    try {
      const res = await apiFetch<CurrentMeasurementsResponse>('/measurements', { method: 'POST', body: result.data });
      setMeasurements(measurementsFromApi(res.measurements, unit));
      setMeasurementSource(res.measurements?.source ?? null);
      setMeasureStatus({ tone: 'info', text: 'Measurements saved.' });
    } catch (err) {
      if (err instanceof ApiError) setMeasureErrors(localiseErrors(err.fields, unit));
      setMeasureStatus({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not save measurements' });
    } finally {
      setSavingMeasures(false);
    }
  }

  return (
    <div className="fv-page fv-page--narrow">
      <header>
        <h1>Your profile</h1>
        <p className="fv-muted">Used to recommend sizes and build your avatar. Values are stored in metric.</p>
      </header>

      <Card>
        <form className="fv-stack" onSubmit={saveBasics} noValidate aria-labelledby="basics-title">
          <h2 id="basics-title">Profile</h2>
          {basicsStatus && <Alert tone={basicsStatus.tone}>{basicsStatus.text}</Alert>}
          <BasicsFields
            draft={basics}
            errors={basicsErrors}
            onChange={(patch) => {
              setBasics((d) => d && { ...d, ...patch });
              setBasicsErrors((e) => clearEditedErrors(e, patch));
            }}
            onUnitChange={onUnitChange}
          />
          <div>
            <Button type="submit" loading={savingBasics}>
              {savingBasics ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <form className="fv-stack" onSubmit={saveMeasurements} noValidate aria-labelledby="measure-title">
          <div>
            <h2 id="measure-title">Body measurements</h2>
            <p className="fv-muted fv-small">Measure over light clothing with a soft tape. Leave blank anything you don’t know.</p>
            {measurementSource && measurementSource !== 'manual' && (
              <p className="fv-small">
                Current values come from a body scan{measurementSource === 'corrected' ? ' (with your corrections)' : ''}.{' '}
                {BODY_SCAN_DISCLAIMER}
              </p>
            )}
          </div>
          {measureStatus && <Alert tone={measureStatus.tone}>{measureStatus.text}</Alert>}
          <MeasurementFields
            draft={measurements}
            unit={unit}
            errors={measureErrors}
            onChange={(patch) => {
              setMeasurements((d) => ({ ...d, ...patch }));
              setMeasureErrors((e) => clearEditedErrors(e, patch));
            }}
          />
          <div>
            <Button type="submit" loading={savingMeasures}>
              {savingMeasures ? 'Saving…' : 'Save measurements'}
            </Button>
          </div>
        </form>
      </Card>

      <ScanSummaryCard />
    </div>
  );
}
