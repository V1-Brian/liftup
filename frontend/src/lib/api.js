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

  listInvoices:      ()            => req('GET',    '/api/invoices'),
  getInvoice:        (month)       => req('GET',    `/api/invoices/${month}`),
  saveInvoice:       (month, d)    => req('POST',   `/api/invoices/${month}`, d),
  patchStatus:       (month, d)    => req('PATCH',  `/api/invoices/${month}/status`, d),
  deleteInvoice:     (month)       => req('DELETE', `/api/invoices/${month}`),
  getPaymentStatus:  ()            => req('GET',    '/api/invoices/payment-status'),

  syncMonth:    (month)       => req('POST',   `/api/sync/${month}`),

  listPayments:      (type)        => req('GET',    `/api/payments${type ? `?type=${type}` : ''}`),
  createPayment:     (d)           => req('POST',   '/api/payments', d),

  listCredits:        ()            => req('GET',    '/api/credits'),
  applyCredit:        (id, month)   => req('POST',   `/api/credits/${id}/apply`, { invoice_month: month }),
  sendCreditSnapshot: ()            => req('POST',   '/api/credits/send-snapshot'),

  getUnmatchedEmails: ()           => req('GET',    '/api/email/unmatched'),
  resolveUnmatched:   (id)         => req('POST',   `/api/email/unmatched/${id}/resolve`),
  pollEmails:         ()           => req('GET',    '/api/email/poll'),

  getPendingReturns:  ()           => req('GET',    '/api/returns/pending'),
  processReturn:      (id, d)      => req('POST',   `/api/returns/${id}/process`, d),
  dismissReturn:      (id)         => req('POST',   `/api/returns/${id}/dismiss`),

  getShipments:       ()           => req('GET',    '/api/shipments'),
  retryShopifySync:   (id)         => req('POST',   `/api/shipments/${id}/retry-sync`),
}
