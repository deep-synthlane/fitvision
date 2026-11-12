import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

/** Decides which destinations outbound fetches may reach. */
export interface FetchPolicy {
  allowPort(port: number): boolean;
  allowAddress(ip: string, port: number): boolean;
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);

/**
 * Only public unicast addresses. ipaddr's range() labels everything else — private, loopback,
 * link-local (incl. 169.254.169.254 cloud metadata), carrier-grade NAT, unique-local IPv6,
 * multicast, reserved, unspecified — and IPv4-mapped IPv6 is unwrapped first.
 */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  const addr = ipaddr.process(ip);
  return addr.range() === 'unicast';
}

export const DEFAULT_FETCH_POLICY: FetchPolicy = {
  allowPort: (port) => port === 80 || port === 443,
  allowAddress: (ip) => isPublicAddress(ip),
};

/** Development/testing only: additionally allow specific `host:port` pairs (e.g. a local fixture server). */
export function policyWithExtraHosts(base: FetchPolicy, hostPorts: string[]): FetchPolicy {
  const extra = new Set(hostPorts);
  return {
    allowPort: (port) => base.allowPort(port) || [...extra].some((hp) => hp.endsWith(`:${port}`)),
    allowAddress: (ip, port) => extra.has(`${ip}:${port}`) || (base.allowPort(port) && base.allowAddress(ip, port)),
  };
}

export type FetchErrorCode =
  | 'invalid_url'
  | 'blocked_url'
  | 'fetch_failed'
  | 'timeout'
  | 'too_large'
  | 'unsupported_content'
  | 'http_error'
  | 'blocked_by_site'
  | 'too_many_redirects';

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/** Parses and checks a URL before any network activity. */
export function checkUrl(raw: string | URL, policy: FetchPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError('invalid_url', 'That doesn’t look like a valid link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('invalid_url', 'Only http and https links are supported.');
  if (url.username || url.password) throw new FetchError('blocked_url', 'Links containing a username or password aren’t allowed.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new FetchError('invalid_url', 'That doesn’t look like a valid link.');
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new FetchError('blocked_url', 'That address can’t be imported.');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!policy.allowPort(port)) throw new FetchError('blocked_url', 'Only standard web ports are supported.');
  const literal = host.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !policy.allowAddress(literal, port)) throw new FetchError('blocked_url', 'That address can’t be imported.');
  return url;
}
