const Anthropic = require('@anthropic-ai/sdk');
const TOPICS = require('./blog-topics');

const SHOPIFY_API_VERSION = '2024-01';
const PUBLISH_AS_DRAFT = false; // set to true to review before going live

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

async function publishArticle(token, title, bodyHtml, tags) {
  const { SHOPIFY_STORE, SHOPIFY_BLOG_ID } = process.env;
  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/blogs/${SHOPIFY_BLOG_ID}/articles.json`;
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
SUGGESTED TITLE: "${topic.title_hint}"

STRUCTURE:
- H1 title (use the suggested title or improve it slightly for the keyword)
- Opening paragraph: hook the reader with the core problem or question (2–3 sentences)
- 3–5 H2 sections with substantive content under each (150–250 words per section)
- A natural product mention or two where it fits — not forced, not salesy
- Closing paragraph with a soft call to action (e.g., "Learn more about the LiftUp floor lift" — do not use hard sales language)
- Meta description (1 sentence, ~155 characters, include the target keyword)

FORMATTING: Return the full article as clean HTML (h1, h2, p, ul/li tags only — no inline styles, no divs, no scripts). Place the meta description at the very end in this exact format:
<!-- meta: YOUR META DESCRIPTION HERE -->

TONE: Warm, knowledgeable, and practical. Written for caregivers and family members, not medical professionals. Avoid jargon. Aim for a 7th–8th grade reading level.

LENGTH: 900–1,200 words of body text (not counting HTML tags).

Do not include any commentary before or after the HTML — return only the article HTML.`;
}

async function generateArticle(topic) {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: buildPrompt(topic) }],
  });
  return message.content[0].text.trim();
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function pickNextTopic(pool) {
  // Find the highest topic_index used so far, then advance by 1 (wrapping around)
  const { rows } = await pool.query(
    'SELECT MAX(topic_index) AS last FROM blog_posts_log WHERE status != $1',
    ['error']
  );
  const last = rows[0].last;
  if (last === null) return 0;
  return (last + 1) % TOPICS.length;
}

async function runBlogPost(pool) {
  const topicIndex = await pickNextTopic(pool);
  const topic      = TOPICS[topicIndex];

  console.log(`[blog] topic ${topicIndex}: "${topic.keyword}"`);

  // Log intent before calling external APIs so a crash still leaves a trace
  const { rows: [logRow] } = await pool.query(
    `INSERT INTO blog_posts_log (topic_index, keyword, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [topicIndex, topic.keyword]
  );
  const logId = logRow.id;

  try {
    const html    = await generateArticle(topic);
    const token   = await getShopifyToken();

    // Extract title from the first <h1> tag
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '') : topic.title_hint;

    // Strip meta comment from body before publishing
    const bodyHtml = html.replace(/<!--\s*meta:.*?-->/gi, '').trim();

    const tags = ['fall recovery', 'caregiver', 'patient lift', topic.pillar];
    const article = await publishArticle(token, title, bodyHtml, tags.join(', '));

    await pool.query(
      `UPDATE blog_posts_log
       SET status = $1, title = $2, shopify_article_id = $3
       WHERE id = $4`,
      [PUBLISH_AS_DRAFT ? 'draft' : 'published', title, article.id, logId]
    );

    console.log(`[blog] published article id=${article.id} "${title}"`);
    return { ok: true, topicIndex, title, articleId: article.id };

  } catch (err) {
    await pool.query(
      `UPDATE blog_posts_log SET status = 'error', error_message = $1 WHERE id = $2`,
      [err.message, logId]
    );
    throw err;
  }
}

module.exports = { runBlogPost };
