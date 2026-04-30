import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, fmtMonth } from '../lib/utils'

export default function RecordPaymentModal({ paymentType, defaultInvoiceId, onClose, onSaved }) {
  const isCommission = paymentType === 'commission'
  const title = isCommission ? 'Record commission received' : 'Record payment to LiftUp'

  const [invoices,    setInvoices]    = useState([])
  const [loading,     setLoading]     = useState(isCommission)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)
  const [allocations, setAllocations] = useState({})

  const [form, setForm] = useState({
    payment_date: new Date().toISOString().slice(0, 10),
    amount:       '',
    reference:    '',
    notes:        '',
  })

  useEffect(() => {
    if (!isCommission) return
    api.getPaymentStatus()
      .then(rows => {
        // Only show invoices with outstanding commission balance
        const unpaid = rows.filter(r => !r.commission_paid)
        setInvoices(unpaid)
        // Pre-populate allocation amounts with remaining balance
        const init = {}
        unpaid.forEach(r => {
          const remaining = +(Number(r.total_commission) - Number(r.commission_amount_received)).toFixed(2)
          if (defaultInvoiceId && r.id === defaultInvoiceId) {
            init[r.id] = { checked: true, amount: remaining > 0 ? String(remaining) : '' }
          } else {
            init[r.id] = { checked: false, amount: remaining > 0 ? String(remaining) : '' }
          }
        })
        setAllocations(init)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const allocTotal = Object.entries(allocations)
    .filter(([, v]) => v.checked)
    .reduce((s, [, v]) => s + (parseFloat(v.amount) || 0), 0)

  const enteredAmount = parseFloat(form.amount) || 0
  const overAllocated = allocTotal > enteredAmount + 0.01

  function toggle(id) {
    setAllocations(prev => ({
      ...prev,
      [id]: { ...prev[id], checked: !prev[id].checked },
    }))
  }

  function setAllocAmt(id, val) {
    setAllocations(prev => ({ ...prev, [id]: { ...prev[id], amount: val } }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount || !form.payment_date) return setError('Payment date and amount are required')
    if (isCommission && overAllocated) return setError('Allocated amount exceeds payment total')

    setSaving(true); setError(null)
    try {
      const allocList = isCommission
        ? Object.entries(allocations)
            .filter(([, v]) => v.checked && parseFloat(v.amount) > 0)
            .map(([id, v]) => ({ invoice_id: Number(id), amount: parseFloat(v.amount) }))
        : defaultInvoiceId
          ? [{ invoice_id: defaultInvoiceId, amount: parseFloat(form.amount) }]
          : []

      const result = await api.createPayment({
        payment_type: paymentType,
        payment_date: form.payment_date,
        amount:       parseFloat(form.amount),
        reference:    form.reference || undefined,
        notes:        form.notes || undefined,
        allocations:  allocList,
      })
      onSaved(result)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label>Payment date *</label>
              <input type="date" value={form.payment_date} required
                onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>
            <div>
              <label>{isCommission ? 'Amount received ($) *' : 'Amount paid ($) *'}</label>
              <input type="number" value={form.amount} min="0.01" step="0.01" required placeholder="0.00"
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label>{isCommission ? 'Bank transfer reference' : 'QB invoice / reference'}</label>
              <input type="text" value={form.reference} placeholder="e.g. INV-2026-03"
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div>
              <label>Notes</label>
              <input type="text" value={form.notes} placeholder="Optional"
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          {isCommission && (
            <>
              <div className="card-title" style={{ margin: '0 0 8px' }}>Allocate to invoices</div>
              {loading ? (
                <div className="empty-state"><div className="spinner" /> Loading invoices…</div>
              ) : invoices.length === 0 ? (
                <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 12 }}>No outstanding commission invoices.</div>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 260, marginBottom: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 32 }}></th>
                        <th>Month</th>
                        <th style={{ textAlign: 'right' }}>Commission owed</th>
                        <th style={{ textAlign: 'right' }}>Already received</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                        <th style={{ textAlign: 'right' }}>Apply ($)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(inv => {
                        const balance = +(Number(inv.total_commission) - Number(inv.commission_amount_received)).toFixed(2)
                        const alloc   = allocations[inv.id] || { checked: false, amount: '' }
                        return (
                          <tr key={inv.id} style={{ background: alloc.checked ? 'var(--bg2)' : undefined }}>
                            <td><input type="checkbox" checked={alloc.checked} onChange={() => toggle(inv.id)} /></td>
                            <td style={{ fontWeight: 600 }}>{fmtMonth(inv.month)}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(inv.total_commission)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{fmt(inv.commission_amount_received)}</td>
                            <td style={{ textAlign: 'right', color: balance > 0 ? 'var(--amber)' : 'var(--green)', fontWeight: 600 }}>{fmt(balance)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <input type="number" min="0.01" step="0.01" placeholder="0.00"
                                value={alloc.checked ? alloc.amount : ''}
                                disabled={!alloc.checked}
                                style={{ width: 90, textAlign: 'right' }}
                                onChange={e => setAllocAmt(inv.id, e.target.value)} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 13, marginBottom: 16 }}>
                <span style={{ color: 'var(--text2)' }}>Allocated:</span>
                <span style={{ fontWeight: 700, color: overAllocated ? 'var(--red)' : undefined }}>{fmt(allocTotal)}</span>
                <span style={{ color: 'var(--text2)' }}>of {fmt(enteredAmount)}</span>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || overAllocated}>
              {saving ? 'Saving…' : 'Save payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
