/**
 * Prints the latest scan's raw estimates from a *dedicated calibration account* as worksheet
 * columns (processing_version … scan_hips_conf), so the operator doesn't copy numbers by hand.
 * Optional --delete-scan removes the scan photos afterwards.
 *
 *   CAL_EMAIL=… CAL_PASSWORD=… pnpm calibration:fetch [--api http://localhost:4000] [--delete-scan]
 */
import type { CurrentMeasurementsResponse } from '@fitvision/shared';
import { MEASURES } from './analyze.js';

const args = process.argv.slice(2);
const api = args.includes('--api') ? args[args.indexOf('--api') + 1]! : 'http://localhost:4000';
const email = process.env.CAL_EMAIL;
const password = process.env.CAL_PASSWORD;
if (!email || !password) {
  console.error('Set CAL_EMAIL and CAL_PASSWORD for the calibration account.');
  process.exit(1);
}

const login = await fetch(`${api}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`Login failed (${login.status})`);
const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

const res = await fetch(`${api}/api/measurements/current`, { headers: { cookie } });
const { measurements } = (await res.json()) as CurrentMeasurementsResponse;
const scan = measurements?.scanEstimates;
if (!measurements || !scan) {
  console.error('The latest measurements did not come from a body scan.');
  process.exit(1);
}

function worksheetColumns(s: NonNullable<typeof scan>): string {
  const key = { shoulder: 'shoulderCm', chest: 'chestCm', waist: 'waistCm', hips: 'hipsCm' } as const;
  const cells = [s.processingVersion];
  for (const m of MEASURES) {
    const e = s.estimates[key[m]];
    cells.push(e ? String(e.valueCm) : '', e ? String(e.confidence) : '');
  }
  return cells.join(',');
}

console.log('processing_version,scan_shoulder,scan_shoulder_conf,scan_chest,scan_chest_conf,scan_waist,scan_waist_conf,scan_hips,scan_hips_conf');
console.log(worksheetColumns(scan));
if (scan.warnings.length) console.error(`Scan warnings: ${scan.warnings.join(' | ')}`);

if (args.includes('--delete-scan') && measurements.scanId) {
  const del = await fetch(`${api}/api/scans/${measurements.scanId}`, { method: 'DELETE', headers: { cookie } });
  console.error(del.ok ? 'Scan photos deleted.' : `Could not delete scan (${del.status}).`);
}
