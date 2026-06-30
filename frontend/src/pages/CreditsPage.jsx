import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmt, fmtMonth } from '../lib/utils'

export default function CreditsPage() {
  const navigate = useNavigate()
  const [open,        setOpen]        = useState([])
  const [applied,     setApplied]     = useState([])
  const [invoices,    setInvoices]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [showApplied, setShowApplied] = useState(false)
  // applyingId: which credit row has the selector open; selectedMonth: chosen invoice month
  const [applyingId,    setApplyingId]    = useState(null)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [applying,      setApplying]      = useState(false)

  useEffect(() => {
    Promise.all([api.listCredits(), api.listInvoices()])
      .then(([credits, invs]) => {
        setOpen(credits.open)
        setApplied(credits.applied)
        setInvoices(invs)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleApply(creditId) {
    if (!selectedMonth) return
    setApplying(true)
    setError(null)
    try {
      await api.applyCredit(creditId, selectedMonth)
      const credits = await api.listCredits()
      setOpen(credits.open)
      setApplied(credits.applied)
      setApplyingId(null)
      setSelectedMonth('')
    } catch (e) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  if (loading) return <div className="empty-state"><div className="spinner" /> Loading credits…</div>

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Credits</div>
          <div className="page-sub">
            {open.length > 0
              ? `${open.length} open credit${open.length > 1 ? 's' : ''} — apply manually below or auto-applies on next invoice save`
              : 'All credits have been applied'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setShowApplied(s => !s)}>
          {showApplied ? 'Hide applied credits' : `Show applied credits (${applied.length})`}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Open credits */}
      <div className="card-title">Open credits</div>
      {open.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No open credits</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>Credits are generated when orders are marked "Returned (credit memo needed)".</div>
          </div>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: '1.5rem' }}>
          <table>
            <thead>
              <tr>
                <th>Source month</th>
                <th>SKU</th>
                <th>Product</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    <button className="btn btn-sm" style={{ fontWeight: 600, padding: '2px 8px' }}
                      onClick={() => navigate(`/invoice/${c.source_month}`)}>
                      {fmtMonth(c.source_month)}
                    </button>
                  </td>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{c.sku}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{c.sku_name}</td>
                  <td>
                    {c.credit_type === 'retail'
                      ? <span className="badge badge-retail">Retail</span>
                      : <span className="badge badge-commission">Commission</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--amber)' }}>{fmt(c.amount)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {c.credit_type === 'retail'
                      ? 'Reduces what we owe LiftUp'
                      : 'Reduces what LiftUp owes us'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {applyingId === c.id ? (
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <select
                          value={selectedMonth}
                          onChange={e => setSelectedMonth(e.target.value)}
                          style={{ fontSize: 12, padding: '2px 4px' }}
                        >
                          <option value=''>Select invoice…</option>
                          {invoices
                            .filter(i => i.month >= c.source_month)
                            .map(i => (
                              <option key={i.month} value={i.month}>
                                {fmtMonth(i.month)}
                              </option>
                            ))}
                        </select>
                        <button className="btn btn-sm btn-primary" onClick={() => handleApply(c.id)} disabled={applying || !selectedMonth}>
                          Apply
                        </button>
                        <button className="btn btn-sm" onClick={() => { setApplyingId(null); setSelectedMonth('') }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button className="btn btn-sm" onClick={() => { setApplyingId(c.id); setSelectedMonth('') }}>
                        Apply to invoice →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Applied credits */}
      {showApplied && (
        <>
          <div className="card-title">Applied credits</div>
          {applied.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ fontSize: 13, color: 'var(--text2)' }}>No applied credits yet.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source month</th>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Applied to</th>
                    <th>Applied date</th>
                  </tr>
                </thead>
                <tbody>
                  {applied.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{fmtMonth(c.source_month)}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{c.sku}</td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>{c.sku_name}</td>
                      <td>
                        {c.credit_type === 'retail'
                          ? <span className="badge badge-retail">Retail</span>
                          : <span className="badge badge-commission">Commission</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(c.amount)}</td>
                      <td>
                        {c.receiving_month ? (
                          <button className="btn btn-sm" style={{ padding: '2px 8px' }}
                            onClick={() => navigate(`/invoice/${c.receiving_month}`)}>
                            {fmtMonth(c.receiving_month)} →
                          </button>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {c.applied_at ? new Date(c.applied_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
