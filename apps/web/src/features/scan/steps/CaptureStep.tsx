import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ScanView } from '@fitvision/shared';
import { Alert, Badge, Button } from '../../../design';
import type { BodyScanProcessor, CaptureAnalysis, CaptureAssessment } from '../engine';
import { VIEW_INSTRUCTIONS } from '../scanTips';
import { CheckList } from './CheckList';

export interface CapturedPhoto {
  view: ScanView;
  blob: Blob;
  url: string;
  analysis: CaptureAnalysis;
}

interface CaptureStepProps {
  view: ScanView;
  stepLabel: string;
  stream: MediaStream | null;
  mirrored: boolean;
  timerSeconds: number;
  processor: BodyScanProcessor;
  canSwitchCamera: boolean;
  onSwitchCamera: () => void;
  onAccept: (photo: CapturedPhoto) => void;
  onBack: () => void;
  /** Present for optional views. */
  onSkip?: () => void;
}

/** Longest edge of photos we analyse and upload. */
const MAX_EDGE = 1280;

function toCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.9),
  );

/** Dashed outline showing where to stand for each view. */
function PoseGuide({ view }: { view: ScanView }) {
  const facing = view !== 'side';
  return (
    <svg className="fv-viewfinder__guide" viewBox="0 0 60 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <ellipse cx="30" cy="9" rx="5" ry="6" />
      {facing ? (
        <path d="M30 15 L20 18 L13 46 M30 15 L40 18 L47 46 M20 18 L21 50 L24 96 M40 18 L39 50 L36 96 M21 50 L39 50" />
      ) : (
        <path d="M30 15 L27 18 L26 50 L28 96 M30 15 L34 19 L35 50 L32 96 M30 20 L31 46" />
      )}
    </svg>
  );
}

type Phase = { kind: 'live' } | { kind: 'countdown'; remaining: number } | { kind: 'checking' } | { kind: 'result'; blob: Blob; url: string; assessment: CaptureAssessment };

export function CaptureStep(props: CaptureStepProps) {
  const { view, stepLabel, stream, mirrored, timerSeconds, processor, onAccept, onSkip, onBack } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'live' });
  const [error, setError] = useState<string | null>(null);
  /** Viewfinder follows the camera's shape (portrait on phones, landscape on laptops). */
  const [aspect, setAspect] = useState<number | null>(null);
  const instructions = VIEW_INSTRUCTIONS[view];

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {
      // Autoplay can be refused until the user interacts; the capture button still works.
    });
  }, [stream, phase.kind]);

  useEffect(() => {
    if (phase.kind !== 'countdown') return;
    if (phase.remaining === 0) {
      void captureFromVideo();
      return;
    }
    const t = setTimeout(() => setPhase({ kind: 'countdown', remaining: phase.remaining - 1 }), 1000);
    return () => clearTimeout(t);
    // captureFromVideo only reads refs and props that don't change mid-countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function check(canvas: HTMLCanvasElement) {
    setPhase({ kind: 'checking' });
    setError(null);
    try {
      const [assessment, blob] = await Promise.all([processor.assess(view, canvas), toJpeg(canvas)]);
      setAspect(canvas.width / canvas.height);
      setPhase({ kind: 'result', blob, url: URL.createObjectURL(blob), assessment });
    } catch (err) {
      console.error(err);
      setError('We couldn’t analyse the photo. Check your connection (body detection is downloaded the first time) and try again.');
      setPhase({ kind: 'live' });
    }
  }

  async function captureFromVideo() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setError('The camera isn’t ready yet. Wait a moment and try again.');
      setPhase({ kind: 'live' });
      return;
    }
    await check(toCanvas(video, video.videoWidth, video.videoHeight));
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = toCanvas(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      await check(canvas);
    } catch {
      setError('That file couldn’t be opened as a photo. Use a JPEG, PNG or WebP image.');
    }
  }

  function retake() {
    if (phase.kind === 'result') URL.revokeObjectURL(phase.url);
    setPhase({ kind: 'live' });
  }

  function accept() {
    if (phase.kind !== 'result' || !phase.assessment.analysis) return;
    onAccept({ view, blob: phase.blob, url: phase.url, analysis: phase.assessment.analysis });
  }

  const showVideo = Boolean(stream) && phase.kind !== 'result';
  const busy = phase.kind === 'countdown' || phase.kind === 'checking';

  return (
    <div className="fv-stack">
      <div className="fv-scan__head">
        <div>
          <p className="fv-muted fv-eyebrow">{stepLabel}</p>
          <h1>
            {instructions.title} photo {onSkip && <Badge>Optional</Badge>}
          </h1>
        </div>
      </div>
      <p className="fv-muted fv-small">{instructions.how}</p>

      {error && <Alert tone="error">{error}</Alert>}

      <div
        className={`fv-viewfinder${mirrored && showVideo ? ' fv-viewfinder--mirrored' : ''}`}
        style={aspect ? { aspectRatio: String(aspect) } : undefined}
      >
        {showVideo && (
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Camera preview"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
            }}
          />
        )}
        {phase.kind === 'result' && <img src={phase.url} alt={`Captured ${view} photo`} />}
        {!stream && phase.kind !== 'result' && (
          <div className="fv-viewfinder__status fv-viewfinder__status--full">
            Upload a {view} photo to continue.
          </div>
        )}
        {phase.kind !== 'result' && <PoseGuide view={view} />}
        {phase.kind === 'countdown' && (
          <div className="fv-viewfinder__countdown" aria-live="assertive">
            {phase.remaining}
          </div>
        )}
        {phase.kind === 'checking' && (
          <div className="fv-viewfinder__status" role="status">
            Checking photo…
          </div>
        )}
      </div>

      {phase.kind === 'result' ? (
        <>
          <CheckList checks={phase.assessment.checks} />
          {phase.assessment.ok ? (
            <Alert>Looks good — this photo can be used.</Alert>
          ) : (
            <Alert tone="warning">This photo can’t be used yet. Fix the issues above and retake it.</Alert>
          )}
          <div className="fv-actions">
            <Button variant="secondary" onClick={retake}>
              Retake
            </Button>
            <Button onClick={accept} disabled={!phase.assessment.ok}>
              Use this photo
            </Button>
          </div>
        </>
      ) : (
        <div className="fv-actions fv-actions--wrap">
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
          {onSkip && (
            <Button variant="ghost" onClick={onSkip} disabled={busy}>
              Skip
            </Button>
          )}
          {props.canSwitchCamera && stream && (
            <Button variant="secondary" onClick={props.onSwitchCamera} disabled={busy}>
              Switch camera
            </Button>
          )}
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload photo
          </Button>
          {stream && (
            <Button
              onClick={() => (timerSeconds > 0 ? setPhase({ kind: 'countdown', remaining: timerSeconds }) : void captureFromVideo())}
              disabled={busy}
            >
              {phase.kind === 'countdown' ? 'Get in position…' : timerSeconds > 0 ? `Capture (${timerSeconds}s timer)` : 'Capture'}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="fv-visually-hidden"
            tabIndex={-1}
            aria-label={`Upload ${view} photo`}
            onChange={onFile}
          />
        </div>
      )}
    </div>
  );
}
