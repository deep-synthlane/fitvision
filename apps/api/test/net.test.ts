import { describe, expect, it } from 'vitest';
import type { FetchError} from '../src/net/policy.js';
import { DEFAULT_FETCH_POLICY, checkUrl, isPublicAddress } from '../src/net/policy.js';
import { isAllowed, parseRobots } from '../src/net/robots.js';
import { safeFetch } from '../src/net/safeFetch.js';

const blocked = (url: string) => {
  try {
    checkUrl(url, DEFAULT_FETCH_POLICY);
    return null;
  } catch (err) {
    return (err as FetchError).code;
  }
};

describe('SSRF URL policy', () => {
  it('accepts public http(s) URLs on standard ports', () => {
    expect(blocked('https://shop.example.com/p/123')).toBeNull();
    expect(blocked('http://93.184.216.34/item')).toBeNull();
  });

  it('rejects invalid URLs and non-http schemes', () => {
    for (const url of ['not a url', 'ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://x']) {
      expect(blocked(url)).toBe('invalid_url');
    }
  });

  it('rejects localhost, private, link-local and cloud-metadata destinations', () => {
    for (const url of [
      'http://localhost/',
      'http://api.localhost/',
      'http://printer.local/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://172.16.4.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/', // carrier-grade NAT
      'http://169.254.169.254/latest/meta-data/', // AWS/GCP/Azure metadata
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:127.0.0.1]/', // IPv4-mapped IPv6
      'http://[::ffff:a9fe:a9fe]/', // 169.254.169.254, mapped
      'http://user:pass@shop.example.com/', // embedded credentials
      'http://shop.example.com:22/', // non-web port
    ]) {
      expect(blocked(url), url).toBe('blocked_url');
    }
  });

  it('classifies addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
    for (const ip of ['10.1.1.1', '169.254.169.254', '::1', 'fc00::1', '224.0.0.1', '255.255.255.255', '::ffff:10.0.0.1', 'nonsense']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe('safeFetch DNS checks', () => {
  it('refuses hostnames that resolve to private addresses, before connecting', async () => {
    const lookup = async (host: string) =>
      host === 'evil.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
    for (const host of ['evil.example', 'mixed.example']) {
      await expect(
        safeFetch(`http://${host}/product`, { policy: DEFAULT_FETCH_POLICY, lookup, accept: ['text/html'], maxBytes: 1000, timeoutMs: 2000 }),
      ).rejects.toMatchObject({ code: 'blocked_url' });
    }
  });
});

describe('robots.txt', () => {
  const rules = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /checkout
Disallow: /private/
Allow: /private/public-*
Disallow: /*.pdf$
`);

  it('applies the * group with longest-match precedence', () => {
    expect(isAllowed(rules, '/products/1')).toBe(true);
    expect(isAllowed(rules, '/checkout/cart')).toBe(false);
    expect(isAllowed(rules, '/private/x')).toBe(false);
    expect(isAllowed(rules, '/private/public-item')).toBe(true);
    expect(isAllowed(rules, '/doc.pdf')).toBe(false);
    expect(isAllowed(rules, '/doc.pdf?x=1')).toBe(true);
  });

  it('uses a group addressed to our importer when present', () => {
    expect(isAllowed(parseRobots('User-agent: FitVisionImporter\nDisallow: /\n\nUser-agent: *\nAllow: /'), '/p')).toBe(false);
  });
});
