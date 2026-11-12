import { SIZE_MEASUREMENT_KEYS, SIZE_MEASUREMENT_LABELS, type SizeChart } from '@fitvision/shared';

const KIND_LABEL: Record<SizeChart['kind'], string> = {
  body: 'Body measurements (to fit)',
  garment: 'Garment measurements',
  unknown: 'Measurement type not stated',
};

/** Size chart in cm (range midpoints), with the original values in each cell's tooltip. */
export function SizeChartTable({ chart, onRemoveRow }: { chart: SizeChart; onRemoveRow?: (index: number) => void }) {
  const raw: Record<string, string> = { chestCm: 'chest', waistCm: 'waist', hipsCm: 'hips', shoulderCm: 'shoulder', inseamCm: 'inseam', sleeveCm: 'sleeve' };
  const keys = SIZE_MEASUREMENT_KEYS.filter((k) => chart.rows.some((r) => r[k] !== null));
  return (
    <div className="fv-stack">
      <p className="fv-muted fv-small">
        {KIND_LABEL[chart.kind]} · shown in cm{chart.unit === 'in' ? ' (converted from inches)' : ''}. Ranges show their midpoint; hover
        a value to see the original.
      </p>
      <div className="fv-table-scroll">
        <table className="fv-table">
          <thead>
            <tr>
              <th scope="col">Size</th>
              {keys.map((k) => (
                <th key={k} scope="col">
                  {SIZE_MEASUREMENT_LABELS[k]}
                </th>
              ))}
              {onRemoveRow && <th scope="col" className="fv-visually-hidden">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, i) => (
              <tr key={`${row.sizeLabel}-${i}`}>
                <th scope="row">{row.sizeLabel}</th>
                {keys.map((k) => (
                  <td key={k} title={row.raw[raw[k]!]?.raw ? `Original: ${row.raw[raw[k]!]!.raw}` : undefined}>
                    {row[k] ?? '—'}
                  </td>
                ))}
                {onRemoveRow && (
                  <td>
                    <button type="button" className="fv-btn fv-btn--ghost fv-btn--sm" onClick={() => onRemoveRow(i)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
