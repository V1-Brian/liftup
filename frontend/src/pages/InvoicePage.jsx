import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmt, fmtMonth, calcCommission, parseShopifyCSV, STATUS_OPTIONS } from '../lib/utils'
import RecordPaymentModal from '../components/RecordPaymentModal'

const defaultMonth = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export default function InvoicePage() {
  const { month: routeMonth } = useParams()
  const navigate = useNavigate()
  const isNew = !routeMonth || routeMonth === 'new'

  const [month,       setMonth]       = useState(isNew ? defaultMonth() : routeMonth)
  const [skus,        setSkus]        = useState([])
  const [orders,      setOrders]      = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [status,      setStatus]      = useState({
    invoice_number: '', verified: false, verified_date: '',
    mfr_invoice_paid: false, mfr_invoice_paid_date: '',
    commission_paid: false, commission_paid_date: '', notes: '',
    mfr_amount_paid: 0, commission_amount_received: 0,
  })
  const [tab,         setTab]         = useState('import')
  const [saving,      setSaving]      = useState(false)
  const [syncing,     setSyncing]     = useState(false)
  const [loading,     setLoading]     = useState(!isNew)
  const [saveMsg,     setSaveMsg]     = useState(null)
  const [creditMsg,   setCreditMsg]   = useState(null)
  const [error,       setError]       = useState(null)
  const [dragOver,    setDragOver]    = useState(false)
  const [paymentModal, setPaymentModal] = useState(null) // null | 'liftup_invoice' | 'commission'
  const [invoiceId,   setInvoiceId]   = useState(null)
  const [invoicePayments, setInvoicePayments] = useState({ liftup_invoice: [], commission: [] })
  const fileRef = useRef()

  const skuMap = Object.fromEntries(skus.map(s => [s.sku, s]))

  useEffect(() => {
    api.getSkus().then(setSkus)
    if (!isNew) {
      Promise.all([api.getInvoice(routeMonth), api.getInvoicePayments(routeMonth)])
        .then(([inv, pmts]) => {
          setOrders(inv.orders || [])
          setAdjustments(inv.adjustments || [])
          setInvoiceId(inv.id)
          setStatus({
            invoice_number:             inv.invoice_number             || '',
            verified:                   inv.verified                   || false,
            verified_date:              inv.verified_date              || '',
            mfr_invoice_paid:           inv.mfr_invoice_paid           || false,
            mfr_invoice_paid_date:      inv.mfr_invoice_paid_date      || '',
            commission_paid:            inv.commission_paid            || false,
            commission_paid_date:       inv.commission_paid_date       || '',
            notes:                      inv.notes                      || '',
            mfr_amount_paid:            Number(inv.mfr_amount_paid)            || 0,
            commission_amount_received: Number(inv.commission_amount_received) || 0,
          })
          setInvoicePayments(pmts)
          setTab('invoice')
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [routeMonth])

  // ── Shopify Sync ──────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true); setError(null)
    try {
      const inv = await api.syncMonth(month)
      setOrders(inv.orders || [])
      setAdjustments(inv.adjustments || [])
      setStatus({
        invoice_number:        inv.invoice_number        || '',
        verified:              inv.verified              || false,
        verified_date:         inv.verified_date         || '',
        mfr_invoice_paid:      inv.mfr_invoice_paid      || false,
        mfr_invoice_paid_date: inv.mfr_invoice_paid_date || '',
        commission_paid:       inv.commission_paid       || false,
        commission_paid_date:  inv.commission_paid_date  || '',
        notes:                 inv.notes                 || '',
      })
      setSaveMsg(`Synced ${inv.orders?.length || 0} orders from Shopify ✓`)
      setTab('invoice')
      setTimeout(() => setSaveMsg(null), 3000)
      if (isNew) navigate(`/invoice/${month}`, { replace: true })
    } catch (e) { setError(e.message) }
    finally { setSyncing(false) }
  }

  // ── CSV Import ────────────────────────────────────────────────────────────
  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const parsed = parseShopifyCSV(e.target.result, month, skuMap)
      setOrders(parsed)
      setTab('review')
    }
    reader.readAsText(file)
  }

  // ── Calculations ──────────────────────────────────────────────────────────
  const sold   = orders.filter(o => o.status === 'sold')
  const before = orders.filter(o => o.status === 'before')
  const after  = orders.filter(o => o.status === 'after')
  const other  = orders.filter(o => !['sold','before','after'].includes(o.status))

  function getComm(o) {
    const s = skuMap[o.sku]
    if (!s) return { flat: 0, mkt: 0, amz: 0, total: 0 }
    return calcCommission(s, Number(o.sale_price), o.channel)
  }

  const totalRetail  = sold.reduce((s, o) => s + Number(o.sale_price) * (o.qty || 1), 0)
  const totalComm    = sold.reduce((s, o) => s + getComm(o).total * (o.qty || 1), 0)
  const totalCredit  = after.reduce((s, o) => s + Number(o.sale_price) * (o.qty || 1), 0)
  const retailAdj    = adjustments.filter(a => a.adj_type !== 'commission_credit')
  const commAdj      = adjustments.filter(a => a.adj_type === 'commission_credit')
  const adjTotal     = retailAdj.reduce((s, a) => s + Number(a.amount), 0)
  const commAdjTotal = commAdj.reduce((s, a) => s + Number(a.amount), 0)

  // SKU roll-up
  const rollup = {}
  sold.forEach(o => {
    if (!rollup[o.sku]) rollup[o.sku] = { name: skuMap[o.sku]?.name || o.sku, shopQty: 0, amzQty: 0, shopRetail: 0, amzRetail: 0, comm: 0 }
    const r = rollup[o.sku]; const comm = getComm(o)
    r.comm += comm.total * (o.qty || 1)
    if (o.channel === 'Amazon') { r.amzQty += o.qty || 1; r.amzRetail += Number(o.sale_price) * (o.qty || 1) }
    else { r.shopQty += o.qty || 1; r.shopRetail += Number(o.sale_price) * (o.qty || 1) }
  })

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setError(null); setSaveMsg(null); setCreditMsg(null)
    try {
      const result = await api.saveInvoice(month, { ...status, orders, adjustments })
      setInvoiceId(result.id)
      // Refresh adjustments in case credits were auto-applied
      setAdjustments(result.adjustments || [])
      const appliedCount = result.applied_credits?.length || 0
      setSaveMsg('Saved ✓')
      if (appliedCount > 0) {
        setCreditMsg(`${appliedCount} open credit${appliedCount > 1 ? 's' : ''} from prior months were auto-applied as adjustments.`)
        setTimeout(() => setCreditMsg(null), 6000)
      }
      if (isNew) navigate(`/invoice/${month}`, { replace: true })
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  // ── Refresh status after recording a payment ──────────────────────────────
  async function refreshInvoiceStatus() {
    if (isNew) return
    try {
      const [inv, pmts] = await Promise.all([api.getInvoice(month), api.getInvoicePayments(month)])
      setStatus(s => ({
        ...s,
        mfr_invoice_paid:           inv.mfr_invoice_paid           || false,
        mfr_invoice_paid_date:      inv.mfr_invoice_paid_date      || '',
        commission_paid:            inv.commission_paid            || false,
        commission_paid_date:       inv.commission_paid_date       || '',
        mfr_amount_paid:            Number(inv.mfr_amount_paid)            || 0,
        commission_amount_received: Number(inv.commission_amount_received) || 0,
      }))
      setInvoicePayments(pmts)
    } catch (_) {}
  }

  // ── Quick status patch ────────────────────────────────────────────────────
  async function patchStatus(patch) {
    const updated = { ...status, ...patch }
    setStatus(updated)
    if (!isNew) {
      try { await api.patchStatus(month, patch) }
      catch (e) { setError(e.message) }
    }
  }

  if (loading) return <div className="empty-state"><div className="spinner" /> Loading invoice…</div>

  return (
    <>
      <div className="page-header no-print">
        <div>
          <div className="page-title">{isNew ? 'New invoice' : `Invoice — ${fmtMonth(month)}`}</div>
          <div className="page-sub">{isNew ? 'Import sales and generate invoice' : `${orders.filter(o=>o.status==='sold').length} billable orders`}</div>
        </div>
        <div className="gap-2">
          {!isNew && <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Save invoice' : 'Update invoice'}
          </button>
        </div>
      </div>

      {error      && <div className="alert alert-error">{error}</div>}
      {saveMsg    && <div className="alert alert-success">{saveMsg}</div>}
      {creditMsg  && <div className="alert alert-info">{creditMsg}</div>}

      {/* Month picker (new only) */}
      {isNew && (
        <div className="card no-print" style={{ marginBottom: '1rem' }}>
          <label>Invoice month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg2)', borderRadius: 'var(--radius-lg)', padding: 4, marginBottom: '1.5rem', width: 'fit-content' }} className="no-print">
        {[
          { id: 'import',  label: '1 · Import' },
          { id: 'review',  label: '2 · Review orders' },
          { id: 'invoice', label: '3 · Invoice' },
          { id: 'status',  label: '4 · Status' },
        ].map(t => (
          <button key={t.id}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, border: 'none', background: tab === t.id ? 'var(--bg)' : 'transparent', color: tab === t.id ? 'var(--text)' : 'var(--text2)', boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer' }}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── TAB: IMPORT ─────────────────────────────────────────────────── */}
      {tab === 'import' && (
        <div className="no-print">
          {/* Shopify sync — primary action */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Sync from Shopify</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
              Pulls all orders for <strong>{fmtMonth(month)}</strong> directly from Shopify. Runs automatically on the 1st of each month — use this button to re-sync or sync on demand.
            </div>
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing} style={{ minWidth: 180 }}>
              {syncing ? 'Syncing…' : '↻ Sync from Shopify'}
            </button>
          </div>

          {/* CSV fallback */}
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Or import manually via CSV
          </div>
          <div
            className="upload-zone"
            style={{ borderColor: dragOver ? '#888' : undefined, background: dragOver ? 'var(--bg2)' : undefined }}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>⬆</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Click or drag & drop Shopify CSV</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Channel (Shopify/Amazon/Walmart) auto-detected</div>
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          {orders.length > 0 && (
            <div className="alert alert-success mt-2">
              ✓ {orders.length} orders imported. <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setTab('review')}>Review orders →</button>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: REVIEW ORDERS ──────────────────────────────────────────── */}
      {tab === 'review' && (
        <div className="no-print">
          <div className="toolbar">
            <div style={{ fontWeight: 600 }}>{orders.length} line items</div>
            <div className="gap-2">
              <button className="btn btn-sm" onClick={() => setTab('import')}>← Re-import</button>
              <button className="btn btn-sm" onClick={() => {
                const firstSku = skus[0]?.sku || ''
                setOrders(prev => [...prev, {
                  isManual: true, order_date: new Date().toISOString().slice(0,10),
                  order_no: '', sku: firstSku, qty: 1,
                  sale_price: skuMap[firstSku]?.shopify_price || 0,
                  channel: 'Shopify', status: 'sold', note: '',
                }])
              }}>+ Add row</button>
              <button className="btn btn-sm btn-primary" onClick={() => setTab('invoice')}>View invoice →</button>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: 460 }}>
            <table>
              <thead>
                <tr><th>Date</th><th>Order #</th><th>SKU</th><th>Product</th><th style={{textAlign:'right'}}>Price</th><th>Qty</th><th>Channel</th><th>Status</th><th>Note</th><th style={{width:40}}></th></tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={i} style={{ background: o.status === 'before' ? '#fff8f8' : o.status === 'after' ? '#fffbf0' : o.isManual ? 'var(--bg2)' : undefined }}>
                    <td style={{ fontSize: 12 }}>
                      {o.isManual
                        ? <input type="date" value={o.order_date || ''} style={{ fontSize: 11, width: 120 }}
                            onChange={e => setOrders(prev => prev.map((r,j) => j===i ? {...r,order_date:e.target.value} : r))} />
                        : o.order_date || o.date || '—'}
                    </td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                      {o.isManual
                        ? <input type="text" value={o.order_no || ''} placeholder="Order #" style={{ fontSize: 11, width: 80 }}
                            onChange={e => setOrders(prev => prev.map((r,j) => j===i ? {...r,order_no:e.target.value} : r))} />
                        : o.order_no}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>
                      {o.isManual
                        ? <select value={o.sku} style={{ fontSize: 11 }}
                            onChange={e => {
                              const s = skuMap[e.target.value]
                              setOrders(prev => prev.map((r,j) => j===i ? {
                                ...r, sku: e.target.value,
                                sale_price: r.channel === 'Amazon' ? (s?.amazon_price||0) : (s?.shopify_price||0),
                              } : r))
                            }}>
                            {skus.map(s => <option key={s.sku} value={s.sku}>{s.sku}</option>)}
                          </select>
                        : o.sku}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)' }}>{skuMap[o.sku]?.name || '?'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {o.isManual
                        ? <input type="number" value={o.sale_price} step="0.01" style={{ fontSize: 11, width: 80, textAlign: 'right' }}
                            onChange={e => setOrders(prev => prev.map((r,j) => j===i ? {...r,sale_price:parseFloat(e.target.value)||0} : r))} />
                        : fmt(o.sale_price)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {o.isManual
                        ? <input type="number" value={o.qty} min="1" style={{ fontSize: 11, width: 48, textAlign: 'right' }}
                            onChange={e => setOrders(prev => prev.map((r,j) => j===i ? {...r,qty:parseInt(e.target.value)||1} : r))} />
                        : o.qty}
                    </td>
                    <td>
                      {o.isManual
                        ? <select value={o.channel} style={{ fontSize: 11 }}
                            onChange={e => {
                              const s = skuMap[o.sku]
                              setOrders(prev => prev.map((r,j) => j===i ? {
                                ...r, channel: e.target.value,
                                sale_price: e.target.value === 'Amazon' ? (s?.amazon_price||r.sale_price) : (s?.shopify_price||r.sale_price),
                              } : r))
                            }}>
                            <option value="Shopify">Shopify</option>
                            <option value="Amazon">Amazon</option>
                            <option value="Walmart">Walmart</option>
                          </select>
                        : <span className={`badge badge-${(o.channel||'shopify').toLowerCase()}`}>{o.channel}</span>}
                    </td>
                    <td>
                      <select value={o.status} style={{ fontSize: 12, padding: '3px 6px' }}
                        onChange={e => setOrders(prev => prev.map((r,j) => j===i ? {...r,status:e.target.value} : r))}>
                        {STATUS_OPTIONS.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="text" value={o.note || ''} placeholder="Note…" style={{ fontSize: 12, width: 160 }}
                        onChange={e => setOrders(prev => prev.map((r,j) => j===i ? {...r,note:e.target.value} : r))} />
                    </td>
                    <td><button className="btn btn-sm btn-danger" onClick={() => setOrders(prev => prev.filter((_,j)=>j!==i))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Adjustments */}
          <div style={{ marginTop: '1.5rem' }}>
            <div className="toolbar">
              <div className="card-title" style={{ margin: 0 }}>Manual adjustments</div>
              <button className="btn btn-sm" onClick={() => setAdjustments(prev => [...prev, { label: '', amount: 0, adj_type: 'other' }])}>
                + Add adjustment
              </button>
            </div>
            {adjustments.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Description</th><th>Type</th><th style={{textAlign:'right'}}>Amount ($)</th><th></th></tr></thead>
                  <tbody>
                    {adjustments.map((a, i) => (
                      <tr key={i}>
                        <td><input type="text" value={a.label} placeholder="e.g. Shipping credit" style={{ width: '100%' }}
                          onChange={e => setAdjustments(prev => prev.map((r,j) => j===i ? {...r,label:e.target.value} : r))} /></td>
                        <td>
                          <select value={a.adj_type}
                            onChange={e => setAdjustments(prev => prev.map((r,j) => j===i ? {...r,adj_type:e.target.value} : r))}>
                            <option value="shipping">Shipping</option>
                            <option value="tax">Tax credit</option>
                            <option value="credit">Credit memo</option>
                            <option value="other">Other</option>
                          </select>
                        </td>
                        <td><input type="number" value={a.amount} step="0.01" style={{ width: 100, textAlign: 'right' }}
                          onChange={e => setAdjustments(prev => prev.map((r,j) => j===i ? {...r,amount:parseFloat(e.target.value)||0} : r))} /></td>
                        <td><button className="btn btn-sm btn-danger" onClick={() => setAdjustments(prev => prev.filter((_,j)=>j!==i))}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="note">Use negative amounts for credits/deductions (e.g. −125.00 for a shipping credit).</div>
          </div>
        </div>
      )}

      {/* ── TAB: INVOICE ────────────────────────────────────────────────── */}
      {tab === 'invoice' && (
        <>
          <div className="metric-grid">
            <div className="metric"><div className="metric-label">Total retail</div><div className="metric-value">{fmt(totalRetail)}</div><div className="metric-note">{sold.length} units sold</div></div>
            <div className="metric"><div className="metric-label">Mfr invoices us</div><div className="metric-value">{fmt(totalRetail + adjTotal)}</div>{adjTotal !== 0 && <div className="metric-note">{fmt(adjTotal)} adj.</div>}</div>
            <div className="metric"><div className="metric-label">We invoice mfr</div><div className="metric-value green">{fmt(totalComm + commAdjTotal)}</div>{commAdjTotal !== 0 && <div className="metric-note">{fmt(commAdjTotal)} credit</div>}</div>
            <div className="metric"><div className="metric-label">Net owed to mfr</div><div className="metric-value">{fmt(totalRetail + adjTotal - totalComm - commAdjTotal)}</div></div>
            {totalCredit > 0 && <div className="metric"><div className="metric-label">Credit memos</div><div className="metric-value" style={{color:'var(--amber)'}}>{fmt(totalCredit)}</div><div className="metric-note">Pending</div></div>}
          </div>

          {/* Two column invoices */}
          <div className="two-col">
            {/* Mfr → Us */}
            <div>
              <div className="card-title">Manufacturer invoice to us</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>SKU</th><th>Product</th><th>Ch.</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Unit price</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
                  <tbody>
                    {sold.map((o,i) => (
                      <tr key={i}>
                        <td style={{fontWeight:600,fontSize:12}}>{o.sku}</td>
                        <td style={{fontSize:12,color:'var(--text2)'}}>{skuMap[o.sku]?.name||o.sku}</td>
                        <td><span className={`badge badge-${(o.channel||'shopify').toLowerCase()}`}>{o.channel}</span></td>
                        <td style={{textAlign:'right'}}>{o.qty}</td>
                        <td style={{textAlign:'right',fontSize:12}}>{fmt(o.sale_price)}</td>
                        <td style={{textAlign:'right',fontWeight:600}}>{fmt(Number(o.sale_price)*o.qty)}</td>
                      </tr>
                    ))}
                    {after.map((o,i) => (
                      <tr key={'cr'+i} style={{background:'#fffbf0'}}>
                        <td style={{fontSize:12,color:'var(--amber)'}}>{o.sku}</td>
                        <td style={{fontSize:12,color:'var(--amber)'}}>{skuMap[o.sku]?.name||o.sku}</td>
                        <td><span className={`badge badge-${(o.channel||'shopify').toLowerCase()}`}>{o.channel}</span></td>
                        <td style={{textAlign:'right',color:'var(--amber)'}}>{o.qty}</td>
                        <td style={{textAlign:'right',fontSize:12,color:'var(--amber)'}}>{fmt(o.sale_price)}</td>
                        <td style={{textAlign:'right',fontWeight:600,color:'var(--amber)'}}>CREDIT MEMO ⚠</td>
                      </tr>
                    ))}
                    {retailAdj.map((a,i) => (
                      <tr key={'adj'+i}>
                        <td colSpan={5} style={{color:'var(--text2)',fontSize:12,fontStyle:'italic'}}>{a.label} ({a.adj_type})</td>
                        <td style={{textAlign:'right',fontWeight:600,color:Number(a.amount)<0?'var(--red)':undefined}}>{fmt(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={5} style={{padding:'10px'}}>Total owed to manufacturer</td><td style={{textAlign:'right',padding:'10px'}}>{fmt(totalRetail + adjTotal)}</td></tr></tfoot>
                </table>
              </div>
            </div>

            {/* Us → Mfr */}
            <div>
              <div className="card-title">Our commission invoice to manufacturer</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>SKU</th><th>Ch.</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Flat</th><th style={{textAlign:'right'}}>Mkt</th><th style={{textAlign:'right'}}>Amz fee</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
                  <tbody>
                    {sold.map((o,i) => {
                      const c = getComm(o)
                      return (
                        <tr key={i}>
                          <td style={{fontWeight:600,fontSize:12}}>{o.sku}</td>
                          <td><span className={`badge badge-${(o.channel||'shopify').toLowerCase()}`}>{o.channel}</span></td>
                          <td style={{textAlign:'right'}}>{o.qty}</td>
                          <td style={{textAlign:'right',fontSize:12}}>{fmt(c.flat*o.qty)}</td>
                          <td style={{textAlign:'right',fontSize:12}}>{fmt(c.mkt*o.qty)}</td>
                          <td style={{textAlign:'right',fontSize:12}}>{o.channel==='Amazon'?fmt(c.amz*o.qty):'—'}</td>
                          <td style={{textAlign:'right',fontWeight:600,color:'var(--green)'}}>{fmt(c.total*o.qty)}</td>
                        </tr>
                      )
                    })}
                    {after.map((o,i) => {
                      const c = getComm(o)
                      return (
                        <tr key={'cr'+i} style={{background:'#fffbf0'}}>
                          <td style={{fontSize:12,color:'var(--amber)'}}>{o.sku}</td>
                          <td><span className={`badge badge-${(o.channel||'shopify').toLowerCase()}`}>{o.channel}</span></td>
                          <td style={{textAlign:'right',color:'var(--amber)'}}>{o.qty}</td>
                          <td colSpan={3} style={{textAlign:'right',fontSize:12,color:'var(--amber)'}}>{fmt(c.flat*o.qty)} + {fmt(c.mkt*o.qty)}</td>
                          <td style={{textAlign:'right',fontWeight:600,color:'var(--amber)'}}>CREDIT MEMO ⚠</td>
                        </tr>
                      )
                    })}
                    {commAdj.map((a,i) => (
                      <tr key={'cadj'+i}>
                        <td colSpan={6} style={{color:'var(--text2)',fontSize:12,fontStyle:'italic'}}>{a.label}</td>
                        <td style={{textAlign:'right',fontWeight:600,color:'var(--amber)'}}>{fmt(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={6} style={{padding:'10px'}}>Total commission owed to us</td><td style={{textAlign:'right',padding:'10px',color:'var(--green)'}}>{fmt(totalComm + commAdjTotal)}</td></tr></tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* SKU Summary */}
          <div className="card-title">SKU summary</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th style={{textAlign:'right'}}>Shopify qty</th><th style={{textAlign:'right'}}>Shopify retail</th><th style={{textAlign:'right'}}>Amazon qty</th><th style={{textAlign:'right'}}>Amazon retail</th><th style={{textAlign:'right'}}>Total retail</th><th style={{textAlign:'right'}}>Commission</th></tr></thead>
              <tbody>
                {Object.entries(rollup).map(([sku, r]) => (
                  <tr key={sku}>
                    <td style={{fontWeight:600,fontSize:12}}>{sku}</td>
                    <td style={{fontSize:12,color:'var(--text2)'}}>{r.name}</td>
                    <td style={{textAlign:'right'}}>{r.shopQty||'—'}</td>
                    <td style={{textAlign:'right'}}>{r.shopRetail?fmt(r.shopRetail):'—'}</td>
                    <td style={{textAlign:'right'}}>{r.amzQty||'—'}</td>
                    <td style={{textAlign:'right'}}>{r.amzRetail?fmt(r.amzRetail):'—'}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{fmt(r.shopRetail+r.amzRetail)}</td>
                    <td style={{textAlign:'right',fontWeight:600,color:'var(--green)'}}>{fmt(r.comm)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={6} style={{padding:'10px'}}>Totals</td><td style={{textAlign:'right',padding:'10px'}}>{fmt(totalRetail)}</td><td style={{textAlign:'right',padding:'10px',color:'var(--green)'}}>{fmt(totalComm)}</td></tr>
              </tfoot>
            </table>
          </div>

          {/* Returns section */}
          {(before.length > 0 || after.length > 0 || other.length > 0) && (
            <>
              <div className="card-title" style={{marginTop:'1rem'}}>Returns, warranties & notes</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Order #</th><th>SKU</th><th>Channel</th><th>Status</th><th>Note</th></tr></thead>
                  <tbody>
                    {[...before,...after,...other].map((o,i) => {
                      const statusLabel = STATUS_OPTIONS.find(s=>s.val===o.status)?.label || o.status
                      const bc = o.status==='after'?'badge-credit':o.status==='warranty'?'badge-warranty':'badge-returned'
                      return (
                        <tr key={i}>
                          <td style={{fontSize:12}}>{o.order_date||o.date||'—'}</td>
                          <td style={{color:'var(--text2)',fontSize:12}}>{o.order_no}</td>
                          <td style={{fontWeight:600,fontSize:12}}>{o.sku}</td>
                          <td><span className={`badge badge-${(o.channel||'shopify').toLowerCase()}`}>{o.channel}</span></td>
                          <td><span className={`badge ${bc}`}>{statusLabel}</span></td>
                          <td style={{fontSize:12,color:'var(--text2)'}}>{o.note||'—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ── TAB: STATUS ─────────────────────────────────────────────────── */}
      {tab === 'status' && (
        <div className="no-print">
          <div className="card">
            <div className="card-title">Invoice status — {fmtMonth(month)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>

              <div>
                <label>Invoice number</label>
                <input type="text" value={status.invoice_number} placeholder="e.g. INV-2026-03"
                  style={{ width: '100%' }}
                  onChange={e => patchStatus({ invoice_number: e.target.value })} />
              </div>

              <div>
                <label>Notes</label>
                <textarea value={status.notes} placeholder="Credit memos, shipping issues, etc."
                  onChange={e => patchStatus({ notes: e.target.value })} style={{ minHeight: 60 }} />
              </div>

              <div>
                <label style={{ marginBottom: 8 }}>Verification</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                    <input type="checkbox" checked={status.verified}
                      onChange={e => patchStatus({ verified: e.target.checked, verified_date: e.target.checked ? new Date().toISOString().slice(0,10) : '' })} />
                    Verified
                  </label>
                  {status.verified && (
                    <input type="date" value={status.verified_date}
                      onChange={e => patchStatus({ verified_date: e.target.value })} />
                  )}
                </div>
              </div>

              <div>
                <label style={{ marginBottom: 8 }}>LiftUp invoice — we pay LiftUp</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                    <input type="checkbox" checked={status.mfr_invoice_paid}
                      onChange={e => patchStatus({ mfr_invoice_paid: e.target.checked, mfr_invoice_paid_date: e.target.checked ? new Date().toISOString().slice(0,10) : '' })} />
                    Paid
                  </label>
                  {status.mfr_invoice_paid && (
                    <input type="date" value={status.mfr_invoice_paid_date}
                      onChange={e => patchStatus({ mfr_invoice_paid_date: e.target.value })} />
                  )}
                  {!isNew && (
                    <button className="btn btn-sm" onClick={() => setPaymentModal('liftup_invoice')}>
                      + Record payment
                    </button>
                  )}
                </div>
                {status.mfr_amount_paid > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                      Paid: {fmt(status.mfr_amount_paid)}
                      {!status.mfr_invoice_paid && <span style={{ color: 'var(--amber)' }}> · partial</span>}
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{
                        width: `${Math.min(100, (status.mfr_amount_paid / Math.max(totalRetail + adjTotal - totalComm, 0.01)) * 100).toFixed(1)}%`
                      }} />
                    </div>
                  </div>
                )}
                {status.mfr_invoice_paid && <div style={{ marginTop: 6 }}><span className="badge badge-paid">✓ LiftUp invoice paid {status.mfr_invoice_paid_date}</span></div>}
              </div>

              <div>
                <label style={{ marginBottom: 8 }}>Commission — LiftUp pays us</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                    <input type="checkbox" checked={status.commission_paid}
                      onChange={e => patchStatus({ commission_paid: e.target.checked, commission_paid_date: e.target.checked ? new Date().toISOString().slice(0,10) : '' })} />
                    Received
                  </label>
                  {status.commission_paid && (
                    <input type="date" value={status.commission_paid_date}
                      onChange={e => patchStatus({ commission_paid_date: e.target.value })} />
                  )}
                  {!isNew && (
                    <button className="btn btn-sm" onClick={() => setPaymentModal('commission')}>
                      + Record received
                    </button>
                  )}
                </div>
                {status.commission_amount_received > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                      Received: {fmt(status.commission_amount_received)}
                      {!status.commission_paid && <span style={{ color: 'var(--amber)' }}> · partial</span>}
                    </div>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{
                        width: `${Math.min(100, (status.commission_amount_received / Math.max(totalComm, 0.01)) * 100).toFixed(1)}%`
                      }} />
                    </div>
                  </div>
                )}
                {status.commission_paid && <div style={{ marginTop: 6 }}><span className="badge badge-paid">✓ Commission received {status.commission_paid_date}</span></div>}
              </div>
            </div>
          </div>

          {/* Payment activity */}
          <div className="card">
            <div className="card-title">Payment activity</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

              {/* We paid LiftUp */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>We paid LiftUp</div>
                {invoicePayments.liftup_invoice.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>No payments recorded yet.</div>
                ) : (
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--text2)', paddingBottom: 4 }}>Date</th>
                        <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--text2)', paddingBottom: 4 }}>Amount</th>
                        <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--text2)', paddingBottom: 4, paddingLeft: 12 }}>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicePayments.liftup_invoice.map((p, i) => (
                        <tr key={i}>
                          <td style={{ padding: '4px 0' }}>{p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.allocated_amount)}</td>
                          <td style={{ paddingLeft: 12, color: 'var(--text2)' }}>{p.reference || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ paddingTop: 6, color: 'var(--text2)' }}>Total paid</td>
                        <td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700 }}>{fmt(status.mfr_amount_paid)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* Commission received from LiftUp */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Commission received from LiftUp</div>
                {invoicePayments.commission.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text2)' }}>No commission recorded yet.</div>
                ) : (
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--text2)', paddingBottom: 4 }}>Date</th>
                        <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--text2)', paddingBottom: 4 }}>Amount</th>
                        <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--text2)', paddingBottom: 4, paddingLeft: 12 }}>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicePayments.commission.map((p, i) => (
                        <tr key={i}>
                          <td style={{ padding: '4px 0' }}>{p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>{fmt(p.allocated_amount)}</td>
                          <td style={{ paddingLeft: 12, color: 'var(--text2)' }}>{p.reference || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ paddingTop: 6, color: 'var(--text2)' }}>Total received</td>
                        <td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>{fmt(status.commission_amount_received)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

            </div>
          </div>

          {/* Summary card */}
          <div className="card" style={{ background: 'var(--bg2)' }}>
            <div className="card-title">Summary for {fmtMonth(month)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 13 }}>
              {[
                ['Total retail sold', fmt(totalRetail)],
                ['Total commission', fmt(totalComm)],
                ['Net owed to LiftUp', fmt(totalRetail + adjTotal - totalComm)],
                ['Credit memos pending', totalCredit > 0 ? fmt(totalCredit) : 'None'],
                ['Manual adjustments', adjTotal !== 0 ? fmt(adjTotal) : 'None'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ color: 'var(--text2)' }}>{l}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENT MODAL ────────────────────────────────────────────────── */}
      {paymentModal && (
        <RecordPaymentModal
          paymentType={paymentModal}
          defaultInvoiceId={invoiceId}
          onClose={() => setPaymentModal(null)}
          onSaved={() => { setPaymentModal(null); refreshInvoiceStatus() }}
        />
      )}
    </>
  )
}
