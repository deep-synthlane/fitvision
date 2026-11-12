/**
 * Minimal in-process metrics registry rendered in Prometheus text format at GET /api/metrics.
 * Labels must be low-cardinality (no user ids, URLs or measurements).
 */
type Labels = Record<string, string>;

const key = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, '_')}"`)
    .join(',');

class Counter {
  readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1) {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) lines.push(`${this.name}${k ? `{${k}}` : ''} ${v}`);
    return lines.join('\n');
  }
}

class Histogram {
  readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[],
  ) {}
  observe(labels: Labels, value: number) {
    const k = key(labels);
    const s = this.series.get(k) ?? { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i]!++;
    });
    s.sum += value;
    s.count++;
    this.series.set(k, s);
  }
  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : '';
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket{${sep}le="${b}"} ${s.counts[i]}`));
      lines.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`, `${this.name}_sum${k ? `{${k}}` : ''} ${s.sum}`, `${this.name}_count${k ? `{${k}}` : ''} ${s.count}`);
    }
    return lines.join('\n');
  }
}

export class Metrics {
  readonly httpRequests = new Counter('fitvision_http_requests_total', 'HTTP requests by route and status class');
  readonly httpDuration = new Histogram('fitvision_http_request_duration_seconds', 'HTTP request duration', [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
  readonly productImports = new Counter('fitvision_product_imports_total', 'Product URL imports by result and failure reason');
  readonly tryOnJobs = new Counter('fitvision_tryon_jobs_total', 'Try-on jobs finished, by provider, source and status/error code');
  readonly tryOnProviderLatency = new Histogram('fitvision_tryon_provider_seconds', 'Try-on time from start to provider result', [5, 10, 20, 30, 60, 120, 180, 300]);
  readonly tryOnProviderErrors = new Counter('fitvision_tryon_provider_errors_total', 'Normalised provider errors (including retried ones)');
  readonly sizeRecommendations = new Counter('fitvision_size_recommendations_total', 'Size recommendations by confidence and chart source');
  readonly avatarJobs = new Counter('fitvision_avatar_jobs_total', 'Avatar generations finished, by status');

  render(): string {
    return [this.httpRequests, this.httpDuration, this.productImports, this.tryOnJobs, this.tryOnProviderLatency, this.tryOnProviderErrors, this.sizeRecommendations, this.avatarJobs]
      .map((m) => m.render())
      .join('\n\n')
      .concat('\n');
  }
}
