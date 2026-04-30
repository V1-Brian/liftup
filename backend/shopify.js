const SHOPIFY_API_VERSION = '2024-01';

// Exchange client_id + client_secret for a short-lived access token (24h)
async function getAccessToken(store, clientId, clientSecret) {
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch (_) {
    throw new Error(`Shopify token request failed (${res.status}): ${raw}`);
  }
  if (!data.access_token) throw new Error(`No access_token in response: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Fetch a single page from Shopify; returns { orders, nextPath }
async function shopifyGetOrders(store, token, path) {
  const url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify API ${res.status}: ${body}`);
  }
  const link = res.headers.get('link') || '';
  const data = await res.json();

  // Parse cursor from Link header: <url>; rel="next"
  const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
  let nextPath = null;
  if (nextMatch) {
    // nextMatch[1] is the full absolute URL — strip the base so we keep path+query
    nextPath = nextMatch[1].replace(
      `https://${store}/admin/api/${SHOPIFY_API_VERSION}`,
      ''
    );
  }

  return { orders: data.orders || [], nextPath };
}

// Fetch all orders for a given month (YYYY-MM), handling pagination
async function fetchOrdersForMonth(store, token, month) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const minDate = `${month}-01T00:00:00+00:00`;
  const maxDate = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59+00:00`;

  let path = `/orders.json?created_at_min=${encodeURIComponent(minDate)}&created_at_max=${encodeURIComponent(maxDate)}&status=any&limit=250`;
  const all = [];

  while (path) {
    const { orders, nextPath } = await shopifyGetOrders(store, token, path);
    all.push(...orders);
    path = nextPath;
  }

  return all;
}

function detectChannel(order) {
  const src  = (order.source_name || '').toLowerCase();
  const tags = (order.tags || '').toLowerCase();
  const sm   = (order.shipping_lines || [])
    .map(s => `${s.title || ''} ${s.source || ''}`)
    .join(' ')
    .toLowerCase();

  if (src.includes('amazon') || tags.includes('amazon') || sm.includes('amazon')) return 'Amazon';
  if (src.includes('walmart') || tags.includes('walmart')) return 'Walmart';
  return 'Shopify';
}

// Convert Shopify order objects into the internal order row format
function processOrders(shopifyOrders, skuMap) {
  const orders = [];
  for (const order of shopifyOrders) {
    if (order.cancelled_at) continue;
    const date    = (order.created_at || '').slice(0, 10);
    const channel = detectChannel(order);

    for (const item of order.line_items || []) {
      if (!item.sku) continue;
      const rawPrice  = parseFloat(item.price) || 0;
      const s         = skuMap[item.sku];
      const salePrice = rawPrice > 0
        ? rawPrice
        : s ? (channel === 'Amazon' ? Number(s.amazon_price) : Number(s.shopify_price)) : 0;

      orders.push({
        order_no:   order.name,
        order_date: date,
        sku:        item.sku,
        qty:        item.quantity || 1,
        channel,
        sale_price: salePrice,
        status:     'sold',
        note:       '',
      });
    }
  }
  return orders;
}

module.exports = { getAccessToken, fetchOrdersForMonth, processOrders };
