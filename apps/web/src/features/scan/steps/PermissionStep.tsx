import { Alert, Button } from '../../../design';
import { CAMERA_ERROR_MESSAGES, type CameraError } from '../useCamera';

interface PermissionStepProps {
  error: CameraError | null;
  requesting: boolean;
  onAllow: () => void;
  onUploadInstead: () => void;
  onCancel: () => void;
}

export function PermissionStep({ error, requesting, onAllow, onUploadInstead, onCancel }: PermissionStepProps) {
  return (
    <div className="fv-stack">
      <div>
        <p className="fv-muted fv-eyebrow">Body scan</p>
        <h1>Allow camera access</h1>
      </div>
      <p className="fv-muted">
        FitVision uses your camera to take a front photo, a side photo and an optional back photo. The photos are analysed in
        your browser to estimate your measurements. When you save, they’re stored privately in your account — only you can
        view them, and you can delete them at any time.
      </p>
      {error && <Alert tone="error">{CAMERA_ERROR_MESSAGES[error]}</Alert>}
      <div className="fv-actions fv-actions--wrap">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={onUploadInstead}>
          Upload photos instead
        </Button>
        <Button onClick={onAllow} loading={requesting}>
          {requesting ? 'Waiting for permission…' : error ? 'Try again' : 'Allow camera'}
        </Button>
      </div>
    </div>
  );
}
