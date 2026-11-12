import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  SCAN_VIEWS,
  type BodyMeasurements,
  type CurrentMeasurementsResponse,
  type MeasurementValues,
  type Profile,
  type ProfileResponse,
  type ScanEstimates,
  type ScanResponse,
  type ScanSubmission,
  type ScanView,
} from '@fitvision/shared';
import { Alert, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { createBodyScanProcessor, type BodyScanProcessor } from './engine';
import { CaptureStep, type CapturedPhoto } from './steps/CaptureStep';
import { CompleteStep } from './steps/CompleteStep';
import { InstructionsStep } from './steps/InstructionsStep';
import { PermissionStep } from './steps/PermissionStep';
import { ProcessingStep } from './steps/ProcessingStep';
import { ReviewStep } from './steps/ReviewStep';
import { useCamera } from './useCamera';
import './scan.css';

type Step =
  | { kind: 'permission' }
  | { kind: 'instructions' }
  | { kind: 'capture'; view: ScanView }
  | { kind: 'processing' }
  | { kind: 'review'; result: ScanEstimates }
  | { kind: 'complete'; measurements: BodyMeasurements };

interface ScanPageProps {
  /** Injected in tests; defaults to the MediaPipe implementation. */
  createProcessor?: () => BodyScanProcessor;
}

/**
 * Camera permission → instructions → front → side → optional back (each validated on capture)
 * → estimation → review & correct → save → complete.
 */
export function ScanPage({ createProcessor = createBodyScanProcessor }: ScanPageProps) {
  const navigate = useNavigate();
  const camera = useCamera();
  const processor = useMemo(createProcessor, [createProcessor]);
  const [step, setStep] = useState<Step>({ kind: 'permission' });
  const [timerSeconds, setTimerSeconds] = useState(5);
  const [captures, setCaptures] = useState<Partial<Record<ScanView, CapturedPhoto>>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [previous, setPrevious] = useState<BodyMeasurements | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<ProfileResponse>('/profile'), apiFetch<CurrentMeasurementsResponse>('/measurements/current')])
      .then(([p, m]) => {
        setProfile(p.profile);
        setPrevious(m.measurements);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : 'Could not load your profile'));
  }, []);

  useEffect(() => () => processor.close(), [processor]);

  // Release photo previews when leaving the page.
  const capturesRef = useRef(captures);
  capturesRef.current = captures;
  useEffect(() => () => Object.values(capturesRef.current).forEach((c) => c && URL.revokeObjectURL(c.url)), []);

  function startInstructions() {
    apiFetch('/analytics/events', { method: 'POST', body: { name: 'scan_started' } }).catch(() => {});
    // Start downloading the pose model while the user reads the instructions.
    processor.load().catch(() => {
      // Surfaced on capture, where the user can retry.
    });
    setStep({ kind: 'instructions' });
  }

  async function allowCamera() {
    await camera.start('user');
  }
  useEffect(() => {
    if (camera.stream && step.kind === 'permission') startInstructions();
    // startInstructions only touches stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.stream, step.kind]);

  function accept(photo: CapturedPhoto) {
    setCaptures((c) => {
      const old = c[photo.view];
      if (old && old.url !== photo.url) URL.revokeObjectURL(old.url);
      return { ...c, [photo.view]: photo };
    });
    const next = SCAN_VIEWS[SCAN_VIEWS.indexOf(photo.view) + 1];
    if (next) setStep({ kind: 'capture', view: next });
    else finishCapture();
  }

  function finishCapture() {
    camera.stop();
    setStep({ kind: 'processing' });
  }

  function skipBack() {
    setCaptures(({ back, ...rest }) => {
      if (back) URL.revokeObjectURL(back.url);
      return rest;
    });
    finishCapture();
  }

  function retake() {
    setCaptures((c) => {
      Object.values(c).forEach((p) => p && URL.revokeObjectURL(p.url));
      return {};
    });
    setSaveError(null);
    if (camera.error === null) void camera.start(camera.facing);
    setStep({ kind: 'capture', view: 'front' });
  }

  const runEstimate = useCallback(() => {
    const { front, side, back } = captures;
    if (!front || !side || !profile) throw new Error('Front and side photos and a profile are required');
    return processor.estimate({ front: front.analysis, side: side.analysis, back: back?.analysis }, profile.heightCm);
  }, [captures, processor, profile]);

  const onEstimated = useCallback((result: ScanEstimates) => setStep({ kind: 'review', result }), []);

  async function save(result: ScanEstimates, measurements: MeasurementValues) {
    setSaving(true);
    setSaveError(null);
    const form = new FormData();
    for (const view of SCAN_VIEWS) {
      const photo = captures[view];
      if (photo) form.append(view, photo.blob, `${view}.jpg`);
    }
    const submission: ScanSubmission = { scan: result, measurements };
    form.append('data', JSON.stringify(submission));
    try {
      const res = await apiFetch<ScanResponse>('/scans', { method: 'POST', body: form });
      setStep({ kind: 'complete', measurements: res.measurements! });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save your scan. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <Alert tone="error">{loadError}</Alert>;
  if (!profile) return <p className="fv-muted">Loading…</p>;

  const viewIndex = step.kind === 'capture' ? SCAN_VIEWS.indexOf(step.view) : 0;
  const photoCount = Object.keys(captures).length;

  return (
    <div className="fv-page fv-scan">
      <Card>
        {step.kind === 'permission' && (
          <PermissionStep
            error={camera.error}
            requesting={camera.requesting}
            onAllow={allowCamera}
            onUploadInstead={startInstructions}
            onCancel={() => navigate('/')}
          />
        )}
        {step.kind === 'instructions' && (
          <InstructionsStep
            timerSeconds={timerSeconds}
            onTimerChange={setTimerSeconds}
            onStart={() => setStep({ kind: 'capture', view: 'front' })}
            onBack={() => {
              camera.stop();
              setStep({ kind: 'permission' });
            }}
          />
        )}
        {step.kind === 'capture' && (
          <CaptureStep
            key={step.view}
            view={step.view}
            stepLabel={`Photo ${viewIndex + 1} of ${SCAN_VIEWS.length}`}
            stream={camera.stream}
            mirrored={camera.facing === 'user'}
            timerSeconds={camera.stream ? timerSeconds : 0}
            processor={processor}
            canSwitchCamera={camera.canSwitch}
            onSwitchCamera={() => void camera.start(camera.facing === 'user' ? 'environment' : 'user')}
            onAccept={accept}
            onBack={() => setStep(viewIndex === 0 ? { kind: 'instructions' } : { kind: 'capture', view: SCAN_VIEWS[viewIndex - 1]! })}
            onSkip={step.view === 'back' ? skipBack : undefined}
          />
        )}
        {step.kind === 'processing' && (
          <ProcessingStep photoCount={photoCount} run={runEstimate} onDone={onEstimated} onRetake={retake} />
        )}
        {step.kind === 'review' && (
          <ReviewStep
            result={step.result}
            unit={profile.measurementUnit}
            heightCm={profile.heightCm}
            previous={previous}
            saving={saving}
            saveError={saveError}
            onSave={(values) => void save(step.result, values)}
            onRetake={retake}
          />
        )}
        {step.kind === 'complete' && <CompleteStep measurements={step.measurements} unit={profile.measurementUnit} />}
      </Card>
    </div>
  );
}
