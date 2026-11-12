import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Tiny S3-compatible server (path-style): PutObject, GetObject, DeleteObject, ListObjectsV2,
 * DeleteObjects. Signatures aren't verified — it tests our use of the S3 protocol, not AWS auth.
 */
export async function startFakeS3() {
  const objects = new Map<string, Buffer>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      const [, bucket, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      const body = Buffer.concat(chunks);
      const xml = (s: number, x: string) => {
        res.writeHead(s, { 'content-type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>${x}`);
      };
      if (req.method === 'PUT' && key) {
        objects.set(`${bucket}/${key}`, body);
        res.writeHead(200, { etag: '"x"' });
        return res.end();
      }
      if (req.method === 'GET' && key) {
        const o = objects.get(`${bucket}/${key}`);
        if (!o) return xml(404, '<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': o.length });
        return res.end(o);
      }
      if (req.method === 'DELETE' && key) {
        objects.delete(`${bucket}/${key}`);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = `${bucket}/${url.searchParams.get('prefix') ?? ''}`;
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(bucket!.length + 1));
        return xml(200, `<ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated><KeyCount>${keys.length}</KeyCount>${keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('')}</ListBucketResult>`);
      }
      if (req.method === 'POST' && url.searchParams.has('delete')) {
        for (const m of body.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) objects.delete(`${bucket}/${m[1]}`);
        return xml(200, '<DeleteResult></DeleteResult>');
      }
      xml(400, '<Error><Code>Unsupported</Code></Error>');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { endpoint, objects, close: () => new Promise<void>((r) => server.close(() => r())) };
}
