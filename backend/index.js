require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
const { calcCommission } = require('./commission');
const { getAccessToken, fetchOrdersForMonth, processOrders } = require('./shopify');
const { detectEmailType, parseLiftUpInvoiceEmail, parseQBPaymentEmail, parseBankTransferEmail, compareInvoices } = require('./email-parser');
const { fetchFolderMessages, fetchUnreadMessages, fetchMessageContent, markAsRead, sendEmail } = require('./zoho-mail');
const { buildSalesReport, buildCommissionInvoice } = require('./report-generator');

const app  = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '5mb' }));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// ── SKU CONFIG ──────────────────────────────────────────────────────────────
app.get('/api/skus', async (_, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sku_config WHERE active = TRUE ORDER BY id'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/skus', async (req, res) => {
  const { sku, name, shopify_price, amazon_price, flat_comm, mkt_type, mkt_value, amazon_fee_pct } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO sku_config
         (sku, name, shopify_price, amazon_price, flat_comm, mkt_type, mkt_value, amazon_fee_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [sku, name, shopify_price, amazon_price, flat_comm, mkt_type, mkt_value, amazon_fee_pct]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/skus/:id', async (req, res) => {
  const { name, shopify_price, amazon_price, flat_comm, mkt_type, mkt_value, amazon_fee_pct } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE sku_config
       SET name=$1, shopify_price=$2, amazon_price=$3, flat_comm=$4,
           mkt_type=$5, mkt_value=$6, amazon_fee_pct=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [name, shopify_price, amazon_price, flat_comm, mkt_type, mkt_value, amazon_fee_pct, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'SKU not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/skus/:id', async (req, res) => {
  try {
    await pool.query('UPDATE sku_config SET active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── INVOICE LIST ────────────────────────────────────────────────────────────
app.get('/api/invoices', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM invoices ORDER BY month DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SINGLE INVOICE ──────────────────────────────────────────────────────────
app.get('/api/invoices/:month', async (req, res) => {
  try {
    const { rows: inv } = await pool.query(
      'SELECT * FROM invoices WHERE month=$1', [req.params.month]
    );
    if (!inv.length) return res.status(404).json({ error: 'Not found' });
    const id = inv[0].id;
    const { rows: orders } = await pool.query(
      'SELECT * FROM orders WHERE invoice_id=$1 ORDER BY order_date, id', [id]
    );
    const { rows: adjustments } = await pool.query(
      'SELECT * FROM adjustments WHERE invoice_id=$1 ORDER BY id', [id]
    );
    res.json({ ...inv[0], orders, adjustments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SAVE / UPSERT FULL INVOICE ───────────────────────────────────────────────
app.post('/api/invoices/:month', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { month } = req.params;
    const {
      invoice_number, notes,
      verified, verified_date,
      mfr_invoice_paid, mfr_invoice_paid_date,
      commission_paid, commission_paid_date,
      orders = [], adjustments = [],
    } = req.body;

    // Get current SKUs for commission calculation
    const { rows: skus } = await client.query('SELECT * FROM sku_config WHERE active=TRUE');
    const skuMap = Object.fromEntries(skus.map(s => [s.sku, s]));

    // Enrich orders with calculated commissions
    const enriched = orders.map(o => {
      const s = skuMap[o.sku];
      const comm = s
        ? calcCommission(s, Number(o.sale_price), o.channel)
        : { flat: 0, mkt: 0, amz: 0, total: 0 };
      return { ...o, ...comm };
    });

    const sold   = enriched.filter(o => o.status === 'sold');
    const credit = enriched.filter(o => o.status === 'after');
    const adjSum = adjustments.reduce((s, a) => s + Number(a.amount), 0);

    const totalRetail     = +sold.reduce((s, o) => s + Number(o.sale_price) * o.qty, 0).toFixed(2);
    const totalCommission = +sold.reduce((s, o) => s + o.total * o.qty, 0).toFixed(2);
    const totalCredit     = +credit.reduce((s, o) => s + Number(o.sale_price) * o.qty, 0).toFixed(2);

    // Upsert invoice row
    const { rows: inv } = await client.query(
      `INSERT INTO invoices
         (month, invoice_number, total_retail, total_commission, total_credit,
          verified, verified_date, mfr_invoice_paid, mfr_invoice_paid_date,
          commission_paid, commission_paid_date, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (month) DO UPDATE SET
         invoice_number        = EXCLUDED.invoice_number,
         total_retail          = EXCLUDED.total_retail,
         total_commission      = EXCLUDED.total_commission,
         total_credit          = EXCLUDED.total_credit,
         verified              = EXCLUDED.verified,
         verified_date         = EXCLUDED.verified_date,
         mfr_invoice_paid      = EXCLUDED.mfr_invoice_paid,
         mfr_invoice_paid_date = EXCLUDED.mfr_invoice_paid_date,
         commission_paid       = EXCLUDED.commission_paid,
         commission_paid_date  = EXCLUDED.commission_paid_date,
         notes                 = EXCLUDED.notes,
         updated_at            = NOW()
       RETURNING *`,
      [month, invoice_number || null, totalRetail, totalCommission, totalCredit,
       verified || false, verified_date || null,
       mfr_invoice_paid || false, mfr_invoice_paid_date || null,
       commission_paid || false, commission_paid_date || null,
       notes || null]
    );
    const invoiceId = inv[0].id;

    // Replace all orders for this invoice
    await client.query('DELETE FROM orders WHERE invoice_id=$1', [invoiceId]);
    for (const o of enriched) {
      await client.query(
        `INSERT INTO orders
           (invoice_id, order_no, order_date, sku, qty, channel, sale_price,
            status, note, comm_flat, comm_mkt, comm_amz, comm_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [invoiceId, o.order_no || null, o.order_date || null,
         o.sku, o.qty || 1, o.channel, o.sale_price,
         o.status || 'sold', o.note || null,
         o.flat, o.mkt, o.amz, o.total]
      );
    }

    // Replace adjustments (preserve any auto-applied credit adjustments passed back from frontend)
    await client.query('DELETE FROM adjustments WHERE invoice_id=$1', [invoiceId]);
    for (const a of adjustments) {
      await client.query(
        `INSERT INTO adjustments (invoice_id, label, amount, adj_type)
         VALUES ($1,$2,$3,$4)`,
        [invoiceId, a.label, a.amount, a.adj_type || 'other']
      );
    }

    // ── Auto-generate credits for 'after' orders ─────────────────────────────
    // Only delete open credits — applied credits must survive re-save
    await client.query(
      `DELETE FROM credits WHERE source_invoice_id=$1 AND status='open'`, [invoiceId]
    );
    const afterOrders = enriched.filter(o => o.status === 'after');
    for (const o of afterOrders) {
      const s = skuMap[o.sku];
      const skuName = s ? s.name : o.sku;
      // Retail credit: reduces what we owe LiftUp
      await client.query(
        `INSERT INTO credits (source_invoice_id, credit_type, sku, sku_name, amount, source_month)
         VALUES ($1,'retail',$2,$3,$4,$5)`,
        [invoiceId, o.sku, skuName, +(Number(o.sale_price) * (o.qty || 1)).toFixed(2), month]
      );
      // Commission credit: reduces what LiftUp owes us
      await client.query(
        `INSERT INTO credits (source_invoice_id, credit_type, sku, sku_name, amount, source_month)
         VALUES ($1,'commission',$2,$3,$4,$5)`,
        [invoiceId, o.sku, skuName, +(o.total * (o.qty || 1)).toFixed(2), month]
      );
    }

    // ── Auto-apply open credits from prior months ─────────────────────────────
    const { rows: openCredits } = await client.query(
      `SELECT * FROM credits WHERE status='open' AND source_month < $1 ORDER BY source_month, id`,
      [month]
    );
    for (const credit of openCredits) {
      const label = `Credit memo - ${credit.sku_name} (from ${credit.source_month})`;
      await client.query(
        `INSERT INTO adjustments (invoice_id, label, amount, adj_type) VALUES ($1,$2,$3,'credit')`,
        [invoiceId, label, -Number(credit.amount)]
      );
      await client.query(
        `UPDATE credits SET status='applied', receiving_invoice_id=$1, applied_at=NOW() WHERE id=$2`,
        [invoiceId, credit.id]
      );
    }

    await client.query('COMMIT');

    // Return the full saved invoice
    const { rows: finalOrders } = await client.query(
      'SELECT * FROM orders WHERE invoice_id=$1 ORDER BY order_date, id', [invoiceId]
    );
    const { rows: finalAdj } = await client.query(
      'SELECT * FROM adjustments WHERE invoice_id=$1 ORDER BY id', [invoiceId]
    );
    res.json({ ...inv[0], orders: finalOrders, adjustments: finalAdj, applied_credits: openCredits });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── QUICK STATUS PATCH (no order reload needed) ─────────────────────────────
app.patch('/api/invoices/:month/status', async (req, res) => {
  const fields = ['invoice_number','verified','verified_date',
    'mfr_invoice_paid','mfr_invoice_paid_date',
    'commission_paid','commission_paid_date','notes'];
  const sets = []; const vals = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      sets.push(`${f}=$${vals.length + 1}`);
      vals.push(req.body[f]);
    }
  });
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.month);
  try {
    const { rows } = await pool.query(
      `UPDATE invoices SET ${sets.join(',')}, updated_at=NOW()
       WHERE month=$${vals.length} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE INVOICE ──────────────────────────────────────────────────────────
app.delete('/api/invoices/:month', async (req, res) => {
  try {
    await pool.query('DELETE FROM invoices WHERE month=$1', [req.params.month]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SHOPIFY SYNC ─────────────────────────────────────────────────────────────
// Shared logic: fetch Shopify orders for a month, enrich, and save/upsert invoice
async function syncMonth(month) {
  const store        = process.env.SHOPIFY_STORE;
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!store || !clientId || !clientSecret)
    throw new Error('Shopify not configured — set SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET');

  const token = await getAccessToken(store, clientId, clientSecret);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: skus } = await client.query('SELECT * FROM sku_config WHERE active=TRUE');
    const skuMap = Object.fromEntries(skus.map(s => [s.sku, s]));

    // Fetch fresh orders from Shopify
    const shopifyOrders = await fetchOrdersForMonth(store, token, month);
    const orders = processOrders(shopifyOrders, skuMap);

    // Preserve existing invoice status fields and adjustments if invoice already exists
    const { rows: existing } = await client.query(
      'SELECT * FROM invoices WHERE month=$1', [month]
    );
    const prev = existing[0] || {};

    let adjustments = [];
    if (prev.id) {
      const { rows: prevAdj } = await client.query(
        'SELECT label, amount, adj_type FROM adjustments WHERE invoice_id=$1', [prev.id]
      );
      adjustments = prevAdj;
    }

    // Enrich orders with commissions
    const enriched = orders.map(o => {
      const s = skuMap[o.sku];
      const comm = s
        ? calcCommission(s, Number(o.sale_price), o.channel)
        : { flat: 0, mkt: 0, amz: 0, total: 0 };
      return { ...o, ...comm };
    });

    const sold   = enriched.filter(o => o.status === 'sold');
    const credit = enriched.filter(o => o.status === 'after');
    const adjSum = adjustments.reduce((s, a) => s + Number(a.amount), 0);

    const totalRetail      = +sold.reduce((s, o) => s + Number(o.sale_price) * o.qty, 0).toFixed(2);
    const totalCommission  = +sold.reduce((s, o) => s + o.total * o.qty, 0).toFixed(2);
    const totalCredit      = +credit.reduce((s, o) => s + Number(o.sale_price) * o.qty, 0).toFixed(2);

    const { rows: inv } = await client.query(
      `INSERT INTO invoices
         (month, invoice_number, total_retail, total_commission, total_credit,
          verified, verified_date, mfr_invoice_paid, mfr_invoice_paid_date,
          commission_paid, commission_paid_date, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (month) DO UPDATE SET
         total_retail          = EXCLUDED.total_retail,
         total_commission      = EXCLUDED.total_commission,
         total_credit          = EXCLUDED.total_credit,
         updated_at            = NOW()
       RETURNING *`,
      [month, prev.invoice_number || null, totalRetail, totalCommission, totalCredit,
       prev.verified || false, prev.verified_date || null,
       prev.mfr_invoice_paid || false, prev.mfr_invoice_paid_date || null,
       prev.commission_paid || false, prev.commission_paid_date || null,
       prev.notes || null]
    );
    const invoiceId = inv[0].id;

    await client.query('DELETE FROM orders WHERE invoice_id=$1', [invoiceId]);
    for (const o of enriched) {
      await client.query(
        `INSERT INTO orders
           (invoice_id, order_no, order_date, sku, qty, channel, sale_price,
            status, note, comm_flat, comm_mkt, comm_amz, comm_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [invoiceId, o.order_no || null, o.order_date || null,
         o.sku, o.qty || 1, o.channel, o.sale_price,
         o.status || 'sold', o.note || null,
         o.flat, o.mkt, o.amz, o.total]
      );
    }

    // Re-insert preserved adjustments
    await client.query('DELETE FROM adjustments WHERE invoice_id=$1', [invoiceId]);
    for (const a of adjustments) {
      await client.query(
        `INSERT INTO adjustments (invoice_id, label, amount, adj_type) VALUES ($1,$2,$3,$4)`,
        [invoiceId, a.label, a.amount, a.adj_type || 'other']
      );
    }

    await client.query('COMMIT');

    const { rows: finalOrders } = await client.query(
      'SELECT * FROM orders WHERE invoice_id=$1 ORDER BY order_date, id', [invoiceId]
    );
    const { rows: finalAdj } = await client.query(
      'SELECT * FROM adjustments WHERE invoice_id=$1 ORDER BY id', [invoiceId]
    );
    return { ...inv[0], orders: finalOrders, adjustments: finalAdj };

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Manual sync trigger — POST /api/sync/:month
app.post('/api/sync/:month', async (req, res) => {
  try {
    const result = await syncMonth(req.params.month);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Vercel cron — GET /api/cron/monthly-sync (runs 1st of each month at 08:00 UTC)
// Sequence: sync Shopify → auto-save invoice → send sales report → send commission invoice
app.get('/api/cron/monthly-sync', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const month = d.toISOString().slice(0, 7);
  const log   = [];

  try {
    // 1 — Sync Shopify orders into DB
    const syncResult = await syncMonth(month);
    log.push(`synced ${syncResult.orders.length} orders`);

    // 2 — Load invoice + orders (sync already upserted the invoice row)
    const { rows: invRows } = await pool.query('SELECT * FROM invoices WHERE month=$1', [month]);
    if (!invRows.length) throw new Error(`Invoice row not found after sync for ${month}`);
    const invoice = invRows[0];

    const { rows: orders } = await pool.query(
      `SELECT o.*, s.name AS sku_name
       FROM orders o LEFT JOIN sku_config s ON s.sku = o.sku
       WHERE o.invoice_id = $1 ORDER BY o.order_date, o.id`,
      [invoice.id]
    );
    const { rows: adjustments } = await pool.query(
      'SELECT * FROM adjustments WHERE invoice_id=$1 ORDER BY id', [invoice.id]
    );

    // 3 — Generate and send reports (only if LIFTUP_EMAIL is configured)
    const liftupEmail = process.env.LIFTUP_EMAIL;
    const notifyCC    = process.env.OUR_EMAIL;

    if (liftupEmail) {
      const salesReport = await buildSalesReport(invoice, orders, month);
      await sendEmail({
        to:      liftupEmail,
        cc:      notifyCC,
        subject: salesReport.subject,
        html:    salesReport.html,
      });
      log.push('sales report sent');

      const commInvoice = await buildCommissionInvoice(invoice, orders, adjustments, month);
      await sendEmail({
        to:      liftupEmail,
        cc:      notifyCC,
        subject: commInvoice.subject,
        html:    commInvoice.html,
      });
      log.push('commission invoice sent');
    } else {
      log.push('LIFTUP_EMAIL not set — reports generated but not sent');
    }

    console.log(`Cron monthly-sync complete: ${month} — ${log.join(', ')}`);
    res.json({ ok: true, month, orders: syncResult.orders.length, log });
  } catch (e) {
    console.error(`Cron monthly-sync failed: ${month}`, e.message);
    res.status(500).json({ error: e.message, month, log });
  }
});

// ── PAYMENT STATUS (for allocation modal) ───────────────────────────────────
app.get('/api/invoices/payment-status', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*,
        COALESCE(SUM(a.amount), 0) AS adj_sum
      FROM invoices i
      LEFT JOIN adjustments a ON a.invoice_id = i.id
      GROUP BY i.id
      ORDER BY i.month DESC
    `);
    const result = rows.map(r => ({
      ...r,
      net_owed_to_liftup: +(Number(r.total_retail) + Number(r.adj_sum) - Number(r.total_commission)).toFixed(2),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PAYMENTS ─────────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, json_agg(json_build_object(
          'id', pa.id, 'invoice_id', pa.invoice_id, 'amount', pa.amount,
          'month', i.month, 'invoice_number', i.invoice_number
        ) ORDER BY pa.id) FILTER (WHERE pa.id IS NOT NULL) AS allocations
       FROM payments p
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
       LEFT JOIN invoices i ON i.id = pa.invoice_id
       WHERE ($1::text IS NULL OR p.payment_type = $1)
       GROUP BY p.id ORDER BY p.payment_date DESC`,
      [req.query.type || null]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payments', async (req, res) => {
  const { payment_type, payment_date, amount, reference, notes, allocations = [], payment_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allocTotal = allocations.reduce((s, a) => s + Number(a.amount), 0);
    if (allocTotal > Number(amount) + 0.01) {
      return res.status(400).json({ error: 'Allocated amount exceeds payment total' });
    }

    let pid = payment_id;
    if (pid) {
      // Update existing payment (e.g. one detected via bank email being allocated now)
      await client.query(
        `UPDATE payments SET payment_date=$1, amount=$2, reference=$3, notes=$4 WHERE id=$5`,
        [payment_date, amount, reference || null, notes || null, pid]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO payments (payment_type, payment_date, amount, reference, notes, source)
         VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id`,
        [payment_type, payment_date, amount, reference || null, notes || null]
      );
      pid = rows[0].id;
    }

    for (const alloc of allocations) {
      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount)
         VALUES ($1,$2,$3) ON CONFLICT (payment_id, invoice_id) DO UPDATE SET amount=$3`,
        [pid, alloc.invoice_id, alloc.amount]
      );

      const amtCol = payment_type === 'commission' ? 'commission_amount_received' : 'mfr_amount_paid';
      const paidCol = payment_type === 'commission' ? 'commission_paid' : 'mfr_invoice_paid';
      const dateCol = payment_type === 'commission' ? 'commission_paid_date' : 'mfr_invoice_paid_date';

      // Recalculate total received for this invoice across all allocations
      const { rows: sumRows } = await client.query(
        `SELECT COALESCE(SUM(pa.amount),0) AS total_received,
                i.total_retail, i.total_commission,
                COALESCE(SUM(a.amount),0) AS adj_sum
         FROM invoices i
         LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
           AND (SELECT payment_type FROM payments WHERE id = pa.payment_id) = $2
         LEFT JOIN adjustments a ON a.invoice_id = i.id
         WHERE i.id = $1
         GROUP BY i.id`,
        [alloc.invoice_id, payment_type]
      );
      const s = sumRows[0];
      const totalReceived = Number(s.total_received);
      const threshold = payment_type === 'commission'
        ? Number(s.total_commission)
        : +(Number(s.total_retail) + Number(s.adj_sum) - Number(s.total_commission)).toFixed(2);
      const fullyPaid = totalReceived >= threshold - 0.01;

      await client.query(
        `UPDATE invoices SET ${amtCol}=$1, ${paidCol}=$2,
          ${dateCol}=CASE WHEN $2 THEN COALESCE(${dateCol},$3::date) ELSE ${dateCol} END
         WHERE id=$4`,
        [totalReceived, fullyPaid, payment_date, alloc.invoice_id]
      );
    }

    await client.query('COMMIT');

    const { rows: result } = await pool.query(
      `SELECT p.*, json_agg(json_build_object(
          'id', pa.id, 'invoice_id', pa.invoice_id, 'amount', pa.amount,
          'month', i.month
        ) ORDER BY pa.id) FILTER (WHERE pa.id IS NOT NULL) AS allocations
       FROM payments p
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
       LEFT JOIN invoices i ON i.id = pa.invoice_id
       WHERE p.id=$1 GROUP BY p.id`,
      [pid]
    );
    res.status(201).json(result[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── CREDITS ──────────────────────────────────────────────────────────────────
app.get('/api/credits', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        ri.month AS receiving_month
      FROM credits c
      LEFT JOIN invoices ri ON ri.id = c.receiving_invoice_id
      ORDER BY c.source_month DESC, c.id
    `);
    res.json({
      open:    rows.filter(r => r.status === 'open'),
      applied: rows.filter(r => r.status === 'applied'),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── EMAIL PROCESSING (shared logic used by the Zoho poll endpoint) ───────────
async function processEmail(subject, fromAddr, text, html) {
  const emailType = detectEmailType(subject, fromAddr);

  // ── LiftUp invoice email → auto-populate invoice_number ──────────────────
  if (emailType === 'liftup_invoice') {
    const parsed = parseLiftUpInvoiceEmail(text, html);
    if (!parsed) {
      await pool.query(
        `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'no_invoice_number')`,
        [subject, fromAddr, text]
      );
      return { type: 'unmatched', reason: 'no_invoice_number' };
    }
    if (!parsed.billing_month) {
      await pool.query(
        `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'no_billing_month')`,
        [subject, fromAddr, text]
      );
      return { type: 'unmatched', reason: 'no_billing_month' };
    }
    const { rows: inv } = await pool.query(
      `SELECT i.*, COALESCE(SUM(a.amount),0) AS adj_sum
       FROM invoices i LEFT JOIN adjustments a ON a.invoice_id = i.id
       WHERE i.month=$1 GROUP BY i.id`,
      [parsed.billing_month]
    );
    if (!inv.length) {
      await pool.query(
        `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'no_matching_invoice')`,
        [subject, fromAddr, text]
      );
      return { type: 'unmatched', reason: 'no_matching_invoice' };
    }
    const invoice = inv[0];

    // Fetch orders for line-by-line comparison
    const { rows: orders } = await pool.query(
      `SELECT o.*, s.name AS sku_name
       FROM orders o LEFT JOIN sku_config s ON s.sku = o.sku
       WHERE o.invoice_id = $1`,
      [invoice.id]
    );

    // Compare line items and build discrepancy notes
    const mismatchNotes = compareInvoices(
      orders,
      parsed.line_items || [],
      Number(invoice.total_retail),
      parsed.amount
    );

    await pool.query(
      `UPDATE invoices
       SET invoice_number=$1,
           email_invoice_total=$2,
           email_line_items=$3,
           mismatch_notes=$4,
           updated_at=NOW()
       WHERE id=$5`,
      [
        parsed.invoice_number,
        parsed.amount,
        JSON.stringify(parsed.line_items || []),
        mismatchNotes.length ? mismatchNotes.join('\n') : null,
        invoice.id,
      ]
    );

    return {
      type:           'liftup_invoice',
      matched_month:  parsed.billing_month,
      invoice_number: parsed.invoice_number,
      discrepancies:  mismatchNotes,
    };
  }

  // ── QB payment receipt → record payment to LiftUp ────────────────────────
  if (emailType === 'qb_payment') {
    const parsed = parseQBPaymentEmail(text, html);
    if (!parsed) {
      await pool.query(
        `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'no_amount')`,
        [subject, fromAddr, text]
      );
      return { type: 'unmatched', reason: 'no_amount' };
    }
    const { rows: inv } = parsed.reference
      ? await pool.query('SELECT id, month, total_retail, total_commission FROM invoices WHERE invoice_number=$1', [parsed.reference])
      : { rows: [] };

    const { rows: [payment] } = await pool.query(
      `INSERT INTO payments (payment_type, payment_date, amount, reference, source, raw_email_text)
       VALUES ('liftup_invoice',$1,$2,$3,'email',$4) RETURNING id`,
      [parsed.payment_date, parsed.amount, parsed.reference || null, text]
    );

    let fullyPaid = false;
    let matchedMonth = null;

    if (inv.length) {
      const invoice = inv[0];
      matchedMonth  = invoice.month;
      const { rows: adjRows } = await pool.query(
        'SELECT COALESCE(SUM(amount),0) AS adj_sum FROM adjustments WHERE invoice_id=$1', [invoice.id]
      );
      const netOwed = +(Number(invoice.total_retail) + Number(adjRows[0].adj_sum) - Number(invoice.total_commission)).toFixed(2);
      await pool.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES ($1,$2,$3)`,
        [payment.id, invoice.id, parsed.amount]
      );
      const { rows: sumRows } = await pool.query(
        `SELECT COALESCE(SUM(pa.amount),0) AS total_paid FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.invoice_id=$1 AND p.payment_type='liftup_invoice'`,
        [invoice.id]
      );
      const totalPaid = Number(sumRows[0].total_paid);
      fullyPaid = totalPaid >= netOwed - 0.01;
      await pool.query(
        `UPDATE invoices SET mfr_amount_paid=$1, mfr_invoice_paid=$2,
          mfr_invoice_paid_date=CASE WHEN $2 THEN COALESCE(mfr_invoice_paid_date,$3::date) ELSE mfr_invoice_paid_date END
         WHERE id=$4`,
        [totalPaid, fullyPaid, parsed.payment_date, invoice.id]
      );
    } else {
      await pool.query(
        `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'no_matching_invoice')`,
        [subject, fromAddr, text]
      );
    }
    return { type: 'qb_payment', payment_id: payment.id, matched_month: matchedMonth, fully_paid: fullyPaid };
  }

  // ── Bank transfer → create unallocated commission receipt ─────────────────
  if (emailType === 'bank_transfer') {
    const parsed = parseBankTransferEmail(text, html);
    if (!parsed) {
      await pool.query(
        `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'no_amount')`,
        [subject, fromAddr, text]
      );
      return { type: 'unmatched', reason: 'no_amount' };
    }
    const { rows: [payment] } = await pool.query(
      `INSERT INTO payments (payment_type, payment_date, amount, reference, source, raw_email_text)
       VALUES ('commission',$1,$2,$3,'email',$4) RETURNING id`,
      [parsed.payment_date, parsed.amount, parsed.sender_name || null, text]
    );
    return { type: 'bank_transfer', payment_id: payment.id, amount: parsed.amount, needs_allocation: true };
  }

  // ── Unknown — store for manual review ────────────────────────────────────
  await pool.query(
    `INSERT INTO unmatched_emails (subject, from_addr, text_body, reason) VALUES ($1,$2,$3,'unknown_type')`,
    [subject, fromAddr, text]
  );
  return { type: 'unmatched', reason: 'unknown_type' };
}

// ── ZOHO MAIL POLL ─────────────────────────────────────────────────────────────
// Triggered by Vercel cron (GET with CRON_SECRET) or manually from the Dashboard.
// Fetches all unread emails from Zoho, processes each, marks as read.
app.get('/api/email/poll', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}` && req.query.token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Poll specific folders if configured; fall back to full-inbox search
    const invoiceFolderId = process.env.ZOHO_INVOICE_FOLDER_ID;
    const paymentFolderId = process.env.ZOHO_PAYMENT_FOLDER_ID;
    const creditFolderId  = process.env.ZOHO_CREDIT_FOLDER_ID;

    let messages;
    if (invoiceFolderId || paymentFolderId) {
      const results = await Promise.allSettled([
        invoiceFolderId ? fetchFolderMessages(invoiceFolderId, 50) : Promise.resolve([]),
        paymentFolderId ? fetchFolderMessages(paymentFolderId, 50) : Promise.resolve([]),
        creditFolderId  ? fetchFolderMessages(creditFolderId,  50) : Promise.resolve([]),
      ]);
      messages = results.flatMap(r => {
        if (r.status === 'rejected') { console.error('Folder fetch error:', r.reason?.message); return []; }
        return r.value;
      });
    } else {
      messages = await fetchUnreadMessages(50);
    }

    if (!messages.length) return res.json({ ok: true, processed: 0, summary: [], results: [] });

    // Filter out already-processed messages
    const ids = messages.map(m => m.messageId);
    const { rows: seen } = await pool.query(
      'SELECT message_id FROM processed_emails WHERE message_id = ANY($1)', [ids]
    );
    const seenSet = new Set(seen.map(r => r.message_id));
    const newMsgs = messages.filter(m => !seenSet.has(String(m.messageId)));

    if (!newMsgs.length) return res.json({ ok: true, processed: 0, summary: ['all messages already processed'], results: [] });

    const results    = [];
    const toMarkRead = [];

    for (const msg of newMsgs) {
      try {
        const { text, html } = await fetchMessageContent(msg.folderId, msg.messageId);
        const result = await processEmail(msg.subject || '', msg.fromAddress || '', text, html);
        results.push({ messageId: msg.messageId, subject: msg.subject, ...result });
        toMarkRead.push(msg.messageId);
      } catch (e) {
        console.error(`Failed to process message ${msg.messageId}:`, e.message);
        results.push({ messageId: msg.messageId, subject: msg.subject, type: 'error', error: e.message });
      }
      // Record as processed regardless of outcome so we don't retry endlessly
      await pool.query(
        'INSERT INTO processed_emails (message_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [String(msg.messageId)]
      );
    }

    if (toMarkRead.length) await markAsRead(toMarkRead);

    const counts = results.reduce((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([type, n]) => `${n} ${type.replace(/_/g, ' ')}`);
    console.log(`Email poll complete: ${results.length} messages — ${summary.join(', ')}`);

    res.json({ ok: true, processed: results.length, summary, results });
  } catch (e) {
    console.error('Email poll error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── UNMATCHED EMAILS ──────────────────────────────────────────────────────────
app.get('/api/email/unmatched', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, received_at, subject, from_addr, reason FROM unmatched_emails
       WHERE resolved=FALSE ORDER BY received_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/email/unmatched/:id/resolve', async (req, res) => {
  try {
    await pool.query('UPDATE unmatched_emails SET resolved=TRUE WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`🚀  Liftup API on :${PORT}`));
}

module.exports = app;
