import { useEffect, useState } from 'react';
import type { ScanEstimates } from '@fitvision/shared';
import { Alert, Button } from '../../../design';

interface ProcessingStepProps {
  photoCount: number;
  run: () => ScanEstimates;
  onDone: (result: ScanEstimates) => void;
  onRetake: () => void;
}

/**
 * Quality validation and pose detection already ran on each photo as it was captured;
 * this step runs measurement estimation on the accepted photos.
 */
export function ProcessingStep({ photoCount, run, onDone, onRetake }: ProcessingStepProps) {
  const [error, setError] = useState(false);

  useEffect(() => {
    // Let the progress screen paint before the synchronous estimation runs.
    const t = setTimeout(() => {
      try {
        onDone(run());
      } catch (err) {
        console.error(err);
        setError(true);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [run, onDone]);

  return (
    <div className="fv-stack" aria-busy={!error}>
      <div>
        <p className="fv-muted fv-eyebrow">Body scan</p>
        <h1>Processing your scan</h1>
      </div>
      <ul className="fv-checks">
        <li className="fv-check--pass">
          <span className="fv-check__icon" aria-hidden="true">✓</span>
          <span>Image quality validated ({photoCount} photos)</span>
        </li>
        <li className="fv-check--pass">
          <span className="fv-check__icon" aria-hidden="true">✓</span>
          <span>Body and pose detected</span>
        </li>
        <li className={error ? 'fv-check--fail' : 'fv-check--skipped'}>
          <span className="fv-check__icon" aria-hidden="true">{error ? '✕' : '…'}</span>
          <span>{error ? 'Measurement estimation failed' : 'Estimating measurements…'}</span>
        </li>
      </ul>
      {error && (
        <>
          <Alert tone="error">Something went wrong while estimating your measurements. Please retake the photos.</Alert>
          <div className="fv-actions">
            <Button onClick={onRetake}>Retake photos</Button>
          </div>
        </>
      )}
    </div>
  );
}
