export function calcCommission(skuRow, actualPrice, channel) {
  const price = actualPrice > 0
    ? actualPrice
    : (channel === 'Amazon' ? Number(skuRow.amazon_price) : Number(skuRow.shopify_price))

  const flat = Number(skuRow.flat_comm)
  const mkt  = skuRow.mkt_type === 'flat'
    ? Number(skuRow.mkt_value)
    : Math.round(price * Number(skuRow.mkt_value)) / 100
  const amz  = channel === 'Amazon'
    ? Math.round(price * Number(skuRow.amazon_fee_pct)) / 100
    : 0

  return {
    flat:  +flat.toFixed(2),
    mkt:   +mkt.toFixed(2),
    amz:   +amz.toFixed(2),
    total: +(flat + mkt + amz).toFixed(2),
  }
}

export function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function fmtMonth(m) {
  if (!m) return '—'
  return new Date(m + '-15').toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

// Parse Shopify multi-line CSV (Notes field spans multiple raw lines)
export function parseShopifyCSV(text, targetMonth, skuMap) {
  const rawLines = text.split(/\r?\n/)
  const logical  = []
  let cur = ''

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (i === 0) { logical.push(line); continue }
    if (/^(#\d|Name,)/.test(line.trim())) {
      if (cur) logical.push(cur)
      cur = line
    } else {
      cur += ' ' + line
    }
  }
  if (cur) logical.push(cur)

  function splitCSV(line) {
    const res = []; let s = '', inQ = false
    for (const c of line) {
      if (c === '"') { inQ = !inQ; continue }
      if (c === ',' && !inQ) { res.push(s.trim()); s = ''; continue }
      s += c
    }
    res.push(s.trim())
    return res
  }

  const headers = splitCSV(logical[0]).map(h => h.toLowerCase().trim())
  const fi = (...keys) => headers.findIndex(h => keys.some(k => h.includes(k)))

  const iOrder = fi('name')
  const iDate  = fi('created at')
  const iSKU   = fi('lineitem sku')
  const iQty   = fi('lineitem quantity')
  const iPrice = fi('lineitem price')
  const iSrc   = fi('source')
  const iTags  = fi('tags')
  const iSM    = fi('shipping method')

  // First pass: build orderNo → channel map
  const channelMap = {}
  for (let i = 1; i < logical.length; i++) {
    const cols = splitCSV(logical[i])
    const orderNo = (cols[iOrder] || '').trim()
    if (!orderNo || channelMap[orderNo]) continue
    const src  = (iSrc  >= 0 ? cols[iSrc]  || '' : '').toLowerCase()
    const tags = (iTags >= 0 ? cols[iTags] || '' : '').toLowerCase()
    const sm   = (iSM   >= 0 ? cols[iSM]  || '' : '').toLowerCase()
    channelMap[orderNo] =
      src.includes('amazon') || tags.includes('amazon') || sm.includes('amazon')
        ? 'Amazon'
        : src.includes('walmart') || tags.includes('walmart')
          ? 'Walmart'
          : 'Shopify'
  }

  // Second pass: extract line items
  const orders = []
  for (let i = 1; i < logical.length; i++) {
    const cols    = splitCSV(logical[i])
    const sku     = (iSKU >= 0 ? cols[iSKU] || '' : '').trim()
    if (!sku) continue
    const date    = (iDate >= 0 ? cols[iDate] || '' : '').slice(0, 10)
    if (targetMonth && date && !date.startsWith(targetMonth)) continue
    const orderNo = (cols[iOrder] || `#${i}`).trim()
    const qty     = parseInt(cols[iQty] || '1') || 1
    const channel = channelMap[orderNo] || 'Shopify'
    const rawPrice = parseFloat((cols[iPrice] || '').replace(/[$,]/g, '')) || 0
    const s = skuMap[sku]
    const salePrice = rawPrice > 0 ? rawPrice
      : s ? (channel === 'Amazon' ? Number(s.amazon_price) : Number(s.shopify_price)) : 0
    orders.push({ order_no: orderNo, order_date: date, sku, qty, channel, sale_price: salePrice, status: 'sold', note: '' })
  }
  return orders
}

export const STATUS_OPTIONS = [
  { val: 'sold',     label: 'Sold' },
  { val: 'before',   label: 'Returned (before invoice)' },
  { val: 'after',    label: 'Returned (credit memo needed)' },
  { val: 'warranty', label: 'Warranty replacement' },
  { val: 'rental',   label: 'Rental charge' },
]
