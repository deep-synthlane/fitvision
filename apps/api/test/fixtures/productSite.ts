import http from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';

/** Local stand-in for retailer websites, so tests never depend on live sites. */
export interface ProductSite {
  origin: string;
  hostPort: string;
  close: () => Promise<void>;
}

export const garmentPng = (color: string, w = 400, h = 500) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#f4f4f4' } })
    .composite([{ input: { create: { width: Math.round(w * 0.6), height: Math.round(h * 0.7), channels: 3, background: color } }, top: Math.round(h * 0.15), left: Math.round(w * 0.2) }])
    .png()
    .toBuffer();

export async function startProductSite(port = 0): Promise<ProductSite> {
  const front = await garmentPng('#1d4ed8');
  const back = await garmentPng('#b91c1c');
  // Same picture as `front`, re-encoded as JPEG: a near-duplicate.
  const frontJpeg = await sharp(front).jpeg({ quality: 80 }).toBuffer();
  const tiny = await garmentPng('#000', 50, 50);
  let origin = '';

  const jsonLdPage = () => `<!doctype html><html><head><title>Ignored title</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Women' },
          { '@type': 'ListItem', position: 2, name: 'Denim Jackets' },
        ],
      },
      {
        '@type': 'ProductGroup',
        name: 'Classic Denim Jacket',
        brand: { '@type': 'Brand', name: 'Acme Apparel' },
        description: 'A <b>classic</b> denim jacket.',
        url: `${origin}/products/denim-jacket`,
        image: [`${origin}/img/front.png`, `${origin}/img/back.png`],
        variesBy: ['size'],
        hasVariant: ['XS', 'S', 'M', 'L'].map((size, i) => ({
          '@type': 'Product',
          sku: `DJ-${size}`,
          size,
          color: 'Indigo',
          offers: { '@type': 'Offer', price: '89.50', priceCurrency: 'EUR', availability: i === 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' },
        })),
      },
    ],
  })}</script>
<script type="application/ld+json">{ not valid json </script>
</head><body><h1>Classic Denim Jacket</h1><img src="/img/front-dupe.jpg" width="600"></body></html>`;

  const ogPage = () => `<!doctype html><html><head>
<meta property="og:title" content="Linen Midi Dress">
<meta property="og:image" content="${origin}/img/front.png">
<meta property="product:price:amount" content="1.299,00">
<meta property="product:price:currency" content="sek">
<meta property="og:url" content="${origin}/p/linen-dress">
</head><body></body></html>`;

  const htmlPage = () => `<!doctype html><html><head><title>Slim Chinos | Shop</title>
<link rel="canonical" href="/products/slim-chinos"></head><body>
<nav class="breadcrumb">Men / Trousers / Chinos</nav>
<h1>Slim Chinos</h1>
<div class="product-gallery"><img src="/img/front.png"><img src="/img/logo.png" class="logo"><img data-src="/img/back.png"></div>
<select name="size"><option>Select size</option><option>30</option><option>32</option><option>34 - sold out</option></select>
<h3>Size guide (body measurements, inches)</h3>
<table>
  <tr><th>Size</th><th>30</th><th>32</th><th>34</th></tr>
  <tr><td>Waist</td><td>30-31</td><td>32-33</td><td>34 1/2</td></tr>
  <tr><td>Hips</td><td>38</td><td>40</td><td>42</td></tr>
  <tr><td>Inside leg</td><td>32</td><td>32</td><td>32</td></tr>
</table></body></html>`;

  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    const png = (buf: Buffer, type = 'image/png') => {
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    };
    switch (path) {
      case '/robots.txt':
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('User-agent: *\nDisallow: /private/\n');
      case '/products/denim-jacket':
        return html(jsonLdPage());
      case '/p/linen-dress':
        return html(ogPage());
      case '/products/slim-chinos':
        return html(htmlPage());
      case '/private/item':
        return html(jsonLdPage());
      case '/no-product':
        return html('<!doctype html><html><head></head><body><p>Hello</p></body></html>');
      case '/blocked':
        res.writeHead(403, { 'content-type': 'text/html' });
        return res.end('Forbidden');
      case '/api.json':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{}');
      case '/redirect-private':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return res.end();
      case '/redirect-loop':
        res.writeHead(302, { location: '/redirect-loop' });
        return res.end();
      case '/redirect-ok':
        res.writeHead(301, { location: '/products/denim-jacket' });
        return res.end();
      case '/huge': {
        // No content-length: the size limit must be enforced while streaming.
        res.writeHead(200, { 'content-type': 'text/html' });
        const chunk = Buffer.alloc(64 * 1024, 'a');
        let sent = 0;
        const write = () => {
          while (sent < 5 * 1024 * 1024) {
            sent += chunk.length;
            if (!res.write(chunk)) return res.once('drain', write);
          }
          res.end();
        };
        return write();
      }
      case '/img/front.png':
        return png(front);
      case '/img/back.png':
        return png(back);
      case '/img/front-dupe.jpg':
        return png(frontJpeg, 'image/jpeg');
      case '/img/tiny.png':
        return png(tiny);
      case '/img/fake.png':
        return png(Buffer.from('<html>not an image</html>'));
      default:
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('Not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${actual}`;
  return { origin, hostPort: `127.0.0.1:${actual}`, close: () => new Promise((r) => server.close(() => r())) };
}
