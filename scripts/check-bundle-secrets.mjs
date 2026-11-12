// Fails if the built web bundle contains anything that looks like a server secret.
// Run after `pnpm build`: node scripts/check-bundle-secrets.mjs [apps/web/dist]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'apps/web/dist';
const PATTERNS = [
  [/JWT_SECRET|REPLICATE_API_TOKEN|S3_SECRET_ACCESS_KEY|METRICS_TOKEN|DATABASE_URL|POSTGRES_PASSWORD/, 'server environment variable name'],
  [/dev-only-insecure-secret/, 'development JWT secret'],
  [/r8_[A-Za-z0-9]{20,}/, 'Replicate API token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/, 'database URL with credentials'],
  [/sk-[A-Za-z0-9]{32,}/, 'API secret key'],
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json|map|txt|svg)$/.test(name)) files.push(p);
  }
};
walk(root);

const findings = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of PATTERNS) if (re.test(text)) findings.push(`${file}: ${label}`);
}
if (findings.length) {
  console.error(`Possible secrets in the browser bundle:\n- ${findings.join('\n- ')}`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} bundle files under ${root}.`);
