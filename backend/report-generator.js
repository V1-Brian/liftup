/**
 * Report generator for outbound emails to LiftUp.
 * Produces both an HTML email body and a PDF attachment for each report type.
 *
 * Two exports:
 *   buildSalesReport(invoice, orders, month)
 *     → { subject, html, pdfBuffer, filename }
 *   buildCommissionInvoice(invoice, orders, adjustments, month)
 *     → { subject, html, pdfBuffer, filename }
 *
 * Requires pdfkit. Logo: backend/assets/logo.png (optional — falls back to text header).
 */

const PDFDocument = require('pdfkit');
const path        = require('fs');
const fs          = require('fs');
const LOGO_PATH   = require('path').join(__dirname, 'assets', 'logo.png');

// ── Brand colours ────────────────────────────────────────────────────────────
const RED        = '#CC0000';
const DARK       = '#1a1a1a';
const GRAY       = '#666666';
const LIGHT_GRAY = '#f5f5f5';
const BORDER     = '#e0e0e0';
const TOTAL_BG   = '#f0ede8';

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmt(n) {
  const v = Number(n) || 0;
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtMonthLabel(month) {
  const [y, m] = month.split('-');
  const names = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── PDF primitives ────────────────────────────────────────────────────────────

function buildPDF(drawFn) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { drawFn(doc); } catch (e) { reject(e); return; }
    doc.end();
  });
}

function pdfHeader(doc, title, subtitle, month) {
  const hasLogo = fs.existsSync(LOGO_PATH);
  if (hasLogo) {
    doc.image(LOGO_PATH, 50, 38, { width: 100, height: 73 });
  } else {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(RED).text('V1 VENTURES', 50, 45);
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text('Sales Representative', 50, 68);
  }

  doc.font('Helvetica-Bold').fontSize(20).fillColor(DARK)
     .text(title, 0, 45, { align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
     .text(subtitle,               0, 72, { align: 'right' })
     .text(`Period: ${fmtMonthLabel(month)}`, 0, 87, { align: 'right' })
     .text(`Date: ${fmtDate(new Date())}`,    0, 102, { align: 'right' });

  doc.moveTo(50, 128).lineTo(562, 128).strokeColor(BORDER).lineWidth(1).stroke();
  return 142;
}

function pdfSectionLabel(doc, y, text) {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
     .text(text.toUpperCase(), 50, y, { letterSpacing: 1 });
  return y + 15;
}

function pdfTable(doc, startY, headers, rows, colWidths, colAligns) {
  const x      = 50;
  const hdrH   = 22;
  const rowH   = 20;
  let y        = startY;

  // Header
  doc.rect(x, y, 512, hdrH).fill(LIGHT_GRAY);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
  let cx = x + 6;
  headers.forEach((h, i) => {
    doc.text(h, cx, y + 7, { width: colWidths[i] - 8, align: colAligns[i] || 'left', lineBreak: false });
    cx += colWidths[i];
  });
  y += hdrH;

  // Rows
  rows.forEach(row => {
    if (y + rowH > 720) { doc.addPage(); y = 50; }
    doc.moveTo(x, y + rowH).lineTo(x + 512, y + rowH).strokeColor(BORDER).lineWidth(0.3).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(DARK);
    cx = x + 6;
    row.forEach((cell, i) => {
      const text  = typeof cell === 'object' ? cell.text  : cell;
      const bold  = typeof cell === 'object' ? cell.bold  : false;
      const color = typeof cell === 'object' ? cell.color : null;
      if (bold)  doc.font('Helvetica-Bold');
      if (color) doc.fillColor(color);
      doc.text(String(text ?? ''), cx, y + 5, {
        width: colWidths[i] - 8,
        align: colAligns[i] || 'left',
        lineBreak: false,
      });
      if (bold)  doc.font('Helvetica');
      if (color) doc.fillColor(DARK);
      cx += colWidths[i];
    });
    y += rowH;
  });

  return y + 6;
}

function pdfTotalRow(doc, y, label, value, isFinal) {
  if (y + 26 > 720) { doc.addPage(); y = 50; }
  if (isFinal) {
    doc.rect(50, y, 512, 26).fill(TOTAL_BG);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK);
  } else {
    doc.font('Helvetica').fontSize(10).fillColor(GRAY);
  }
  doc.text(label, 56, y + (isFinal ? 8 : 6), { width: 390, lineBreak: false });
  doc.text(fmt(value), 56, y + (isFinal ? 8 : 6), { width: 498, align: 'right', lineBreak: false });
  return y + (isFinal ? 26 : 22);
}

function pdfFooter(doc) {
  const y = 738;
  doc.moveTo(50, y).lineTo(562, y).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
     .text('V1 Ventures · brian@skystart.org · Generated automatically', 50, y + 8, { align: 'center' });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function htmlWrap(title, month, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,Arial,sans-serif;background:#f4f4f2;margin:0;padding:20px}
  .wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)}
  .hdr{background:#1a1a1a;padding:0}
  .hdr-table{width:100%;border-collapse:collapse}
  .hdr-left{color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;padding:26px 36px;vertical-align:middle}
  .hdr-right{text-align:right;padding:26px 36px;vertical-align:middle;white-space:nowrap}
  .hdr-title{color:#fff;font-size:16px;font-weight:700}
  .hdr-period{color:#aaa;font-size:12px;margin-top:4px}
  .red-bar{height:4px;background:#CC0000}
  .body{padding:28px 36px}
  p{font-size:14px;color:#444;margin:0 0 16px;line-height:1.6}
  h3{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#999;margin:24px 0 8px;border-bottom:1px solid #eee;padding-bottom:6px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
  th{text-align:left;padding:8px 10px;background:#f5f5f5;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;border-bottom:1px solid #e0e0e0}
  td{padding:8px 10px;border-bottom:1px solid #f0f0f0;color:#333}
  tr:last-child td{border-bottom:none}
  .r{text-align:right}
  .b{font-weight:700}
  .sub-row td{color:#888;font-size:12px;border-top:1px solid #eee}
  .total-row td{font-weight:700;font-size:14px;background:#f0ede8;border-top:2px solid #ddd;color:#1a1a1a}
  .note{font-size:12px;color:#666;margin-top:16px;padding:12px 14px;background:#fff8f0;border-radius:6px;border-left:3px solid #CC0000;line-height:1.5}
  .meta-table td{padding:5px 10px;border:none;font-size:13px}
  .meta-table td:first-child{color:#999;width:110px}
  .ftr{padding:16px 36px;background:#f9f9f9;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #eee}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <table class="hdr-table">
      <tr>
        <td class="hdr-left">V1 VENTURES</td>
        <td class="hdr-right">
          <div class="hdr-title">${title}</div>
          <div class="hdr-period">${fmtMonthLabel(month)}</div>
        </td>
      </tr>
    </table>
  </div>
  <div class="red-bar"></div>
  <div class="body">
    ${bodyHtml}
  </div>
  <div class="ftr">V1 Ventures &middot; brian@skystart.org &middot; Generated automatically</div>
</div>
</body>
</html>`;
}

// ── Sales report ─────────────────────────────────────────────────────────────

async function buildSalesReport(invoice, orders, month) {
  // Group sold orders by SKU + channel
  const groups = {};
  for (const o of orders.filter(x => x.status === 'sold')) {
    const key = `${o.sku}|${o.channel}`;
    if (!groups[key]) {
      groups[key] = {
        sku: o.sku,
        name: o.sku_name || o.sku,
        channel: o.channel,
        qty: 0,
        unitPrice: Number(o.sale_price),
        total: 0,
      };
    }
    groups[key].qty   += Number(o.qty || 1);
    groups[key].total += Number(o.sale_price) * Number(o.qty || 1);
  }
  const lines = Object.values(groups).sort((a, b) => a.sku.localeCompare(b.sku));

  // Returns (after orders)
  const returnLines = orders.filter(x => x.status === 'after');

  const shopifyTotal = lines.filter(l => l.channel === 'shopify').reduce((s, l) => s + l.total, 0);
  const amazonTotal  = lines.filter(l => l.channel === 'amazon').reduce((s, l) => s + l.total, 0);
  const grandTotal   = Number(invoice.total_retail);

  // ── HTML ──────────────────────────────────────────────────────────────────
  const tableRows = lines.map(l => `
    <tr>
      <td class="b">${l.sku}</td>
      <td>${l.name}</td>
      <td>${l.channel === 'shopify' ? 'Shopify' : 'Amazon'}</td>
      <td class="r">${l.qty}</td>
      <td class="r">${fmt(l.unitPrice)}</td>
      <td class="r">${fmt(l.total)}</td>
    </tr>`).join('');

  const returnSection = returnLines.length ? `
    <h3>Returns (Credit Memo Pending)</h3>
    <table>
      <thead><tr><th>SKU</th><th>Product</th><th>Channel</th><th class="r">Qty</th><th class="r">Unit Price</th></tr></thead>
      <tbody>${returnLines.map(o => `
        <tr>
          <td class="b">${o.sku}</td><td>${o.sku_name || o.sku}</td>
          <td>${o.channel === 'shopify' ? 'Shopify' : 'Amazon'}</td>
          <td class="r">${o.qty || 1}</td><td class="r">${fmt(o.sale_price)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="note">The above returns will be offset via credit memo on a subsequent invoice.</div>` : '';

  const bodyHtml = `
    <p>Please find the monthly sales report for <strong>${fmtMonthLabel(month)}</strong> below,
    reflecting all orders processed through Shopify and Amazon for the period.</p>

    <h3>Units Sold by SKU</h3>
    <table>
      <thead><tr>
        <th>SKU</th><th>Product</th><th>Channel</th>
        <th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Total</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      ${shopifyTotal > 0 ? `<tr class="sub-row"><td colspan="5" class="r">Shopify Subtotal</td><td class="r">${fmt(shopifyTotal)}</td></tr>` : ''}
      ${amazonTotal  > 0 ? `<tr class="sub-row"><td colspan="5" class="r">Amazon Subtotal</td><td class="r">${fmt(amazonTotal)}</td></tr>` : ''}
      <tr class="total-row"><td colspan="5" class="r">TOTAL RETAIL (includes shipping)</td><td class="r">${fmt(grandTotal)}</td></tr>
    </table>
    <div class="note">
      Our totals include shipping costs. Your invoice to us should reflect
      <strong>${fmt(grandTotal)}</strong>. Shipping may be broken out as a separate line on your invoice.
    </div>
    ${returnSection}`;

  const html = htmlWrap('Monthly Sales Report', month, bodyHtml);

  // ── PDF ───────────────────────────────────────────────────────────────────
  const pdfBuffer = await buildPDF(doc => {
    let y = pdfHeader(doc, 'SALES REPORT', 'Prepared for: LiftUp', month);

    y = pdfSectionLabel(doc, y, 'Units Sold by SKU & Channel');
    y = pdfTable(doc, y,
      ['SKU', 'Product', 'Channel', 'Qty', 'Unit Price', 'Total'],
      lines.map(l => [
        { text: l.sku, bold: true },
        l.name,
        l.channel === 'shopify' ? 'Shopify' : 'Amazon',
        { text: String(l.qty),       align: 'right' },
        { text: fmt(l.unitPrice),    align: 'right' },
        { text: fmt(l.total),        align: 'right' },
      ]),
      [65, 155, 72, 48, 82, 90],
      ['left', 'left', 'left', 'right', 'right', 'right']
    );

    y += 6;
    if (shopifyTotal > 0) y = pdfTotalRow(doc, y, 'Shopify Subtotal', shopifyTotal, false);
    if (amazonTotal  > 0) y = pdfTotalRow(doc, y, 'Amazon Subtotal',  amazonTotal,  false);
    y = pdfTotalRow(doc, y, 'TOTAL RETAIL (includes shipping)', grandTotal, true);

    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text('Note: Our totals include shipping. Your invoice to us should reflect the total above; shipping may appear as a separate line.',
             50, y, { width: 512 });

    if (returnLines.length) {
      y += 32;
      y = pdfSectionLabel(doc, y, 'Returns — Credit Memo Pending');
      y = pdfTable(doc, y,
        ['SKU', 'Product', 'Channel', 'Qty', 'Unit Price'],
        returnLines.map(o => [
          { text: o.sku, bold: true },
          o.sku_name || o.sku,
          o.channel === 'shopify' ? 'Shopify' : 'Amazon',
          String(o.qty || 1),
          fmt(o.sale_price),
        ]),
        [65, 215, 72, 60, 100],
        ['left', 'left', 'left', 'right', 'right']
      );
      y += 8;
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text('Returns will be offset via credit memo on a subsequent invoice.', 50, y, { width: 512 });
    }

    pdfFooter(doc);
  });

  return {
    subject:   `V1 Ventures — Monthly Sales Report — ${fmtMonthLabel(month)}`,
    html,
    pdfBuffer,
    filename:  `v1ventures-sales-report-${month}.pdf`,
  };
}

// ── Commission invoice ────────────────────────────────────────────────────────

async function buildCommissionInvoice(invoice, orders, adjustments, month) {
  // Group sold orders by SKU + channel
  const groups = {};
  for (const o of orders.filter(x => x.status === 'sold')) {
    const key = `${o.sku}|${o.channel}`;
    if (!groups[key]) {
      groups[key] = {
        sku: o.sku,
        name: o.sku_name || o.sku,
        channel: o.channel,
        qty: 0,
        commTotal: 0,
      };
    }
    groups[key].qty       += Number(o.qty || 1);
    groups[key].commTotal += Number(o.comm_total);
  }
  const lines    = Object.values(groups).sort((a, b) => a.sku.localeCompare(b.sku));
  const baseComm = lines.reduce((s, l) => s + l.commTotal, 0);
  const adjTotal = adjustments.reduce((s, a) => s + Number(a.amount), 0);
  const netComm  = Number(invoice.total_commission);
  const ourRef   = `V1-${month}`;

  // ── HTML ──────────────────────────────────────────────────────────────────
  const tableRows = lines.map(l => `
    <tr>
      <td class="b">${l.sku}</td>
      <td>${l.name}</td>
      <td>${l.channel === 'shopify' ? 'Shopify' : 'Amazon'}</td>
      <td class="r">${l.qty}</td>
      <td class="r">${fmt(l.commTotal)}</td>
    </tr>`).join('');

  const adjRows = adjustments.map(a => `
    <tr class="sub-row">
      <td colspan="4">${a.label}</td>
      <td class="r" style="color:${Number(a.amount) < 0 ? '#a32d2d' : '#1a6e3a'}">${fmt(a.amount)}</td>
    </tr>`).join('');

  const bodyHtml = `
    <p>Please find our commission invoice for <strong>${fmtMonthLabel(month)}</strong> below.
    Kindly remit payment at your earliest convenience.</p>

    <h3>Invoice Details</h3>
    <table class="meta-table" style="width:auto">
      <tr><td>Invoice #</td><td class="b">${ourRef}</td></tr>
      <tr><td>Date</td><td>${fmtDate(new Date())}</td></tr>
      <tr><td>From</td><td>V1 Ventures</td></tr>
      <tr><td>To</td><td>LiftUp</td></tr>
    </table>

    <h3>Commission Detail</h3>
    <table>
      <thead><tr>
        <th>SKU</th><th>Product</th><th>Channel</th>
        <th class="r">Qty</th><th class="r">Commission</th>
      </tr></thead>
      <tbody>
        ${tableRows}
        ${adjRows}
        ${adjustments.length ? `<tr class="sub-row"><td colspan="4" class="r">Commission Subtotal</td><td class="r">${fmt(baseComm)}</td></tr>` : ''}
        <tr class="total-row"><td colspan="4" class="r">TOTAL COMMISSION DUE</td><td class="r">${fmt(netComm)}</td></tr>
      </tbody>
    </table>
    <div class="note">
      Please remit <strong>${fmt(netComm)}</strong> to V1 Ventures.<br>
      Questions? Contact brian@skystart.org
    </div>`;

  const html = htmlWrap('Commission Invoice', month, bodyHtml);

  // ── PDF ───────────────────────────────────────────────────────────────────
  const pdfBuffer = await buildPDF(doc => {
    let y = pdfHeader(doc, 'COMMISSION INVOICE', `Invoice # ${ourRef}`, month);

    y = pdfSectionLabel(doc, y, 'Invoice Details');
    [['Invoice #', ourRef], ['Date', fmtDate(new Date())], ['From', 'V1 Ventures'], ['To', 'LiftUp']]
      .forEach(([k, v]) => {
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(k, 50,  y, { width: 100, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(v, 155, y, { lineBreak: false });
        y += 16;
      });
    y += 10;

    y = pdfSectionLabel(doc, y, 'Commission Detail');
    y = pdfTable(doc, y,
      ['SKU', 'Product', 'Channel', 'Qty', 'Commission'],
      lines.map(l => [
        { text: l.sku, bold: true },
        l.name,
        l.channel === 'shopify' ? 'Shopify' : 'Amazon',
        { text: String(l.qty),        align: 'right' },
        { text: fmt(l.commTotal),     align: 'right' },
      ]),
      [65, 200, 72, 55, 120],
      ['left', 'left', 'left', 'right', 'right']
    );

    if (adjustments.length) {
      y += 4;
      adjustments.forEach(a => {
        const color = Number(a.amount) < 0 ? '#a32d2d' : '#1a6e3a';
        y = pdfTotalRow(doc, y, a.label, Number(a.amount), false);
      });
      y = pdfTotalRow(doc, y, 'Commission Subtotal', baseComm, false);
    }

    y = pdfTotalRow(doc, y, 'TOTAL COMMISSION DUE', netComm, true);

    y += 18;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text(`Please remit ${fmt(netComm)} to V1 Ventures. Contact brian@skystart.org with any questions.`,
             50, y, { width: 512 });

    pdfFooter(doc);
  });

  return {
    subject:  `V1 Ventures — Commission Invoice — ${fmtMonthLabel(month)}`,
    html,
    pdfBuffer,
    filename: `v1ventures-commission-invoice-${month}.pdf`,
  };
}

module.exports = { buildSalesReport, buildCommissionInvoice };
