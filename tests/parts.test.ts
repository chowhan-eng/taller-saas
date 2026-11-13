// Live supplier lookup: query normaliser, classifier, Androgeek/SpainSellers parsing, per-tenant dealer sessions
// (never shared, credentials only as ciphertext), price-change alerts, SSRF guard, MuchoRepuesto = link only.
import { describe, expect, it } from 'vitest';
import { fieldCrypto } from '../base44/shared/crypto.ts';
import type { Row } from '../base44/shared/db.ts';
import { classify, canon, cents, parseAndrogeekHtml, parseQuery, parseSpainSellersCsv, safeFeedUrl, searchParts, saveSupplierAccount, ssParseItems, ssPickCategories, supplierStatus, testSupplier, type Fetch } from '../base44/shared/parts.ts';
import { handleReparo } from '../base44/shared/reparoApi.ts';
import { fakeDb } from './fakeDb.ts';

const fc = fieldCrypto(btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));

const card = (id: number, title: string, price: string) =>
  `" data-id-product="${id}"><h3 class="product-title"><a href="https://androgeek.es/p/${id}">${title}</a></h3><span itemprop="price" class="price">${price}</span><div class="product-description"></div>`;
const html = (cards: string, extra = '') => `<html>${extra}${cards.split('|').map((c) => `<article class="js-product-miniature ${c}</article>`).join('')}</html>`;

/** Fake supplier site. Dealer login = good credentials set a cookie; dealer prices need that cookie. */
function fakeSite(opts: { goodPass?: string } = {}) {
  const seen: { url: string; cookie: string }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    const cookie = String((init?.headers as Record<string, string> | undefined)?.Cookie ?? '');
    seen.push({ url, cookie });
    const u = new URL(url);
    if (u.hostname.includes('muchorepuesto')) throw new Error('MuchoRepuesto must never be fetched');
    if (u.pathname === '/autenticacion' && (init?.method ?? 'GET') === 'GET') return new Response('<form></form>', { headers: [['set-cookie', 'sid=1; path=/']] });
    if (u.pathname === '/autenticacion') {
      const ok = String(init?.body).includes(`password=${opts.goodPass ?? 'secreta'}`);
      return ok ? new Response('', { status: 302, headers: [['set-cookie', 'auth=OK; path=/'], ['location', '/mi-cuenta']] }) : new Response('<div class="alert alert-danger">Error de autenticación</div>');
    }
    if (u.pathname === '/mi-cuenta') return new Response(cookie.includes('auth=OK') ? '<h1>Mi cuenta</h1>' : '<input name="password">');
    if (u.pathname === '/buscar') {
      const dealer = cookie.includes('auth=OK');
      return new Response(html(card(101, 'Pantalla iPhone 13 OLED compatible', dealer ? '39,00 €' : '45,00 €') + '|' + card(102, 'Funda iPhone 13 silicona', '5,00 €') + '|' + card(103, 'Pantalla iPhone 13 Pro OLED', '60,00 €'),
        `"display_prices_tax_incl":false${dealer ? '' : ',"is_logged":false'}`));
    }
    if (u.hostname === 'feeds.example.es') return new Response('id;nombre;categoria;precio;pvd;stock;img\n7;Pantalla iPhone 13 Original;Repuestos;99,00;70,00;en stock;\n8;Bateria iPhone 13;Repuestos;30,00;22,00;sin stock;\n');
    return new Response('not found', { status: 404 });
  };
  return { fetchFn, seen };
}
const baseDb = () => fakeDb({ Tenant: [{ id: 'TA', plan: 'pro', status: 'active' }, { id: 'TB', plan: 'pro', status: 'active' }] });

describe('normaliser and classifier (ported verbatim)', () => {
  it('fixes typos and abbreviations', () => {
    expect(canon('Patalla Samsumg A52')).toBe('pantalla samsung a52');
    expect(canon('ip13 pro bateria')).toBe('iphone 13 pro bateria');
    expect(canon('Apple 13 PRO')).toBe('iphone 13 pro');
  });
  it('understands the part and the model', () => {
    const p = parseQuery('pantalla iphone 13');
    expect(p).toMatchObject({ part_type: 'screen', brand: 'Apple', category: 'movil', model: 'iphone 13' });
    expect(parseQuery('13 pro bateria').modelTokens).toEqual(['iphone', '13', 'pro']);
  });
  it('flags accessories, other parts and other models as junk; grades quality', () => {
    const p = parseQuery('pantalla iphone 13');
    expect(classify('Funda iPhone 13 silicona', p).is_junk).toBe(true);
    expect(classify('Batería iPhone 13', p).junk_reason).toBe('otra pieza');
    expect(classify('Pantalla iPhone 13 Pro OLED', p).junk_reason).toBe('otro modelo');
    expect(classify('Pantalla iPhone 13 OLED compatible', p)).toMatchObject({ is_junk: false, tier: 2, quality_label: 'OLED' });
    expect(classify('Pantalla iPhone 13 Incell compatible', p)).toMatchObject({ is_junk: false, tier: 1, quality_label: 'Incell' });
    expect(classify('Pantalla iPhone 13 Original Service Pack', p)).toMatchObject({ tier: 3, quality_label: 'Service Pack' });
    expect(classify('Pantalla iPhone 13 Soft OLED', p)).toMatchObject({ tier: 2, quality_label: 'Soft OLED' });
  });
  it('parses euro amounts', () => {
    expect(cents('1.234,56 €')).toBe(123456);
    expect(cents('29.99')).toBe(2999);
    expect(cents('49,50')).toBe(4950);
  });
});

describe('page parsers', () => {
  it('reads Androgeek result cards and the tax mode', () => {
    const r = parseAndrogeekHtml(html(card(101, 'Pantalla iPhone 13 &amp; marco', '45,00 €'), '"display_prices_tax_incl":true'));
    expect(r.tax).toBe('gross');
    expect(r.offers).toEqual([expect.objectContaining({ sku: '101', title: 'Pantalla iPhone 13 & marco', price_cents: 4500, url: 'https://androgeek.es/p/101' })]);
  });
  it('picks the right SpainSellers category and parses product lists', () => {
    const cats = [{ title: 'Repuestos iPhone 13' }, { title: 'Repuestos iPhone 13 Pro Max' }, { title: 'Repuestos iPhone 12' }];
    expect(ssPickCategories(cats, parseQuery('pantalla iphone 13')).map((c) => c.title)).toEqual(['Repuestos iPhone 13']);
    const items = ssParseItems('<ul><li class="ajax_block_product"><a class="product-name" href="https://www.spainsellers.com/x-p-55.html" title="Pantalla iPhone 13"></a><span class="price product-price">24,46 €</span></li></ul>');
    expect(items).toEqual([expect.objectContaining({ sku: '55', guest_cents: 2446, title: 'Pantalla iPhone 13' })]);
  });
  it('filters a CSV feed by model and prefers the dealer price', () => {
    const offers = parseSpainSellersCsv('id;nombre;categoria;precio;pvd;stock\n1;Pantalla iPhone 13;R;99,00;70,00;en stock\n2;Pantalla iPhone 12;R;80,00;60,00;en stock', parseQuery('pantalla iphone 13'));
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ price_cents: 7000, price_tax_mode: 'net' });
  });
});

describe('SSRF guard for feed URLs', () => {
  it.each(['http://feeds.example.es/a.csv', 'https://127.0.0.1/a.csv', 'https://localhost/a', 'https://[::1]/a', 'https://printer.local/a', 'https://u:p@feeds.example.es/a', 'ftp://x.es/a', 'nope'])('rejects %s', (u) => {
    expect(safeFeedUrl(u)).toBeNull();
  });
  it('accepts a public https URL', () => expect(safeFeedUrl('https://feeds.example.es/a.csv')).toBe('https://feeds.example.es/a.csv'));
});

describe('searchParts for one shop', () => {
  it('guest search: Androgeek public price, junk flagged, MuchoRepuesto link only and never fetched', async () => {
    const db = baseDb(); const site = fakeSite();
    const r = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TA', 'pantalla iphone 13');
    const ok = r.offers.filter((o) => !o.is_junk);
    expect(ok.map((o) => o.sku)).toEqual(['101']);
    expect(ok[0]).toMatchObject({ source: 'androgeek', net_cost_cents: 4500, price_tax_mode: 'net', tier: 2 });
    expect(r.offers.filter((o) => o.is_junk).map((o) => o.sku).sort()).toEqual(['102', '103']);
    expect(r.sources.androgeek.note).toContain('invitado');
    expect(r.sources.muchorepuesto.state).toBe('link');
    expect(site.seen.some((s) => s.url.includes('muchorepuesto'))).toBe(false);
  });

  it('a shop\'s dealer login gives ITS price; credentials and cookie are stored only as ciphertext', async () => {
    const db = baseDb(); const site = fakeSite();
    await saveSupplierAccount({ db, fc }, 'TA', { source: 'androgeek', email: 'taller@a.es', password: 'secreta' });
    const r = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TA', 'pantalla iphone 13');
    expect(r.offers.find((o) => o.sku === '101')?.net_cost_cents).toBe(3900);
    expect(r.sources.androgeek.note).toContain('distribuidor');
    const row = db._rows.SupplierAccount[0] as Row;
    expect(JSON.stringify(row)).not.toContain('secreta');
    expect(JSON.stringify(row)).not.toContain('taller@a.es');
    expect(JSON.stringify(row)).not.toContain('auth=OK');
    expect(String(row.password_enc)).toMatch(/^v1:/);
    expect(String(row.cookie_enc)).toMatch(/^v1:/);
  });

  it('dealer sessions are never shared between shops', async () => {
    const db = baseDb(); const site = fakeSite();
    await saveSupplierAccount({ db, fc }, 'TA', { source: 'androgeek', email: 'taller@a.es', password: 'secreta' });
    await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TA', 'pantalla iphone 13');
    site.seen.length = 0;
    const b = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TB', 'pantalla iphone 13');
    expect(b.offers.find((o) => o.sku === '101')?.net_cost_cents).toBe(4500);
    expect(site.seen.filter((s) => s.cookie.includes('auth=OK'))).toHaveLength(0);
    expect(((await supplierStatus({ db, fc }, 'TB')).androgeek)).toMatchObject({ configured: false });
  });

  it('a wrong password falls back to guest prices and reports why; status never exposes secrets', async () => {
    const db = baseDb(); const site = fakeSite();
    await saveSupplierAccount({ db, fc }, 'TA', { source: 'androgeek', email: 'taller@a.es', password: 'mala-clave' });
    const t = await testSupplier({ db, fc, fetchFn: site.fetchFn }, 'TA', 'androgeek');
    expect(t.state).toBe('failed');
    const r = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TA', 'pantalla iphone 13');
    expect(r.offers.find((o) => o.sku === '101')?.net_cost_cents).toBe(4500);
    const st = await supplierStatus({ db, fc }, 'TA');
    expect(st.androgeek).toMatchObject({ configured: true, state: 'failed' });
    expect(JSON.stringify(st)).not.toContain('mala-clave');
  });

  it('SpainSellers CSV feed of the shop is used (net dealer price) and the URL is validated', async () => {
    const db = baseDb(); const site = fakeSite();
    await expect(saveSupplierAccount({ db, fc }, 'TA', { source: 'spainsellers', feedUrl: 'https://127.0.0.1/x.csv' })).rejects.toThrow(/https/);
    await expect(saveSupplierAccount({ db, fc }, 'TA', { source: 'androgeek', feedUrl: 'https://feeds.example.es/a.csv' })).rejects.toThrow(/SpainSellers/);
    await saveSupplierAccount({ db, fc }, 'TA', { source: 'spainsellers', feedUrl: 'https://feeds.example.es/a.csv' });
    const r = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TA', 'pantalla iphone 13');
    const ss = r.offers.find((o) => o.source === 'spainsellers' && !o.is_junk);
    expect(ss).toMatchObject({ sku: '7', net_cost_cents: 7000, tier: 3 });
  });

  it('flags a changed price for a part remembered by supplier SKU', async () => {
    const db = baseDb(); const site = fakeSite();
    await db.PartPrice.create({ tenant_id: 'TA', part_key: 'sku:androgeek:101', part_label: 'Pantalla iPhone 13 OLED compatible', supplier: 'Androgeek', price_eur: 40, tax_mode: 'net' });
    await db.PartPrice.create({ tenant_id: 'TB', part_key: 'sku:androgeek:101', part_label: 'x', supplier: 'Androgeek', price_eur: 45, tax_mode: 'net' });
    const a = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TA', 'pantalla iphone 13');
    expect(a.offers.find((o) => o.sku === '101')?.saved).toMatchObject({ price_eur: 40, changed: true });
    const b = await searchParts({ db, fc, fetchFn: site.fetchFn }, 'TB', 'pantalla iphone 13');
    expect(b.offers.find((o) => o.sku === '101')?.saved).toMatchObject({ price_eur: 45, changed: false });
  });

  it('rejects too-short queries', async () => {
    await expect(searchParts({ db: baseDb(), fc }, 'TA', 'a')).rejects.toThrow(/3 caracteres/);
  });
});

describe('reparo actions for suppliers', () => {
  const seed = () => fakeDb({
    Tenant: [{ id: 'TA', plan: 'pro', status: 'active' }, { id: 'TS', plan: 'starter', status: 'active' }],
    Subscription: [{ id: 'S1', tenant_id: 'TA', plan: 'pro', status: 'active' }],
    TenantUser: [{ id: 'm1', tenant_id: 'TA', user_id: 'owner', role: 'owner', active: true }, { id: 'm2', tenant_id: 'TA', user_id: 'tech', role: 'technician', active: true }],
  });
  it('only owner/admin can store or test supplier accounts; the answer never contains secrets', async () => {
    const db = seed();
    const body = { tenantId: 'TA', action: 'saveSupplierAccount', source: 'androgeek', email: 'a@b.es', password: 'secreta' };
    expect((await handleReparo({ db, fc, userId: 'tech' }, body)).status).toBe(403);
    const r = await handleReparo({ db, fc, userId: 'owner' }, body);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('secreta');
    expect((await handleReparo({ db, fc, userId: 'tech' }, { tenantId: 'TA', action: 'testSupplier', source: 'androgeek' })).status).toBe(403);
  });
  it('searchParts through the router works for a Pro shop and reports bad input as 400', async () => {
    const db = seed(); const site = fakeSite();
    const r = await handleReparo({ db, fc, userId: 'tech', fetchFn: site.fetchFn }, { tenantId: 'TA', action: 'searchParts', q: 'pantalla iphone 13' });
    expect(r.status).toBe(200);
    expect((r.body as { offers: unknown[] }).offers.length).toBeGreaterThan(0);
    expect((await handleReparo({ db, fc, userId: 'tech', fetchFn: site.fetchFn }, { tenantId: 'TA', action: 'searchParts', q: 'x' })).status).toBe(400);
  });
  it('savePartPrice by SKU keeps one row per supplier product and reports a change', async () => {
    const db = seed();
    const save = (priceEur: number) => handleReparo({ db, fc, userId: 'owner' }, { tenantId: 'TA', action: 'savePartPrice', label: 'Pantalla X', supplier: 'Androgeek', sku: '101', priceEur, taxMode: 'net' }).then((r) => r.body as { change: unknown });
    expect((await save(39)).change).toBeNull();
    expect((await save(42)).change).toEqual({ from: 39, to: 42 });
    expect(db._rows.PartPrice).toHaveLength(1);
    expect(db._rows.PartPrice[0].part_key).toBe('sku:androgeek:101');
  });
});
