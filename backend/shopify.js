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

// Extract the Amazon Order ID from Shopify MCF orders.
// Shopify stores it in note_attributes as { name: "Amazon Order ID", value: "XXX-XXXXXXX-XXXXXXX" }.
// Falls back to source_identifier if it matches the Amazon order ID format.
function extractAmazonOrderId(order) {
  for (const attr of order.note_attributes || []) {
    const name = (attr.name || '').toLowerCase();
    if (name.includes('amazon') && name.includes('order')) return attr.value || null;
  }
  const src = order.source_identifier || '';
  if (/^\d{3}-\d{7}-\d{7}$/.test(src)) return src;
  return null;
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
    const date           = (order.created_at || '').slice(0, 10);
    const channel        = detectChannel(order);
    const amazonOrderId  = extractAmazonOrderId(order);

    for (const item of order.line_items || []) {
      if (!item.sku) continue;
      const rawPrice  = parseFloat(item.price) || 0;
      const s         = skuMap[item.sku];
      const salePrice = rawPrice > 0
        ? rawPrice
        : s ? (channel === 'Amazon' ? Number(s.amazon_price) : Number(s.shopify_price)) : 0;

      orders.push({
        order_no:        order.name,
        order_date:      date,
        sku:             item.sku,
        qty:             item.quantity || 1,
        channel,
        sale_price:      salePrice,
        status:          'sold',
        note:            '',
        amazon_order_id: amazonOrderId,
      });
    }
  }
  return orders;
}

/**
 * Find a Shopify order by its name (e.g. "#11407") and create a fulfillment
 * with the given UPS tracking number.
 *
 * Requires scopes: read_orders, read_merchant_managed_fulfillment_orders,
 *                  write_merchant_managed_fulfillment_orders
 *
 * Returns { shopify_order_id, fulfillment_id } on success.
 * Returns { shopify_order_id, fulfillment_id: null } if already fulfilled.
 * Throws on API error or if no open fulfillment order is found.
 */
async function updateShopifyTracking(store, token, orderName, trackingNumber) {
  // 1. Find the order by name
  const searchUrl = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
    `?name=${encodeURIComponent(orderName)}&status=any&fields=id,name,fulfillment_status&limit=5`;
  const searchRes = await fetch(searchUrl, { headers: { 'X-Shopify-Access-Token': token } });
  if (!searchRes.ok) throw new Error(`Shopify order search ${searchRes.status}: ${await searchRes.text()}`);
  const { orders } = await searchRes.json();
  if (!orders || !orders.length) throw new Error(`Order ${orderName} not found in Shopify`);
  const order = orders[0];

  if (order.fulfillment_status === 'fulfilled') {
    return { shopify_order_id: order.id, fulfillment_id: null };
  }

  // 2. Get open fulfillment orders (requires read_merchant_managed_fulfillment_orders)
  const foUrl = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.id}/fulfillment_orders.json`;
  const foRes = await fetch(foUrl, { headers: { 'X-Shopify-Access-Token': token } });
  if (!foRes.ok) throw new Error(`Shopify fulfillment orders ${foRes.status}: ${await foRes.text()}`);
  const { fulfillment_orders } = await foRes.json();

  const openFO = (fulfillment_orders || []).find(fo =>
    fo.status === 'open' || fo.status === 'in_progress' || fo.status === 'scheduled'
  );
  if (!openFO) throw new Error(`No open fulfillment order for ${orderName} (status: ${order.fulfillment_status})`);

  // 3. Create fulfillment with tracking (requires write_merchant_managed_fulfillment_orders)
  const fulfillUrl = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/fulfillments.json`;
  const fulfillRes = await fetch(fulfillUrl, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fulfillment: {
        line_items_by_fulfillment_order: [{ fulfillment_order_id: openFO.id }],
        tracking_info: {
          number:  trackingNumber,
          company: 'UPS',
          url:     `https://www.ups.com/track?tracknum=${trackingNumber}`,
        },
        notify_customer: true,
      },
    }),
  });
  if (!fulfillRes.ok) throw new Error(`Shopify create fulfillment ${fulfillRes.status}: ${await fulfillRes.text()}`);
  const { fulfillment } = await fulfillRes.json();

  return { shopify_order_id: order.id, fulfillment_id: fulfillment.id };
}

module.exports = { getAccessToken, fetchOrdersForMonth, processOrders, updateShopifyTracking };
