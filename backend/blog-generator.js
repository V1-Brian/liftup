const Anthropic = require('@anthropic-ai/sdk');
const TOPICS = require('./blog-topics');

const SHOPIFY_API_VERSION = '2024-01';
const PUBLISH_AS_DRAFT = false; // set to true to review before going live

// Maps topic.blog → Vercel env var name
const BLOG_ID_ENV = {
  home_care:         'SHOPIFY_BLOG_ID_HOME_CARE',
  professional_care: 'SHOPIFY_BLOG_ID_PROFESSIONAL_CARE',
  buyers_guide:      'SHOPIFY_BLOG_ID_BUYERSGUIDE',
};

function getBlogId(blogKey) {
  const envVar = BLOG_ID_ENV[blogKey];
  if (!envVar) throw new Error(`Unknown blog key: ${blogKey}`);
  const id = process.env[envVar];
  if (!id) throw new Error(`Env var ${envVar} is not set`);
  return id;
}

// ── HTML cleanup ─────────────────────────────────────────────────────────────

// Strip markdown code fences Claude sometimes adds around the HTML
function cleanHtml(raw) {
  return raw.replace(/^```html\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ── Unsplash image ────────────────────────────────────────────────────────────

async function fetchUnsplashImage(keyword) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${key}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data.results?.[0];
    if (!photo) return null;
    return {
      url:    photo.urls.regular,
      alt:    photo.alt_description || keyword,
      credit: `Photo by <a href="${photo.user.links.html}?utm_source=rizeup&utm_medium=referral" target="_blank" rel="noopener">${photo.user.name}</a> on <a href="https://unsplash.com/?utm_source=rizeup&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>`,
    };
  } catch {
    return null; // non-fatal — post publishes without image
  }
}

function buildHeroImageHtml(image) {
  return `<figure style="margin:0 0 2em 0"><img src="${image.url}" alt="${image.alt}" style="width:100%;height:auto;border-radius:6px;display:block"><figcaption style="font-size:0.8em;color:#888;text-align:right;margin-top:4px">${image.credit}</figcaption></figure>`;
}

// ── Shopify helpers ──────────────────────────────────────────────────────────

async function getShopifyToken() {
  const { SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Shopify token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function publishArticle(token, blogId, title, bodyHtml, tags) {
  const { SHOPIFY_STORE } = process.env;
  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}/articles.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      article: {
        title,
        body_html: bodyHtml,
        tags,
        published: !PUBLISH_AS_DRAFT,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.article) {
    throw new Error(`Shopify article create failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.article;
}

// ── Claude content generation ────────────────────────────────────────────────

function buildPrompt(topic) {
  const pillarContext = {
    'pain-point':    'The reader is a caregiver or family member in an urgent or stressful situation. Lead with empathy and practical steps.',
    'product-aware': 'The reader is actively researching solutions. Be informative and help them understand what to look for, naturally referencing our products where relevant.',
    'comparison':    'The reader is comparing options, possibly including competitor products. Be honest and balanced; highlight genuine differentiators of our device.',
    'education':     'The reader wants to learn. Be authoritative, cite general statistics where appropriate, and build trust. Connect to fall safety and assistive device topics naturally.',
  };

  return `You are writing a blog article for a website that sells the LiftUp patient floor lift — a mobility device for elderly and disabled people who fall and cannot get up on their own.

What makes LiftUp unique: the patient does NOT need any strength or ability to move. The device is assembled around the patient while they lie flat, then lifts them to a seated or standing position. This is fundamentally different from most lifts that require the patient to pivot or assist.

Product lineup:
- Manual crank floor lift: ~$1,995 (caregiver operates a hand crank)
- Electronic floor lift: ~$5,495 (motorized, one-button operation)
- Refurbished electronic floor lift: ~$4,495

Primary competitor: Vocic / Maidesite (sold on Amazon) — budget options, require more patient participation.

Content pillar context: ${pillarContext[topic.pillar]}

Write a complete, publication-ready blog article with the following requirements:

TARGET KEYWORD: "${topic.keyword}"
ARTICLE TITLE: "${topic.title_hint}"

STRUCTURE:
- Opening paragraph: hook the reader with the core problem or question (2–3 sentences)
- 3–5 H2 sections with substantive content under each (150–250 words per section)
- A natural product mention or two where it fits — not forced, not salesy
- Closing paragraph with a soft call to action (e.g., "Learn more about the LiftUp floor lift" — do not use hard sales language)
- Meta description (1 sentence, ~155 characters, include the target keyword)

FORMATTING RULES — follow exactly:
- Do NOT include an H1 tag. The title is displayed separately by the CMS; including it here causes it to appear twice.
- Start the response directly with the opening <p> tag.
- Use only these tags: p, h2, ul, li, strong, em, a.
- No inline styles, no divs, no scripts.
- Do NOT wrap the HTML in markdown code fences (no \`\`\`html ... \`\`\`).
- Place the meta description at the very end in this exact format:
<!-- meta: YOUR META DESCRIPTION HERE -->

TONE: Warm, knowledgeable, and practical. Written for caregivers and family members, not medical professionals. Avoid jargon. Aim for a 7th–8th grade reading level.

LENGTH: 900–1,200 words of body text (not counting HTML tags).

Return only the article HTML — no commentary before or after.`;
}

async function generateArticle(topic) {
  const client = new Anthropic();
  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: buildPrompt(topic) }],
  });
  return message.content[0].text.trim();
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function pickNextTopic(pool) {
  const { rows } = await pool.query(
    'SELECT MAX(topic_index) AS last FROM blog_posts_log WHERE status != $1',
    ['error']
  );
  const last = rows[0].last;
  if (last === null) return 0;
  return (last + 1) % TOPICS.length;
}

async function runBlogPost(pool, forceTopicIndex = null) {
  const topicIndex = forceTopicIndex !== null ? forceTopicIndex : await pickNextTopic(pool);
  const topic      = TOPICS[topicIndex];

  console.log(`[blog] topic ${topicIndex} (${topic.blog}): "${topic.keyword}"`);

  const { rows: [logRow] } = await pool.query(
    `INSERT INTO blog_posts_log (topic_index, keyword, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [topicIndex, topic.keyword]
  );
  const logId = logRow.id;

  try {
    const [rawHtml, image] = await Promise.all([
      generateArticle(topic),
      fetchUnsplashImage(topic.keyword),
    ]);

    const token  = await getShopifyToken();
    const blogId = getBlogId(topic.blog);

    // Clean Claude output: strip code fences, strip meta comment
    let bodyHtml = cleanHtml(rawHtml);
    bodyHtml = bodyHtml.replace(/<!--\s*meta:.*?-->/gi, '').trim();

    // Prepend hero image if one was found
    if (image) bodyHtml = buildHeroImageHtml(image) + '\n' + bodyHtml;

    const title = topic.title_hint;
    const tags  = ['fall recovery', 'caregiver', 'patient lift', topic.pillar];
    const article = await publishArticle(token, blogId, title, bodyHtml, tags.join(', '));

    await pool.query(
      `UPDATE blog_posts_log SET status=$1, title=$2, shopify_article_id=$3 WHERE id=$4`,
      [PUBLISH_AS_DRAFT ? 'draft' : 'published', title, article.id, logId]
    );

    console.log(`[blog] published article id=${article.id} "${title}" → ${topic.blog}`);
    return { ok: true, topicIndex, blog: topic.blog, title, articleId: article.id };

  } catch (err) {
    await pool.query(
      `UPDATE blog_posts_log SET status='error', error_message=$1 WHERE id=$2`,
      [err.message, logId]
    );
    throw err;
  }
}

module.exports = { runBlogPost };
