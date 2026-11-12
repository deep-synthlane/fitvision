import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '../../design';
import { CAMERA_ERROR_MESSAGES, useCamera } from '../scan/useCamera';
import { toCanvas } from './photoUtils';

/** Minimal camera capture with a self-timer, for taking a try-on photo. */
export function CameraCapture({ onCapture, onCancel }: { onCapture: (canvas: HTMLCanvasElement) => void; onCancel: () => void }) {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { start } = camera;

  useEffect(() => {
    void start('user');
  }, [start]);

  useEffect(() => {
    if (videoRef.current && camera.stream) {
      videoRef.current.srcObject = camera.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [camera.stream]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      const v = videoRef.current;
      if (v && v.videoWidth) onCapture(toCanvas(v, v.videoWidth, v.videoHeight));
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onCapture]);

  return (
    <div className="fv-stack">
      {camera.error && <Alert tone="error">{CAMERA_ERROR_MESSAGES[camera.error]}</Alert>}
      {camera.stream && (
        <div className="fv-viewfinder fv-viewfinder--mirrored fv-tryon-camera">
          <video ref={videoRef} playsInline muted aria-label="Camera preview" />
          {countdown !== null && (
            <div className="fv-viewfinder__countdown" aria-live="assertive">
              {countdown}
            </div>
          )}
        </div>
      )}
      <div className="fv-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => setCountdown(5)} disabled={!camera.stream || countdown !== null}>
          {countdown !== null ? 'Get in position…' : 'Take photo (5s timer)'}
        </Button>
      </div>
    </div>
  );
}
