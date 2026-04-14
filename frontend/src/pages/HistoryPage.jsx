import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmt, fmtMonth } from '../lib/utils'

export default function HistoryPage() {
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('all')
  const navigate = useNavigate()

  useEffect(() => {
    api.listInvoices().then(setInvoices).finally(() => setLoading(false))
  }, [])

  async function handleDelete(month, e) {
    e.stopPropagation()
    if (!confirm(`Delete invoice for ${fmtMonth(month)}? This cannot be undone.`)) return
    await api.deleteInvoice(month)
    setInvoices(prev => prev.filter(i => i.month !== month))
  }

  const filtered = invoices.filter(i => {
    if (filter === 'unpaid_mfr')  return !i.mfr_invoice_paid
    if (filter === 'unpaid_comm') return !i.commission_paid
    if (filter === 'unverified')  return !i.verified
    return true
  })

  if (loading) return <div className="empty-state"><div className="spinner" /> Loading...</div>

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Invoice history</div>
          <div className="page-sub">{invoices.length} invoices total</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/invoice/new')}>
          + New invoice
        </button>
      </div>

      <div className="gap-2" style={{ marginBottom: '1rem' }}>
        {[
          { val: 'all',         label: 'All' },
          { val: 'unverified',  label: 'Unverified' },
          { val: 'unpaid_mfr',  label: 'Mfr unpaid' },
          { val: 'unpaid_comm', label: 'Commission pending' },
        ].map(f => (
          <button
            key={f.val}
            className={'btn btn-sm' + (filter === f.val ? ' btn-primary' : '')}
            onClick={() => setFilter(f.val)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">No invoices match this filter.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Invoice #</th>
                <th style={{ textAlign: 'right' }}>Retail</th>
                <th style={{ textAlign: 'right' }}>Commission</th>
                <th style={{ textAlign: 'right' }}>Credit memos</th>
                <th>Verified</th>
                <th>Mfr invoice</th>
                <th>Commission</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoice/${inv.month}`)}>
                  <td style={{ fontWeight: 600 }}>{fmtMonth(inv.month)}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{inv.invoice_number || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(inv.total_retail)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 600 }}>{fmt(inv.total_commission)}</td>
                  <td style={{ textAlign: 'right', color: Number(inv.total_credit) > 0 ? 'var(--amber)' : 'var(--text3)' }}>
                    {Number(inv.total_credit) > 0 ? fmt(inv.total_credit) : '—'}
                  </td>
                  <td>
                    <span className={'badge ' + (inv.verified ? 'badge-verified' : 'badge-pending')}>
                      {inv.verified ? `✓ ${inv.verified_date || ''}` : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={'badge ' + (inv.mfr_invoice_paid ? 'badge-paid' : 'badge-pending')}>
                      {inv.mfr_invoice_paid ? `✓ ${inv.mfr_invoice_paid_date || 'Paid'}` : 'Unpaid'}
                    </span>
                  </td>
                  <td>
                    <span className={'badge ' + (inv.commission_paid ? 'badge-paid' : 'badge-pending')}>
                      {inv.commission_paid ? `✓ ${inv.commission_paid_date || 'Received'}` : 'Pending'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.notes || '—'}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="gap-2">
                      <button className="btn btn-sm" onClick={() => navigate(`/invoice/${inv.month}`)}>View</button>
                      <button className="btn btn-sm btn-danger" onClick={e => handleDelete(inv.month, e)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
