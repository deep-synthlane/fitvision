import type { ReactNode } from 'react';

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'mock'; children: ReactNode }) {
  return <span className={`fv-badge${tone === 'mock' ? ' fv-badge--mock' : ''}`}>{children}</span>;
}

/** Required on any UI that shows simulated AI output. */
export function MockDataBadge() {
  return (
    <Badge tone="mock">
      <span aria-hidden="true">⚠︎</span>&nbsp;Mock data
    </Badge>
  );
}
