import { useState, useEffect } from 'react'
import { api } from '../lib/api'

function ShipStatus({ s }) {
  if (s.tracking_number && s.shopify_synced)
    return <span className="badge badge-commission">Synced to Shopify</span>
  if (s.tracking_number && s.shopify_sync_error)
    return <span className="badge" style={{ background: 'var(--amber)', color: '#fff' }}>Sync failed</span>
  if (s.tracking_number)
    return <span className="badge badge-retail">Tracking received</span>
  return <span className="badge" style={{ background: 'var(--border)', color: 'var(--text2)' }}>Awaiting shipment</span>
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [search,    setSearch]    = useState('')

  useEffect(() => {
    api.getShipments()
      .then(setShipments)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = shipments.filter(s => {
    const q = search.toLowerCase()
    return !q ||
      s.order_no.toLowerCase().includes(q) ||
      (s.tracking_number || '').toLowerCase().includes(q)
  })

  const awaiting  = shipments.filter(s => !s.tracking_number).length
  const inTransit = shipments.filter(s =>  s.tracking_number && !s.shopify_synced).length
  const synced    = shipments.filter(s =>  s.shopify_synced).length

  if (loading) return <div className="empty-state"><div className="spinner" /> Loading shipments…</div>

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Shipments</div>
          <div className="page-sub">
            {awaiting > 0 && <span style={{ marginRight: 12 }}>{awaiting} awaiting shipment</span>}
            {inTransit > 0 && <span style={{ marginRight: 12 }}>{inTransit} tracking received</span>}
            {synced > 0 && <span>{synced} synced to Shopify</span>}
            {shipments.length === 0 && 'No shipments yet — populated automatically from email'}
          </div>
        </div>
        <input
          className="input"
          style={{ width: 220, marginLeft: 'auto' }}
          placeholder="Search order # or tracking…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {search ? 'No matching shipments' : 'No shipments yet'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              Shipments are populated automatically when order and UPS tracking emails
              are received in the configured Zoho folders.
            </div>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Status</th>
                <th>Tracking number</th>
                <th>Carrier</th>
                <th>Shipped date</th>
                <th>Shopify synced</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 700, fontSize: 13 }}>{s.order_no}</td>
                  <td><ShipStatus s={s} /></td>
                  <td>
                    {s.tracking_number ? (
                      <a
                        href={`https://www.ups.com/track?tracknum=${s.tracking_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        {s.tracking_number}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{s.carrier}</td>
                  <td style={{ fontSize: 12 }}>
                    {s.shipped_at
                      ? new Date(s.shipped_at).toLocaleDateString()
                      : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {s.shopify_synced
                      ? <span style={{ color: 'var(--green)' }}>
                          {s.shopify_synced_at ? new Date(s.shopify_synced_at).toLocaleDateString() : 'Yes'}
                        </span>
                      : s.shopify_sync_error
                        ? <span style={{ color: 'var(--red)', fontSize: 11 }} title={s.shopify_sync_error}>
                            Failed ⚠
                          </span>
                        : <span style={{ color: 'var(--text3)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {new Date(s.created_at).toLocaleDateString()}
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
