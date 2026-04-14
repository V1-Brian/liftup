const BASE = import.meta.env.VITE_API_URL || ''

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

export const api = {
  getSkus:      ()            => req('GET',    '/api/skus'),
  createSku:    (d)           => req('POST',   '/api/skus', d),
  updateSku:    (id, d)       => req('PUT',    `/api/skus/${id}`, d),
  deleteSku:    (id)          => req('DELETE', `/api/skus/${id}`),

  listInvoices: ()            => req('GET',    '/api/invoices'),
  getInvoice:   (month)       => req('GET',    `/api/invoices/${month}`),
  saveInvoice:  (month, d)    => req('POST',   `/api/invoices/${month}`, d),
  patchStatus:  (month, d)    => req('PATCH',  `/api/invoices/${month}/status`, d),
  deleteInvoice:(month)       => req('DELETE', `/api/invoices/${month}`),
}
