/**
 * Zoho Mail API client.
 * Handles token refresh, searching unread messages, fetching content, and marking as read.
 *
 * Required env vars:
 *   ZOHO_CLIENT_ID       — from Zoho Developer Console (Self Client app)
 *   ZOHO_CLIENT_SECRET   — from Zoho Developer Console
 *   ZOHO_REFRESH_TOKEN   — obtained once via self-client authorization code flow (never expires)
 *   ZOHO_ACCOUNT_ID      — your Zoho Mail account ID (obtained once, stored as env var)
 *   ZOHO_REGION          — data center TLD: 'com' (US), 'eu', 'in', 'com.au', etc. Defaults to 'com'
 */

const REGION      = () => process.env.ZOHO_REGION || 'com';
const ACCOUNTS_BASE = () => `https://accounts.zoho.${REGION()}`;
const MAIL_BASE     = () => `https://mail.zoho.${REGION()}/api`;

// In-memory token cache — reused across invocations within the same process lifetime
let cachedToken    = null;
let tokenExpiresAt = 0;

/**
 * Returns a valid access token, refreshing if expired.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho Mail not configured — set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN');
  }

  const res = await fetch(`${ACCOUNTS_BASE()}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      refresh_token: ZOHO_REFRESH_TOKEN,
    }).toString(),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(data)}`);
  }

  cachedToken    = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/**
 * GET helper with auth header.
 */
async function zohoGet(path, params = {}) {
  const token = await getAccessToken();
  const url   = new URL(`${MAIL_BASE()}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * PUT helper with auth header.
 */
async function zohoPut(path, body) {
  const token = await getAccessToken();
  const res   = await fetch(`${MAIL_BASE()}${path}`, {
    method:  'PUT',
    headers: {
      Authorization:  `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho PUT ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Fetch all unread messages from a specific folder (up to limit).
 * @param {string} folderId  — Zoho folder ID
 */
async function fetchFolderMessages(folderId, limit = 50) {
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  if (!accountId) throw new Error('ZOHO_ACCOUNT_ID env var not set');

  const data = await zohoGet(`/accounts/${accountId}/folders/${folderId}/messages`, {
    status: 'unread',
    limit:  String(limit),
  });

  return (data.data || []).map(m => ({ ...m, folderId }));
}

/**
 * Fetch all unread messages from the full inbox (fallback — used when folder IDs not configured).
 */
async function fetchUnreadMessages(limit = 50) {
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  if (!accountId) throw new Error('ZOHO_ACCOUNT_ID env var not set');

  const data = await zohoGet(`/accounts/${accountId}/messages/search`, {
    searchKey: 'newMails',
    limit:     String(limit),
    includeto: 'false',
  });

  return data.data || [];
}

/**
 * Fetch the full HTML content of a message.
 * Returns plain text (HTML tags stripped) for use by email-parser.js.
 */
async function fetchMessageContent(folderId, messageId) {
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  const data = await zohoGet(
    `/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content`
  );
  const html = data.data?.content || '';
  // Strip HTML tags to get plain text
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return { html, text };
}

/**
 * Mark one or more messages as read.
 */
async function markAsRead(messageIds) {
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  if (!messageIds.length) return;
  await zohoPut(`/accounts/${accountId}/updatemessage`, {
    mode:      'markAsRead',
    messageId: messageIds.map(String),
  });
}

/**
 * Upload a file attachment to Zoho and return the attachment path.
 * Must be called before sendEmail when attaching files.
 */
async function uploadAttachment(filename, buffer, mimeType) {
  const token     = await getAccessToken();
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  if (!accountId) throw new Error('ZOHO_ACCOUNT_ID env var not set');

  const formData = new FormData();
  formData.append('attach', new Blob([buffer], { type: mimeType }), filename);

  const uploadUrl = `${MAIL_BASE()}/accounts/${accountId}/messages/attachments?fileName=${encodeURIComponent(filename)}`;
  const res = await fetch(uploadUrl, {
    method:  'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    body:    formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho attachment upload ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.data?.attachmentPath || null;
}

/**
 * Send an email via Zoho Mail.
 * @param {object} opts
 * @param {string}   opts.to          — recipient address
 * @param {string}  [opts.cc]         — CC address (optional)
 * @param {string}   opts.subject
 * @param {string}   opts.html        — HTML body
 * @param {Array}   [opts.attachments] — [{ filename, buffer, mimeType }]
 */
async function sendEmail({ to, cc, subject, html, attachments = [] }) {
  const token     = await getAccessToken();
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  const from      = process.env.OUR_EMAIL;
  if (!accountId) throw new Error('ZOHO_ACCOUNT_ID env var not set');
  if (!from)      throw new Error('OUR_EMAIL env var not set');

  // Upload attachments first to get Zoho attachment paths
  const attachList = [];
  for (const att of attachments) {
    const attachPath = await uploadAttachment(att.filename, att.buffer, att.mimeType || 'application/octet-stream');
    if (attachPath) attachList.push({ attachmentName: att.filename, attachmentPath: attachPath });
  }

  const payload = {
    fromAddress: from,
    toAddress:   to,
    subject,
    content:     html,
    mailFormat:  'html',
  };
  if (cc)               payload.ccAddress   = cc;
  if (attachList.length) payload.attachments = attachList;

  const res = await fetch(`${MAIL_BASE()}/accounts/${accountId}/messages`, {
    method:  'POST',
    headers: {
      Authorization:  `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho sendEmail ${res.status}: ${text}`);
  }
  return res.json();
}

module.exports = { fetchFolderMessages, fetchUnreadMessages, fetchMessageContent, markAsRead, sendEmail };
