/**
 * Calculates commission for one order line.
 * Stored on save so historical commissions survive config changes.
 */
function calcCommission(skuRow, actualPrice, channel) {
  const price = actualPrice > 0
    ? actualPrice
    : (channel === 'Amazon' ? Number(skuRow.amazon_price) : Number(skuRow.shopify_price));

  const flat = Number(skuRow.flat_comm);
  const mkt  = skuRow.mkt_type === 'flat'
    ? Number(skuRow.mkt_value)
    : Math.round(price * Number(skuRow.mkt_value)) / 100;
  const amz  = channel === 'Amazon'
    ? Math.round(price * Number(skuRow.amazon_fee_pct)) / 100
    : 0;

  return {
    flat:  +flat.toFixed(2),
    mkt:   +mkt.toFixed(2),
    amz:   +amz.toFixed(2),
    total: +(flat + mkt + amz).toFixed(2),
  };
}

module.exports = { calcCommission };
