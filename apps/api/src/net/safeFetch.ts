import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import { FetchError, checkUrl, type FetchPolicy } from './policy.js';

export const IMPORTER_USER_AGENT = 'FitVisionImporter/0.1 (+product import on behalf of a user)';

export type DnsLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: DnsLookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

export interface SafeFetchOptions {
  policy: FetchPolicy;
  /** Allowed media types, e.g. ['text/html'] or ['image/']. A trailing '/' matches a family. */
  accept: string[];
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  lookup?: DnsLookup;
}

export interface FetchedResource {
  url: URL;
  status: number;
  contentType: string;
  body: Buffer;
}

/**
 * Fetches an external URL defensively (SSRF): validates every hop, resolves DNS ourselves and
 * connects only to addresses the policy allows (so DNS rebinding can't swap in a private IP),
 * follows a limited number of redirects manually, caps time and size (also after
 * decompression), checks the content type, and never sends cookies or credentials.
 */
export async function safeFetch(rawUrl: string | URL, opts: SafeFetchOptions): Promise<FetchedResource> {
  const { policy, timeoutMs = 10_000, maxRedirects = 3 } = opts;
  const lookup = opts.lookup ?? systemLookup;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = checkUrl(rawUrl, policy);
    for (let hop = 0; ; hop++) {
      const res = await request(url, opts, lookup, controller.signal);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= maxRedirects) throw new FetchError('too_many_redirects', 'The link redirected too many times.');
        url = checkUrl(new URL(res.headers.location, url), policy);
        continue;
      }
      if (status === 401 || status === 403 || status === 429) {
        res.resume();
        throw new FetchError('blocked_by_site', 'The website refused automated access.', status);
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new FetchError('http_error', `The website responded with an error (${status}).`, status);
      }
      const contentType = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!opts.accept.some((a) => (a.endsWith('/') ? contentType.startsWith(a) : contentType === a))) {
        res.resume();
        throw new FetchError('unsupported_content', `Unsupported content type (${contentType || 'unknown'}).`);
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        res.resume();
        throw new FetchError('too_large', 'The page or file is too large to import.');
      }
      const body = await readLimited(res, opts.maxBytes);
      return { url, status, contentType, body };
    }
  } catch (err) {
    if (controller.signal.aborted) throw new FetchError('timeout', 'The website took too long to respond.');
    if (err instanceof FetchError) throw err;
    throw new FetchError('fetch_failed', 'We couldn’t reach that website.');
  } finally {
    clearTimeout(timer);
  }
}

function request(url: URL, opts: SafeFetchOptions, lookup: DnsLookup, signal: AbortSignal): Promise<http.IncomingMessage> {
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  // Connection-time lookup: every resolved address must pass the policy, otherwise refuse.
  const guardedLookup: LookupFunction = (hostname, options, callback) => {
    lookup(hostname)
      .then((addresses) => {
        if (addresses.length === 0) throw new FetchError('fetch_failed', 'That website’s address couldn’t be found.');
        if (addresses.some((a) => !opts.policy.allowAddress(a.address, port))) {
          throw new FetchError('blocked_url', 'That address can’t be imported.');
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      })
      .catch((err: Error) => callback(err as NodeJS.ErrnoException, '', 0));
  };
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: guardedLookup,
        signal,
        headers: {
          'user-agent': IMPORTER_USER_AGENT,
          accept: opts.accept.map((a) => (a.endsWith('/') ? `${a}*` : a)).join(', '),
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en',
        },
      },
      resolve,
    );
    req.on('error', (err) => reject(err instanceof FetchError ? err : (err as Error & { cause?: unknown }).cause instanceof FetchError ? (err as { cause: FetchError }).cause : err));
    req.end();
  });
}

function readLimited(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = (res.headers['content-encoding'] ?? '').toLowerCase();
  const stream =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? res.pipe(zlib.createGunzip())
      : encoding === 'deflate'
        ? res.pipe(zlib.createInflate())
        : encoding === 'br'
          ? res.pipe(zlib.createBrotliDecompress())
          : res;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        stream.destroy();
        reject(new FetchError('too_large', 'The page or file is too large to import.'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err) => reject(err));
    res.on('error', (err) => reject(err));
  });
}
