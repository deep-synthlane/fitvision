import type { CaptureCheck } from '../engine';

const ICON = { pass: '✓', fail: '✕', skipped: '–' } as const;

export function CheckList({ checks }: { checks: CaptureCheck[] }) {
  return (
    <ul className="fv-checks" aria-label="Photo checks">
      {checks.map((c) => (
        <li key={c.id} className={`fv-check--${c.status}`}>
          <span className="fv-check__icon" aria-hidden="true">
            {ICON[c.status]}
          </span>
          <span>
            {c.label}
            <span className="fv-visually-hidden">: {c.status === 'pass' ? 'passed' : c.status === 'fail' ? 'failed' : 'not checked'}</span>
          </span>
          {c.message && <span className="fv-check__msg">{c.message}</span>}
        </li>
      ))}
    </ul>
  );
}
