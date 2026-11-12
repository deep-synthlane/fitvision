import { Link } from 'react-router';
import { BODY_MEASUREMENTS, BODY_SCAN_DISCLAIMER, formatHeight, formatLength, type BodyMeasurements, type MeasurementUnit } from '@fitvision/shared';
import { Alert } from '../../../design';

export function CompleteStep({ measurements, unit }: { measurements: BodyMeasurements; unit: MeasurementUnit }) {
  return (
    <div className="fv-stack">
      <div>
        <p className="fv-muted fv-eyebrow">Body scan</p>
        <h1>Scan complete</h1>
      </div>
      <p>
        Your measurements were saved as{' '}
        <strong>{measurements.source === 'corrected' ? 'corrected scan measurements' : 'body-scan measurements'}</strong>.
      </p>
      <dl className="fv-body-summary">
        {BODY_MEASUREMENTS.map(({ key, label }) => {
          const v = measurements[key];
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{v == null ? <span className="fv-muted">—</span> : key === 'heightCm' ? formatHeight(v, unit) : formatLength(v, unit)}</dd>
            </div>
          );
        })}
      </dl>
      <Alert tone="warning">{BODY_SCAN_DISCLAIMER}</Alert>
      <div className="fv-actions fv-actions--wrap">
        <Link className="fv-btn fv-btn--ghost" to="/profile">
          Edit in profile
        </Link>
        <Link className="fv-btn fv-btn--secondary" to="/">
          Go to dashboard
        </Link>
        <Link className="fv-btn fv-btn--primary" to="/avatar">
          Create my avatar
        </Link>
      </div>
    </div>
  );
}
