import { useState } from 'react';
import { parseSizeValue, SIZE_MEASUREMENT_KEYS, SIZE_MEASUREMENT_LABELS, type SizeChart, type SizeMeasurementKey } from '@fitvision/shared';
import { Alert, Button, ChoiceGroup } from '../../design';
import { SizeChartTable } from '../clothing/SizeChartTable';

const RAW_KEY: Record<SizeMeasurementKey, string> = { chestCm: 'chest', waistCm: 'waist', hipsCm: 'hips', shoulderCm: 'shoulder', inseamCm: 'inseam', sleeveCm: 'sleeve' };
const KINDS = ['body', 'garment', 'unknown'] as const;
const KIND_LABELS = { body: 'Body measurements (fits a body of this size)', garment: 'Garment measurements (the item itself)', unknown: 'Not sure' };
const UNITS = ['cm', 'in'] as const;
const UNIT_LABELS = { cm: 'Centimetres', in: 'Inches' };

type Row = { sizeLabel: string } & Record<SizeMeasurementKey, string>;
const emptyRow = (): Row => ({ sizeLabel: '', chestCm: '', waistCm: '', hipsCm: '', shoulderCm: '', inseamCm: '', sleeveCm: '' });

function rowsFromChart(chart: SizeChart | null): Row[] {
  if (!chart) return [emptyRow(), emptyRow(), emptyRow()];
  return chart.rows.map((r) => {
    const row = emptyRow();
    row.sizeLabel = r.sizeLabel;
    for (const k of SIZE_MEASUREMENT_KEYS) row[k] = r.raw[RAW_KEY[k]]?.raw ?? (r[k] === null ? '' : String(r[k]));
    return row;
  });
}

interface Props {
  initial: SizeChart | null;
  onSave: (chart: SizeChart) => Promise<void>;
  onCancel: () => void;
}

/**
 * Manual size chart (for products without a usable chart online). Produces the same chart shape as
 * an import, so the size engine treats it identically. Users review the converted values first.
 */
export function SizeChartEditor({ initial, onSave, onCancel }: Props) {
  const [unit, setUnit] = useState<'cm' | 'in'>(initial?.unit ?? 'cm');
  const [kind, setKind] = useState<SizeChart['kind']>(initial?.kind ?? 'body');
  const [rows, setRows] = useState<Row[]>(() => rowsFromChart(initial));
  const [review, setReview] = useState<SizeChart | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const setCell = (i: number, key: keyof Row, value: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  function build() {
    const problems: string[] = [];
    const out: SizeChart['rows'] = [];
    rows.forEach((r, i) => {
      const filled = SIZE_MEASUREMENT_KEYS.filter((k) => r[k].trim());
      if (!r.sizeLabel.trim() && filled.length === 0) return;
      if (!r.sizeLabel.trim()) problems.push(`Row ${i + 1}: add a size label (e.g. M or 32).`);
      const row: SizeChart['rows'][number] = { sizeLabel: r.sizeLabel.trim(), chestCm: null, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, sleeveCm: null, raw: {} };
      for (const k of filled) {
        const v = parseSizeValue(r[k], unit);
        if (!v) problems.push(`Row ${i + 1}, ${SIZE_MEASUREMENT_LABELS[k]}: “${r[k]}” isn’t a number or range like 86-90.`);
        else {
          row[k] = v.midCm;
          row.raw[RAW_KEY[k]] = { raw: r[k].trim(), minCm: v.minCm, maxCm: v.maxCm };
        }
      }
      out.push(row);
    });
    if (out.length < 2) problems.push('Add at least two sizes.');
    if (new Set(out.map((r) => r.sizeLabel.toLowerCase())).size !== out.length) problems.push('Each size label must be different.');
    if (!out.some((r) => SIZE_MEASUREMENT_KEYS.some((k) => r[k] !== null))) problems.push('Enter at least one measurement.');
    setErrors(problems);
    if (problems.length === 0) setReview({ unit, kind, source: 'user', rows: out });
  }

  async function save() {
    if (!review) return;
    setSaving(true);
    try {
      await onSave(review);
    } finally {
      setSaving(false);
    }
  }

  if (review) {
    return (
      <div className="fv-stack">
        <h3>Review size chart</h3>
        <p className="fv-small">Check the converted values before saving. They’re used for your size recommendation.</p>
        <SizeChartTable chart={review} />
        <div className="fv-actions fv-actions--start">
          <Button onClick={save} loading={saving}>
            Save size chart
          </Button>
          <Button variant="secondary" onClick={() => setReview(null)}>
            Back to editing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fv-stack">
      <p className="fv-small fv-muted">
        Copy the values from the retailer’s size guide. Ranges like <code>86-90</code> and fractions like <code>34 1/2</code> are fine. Leave
        blanks for anything not listed.
      </p>
      <div className="fv-row">
        <ChoiceGroup legend="Units" name="chart-unit" options={UNITS} labels={UNIT_LABELS} value={unit} onChange={setUnit} />
        <ChoiceGroup legend="These measurements are…" name="chart-kind" options={KINDS} labels={KIND_LABELS} value={kind} onChange={setKind} />
      </div>
      {errors.length > 0 && (
        <Alert tone="error">
          <ul className="fv-plain-list">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="fv-table-scroll">
        <table className="fv-table fv-chart-editor">
          <caption className="fv-visually-hidden">Size chart rows</caption>
          <thead>
            <tr>
              <th scope="col">Size</th>
              {SIZE_MEASUREMENT_KEYS.map((k) => (
                <th key={k} scope="col">
                  {SIZE_MEASUREMENT_LABELS[k]}
                </th>
              ))}
              <th scope="col">
                <span className="fv-visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input className="fv-input fv-input--sm" aria-label={`Row ${i + 1} size label`} value={r.sizeLabel} onChange={(e) => setCell(i, 'sizeLabel', e.target.value)} />
                </td>
                {SIZE_MEASUREMENT_KEYS.map((k) => (
                  <td key={k}>
                    <input
                      className="fv-input fv-input--sm"
                      aria-label={`Row ${i + 1} ${SIZE_MEASUREMENT_LABELS[k]} (${unit})`}
                      inputMode="decimal"
                      value={r[k]}
                      onChange={(e) => setCell(i, k, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button type="button" className="fv-btn fv-btn--ghost fv-btn--sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fv-actions fv-actions--start">
        <Button variant="secondary" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          Add size
        </Button>
        <Button onClick={build}>Review</Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
