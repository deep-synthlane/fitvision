import { config } from 'zod';

// zod's JIT probes `new Function`, which the production CSP (no 'unsafe-eval') blocks and reports.
// Imported first in main.tsx so it runs before any schema is created.
config({ jitless: true });
