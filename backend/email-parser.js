/**
 * Email parsers for three inbound email types:
 *   1. LiftUp invoice email (from QuickBooks) → invoice_number, line items, amounts
 *   2. QB payment receipt                     → amount paid + invoice reference
 *   3. Bank transfer notification             → incoming commission amount
 *
 * Also exports compareInvoices() for line-by-line discrepancy detection.
 *
 * Known difference: our totals include shipping; LiftUp breaks shipping out as
 * a separate line on their invoice.  compareInvoices() accounts for this.
 */

const MONTH_NAMES = {
  january:'01', february:'02', march:'03', april:'04',
  may:'05', june:'06', july:'07', august:'08',
  september:'09', october:'10', november:'11', december:'12',
};

function parseAmountStr(str = '') {
  const m = str.replace(/,/g, '').match(/\$?\s*([\d]+\.\d{2})/);
  return m ? parseFloat(m[1]) : null;
}

function parseDate(text) {
  let m = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  m = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTH_NAMES[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[2]).padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function extractMonth(text) {
  let m = text.match(/(\d{4}-(?:0[1-9]|1[0-2]))\b/);
  if (m) return m[1];
  m = text.match(/([A-Za-z]+),?\s+(\d{4})/);
  if (m) {
    const mon = MONTH_NAMES[m[1].toLowerCase()];
    if (mon) return `${m[2]}-${mon}`;
  }
  return null;
}

/**
 * Like extractMonth but falls back to inferring the year when only a month name is present.
 * A month that's numerically greater than the current month is assumed to be last year.
 */
function extractMonthWithFallback(text) {
  const m = extractMonth(text);
  if (m) return m;

  const nameMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (!nameMatch) return null;

  const mon = MONTH_NAMES[nameMatch[1].toLowerCase()];
  const now  = new Date();
  let year   = now.getFullYear();
  if (parseInt(mon, 10) > now.getMonth() + 1) year -= 1;
  return `${year}-${mon}`;
}

/**
 * Detect which type of email this is based on subject + sender.
 * Returns: 'liftup_invoice' | 'qb_payment' | 'bank_transfer' | 'amazon_return' | 'unknown'
 */
function detectEmailType(subject = '', fromAddr = '') {
  const sub  = subject.toLowerCase();
  const from = fromAddr.toLowerCase();

  // Amazon return/refund notifications — check before generic invoice rules
  if (from.includes('amazon.com') || from.includes('amazon.co')) {
    if (sub.includes('refund') || sub.includes('return') || sub.includes('a-to-z')) {
      return 'amazon_return';
    }
  }
  // Also detect by subject alone when the Amazon Order ID format is present
  if ((sub.includes('refund') || sub.includes('return')) && /\d{3}-\d{7}-\d{7}/.test(subject)) {
    return 'amazon_return';
  }

  // UPS shipment notifications
  if (from.includes('ups.com') || sub.includes('ups ship') || sub.includes('ups shipment') ||
      /\b1z[a-z0-9]{16}\b/i.test(subject)) {
    return 'ups_shipment';
  }

  // Shopify new order notifications
  if (from.includes('shopify.com') || sub.includes('new order') ||
      (sub.includes('order') && /#\d{3,6}\b/.test(subject))) {
    return 'shopify_order';
  }

  if (from.includes('intuit.com') || from.includes('quickbooks.com')) {
    if (sub.includes('payment') || sub.includes('receipt')) return 'qb_payment';
    if (sub.includes('invoice'))                             return 'liftup_invoice';
  }

  const bankKeywords = ['transfer received','deposit','payment received','ach','wire','funds received','direct deposit'];
  if (bankKeywords.some(k => sub.includes(k))) return 'bank_transfer';

  if (sub.includes('invoice') && !sub.includes('receipt')) return 'liftup_invoice';
  if (sub.includes('payment') && (sub.includes('receipt') || sub.includes('confirmation'))) return 'qb_payment';

  return 'unknown';
}

/**
 * Parse Amazon "Refund Initiated" / return notification email.
 * Returns { amazon_order_id, refund_amount } or null if no order ID found.
 * amazon_order_id is the canonical Amazon format: XXX-XXXXXXX-XXXXXXX
 */
function parseAmazonReturnEmail(text = '', html = '', subject = '') {
  const body = text || html.replace(/<[^>]+>/g, ' ');
  const fullText = subject ? `${subject} ${body}` : body;

  const orderMatch = fullText.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (!orderMatch) return null;

  const amazon_order_id = orderMatch[1];

  const amtMatch = fullText.match(/(?:refund(?:ed)?|amount)[:\s]+\$?\s*([\d,]+\.\d{2})/i);
  const refund_amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;

  return { amazon_order_id, refund_amount };
}

// ── Line item extraction from QuickBooks HTML ─────────────────────────────────

/**
 * Parse line items from a QuickBooks invoice HTML body.
 * Returns array of { description, qty, unitPrice, lineTotal, isShipping }
 */
function parseLineItemsFromHTML(html = '') {
  const items = [];
  // Match every <tr>...</tr> block
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    // Extract <td> text content
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const text = tdMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      cells.push(text);
    }
    if (cells.length < 2) continue;

    // Last cell must look like a dollar amount (line total)
    const lineTotal = parseAmountStr(cells[cells.length - 1]);
    if (!lineTotal) continue;

    // Heuristic: if second-to-last cell is also a dollar amount → it's the unit price
    // and the cell before that is qty
    let unitPrice = null;
    let qty       = null;
    if (cells.length >= 4) {
      unitPrice = parseAmountStr(cells[cells.length - 2]);
      const qtyRaw = parseFloat(cells[cells.length - 3]);
      if (!isNaN(qtyRaw) && qtyRaw > 0 && qtyRaw < 10000) qty = qtyRaw;
    }

    const description = cells[0];
    const isShipping  = /shipping|freight|delivery/i.test(description);

    items.push({ description, qty, unitPrice, lineTotal, isShipping });
  }
  return items;
}

/**
 * Parse LiftUp's QuickBooks invoice email.
 * Returns { invoice_number, billing_month, amount, line_items, shipping_amount } or null.
 *
 * LiftUp's QB emails often omit an invoice number in the body (only "BALANCE DUE $X").
 * invoice_number will be null in that case — callers should not require it.
 * billing_month is extracted from the subject line when absent from the body.
 */
function parseLiftUpInvoiceEmail(text = '', html = '', subject = '') {
  const body = text || html.replace(/<[^>]+>/g, ' ');
  // Prepend subject so month and invoice-number regexes can match against it
  const fullText = subject ? `${subject} ${body}` : body;

  // Invoice number — requires explicit "Inv# 3316", "Invoice No. 3316", "Invoice #3316"
  // The keyword (no./#/number) is required to avoid false matches on "invoice is ready"
  const invMatch = fullText.match(/\binv(?:oice)?\s*(?:no\.?|#|number)\s*[:\s]*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
  const invoice_number = invMatch ? invMatch[1].trim() : null;

  // Total amount — "BALANCE DUE $7,920.00", "BALANCE DUE $USD 13,211.00", "Total: $X"
  const amtMatch = fullText.match(/(?:balance\s*due|total|amount\s*due|invoice\s*total)[:\s]+(?:\$\s*USD\s*|\$\s*)?([0-9,]+\.\d{2})/i);
  const amount   = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;

  // Billing month — try full text (subject included); fall back to month-name-only inference
  const billing_month = extractMonthWithFallback(fullText);

  // Nothing useful parsed at all — give up
  if (!amount && !billing_month) return null;

  // Line items (best-effort from HTML)
  const line_items     = parseLineItemsFromHTML(html);
  const shippingLine   = line_items.find(i => i.isShipping);
  const shipping_amount = shippingLine ? shippingLine.lineTotal : null;

  return { invoice_number, billing_month, amount, line_items, shipping_amount };
}

/**
 * Parse QuickBooks payment receipt email.
 * Returns { amount, reference, payment_date } or null.
 */
function parseQBPaymentEmail(text = '', html = '') {
  const body = text || html.replace(/<[^>]+>/g, ' ');

  const amtMatch = body.match(/(?:amount|total|payment)[:\s]+\$?\s*([\d,]+\.\d{2})/i);
  if (!amtMatch) return null;
  const amount = parseFloat(amtMatch[1].replace(/,/g, ''));

  const refMatch = body.match(/(?:invoice\s*(?:no\.?|#|number)?|ref(?:erence)?)[:\s]+([A-Z0-9][A-Z0-9\-\/]+)/i);
  const reference = refMatch ? refMatch[1].trim() : null;

  const payment_date = parseDate(body);

  return { amount, reference, payment_date };
}

/**
 * Parse bank transfer / deposit notification email.
 * Returns { amount, sender_name, payment_date } or null.
 */
function parseBankTransferEmail(text = '', html = '') {
  const body = text || html.replace(/<[^>]+>/g, ' ');

  const amount = parseAmountStr(body);
  if (!amount) return null;

  const senderMatch = body.match(/(?:from|originator|sender|received from)[:\s]+([A-Za-z0-9 ,\.]+?)(?:\s+on|\s+dated|\s+\$|\n|\.)/i);
  const sender_name = senderMatch ? senderMatch[1].trim() : null;

  const payment_date = parseDate(body);

  return { amount, sender_name, payment_date };
}

// ── Discrepancy comparison ────────────────────────────────────────────────────

function fmtAmt(n) {
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Compare our invoice orders against LiftUp's parsed email line items.
 *
 * ourOrders  — rows from the orders table (status='sold'), each with { sku, sku_name, qty, sale_price }
 * theirItems — line_items array from parseLiftUpInvoiceEmail
 * ourTotal   — invoice.total_retail (includes shipping)
 * theirTotal — parsed amount from their email
 *
 * Returns array of human-readable discrepancy strings (empty = no issues).
 * Known difference: their total excludes shipping; ours includes it.
 */
function compareInvoices(ourOrders, theirItems, ourTotal, theirTotal) {
  const notes = [];

  // ── Amount-level check ───────────────────────────────────────────────────
  const shippingLine  = theirItems.find(i => i.isShipping);
  const shippingAmt   = shippingLine ? (shippingLine.lineTotal || 0) : 0;
  // Their total should equal our total (we both include shipping value; they break it out separately)
  if (theirTotal !== null && Math.abs(ourTotal - theirTotal) > 0.01) {
    notes.push(`Total mismatch: our total ${fmtAmt(ourTotal)} vs their invoice total ${fmtAmt(theirTotal)} (Δ ${fmtAmt(Math.abs(ourTotal - theirTotal))})`);
  }
  if (shippingAmt > 0) {
    notes.push(`Shipping note: their invoice breaks out shipping separately (${fmtAmt(shippingAmt)}); our total includes shipping.`);
  }

  // ── Line-by-line SKU check ───────────────────────────────────────────────
  // Aggregate our sold orders by SKU
  const ourSkus = {};
  for (const o of ourOrders.filter(x => x.status === 'sold')) {
    if (!ourSkus[o.sku]) ourSkus[o.sku] = { sku: o.sku, name: o.sku_name || o.sku, qty: 0, total: 0 };
    ourSkus[o.sku].qty   += Number(o.qty   || 1);
    ourSkus[o.sku].total += Number(o.sale_price) * Number(o.qty || 1);
  }

  const theirProductLines = theirItems.filter(i => !i.isShipping);
  const matchedSkus       = new Set();

  // Skip line-by-line checks when no line items were parsed from the email
  // (suppresses false "missing SKU" notes for emails without structured tables)
  if (!theirProductLines.length) {
    return notes; // only total-level check above applies
  }

  for (const theirLine of theirProductLines) {
    // Match by SKU code or product name substring
    const ourSku = Object.values(ourSkus).find(s =>
      theirLine.description.toLowerCase().includes(s.sku.toLowerCase()) ||
      theirLine.description.toLowerCase().includes(s.name.toLowerCase())
    );

    if (!ourSku) {
      notes.push(`Unrecognised line item on their invoice: "${theirLine.description}" (${fmtAmt(theirLine.lineTotal)})`);
      continue;
    }

    matchedSkus.add(ourSku.sku);

    // Qty check
    if (theirLine.qty !== null && Math.abs(theirLine.qty - ourSku.qty) > 0.01) {
      notes.push(`Qty mismatch on ${ourSku.sku}: our qty ${ourSku.qty} vs their qty ${theirLine.qty}`);
    }

    // Line total check — allow the difference to be shipping (typically < $100)
    // Flag only if delta is > $1 after accounting for possible per-SKU shipping allocation
    if (theirLine.lineTotal !== null) {
      const delta = Math.abs(theirLine.lineTotal - ourSku.total);
      const pctDiff = ourSku.total > 0 ? delta / ourSku.total : 1;
      if (delta > 1.00 && pctDiff > 0.02) {
        notes.push(`Amount mismatch on ${ourSku.sku}: our total ${fmtAmt(ourSku.total)} vs their line ${fmtAmt(theirLine.lineTotal)} (Δ ${fmtAmt(delta)})`);
      }
    }
  }

  // SKUs we have that don't appear on their invoice
  for (const ourSku of Object.values(ourSkus)) {
    if (!matchedSkus.has(ourSku.sku)) {
      notes.push(`SKU in our records missing from their invoice: ${ourSku.sku} (${ourSku.name}, ${fmtAmt(ourSku.total)})`);
    }
  }

  return notes;
}

/**
 * Parse a Shopify new order notification email.
 * Returns { order_no, shopify_order_id } or null.
 * order_no is in the canonical Shopify format: #11407
 * shopify_order_id is the internal numeric Shopify ID (BigInt-safe string) when found.
 */
function parseShopifyOrderEmail(text = '', html = '', subject = '') {
  const body = text || html.replace(/<[^>]+>/g, ' ');
  const fullText = subject ? `${subject} ${body}` : body;

  // Order number: "#11407", "Order #11407", "order number 11407"
  const orderMatch = fullText.match(/#(\d{3,6})\b/);
  if (!orderMatch) return null;
  const order_no = '#' + orderMatch[1];

  // Shopify internal order ID from URL (e.g. /orders/6123456789012)
  const idMatch = (html || '').match(/\/orders\/(\d{8,})/);
  const shopify_order_id = idMatch ? idMatch[1] : null;

  return { order_no, shopify_order_id };
}

/**
 * Parse a UPS shipment notification email.
 * Returns { tracking_number, order_no, shipped_at } or null.
 * UPS tracking numbers start with 1Z followed by 16 alphanumeric chars.
 * order_no is extracted from "Reference Number 1" field (LiftUp uses Shopify order # there).
 */
function parseUPSShipmentEmail(text = '', html = '', subject = '') {
  const body = text || html.replace(/<[^>]+>/g, ' ');
  const fullText = subject ? `${subject} ${body}` : body;

  // UPS tracking number: 1Z + 16 alphanumeric chars
  const trackMatch = fullText.match(/\b(1Z[A-Z0-9]{16})\b/i);
  if (!trackMatch) return null;
  const tracking_number = trackMatch[1].toUpperCase();

  // "Reference Number 1: #11407" or "Reference No. 1: 11407" or "Reference 1 : 11407"
  const refMatch = fullText.match(/[Rr]eference\s+(?:[Nn](?:o|umber|o\.)?\s*)?1\s*[:\-]\s*#?(\d{3,6})\b/);
  const order_no = refMatch ? '#' + refMatch[1] : null;

  const shipped_at = parseDate(body);

  return { tracking_number, order_no, shipped_at };
}

module.exports = {
  detectEmailType,
  parseLiftUpInvoiceEmail,
  parseQBPaymentEmail,
  parseBankTransferEmail,
  parseAmazonReturnEmail,
  parseShopifyOrderEmail,
  parseUPSShipmentEmail,
  compareInvoices,
};
