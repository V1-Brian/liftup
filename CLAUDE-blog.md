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
| `ANTHROPIC_API_KEY` | Vercel ✅ set | Claude API key for blog generation |
| `SHOPIFY_BLOG_ID_HOME_CARE` | Vercel ✅ set | Numeric ID for the Home Care blog |
| `SHOPIFY_BLOG_ID_PROFESSIONAL_CARE` | Vercel ✅ set | Numeric ID for the Professional Care blog |
| `SHOPIFY_BLOG_ID_BUYERSGUIDE` | Vercel ✅ set | Numeric ID for the Buyer's Guide blog (formerly "Informative") |
| `SHOPIFY_STORE` | Already set | e.g. `yourstore.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Already set | |
| `SHOPIFY_CLIENT_SECRET` | Already set | Access token unchanged after `write_content` scope added |
| `CRON_SECRET` | Already set | Reused for blog cron auth |

## Blog strategy

Four blogs exist on the Shopify storefront. Auto-generation posts to three; **News is reserved for actual announcements only**.

| Blog | Env var | Content pillar |
|------|---------|----------------|
| Home Care | `SHOPIFY_BLOG_ID_HOME_CARE` | Caregiver pain-points, fall recovery, lifting at home |
| Professional Care | `SHOPIFY_BLOG_ID_PROFESSIONAL_CARE` | Medical/facility-focused, professional caregiver guides |
| Buyer's Guide | `SHOPIFY_BLOG_ID_BUYERSGUIDE` | Product comparisons, competitor captures, education |
| News | — | Manual posts only — do not auto-post here |

Dates are intentionally hidden on blog pages (evergreen content strategy). Do not re-enable.

---

## Shopify app scope requirement

✅ **`write_content` scope has been added.** Access token did not change after reinstall.

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

- [x] Add `ANTHROPIC_API_KEY` to Vercel env vars (Production + Preview)
- [x] Add blog ID env vars to Vercel: `SHOPIFY_BLOG_ID_HOME_CARE`, `SHOPIFY_BLOG_ID_PROFESSIONAL_CARE`, `SHOPIFY_BLOG_ID_BUYERSGUIDE`
- [x] Add `write_content` scope to Shopify custom app
- [x] Install `@anthropic-ai/sdk` in root `package.json`
- [x] Create `backend/blog-topics.js` with full keyword list (40 topics)
- [x] Create `backend/migrate_blog.js`
- [ ] **RUN FIRST**: `migrate_blog.js` against Render DB — `blog_posts_log` table does not yet exist
  ```bash
  cd backend
  DATABASE_URL="postgresql://liftup_user:g0z2pq31zdbRrJTkfnAHTCdfCJ7JSmNN@dpg-d7f908n7f7vs739rfh30-a.oregon-postgres.render.com:5432/liftup_31bl" node migrate_blog.js
  ```
- [ ] **THEN**: Update `backend/blog-topics.js` — add `blog` field to each topic (`'home_care'` | `'professional_care'` | `'buyers_guide'`)
- [ ] **THEN**: Update `backend/blog-generator.js` — replace single `SHOPIFY_BLOG_ID` with named blog ID lookup map
- [ ] Deploy to Vercel after code updates
- [ ] Trigger manually to verify end-to-end: `vercel curl /api/cron/blog-post`
- [ ] Confirm post appears in correct Shopify blog

## ⚙️ Known issues / pending

- Shopify access token is short-lived (24h per `shopify.js` comment) — confirm `client_credentials` grant works for `write_content` scope or switch to a private app API token if needed
- If topic list is exhausted, generator should loop back to index 0 (wrap-around)
- No retry logic yet if Claude API or Shopify API call fails — cron will simply miss that week; consider adding error email via existing Zoho mail setup
