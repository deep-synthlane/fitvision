import { SCAN_VIEWS } from '@fitvision/shared';
import { Button, ChoiceGroup } from '../../../design';
import { SCAN_TIPS, VIEW_INSTRUCTIONS } from '../scanTips';

const TIMER_OPTIONS = ['0', '5', '10'] as const;
const TIMER_LABELS = { '0': 'No timer', '5': '5 seconds', '10': '10 seconds' };

interface InstructionsStepProps {
  timerSeconds: number;
  onTimerChange: (seconds: number) => void;
  onStart: () => void;
  onBack: () => void;
}

export function InstructionsStep({ timerSeconds, onTimerChange, onStart, onBack }: InstructionsStepProps) {
  return (
    <div className="fv-stack">
      <div>
        <p className="fv-muted fv-eyebrow">Body scan</p>
        <h1>Before you start</h1>
      </div>
      <ul className="fv-checklist">
        {SCAN_TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <ol className="fv-steps-list">
        {SCAN_VIEWS.map((v, i) => (
          <li key={v}>
            <strong>
              {i + 1}. {VIEW_INSTRUCTIONS[v].title}
            </strong>{' '}
            <span className="fv-muted">— {VIEW_INSTRUCTIONS[v].how}</span>
          </li>
        ))}
      </ol>
      <ChoiceGroup
        legend="Self-timer (lets you step back into position)"
        name="timer"
        options={TIMER_OPTIONS}
        labels={TIMER_LABELS}
        value={String(timerSeconds) as (typeof TIMER_OPTIONS)[number]}
        onChange={(v) => onTimerChange(Number(v))}
      />
      <p className="fv-muted fv-small">Each photo is checked before it’s accepted. You can retake any photo.</p>
      <div className="fv-actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onStart}>Start with front photo</Button>
      </div>
    </div>
  );
}
