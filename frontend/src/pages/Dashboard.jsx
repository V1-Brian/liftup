import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmt, fmtMonth } from '../lib/utils'
import RecordPaymentModal from '../components/RecordPaymentModal'
import ProcessReturnModal from '../components/ProcessReturnModal'

function lastMonth() {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export default function Dashboard() {
  const [invoices,        setInvoices]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [syncing,         setSyncing]         = useState(false)
  const [error,           setError]           = useState(null)
  const [syncMsg,         setSyncMsg]         = useState(null)
  const [paymentModal,    setPaymentModal]    = useState(false)
  const [unmatchedCount,  setUnmatchedCount]  = useState(0)
  const [pendingReturns,  setPendingReturns]  = useState([])
  const [returnModal,     setReturnModal]     = useState(null)
  const [polling,         setPolling]         = useState(false)
  const [pollMsg,         setPollMsg]         = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.listInvoices()
      .then(setInvoices)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    api.getUnmatchedEmails()
      .then(rows => setUnmatchedCount(rows.length))
      .catch(() => {})
    api.getPendingReturns()
      .then(setPendingReturns)
      .catch(() => {})
  }, [])

  async function handlePoll() {
    setPolling(true); setPollMsg(null); setError(null)
    try {
      const result = await api.pollEmails()
      const { processed, summary } = result
      if (processed === 0) {
        setPollMsg('No new emails found.')
      } else {
        setPollMsg(`Processed ${processed} email${processed > 1 ? 's' : ''}: ${summary.join(', ')}.`)
      }
      const unmatched = await api.getUnmatchedEmails().catch(() => [])
      setUnmatchedCount(unmatched.length)
      const returns = await api.getPendingReturns().catch(() => [])
      setPendingReturns(returns)
      const updated = await api.listInvoices().catch(() => invoices)
      setInvoices(updated)
      setTimeout(() => setPollMsg(null), 6000)
    } catch (e) { setError(e.message) }
    finally { setPolling(false) }
  }

  async function handleSync() {
    setSyncing(true); setError(null); setSyncMsg(null)
    const month = lastMonth()
    try {
      const inv = await api.syncMonth(month)
      setSyncMsg(`Synced ${inv.orders?.length || 0} orders for ${month} ✓`)
      const updated = await api.listInvoices()
      setInvoices(updated)
      setTimeout(() => setSyncMsg(null), 4000)
    } catch (e) { setError(e.message) }
    finally { setSyncing(false) }
  }

  const totalRetail    = invoices.reduce((s, i) => s + Number(i.total_retail), 0)
  const totalComm      = invoices.reduce((s, i) => s + Number(i.total_commission), 0)
  const unpaidMfr      = invoices.filter(i => !i.mfr_invoice_paid).length
  const unpaidComm     = invoices.filter(i => !i.commission_paid).length
  const partialComm    = invoices.filter(i => !i.commission_paid && Number(i.commission_amount_received) > 0).length

  if (loading) return <div className="empty-state"><div className="spinner" /> Loading...</div>

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Overview of all invoices</div>
        </div>
        <div className="gap-2">
          <button className="btn" onClick={handlePoll} disabled={polling}>
            {polling ? <><span className="spinner" /> Checking…</> : '✉ Check emails'}
          </button>
          <button className="btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : '↻ Sync last month'}
          </button>
          <button className="btn" onClick={() => setPaymentModal(true)} style={{ position: 'relative' }}>
            $ Record commission received
            {unmatchedCount > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: 'var(--amber)', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                {unmatchedCount}
              </span>
            )}
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/invoice/new')}>
            + New invoice
          </button>
        </div>
      </div>
      {error   && <div className="alert alert-error">{error}</div>}
      {syncMsg  && <div className="alert alert-success">{syncMsg}</div>}
      {pollMsg  && <div className="alert alert-info">{pollMsg}</div>}
      {unmatchedCount > 0 && (
        <div className="alert alert-warn" style={{ marginBottom: '1rem' }}>
          ⚠ {unmatchedCount} inbound email{unmatchedCount > 1 ? 's' : ''} could not be matched to an invoice automatically — review and resolve them via the payment recording flow.
        </div>
      )}

      {pendingReturns.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="card-title" style={{ marginBottom: '0.75rem' }}>
            ↩ Pending Returns ({pendingReturns.length})
          </div>
          {pendingReturns.map(r => (
            <div key={r.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.amazon_order_id}</div>
                {r.sku_name
                  ? <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.sku_name} × {r.qty} — {r.invoice_month ? fmtMonth(r.invoice_month) : 'unknown month'}</div>
                  : <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 2 }}>⚠ No matching order found</div>
                }
              </div>
              {r.refund_amount && (
                <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(r.refund_amount)}</div>
              )}
              <button className="btn btn-sm" onClick={() => setReturnModal(r)}>
                Review →
              </button>
            </div>
          ))}
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No invoices yet</div>
            <div style={{ fontSize: 13 }}>Create your first invoice to get started.</div>
            <button className="btn btn-primary mt-2" onClick={() => navigate('/invoice/new')}>
              Create first invoice
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-label">Total invoices</div>
              <div className="metric-value">{invoices.length}</div>
            </div>
            <div className="metric">
              <div className="metric-label">All-time retail</div>
              <div className="metric-value">{fmt(totalRetail)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">All-time commission</div>
              <div className="metric-value green">{fmt(totalComm)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">LiftUp invoices unpaid</div>
              <div className="metric-value" style={{ color: unpaidMfr > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {unpaidMfr}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Commissions unpaid</div>
              <div className="metric-value" style={{ color: unpaidComm > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {unpaidComm}
              </div>
              {partialComm > 0 && <div className="metric-note">{partialComm} partially received</div>}
            </div>
          </div>

          {(unpaidMfr > 0 || unpaidComm > 0) && (
            <div className="alert alert-warn" style={{ marginBottom: '1.5rem' }}>
              ⚠ {unpaidMfr > 0 ? `${unpaidMfr} LiftUp invoice(s) awaiting payment.` : ''}
              {unpaidMfr > 0 && unpaidComm > 0 ? ' · ' : ''}
              {unpaidComm > 0 ? `${unpaidComm} commission(s) not yet received.` : ''}
            </div>
          )}

          <div className="card-title">All invoices</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Invoice #</th>
                  <th style={{ textAlign: 'right' }}>Retail</th>
                  <th style={{ textAlign: 'right' }}>Commission</th>
                  <th>Verified</th>
                  <th>Mfr paid</th>
                  <th>Comm paid</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoice/${inv.month}`)}>
                    <td style={{ fontWeight: 600 }}>{fmtMonth(inv.month)}</td>
                    <td style={{ color: 'var(--text2)' }}>{inv.invoice_number || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(inv.total_retail)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{fmt(inv.total_commission)}</td>
                    <td>
                      {inv.verified
                        ? <span className="badge badge-verified">✓ Verified</span>
                        : <span className="badge badge-pending">Pending</span>}
                    </td>
                    <td>
                      {inv.mfr_invoice_paid
                        ? <span className="badge badge-paid">✓ Paid</span>
                        : <span className="badge badge-pending">Unpaid</span>}
                    </td>
                    <td>
                      {inv.commission_paid
                        ? <span className="badge badge-paid">✓ Received</span>
                        : <span className="badge badge-pending">Pending</span>}
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={e => { e.stopPropagation(); navigate(`/invoice/${inv.month}`) }}>
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {paymentModal && (
        <RecordPaymentModal
          paymentType="commission"
          onClose={() => setPaymentModal(false)}
          onSaved={async () => {
            setPaymentModal(false)
            const updated = await api.listInvoices().catch(() => invoices)
            setInvoices(updated)
            const unmatched = await api.getUnmatchedEmails().catch(() => [])
            setUnmatchedCount(unmatched.length)
          }}
        />
      )}

      {returnModal && (
        <ProcessReturnModal
          returnItem={returnModal}
          onClose={() => setReturnModal(null)}
          onProcessed={async () => {
            setReturnModal(null)
            const returns = await api.getPendingReturns().catch(() => [])
            setPendingReturns(returns)
            const updated = await api.listInvoices().catch(() => invoices)
            setInvoices(updated)
          }}
        />
      )}
    </>
  )
}
