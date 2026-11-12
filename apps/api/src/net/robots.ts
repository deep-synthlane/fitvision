import { FetchError } from './policy.js';
import { safeFetch, type SafeFetchOptions } from './safeFetch.js';

const UA_TOKEN = 'fitvisionimporter';
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; rules: Rule[] | 'disallow_all' | 'allow_all' }>();

interface Rule {
  allow: boolean;
  path: string;
}

/** Parses the rules that apply to our importer (its own group, else `*`), per RFC 9309. */
export function parseRobots(text: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow') && value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.includes(a)));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const re = new RegExp(
    '^' +
      pattern
        .replace(/\$$/, '')
        .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      (anchored ? '$' : ''),
  );
  return re.test(path);
}

/** Longest matching rule wins; Allow wins ties. No matching rule means allowed. */
export function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return !best || best.allow;
}

/** Checks the site's robots.txt before importing a page. */
export async function robotsAllows(url: URL, opts: Omit<SafeFetchOptions, 'accept' | 'maxBytes'>): Promise<boolean> {
  const origin = url.origin;
  let entry = cache.get(origin);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    let rules: Rule[] | 'disallow_all' | 'allow_all';
    try {
      const res = await safeFetch(new URL('/robots.txt', origin), { ...opts, accept: ['text/'], maxBytes: 256 * 1024, timeoutMs: 5000 });
      rules = parseRobots(res.body.toString('utf8'));
    } catch (err) {
      // RFC 9309: a missing robots.txt (4xx) allows everything; server errors mean "assume disallowed".
      if (err instanceof FetchError && (err.code === 'http_error' || err.code === 'blocked_by_site') && err.status && err.status < 500) rules = 'allow_all';
      else if (err instanceof FetchError && err.code === 'unsupported_content') rules = 'allow_all';
      else rules = 'disallow_all';
    }
    entry = { at: Date.now(), rules };
    cache.set(origin, entry);
  }
  if (entry.rules === 'allow_all') return true;
  if (entry.rules === 'disallow_all') return false;
  return isAllowed(entry.rules, url.pathname + url.search);
}

export const clearRobotsCache = () => cache.clear();
