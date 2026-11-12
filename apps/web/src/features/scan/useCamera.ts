import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraError = 'unsupported' | 'insecure' | 'denied' | 'notFound' | 'inUse' | 'unknown';
export type Facing = 'user' | 'environment';

export const CAMERA_ERROR_MESSAGES: Record<CameraError, string> = {
  unsupported: 'This browser can’t access a camera. Try a recent version of Chrome, Safari, Edge or Firefox, or upload photos instead.',
  insecure: 'Camera access needs a secure (https) connection. Open FitVision over https, or upload photos instead.',
  denied:
    'Camera access was blocked. Allow camera access for this site in your browser’s address bar or settings, then try again — or upload photos instead.',
  notFound: 'No camera was found on this device. Connect a camera or upload photos instead.',
  inUse: 'Your camera is being used by another app. Close it and try again, or upload photos instead.',
  unknown: 'We couldn’t start the camera. Try again, or upload photos instead.',
};

function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notFound';
  if (name === 'NotReadableError' || name === 'AbortError') return 'inUse';
  return 'unknown';
}

/** Owns the camera stream: request, switch front/back camera, and always release it on unmount. */
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<CameraError | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [facing, setFacing] = useState<Facing>('user');
  const [canSwitch, setCanSwitch] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(
    async (mode: Facing = 'user') => {
      setError(null);
      if (typeof window !== 'undefined' && window.isSecureContext === false) return setError('insecure');
      if (!navigator.mediaDevices?.getUserMedia) return setError('unsupported');
      setRequesting(true);
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = next;
        setStream(next);
        setFacing(mode);
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      } catch (err) {
        setError(toCameraError(err));
      } finally {
        setRequesting(false);
      }
    },
    [],
  );

  useEffect(() => stop, [stop]);

  return { stream, error, requesting, facing, canSwitch, start, stop };
}
