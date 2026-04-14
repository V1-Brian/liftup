import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { fmt, calcCommission } from '../lib/utils'

const EMPTY_SKU = { sku: '', name: '', shopify_price: 0, amazon_price: 0, flat_comm: 0, mkt_type: 'pct', mkt_value: 7, amazon_fee_pct: 15 }

export default function SkuPage() {
  const [skus,    setSkus]    = useState([])
  const [editing, setEditing] = useState(null) // id or 'new'
  const [form,    setForm]    = useState(EMPTY_SKU)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => { api.getSkus().then(setSkus) }, [])

  function startEdit(sku) {
    setEditing(sku.id)
    setForm({ ...sku })
    setError(null); setSuccess(null)
  }

  function startNew() {
    setEditing('new')
    setForm({ ...EMPTY_SKU })
    setError(null); setSuccess(null)
  }

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      if (editing === 'new') {
        const created = await api.createSku(form)
        setSkus(prev => [...prev, created])
        setSuccess('SKU created.')
      } else {
        const updated = await api.updateSku(editing, form)
        setSkus(prev => prev.map(s => s.id === editing ? updated : s))
        setSuccess('SKU updated.')
      }
      setEditing(null)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this SKU from the active list?')) return
    await api.deleteSku(id)
    setSkus(prev => prev.filter(s => s.id !== id))
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">SKU config</div>
          <div className="page-sub">Pricing and commission rules — 2026</div>
        </div>
        <button className="btn btn-primary" onClick={startNew}>+ Add SKU</button>
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {editing && (
        <div className="card" style={{ borderColor: 'var(--border2)' }}>
          <div className="card-title">{editing === 'new' ? 'New SKU' : 'Edit SKU'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {[
              { key: 'sku',            label: 'SKU code',            type: 'text' },
              { key: 'name',           label: 'Product name',        type: 'text' },
              { key: 'shopify_price',  label: 'Shopify price ($)',   type: 'number' },
              { key: 'amazon_price',   label: 'Amazon price ($)',    type: 'number' },
              { key: 'flat_comm',      label: 'Flat commission ($)', type: 'number' },
            ].map(f => (
              <div key={f.key}>
                <label>{f.label}</label>
                <input type={f.type} value={form[f.key]} style={{ width: '100%' }}
                  onChange={e => setForm(p => ({ ...p, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))} />
              </div>
            ))}
            <div>
              <label>Marketing type</label>
              <select value={form.mkt_type} style={{ width: '100%' }}
                onChange={e => setForm(p => ({ ...p, mkt_type: e.target.value, mkt_value: e.target.value === 'pct' ? 7 : p.mkt_value }))}>
                <option value="pct">% of sale price</option>
                <option value="flat">Flat $ per unit</option>
              </select>
            </div>
            <div>
              <label>{form.mkt_type === 'pct' ? 'Marketing %' : 'Marketing $ per unit'}</label>
              <input type="number" value={form.mkt_value} style={{ width: '100%' }}
                onChange={e => setForm(p => ({ ...p, mkt_value: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <label>Amazon fee %</label>
              <input type="number" value={form.amazon_fee_pct} style={{ width: '100%' }}
                onChange={e => setForm(p => ({ ...p, amazon_fee_pct: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save SKU'}
            </button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th><th>Product</th>
              <th style={{ textAlign: 'right' }}>Shopify price</th>
              <th style={{ textAlign: 'right' }}>Amazon price</th>
              <th style={{ textAlign: 'right' }}>Flat comm</th>
              <th>Marketing</th>
              <th style={{ textAlign: 'right' }}>Shopify total comm</th>
              <th style={{ textAlign: 'right' }}>Amazon total comm</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {skus.map(s => {
              const shopComm = s.shopify_price > 0 ? calcCommission(s, s.shopify_price, 'Shopify') : null
              const amzComm  = s.amazon_price  > 0 ? calcCommission(s, s.amazon_price,  'Amazon')  : null
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{s.sku}</td>
                  <td>{s.name}</td>
                  <td style={{ textAlign: 'right' }}>{s.shopify_price > 0 ? fmt(s.shopify_price) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{s.amazon_price  > 0 ? fmt(s.amazon_price)  : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(s.flat_comm)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {s.mkt_type === 'flat' ? fmt(s.mkt_value) + ' flat' : s.mkt_value + '% of sale'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--green)', fontSize: 12 }}>
                    {shopComm ? fmt(shopComm.total) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--green)', fontSize: 12 }}>
                    {amzComm ? fmt(amzComm.total) : '—'}
                  </td>
                  <td>
                    <div className="gap-2">
                      <button className="btn btn-sm" onClick={() => startEdit(s)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s.id)}>×</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="note">
        Commission = flat $ + marketing (% of sale or flat $) + Amazon 15% fee (Amazon orders only).
        Changes here apply to new invoices only — saved invoices store commissions at time of saving.
      </div>
    </>
  )
}
