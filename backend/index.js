require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
const { calcCommission } = require('./commission');

const app  = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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

    // Replace adjustments
    await client.query('DELETE FROM adjustments WHERE invoice_id=$1', [invoiceId]);
    for (const a of adjustments) {
      await client.query(
        `INSERT INTO adjustments (invoice_id, label, amount, adj_type)
         VALUES ($1,$2,$3,$4)`,
        [invoiceId, a.label, a.amount, a.adj_type || 'other']
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
    res.json({ ...inv[0], orders: finalOrders, adjustments: finalAdj });
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀  Liftup API on :${PORT}`));
