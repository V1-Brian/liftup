import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmt, fmtMonth } from '../lib/utils'

export default function Dashboard() {
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.listInvoices()
      .then(setInvoices)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const recent = invoices.slice(0, 3)
  const totalRetail    = invoices.reduce((s, i) => s + Number(i.total_retail), 0)
  const totalComm      = invoices.reduce((s, i) => s + Number(i.total_commission), 0)
  const unpaidMfr      = invoices.filter(i => !i.mfr_invoice_paid).length
  const unpaidComm     = invoices.filter(i => !i.commission_paid).length

  if (loading) return <div className="empty-state"><div className="spinner" /> Loading...</div>
  if (error)   return <div className="alert alert-error">{error}</div>

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Overview of all invoices</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/invoice/new')}>
          + New invoice
        </button>
      </div>

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
              <div className="metric-label">Mfr invoices unpaid</div>
              <div className="metric-value" style={{ color: unpaidMfr > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {unpaidMfr}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Commissions unpaid</div>
              <div className="metric-value" style={{ color: unpaidComm > 0 ? 'var(--amber)' : 'var(--green)' }}>
                {unpaidComm}
              </div>
            </div>
          </div>

          {(unpaidMfr > 0 || unpaidComm > 0) && (
            <div className="alert alert-warn" style={{ marginBottom: '1.5rem' }}>
              ⚠ {unpaidMfr > 0 ? `${unpaidMfr} manufacturer invoice(s) awaiting payment.` : ''}
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
    </>
  )
}
