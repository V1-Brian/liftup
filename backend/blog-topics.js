// Ordered list of SEO topics to cycle through weekly.
// Each entry has a primary keyword, a content pillar for prompt context,
// and a blog target matching one of the three Shopify blogs.
// Pillars: 'pain-point' | 'product-aware' | 'comparison' | 'education'
// Blogs:   'home_care'  | 'professional_care' | 'buyers_guide'

const TOPICS = [
  // ── Pain-point / caregiver searches → Home Care ──────────────────────────
  {
    keyword:    'how to lift elderly person off floor without hurting yourself',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'How to Lift an Elderly Person Off the Floor Without Injuring Yourself',
  },
  {
    keyword:    'elderly person fell and can\'t get up what to do',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'What to Do When an Elderly Person Falls and Can\'t Get Up',
  },
  {
    keyword:    'how to help someone get up from the floor who has no strength',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'How to Help Someone Get Up From the Floor When They Have No Strength',
  },
  {
    keyword:    'lifting patient off floor safely at home',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'How to Safely Lift a Patient Off the Floor at Home',
  },
  {
    keyword:    'caregiver back injury lifting patient',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'Preventing Caregiver Back Injuries When Lifting Patients',
  },
  {
    keyword:    'what to do when elderly parent keeps falling',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'What to Do When Your Elderly Parent Keeps Falling',
  },
  {
    keyword:    'how to get someone up from floor after fall',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'Step-by-Step: How to Get Someone Up From the Floor After a Fall',
  },
  {
    keyword:    'person can\'t stand up from floor on their own',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'Solutions for When a Person Cannot Stand Up From the Floor on Their Own',
  },
  {
    keyword:    'home care fall recovery without ambulance',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'How to Handle a Fall at Home Without Calling an Ambulance Every Time',
  },
  {
    keyword:    'how to lift dead weight person off floor',
    pillar:     'pain-point',
    blog:       'home_care',
    title_hint: 'How to Lift a Person Who Cannot Help With Their Own Transfer',
  },

  // ── Product-aware searches → Buyer's Guide ───────────────────────────────
  {
    keyword:    'floor lift device for elderly',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Floor Lift Devices for the Elderly: What to Know Before You Buy',
  },
  {
    keyword:    'electric patient floor lift for home use',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Electric Patient Floor Lifts for Home Use: A Complete Guide',
  },
  {
    keyword:    'patient lift for someone with no leg strength',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Patient Lifts for People With No Leg Strength: What Actually Works',
  },
  {
    keyword:    'floor lift for bariatric patients',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Floor Lift Options for Bariatric Patients: Capacity, Safety, and Cost',
  },
  {
    keyword:    'manual vs electric patient floor lift',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Manual vs. Electric Patient Floor Lifts: Which Is Right for You?',
  },
  {
    keyword:    'lift device that works while patient lies flat',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Floor Lifts That Work While the Patient Remains Flat: How They Work',
  },
  {
    keyword:    'best floor lift for elderly at home',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'The Best Floor Lifts for Elderly Individuals Living at Home',
  },
  {
    keyword:    'portable patient lift for home caregiver',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Portable Patient Lifts for Home Caregivers: Features That Matter Most',
  },
  {
    keyword:    'fall recovery device for elderly no strength required',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Fall Recovery Devices for the Elderly That Require No Patient Strength',
  },
  {
    keyword:    'floor to standing lift assist device',
    pillar:     'product-aware',
    blog:       'buyers_guide',
    title_hint: 'Floor-to-Standing Lift Assist Devices: How to Choose the Right One',
  },

  // ── Competitor / comparison searches → Buyer's Guide ─────────────────────
  {
    keyword:    'vocic floor lift alternative',
    pillar:     'comparison',
    blog:       'buyers_guide',
    title_hint: 'Looking for a Vocic Floor Lift Alternative? Here\'s What to Consider',
  },
  {
    keyword:    'maidesite floor lift review',
    pillar:     'comparison',
    blog:       'buyers_guide',
    title_hint: 'Maidesite Floor Lift Review: Strengths, Limitations, and Alternatives',
  },
  {
    keyword:    'amazon patient floor lift vs professional grade',
    pillar:     'comparison',
    blog:       'buyers_guide',
    title_hint: 'Amazon Patient Floor Lifts vs. Professional-Grade Devices: Key Differences',
  },
  {
    keyword:    'vocic vs professional patient lift comparison',
    pillar:     'comparison',
    blog:       'buyers_guide',
    title_hint: 'Vocic vs. Professional Patient Lift: An Honest Side-by-Side Comparison',
  },
  {
    keyword:    'best patient floor lift not on amazon',
    pillar:     'comparison',
    blog:       'buyers_guide',
    title_hint: 'Patient Floor Lifts You Won\'t Find on Amazon — and Why That Matters',
  },

  // ── Education / caregiver guides ─────────────────────────────────────────
  {
    keyword:    'fall prevention plan for elderly at home',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'Building a Fall Prevention Plan for an Elderly Loved One at Home',
  },
  {
    keyword:    'how often do elderly people fall at home statistics',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'How Often Do Elderly People Fall at Home? The Statistics Caregivers Need to Know',
  },
  {
    keyword:    'caregiver guide to fall recovery at home',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'The Caregiver\'s Complete Guide to Fall Recovery at Home',
  },
  {
    keyword:    'what equipment do home caregivers need',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'Essential Equipment Every Home Caregiver Should Have',
  },
  {
    keyword:    'reducing caregiver injury when transferring patients',
    pillar:     'education',
    blog:       'professional_care',
    title_hint: 'How to Reduce Caregiver Injuries During Patient Transfers',
  },
  {
    keyword:    'long lie after a fall elderly complications',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'The Dangers of a "Long Lie" After a Fall: Why Fast Recovery Matters',
  },
  {
    keyword:    'aging in place equipment for seniors',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'Aging in Place: The Equipment That Makes It Safer and More Sustainable',
  },
  {
    keyword:    'signs elderly parent needs more home care support',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'Signs Your Elderly Parent Needs More Home Care Support',
  },
  {
    keyword:    'disabled adult fall recovery at home options',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'Fall Recovery Options for Disabled Adults Living at Home',
  },
  {
    keyword:    'how to talk to aging parent about mobility aids',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'How to Talk to Your Aging Parent About Accepting Mobility Aids',
  },
  {
    keyword:    'cost of patient fall in home setting',
    pillar:     'education',
    blog:       'professional_care',
    title_hint: 'The Hidden Cost of Patient Falls at Home — Financial, Physical, and Emotional',
  },
  {
    keyword:    'transfer belt vs floor lift which is safer',
    pillar:     'education',
    blog:       'professional_care',
    title_hint: 'Transfer Belt vs. Floor Lift: Which Is Safer for Caregiver and Patient?',
  },
  {
    keyword:    'occupational therapy fall prevention tips elderly',
    pillar:     'education',
    blog:       'professional_care',
    title_hint: 'Occupational Therapy Fall Prevention Tips Every Caregiver Should Know',
  },
  {
    keyword:    'medicare coverage for patient lift devices',
    pillar:     'education',
    blog:       'professional_care',
    title_hint: 'Does Medicare Cover Patient Lift Devices? What You Need to Know',
  },
  {
    keyword:    'how to create a safe bedroom for elderly parent',
    pillar:     'education',
    blog:       'home_care',
    title_hint: 'How to Create a Safe Bedroom Environment for an Elderly Parent',
  },
];

module.exports = TOPICS;
