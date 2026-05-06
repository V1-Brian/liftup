# SEO Blog Automation — Claude Context

## What this module is
Automated weekly blog post generation for the LiftUp Shopify storefront. A Vercel cron fires weekly, calls the Claude API to generate an SEO-optimized article targeting a predefined keyword, and publishes it (or saves it as a draft) via the Shopify Articles API.

Housed in the same `liftup` repo as the invoice/commission app because Shopify credentials are already wired up here.

---

## Architecture

- **Trigger**: Vercel cron → `GET /api/cron/blog-post` (same `Authorization: Bearer <CRON_SECRET>` pattern as existing crons)
- **Generation**: Anthropic Claude API (`claude-sonnet-4-6` or later) — prompt tuned for long-form SEO articles in the mobility/assistive device niche
- **Publishing**: Shopify Admin REST API — `POST /admin/api/2024-01/blogs/{SHOPIFY_BLOG_ID}/articles.json`
- **Topic tracking**: Cycles through an ordered list in `backend/blog-topics.js`; a `blog_posts_log` DB table records what's been posted to avoid repeats

---

## Key files

| File | Purpose |
|------|---------|
| `backend/blog-generator.js` | Core logic: pick next topic → call Claude → post to Shopify |
| `backend/blog-topics.js` | Ordered array of 40 keyword topics to cycle through |
| `backend/migrate_blog.js` | Creates `blog_posts_log` table — run once against Render DB |
| `backend/index.js` | `GET /api/cron/blog-post` route added at bottom |
| `vercel.json` | Weekly cron added: `0 10 * * 1` (Mondays 10 AM UTC) |

---

## Environment variables

| Var | Where set | Notes |
|-----|-----------|-------|
| `ANTHROPIC_API_KEY` | Vercel (Production + Preview) | New — must be added before first deploy |
| `SHOPIFY_BLOG_ID` | Vercel (Production + Preview) | New — numeric ID of the Shopify blog to post to. Find it via `GET /admin/api/2024-01/blogs.json` or Shopify admin URL |
| `SHOPIFY_STORE` | Already set | e.g. `yourstore.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Already set | |
| `SHOPIFY_CLIENT_SECRET` | Already set | |
| `CRON_SECRET` | Already set | Reused for blog cron auth |

---

## Shopify app scope requirement

The existing Shopify custom app was created with order-reading scopes. Before blog posts can be created, **`write_content` scope must be added**:

1. Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Select the existing app → Configuration tab
3. Add `write_content` to Admin API access scopes
4. Save and reinstall the app (generates a new access token — update `SHOPIFY_CLIENT_SECRET` in Vercel if it changes)

---

## Topic strategy

Topics are grouped into four content pillars:

1. **Pain-point / caregiver searches** — high intent, low competition (e.g. "how to lift elderly person off floor without hurting yourself")
2. **Product-aware searches** — people researching solutions (e.g. "floor lift for someone with no leg strength")
3. **Competitor comparison** — capture Vocic / Maidesite researchers (e.g. "maidesite floor lift alternative")
4. **Education / caregiver guides** — builds topical authority (e.g. "fall recovery plan for elderly at home")

Full list lives in `backend/blog-topics.js`.

---

## Database

### New table: `blog_posts_log`

```sql
CREATE TABLE blog_posts_log (
  id            SERIAL PRIMARY KEY,
  topic_index   INTEGER NOT NULL,
  keyword       TEXT NOT NULL,
  shopify_article_id BIGINT,
  title         TEXT,
  published_at  TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT DEFAULT 'published'  -- 'published' | 'draft' | 'error'
);
```

Run migration: `node backend/migrate_blog.js`

---

## Cron schedule

| Path | Schedule | Purpose |
|------|----------|---------|
| `GET /api/cron/blog-post` | `0 10 * * 1` | Every Monday at 10 AM UTC — generate + publish one blog post |

---

## Publish mode

Currently configured to **auto-publish** (`PUBLISH_AS_DRAFT = false` in `blog-generator.js`). Change to `true` if you want posts to land as drafts for review before going live.

---

## ✅ Build checklist

- [ ] Add `ANTHROPIC_API_KEY` to Vercel env vars (Production + Preview)
- [ ] Add `SHOPIFY_BLOG_ID` to Vercel env vars (Production + Preview)
- [ ] Add `write_content` scope to Shopify custom app
- [x] Install `@anthropic-ai/sdk` in root `package.json`
- [x] Create `backend/blog-topics.js` with full keyword list (40 topics)
- [x] Create `backend/migrate_blog.js`
- [ ] Run `migrate_blog.js` against Render DB
- [x] Create `backend/blog-generator.js`
- [x] Add `/api/cron/blog-post` route to `backend/index.js`
- [x] Add cron entry to `vercel.json`
- [ ] Deploy to Vercel (`vercel --prod`)
- [ ] Trigger manually to verify end-to-end: `vercel curl /api/cron/blog-post`
- [ ] Confirm post appears in Shopify admin

## ⚙️ Known issues / pending

- Shopify access token is short-lived (24h per `shopify.js` comment) — confirm `client_credentials` grant works for `write_content` scope or switch to a private app API token if needed
- If topic list is exhausted, generator should loop back to index 0 (wrap-around)
- No retry logic yet if Claude API or Shopify API call fails — cron will simply miss that week; consider adding error email via existing Zoho mail setup
