import { useState } from 'react'
import { api } from '../lib/api'
import { fmt, fmtMonth } from '../lib/utils'

export default function ProcessReturnModal({ returnItem, onClose, onProcessed }) {
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const [retailCredit,     setRetailCredit]     = useState(true)
  const [commissionCredit, setCommissionCredit] = useState(true)

  async function handle(disposition) {
    setSaving(true)
    setError(null)
    try {
      const credit_types = disposition === 'after'
        ? [retailCredit && 'retail', commissionCredit && 'commission'].filter(Boolean)
        : undefined
      await api.processReturn(returnItem.id, { disposition, credit_types })
      onProcessed()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  async function handleDismiss() {
    setSaving(true)
    try {
      await api.dismissReturn(returnItem.id)
      onProcessed()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const isMatched = !!returnItem.order_id || !!returnItem.order_no

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Process Return</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: 13 }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--text2)' }}>Amazon Order: </span>
              <strong>{returnItem.amazon_order_id}</strong>
            </div>
            {returnItem.order_no && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--text2)' }}>Shopify Order: </span>
                <strong>{returnItem.order_no}</strong>
              </div>
            )}
            {returnItem.sku_name && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--text2)' }}>SKU: </span>
                {returnItem.sku_name} × {returnItem.qty}
                {returnItem.sale_price && <span style={{ color: 'var(--text2)' }}> ({fmt(returnItem.sale_price)} each)</span>}
              </div>
            )}
            {returnItem.invoice_month && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--text2)' }}>Original invoice: </span>
                {fmtMonth(returnItem.invoice_month)}
              </div>
            )}
            {returnItem.refund_amount && (
              <div>
                <span style={{ color: 'var(--text2)' }}>Refund amount: </span>
                <strong>{fmt(returnItem.refund_amount)}</strong>
              </div>
            )}
          </div>

          {!isMatched && (
            <div className="alert alert-warn" style={{ marginBottom: '1rem', fontSize: 13 }}>
              ⚠ No matching order found for this Amazon Order ID. Update <code>amazon_order_id</code> on the order manually, then reprocess.
            </div>
          )}

          {isMatched && (
            <>
              <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>When did this return occur?</p>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: '1rem' }}>
                This determines whether to exclude it from the original invoice totals (<em>same month</em>) or generate a credit memo (<em>after invoice was sent</em>).
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button className="btn" onClick={() => handle('before')} disabled={saving}>
                  Same month as invoice
                </button>
              </div>

              <div style={{ background: 'var(--bg2)', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: '0.5rem' }}>After invoice was sent (credit memo)</p>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: '0.5rem' }}>
                  Normally LiftUp owes us back the retail amount and we owe LiftUp back the commission. If we never invoiced LiftUp commission on this order, uncheck that side.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 13, marginBottom: '0.3rem' }}>
                  <input type="checkbox" checked={retailCredit} onChange={e => setRetailCredit(e.target.checked)} />
                  Retail credit — LiftUp owes us back
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 13, marginBottom: '0.6rem' }}>
                  <input type="checkbox" checked={commissionCredit} onChange={e => setCommissionCredit(e.target.checked)} />
                  Commission credit — we owe LiftUp back
                </label>
                <button
                  className="btn btn-primary"
                  onClick={() => handle('after')}
                  disabled={saving || (!retailCredit && !commissionCredit)}
                >
                  Create credit{(retailCredit && commissionCredit) ? 's' : ''}
                </button>
              </div>
            </>
          )}

          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <button className="btn" style={{ fontSize: 12, color: 'var(--text2)' }} onClick={handleDismiss} disabled={saving}>
              Dismiss without action
            </button>
          </div>

          {error && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}
