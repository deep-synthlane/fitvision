import { useState, type FormEvent } from 'react';
import { FIT_PREFERENCE_LABELS, FIT_PREFERENCES, FIT_RATING_LABELS, FIT_RATINGS, type FitRating, type SizeFeedbackInput } from '@fitvision/shared';
import { Alert, Button, ChoiceGroup, TextField } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';

/** "How did this size fit?" — optional; used offline to calibrate future engine versions. */
export function SizeFeedbackForm({ productId, recommendationId, sizes }: { productId: string; recommendationId: string | null; sizes: string[] }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<FitRating | undefined>();
  const [purchased, setPurchased] = useState('');
  const [returned, setReturned] = useState<'yes' | 'no' | undefined>();
  const [reason, setReason] = useState('');
  const [preference, setPreference] = useState<(typeof FIT_PREFERENCES)[number] | undefined>();
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError('Choose how it fitted.');
      return;
    }
    setState('saving');
    setError(null);
    const body: SizeFeedbackInput = {
      recommendationId,
      fitRating: rating,
      purchasedSize: purchased.trim() || null,
      returned: returned === undefined ? null : returned === 'yes',
      returnReason: returned === 'yes' ? reason.trim() || null : null,
      fitPreference: preference ?? null,
    };
    try {
      await apiFetch(`/products/${productId}/size-feedback`, { method: 'POST', body });
      setState('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your feedback');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="fv-small">
        Thanks — your feedback helps us improve future size recommendations. It doesn’t change this recommendation.
      </p>
    );
  }
  if (!open) {
    return (
      <div>
        <Button variant="secondary" className="fv-btn--sm" onClick={() => setOpen(true)}>
          Bought it? Tell us how it fitted
        </Button>
      </div>
    );
  }
  return (
    <form className="fv-stack fv-feedback" onSubmit={submit} noValidate aria-labelledby={`fb-${productId}`}>
      <h3 id={`fb-${productId}`}>How did this size fit?</h3>
      {error && <Alert tone="error">{error}</Alert>}
      <ChoiceGroup legend="Fit" name="fit-rating" options={FIT_RATINGS} labels={FIT_RATING_LABELS} value={rating} onChange={setRating} />
      <TextField
        label="Size you bought (optional)"
        value={purchased}
        onChange={(e) => setPurchased(e.target.value)}
        list={`sizes-${productId}`}
        maxLength={40}
      />
      <datalist id={`sizes-${productId}`}>
        {sizes.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <ChoiceGroup legend="Did you return it? (optional)" name="returned" options={['no', 'yes'] as const} labels={{ no: 'Kept it', yes: 'Returned it' }} value={returned} onChange={setReturned} />
      {returned === 'yes' && <TextField label="Why did you return it? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
      <ChoiceGroup legend="Your fit preference (optional)" name="fit-preference" options={FIT_PREFERENCES} labels={FIT_PREFERENCE_LABELS} value={preference} onChange={setPreference} />
      <p className="fv-muted fv-small">Used anonymously in aggregate to calibrate future versions — never to change sizes automatically.</p>
      <div className="fv-actions fv-actions--start">
        <Button type="submit" loading={state === 'saving'}>
          Send feedback
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
