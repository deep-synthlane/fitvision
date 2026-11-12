import { BODY_SCAN_DISCLAIMER } from '@fitvision/shared';
import { SCAN_TIPS as TIPS } from '../scan/scanTips';

const CAPTURES = [
  { view: 'Front', note: 'Arms slightly away from your body' },
  { view: 'Side', note: 'Turn 90°, arms relaxed' },
  { view: 'Back', note: 'Optional' },
];

/** Onboarding step 3: explains the body scan before the user starts it. */
export function ScanGuide() {
  return (
    <div className="fv-stack">
      <ul className="fv-checklist">
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <div className="fv-capture-grid">
        {CAPTURES.map((c) => (
          <div key={c.view} className="fv-capture">
            <svg className="fv-capture__figure" viewBox="0 0 40 80" aria-hidden="true">
              <circle cx="20" cy="9" r="7" />
              <path d="M8 22h24l-3 26h-4l-1 30h-8l-1-30h-4z" />
            </svg>
            <strong>{c.view}</strong>
            <span className="fv-muted">{c.note}</span>
          </div>
        ))}
      </div>
      <p className="fv-muted fv-small">
        You’ll need about two minutes. Each photo is checked before it’s used, and you’ll review every measurement before
        it’s saved. {BODY_SCAN_DISCLAIMER}
      </p>
    </div>
  );
}
