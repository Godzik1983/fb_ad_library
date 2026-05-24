import { parseSnapshot } from "./parser.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "get",
  "how",
  "in",
  "into",
  "is",
  "it",
  "just",
  "more",
  "new",
  "now",
  "of",
  "on",
  "or",
  "our",
  "out",
  "the",
  "this",
  "time",
  "to",
  "up",
  "we",
  "with",
  "you",
  "your"
]);

const AD_TYPE_TO_CATEGORY = {
  all: "All ads",
  employment_ads: "Employment",
  housing_ads: "Properties",
  credit_ads: "Financial",
  financial_products_and_services_ads: "Financial",
  political_and_issue_ads: "Issues, elections or politics"
};

const GLOBAL_OFFER_PATTERNS = [
  { type: "free_shipping", test: (text) => /\bfree shipping\b/i.test(text) },
  { type: "free_trial", test: (text) => /\bfree trial\b/i.test(text) },
  { type: "free_offer", test: (text) => /\bfree\b/i.test(text) },
  { type: "limited_time", test: (text) => /\blimited time\b|\btoday only\b|\bends soon\b/i.test(text) },
  { type: "discount", test: (text) => /\bdiscount\b|\b\d+%\s*off\b|\boff\b/i.test(text) },
  { type: "save_amount", test: (text) => /\bsave\b.*(?:\$|\d)|(?:\$|\d).*\bsave\b/i.test(text) },
  { type: "bonus", test: (text) => /\bbonus\b|\bsign on bonus\b|\bsign-on bonus\b/i.test(text) },
  { type: "price_point", test: (text) => /(?:\$|usd\s?)\d[\d,]*(?:\.\d{2})?|\bup to \$?\d/i.test(text) }
];

const CATEGORY_OFFER_PATTERNS = {
  "All ads": [
    { type: "all_ads_general_offer", test: (text) => /\bshop now\b|\blearn more\b|\bget offer\b/i.test(text) }
  ],
  Employment: [
    { type: "job_hiring", test: (text) => /\bhiring\b|\bapply now\b|\bnow hiring\b/i.test(text) },
    { type: "job_sign_on_bonus", test: (text) => /\bsign on bonus\b|\bsign-on bonus\b/i.test(text) },
    { type: "job_weekly_pay", test: (text) => /\bweekly pay\b/i.test(text) },
    { type: "job_benefits", test: (text) => /\bbenefits\b|\bpto\b|\b401k\b/i.test(text) },
    { type: "job_home_time", test: (text) => /\bhome time\b|\bhome-time\b/i.test(text) }
  ],
  Properties: [
    { type: "property_down_payment", test: (text) => /\bdown payment\b/i.test(text) },
    { type: "property_move_in_ready", test: (text) => /\bmove[- ]in ready\b/i.test(text) },
    { type: "property_new_homes", test: (text) => /\bnew homes?\b|\bnew community\b/i.test(text) },
    { type: "property_price_anchor", test: (text) => /\blow \$\d|\bfrom the low\b|\bfrom the mid\b|\bfrom the high\b/i.test(text) },
    { type: "property_tour_cta", test: (text) => /\btour\b|\bopen house\b|\bschedule a showing\b/i.test(text) }
  ],
  Financial: [
    { type: "finance_get_quote", test: (text) => /\bget (?:a )?quote\b/i.test(text) },
    { type: "finance_rate_savings", test: (text) => /\blower rates?\b|\brate savings\b|\bsave on .*insurance\b/i.test(text) },
    { type: "finance_borrowing", test: (text) => /\bmortgage\b|\bloan\b|\brefi\b|\brefinance\b/i.test(text) },
    { type: "finance_credit_score", test: (text) => /\bcredit score\b|\bcredit card\b/i.test(text) },
    { type: "finance_bundle", test: (text) => /\bbundle\b|\bbundling\b/i.test(text) }
  ],
  "Issues, elections or politics": [
    { type: "politics_donate", test: (text) => /\bdonate\b|\bchip in\b|\bcontribute\b/i.test(text) },
    { type: "politics_vote", test: (text) => /\bvote\b|\bregister to vote\b|\bballot\b/i.test(text) },
    { type: "politics_petition", test: (text) => /\bsign the petition\b|\bpetition\b/i.test(text) },
    { type: "politics_endorsement", test: (text) => /\bendorse\b|\bsupport our campaign\b/i.test(text) },
    { type: "politics_issue_action", test: (text) => /\btake action\b|\bstand with\b|\bprotect\b/i.test(text) }
  ]
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getAdSnapshot(ad) {
  if (ad?.snapshot) return ad.snapshot;

  return {
    text: ad?.text || ad?.body || "",
    headline: ad?.headline || ad?.hook || "",
    title: ad?.title || "",
    company: ad?.company || "",
    caption: ad?.caption || "",
    body: ad?.body || ad?.text || "",
    buttons: Array.isArray(ad?.buttons) ? ad.buttons : [],
    ctaButton: ad?.ctaButton || ad?.cta || "",
    rawLines: Array.isArray(ad?.rawLines) ? ad.rawLines : [],
    categories: Array.isArray(ad?.categories) ? ad.categories : [],
    platforms: Array.isArray(ad?.platforms) ? ad.platforms : [],
    adType: ad?.adType || null
  };
}

function countBy(values) {
  const counts = new Map();

  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return counts;
}

function sortCounts(map) {
  return Array.from(map.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([label, count]) => ({ label, count }));
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$%]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function normalizeCategory(category, adType) {
  const explicit = normalizeText(category);
  if (explicit) return explicit;
  return AD_TYPE_TO_CATEGORY[adType] || "All ads";
}

function detectHookStructure(hook, category) {
  const text = normalizeText(hook);
  if (!text) return "unstyled";

  const lower = text.toLowerCase();
  const startsWithSymbol = /^[^A-Za-z0-9]+/.test(text);
  const hasPrice = /(?:\$|usd\s?)\d|\bup to \$?\d/i.test(text);
  const hasQuestion = text.includes("?");
  const hasUrgency = /\blimited\b|\btoday\b|\bnow\b|\bends soon\b/i.test(lower);
  const hasFree = /\bfree\b/i.test(lower);
  const hasHowTo = /^\s*how\b/i.test(lower);
  const hasNumber = /\b\d+\b/.test(text);

  if (category === "Employment" && /\bhiring\b|\bdrivers?\b|\bcareer\b|\bapply\b/i.test(lower)) {
    return "job_recruiting_hook";
  }
  if (category === "Properties" && /\bhome\b|\bcommunity\b|\bmove[- ]in\b|\bbedroom\b/i.test(lower)) {
    return "property_listing_hook";
  }
  if (
    category === "Financial" &&
    /\binsurance\b|\bmortgage\b|\bquote\b|\brates?\b/i.test(lower)
  ) {
    return "finance_savings_hook";
  }
  if (category === "Issues, elections or politics" && /\bvote\b|\bdonate\b|\bprotect\b|\bstand with\b/i.test(lower)) {
    return "political_action_hook";
  }

  if (startsWithSymbol && hasPrice) return "symbol_offer_price";
  if (startsWithSymbol) return "symbol_led";
  if (hasQuestion) return "question_hook";
  if (hasUrgency) return "urgency_hook";
  if (hasFree) return "free_hook";
  if (hasHowTo) return "how_to_hook";
  if (hasPrice) return "price_hook";
  if (hasNumber) return "number_hook";
  return "benefit_hook";
}

function detectOfferTypes(text, category) {
  const normalized = normalizeText(text);
  const globalTypes = GLOBAL_OFFER_PATTERNS
    .filter((entry) => entry.test(normalized))
    .map((entry) => entry.type);
  const categoryTypes = (CATEGORY_OFFER_PATTERNS[category] || [])
    .filter((entry) => entry.test(normalized))
    .map((entry) => entry.type);

  return Array.from(new Set([...globalTypes, ...categoryTypes]));
}

export function findPatterns(ads) {
  const items = Array.isArray(ads) ? ads : [];
  const parsedAds = items.map((ad) => {
    const snapshot = getAdSnapshot(ad);
    const parsed = parseSnapshot(snapshot);
    const category = normalizeCategory(parsed.categories?.[0] || snapshot.categories?.[0], snapshot.adType);
    const hook = normalizeText(parsed.hook || snapshot.headline || ad?.hook || "");
    const combinedText = normalizeText([
      hook,
      parsed.title,
      parsed.caption,
      parsed.body,
      snapshot.text
    ].join(" "));

    return {
      category,
      hook,
      combinedText,
      offerTypes: detectOfferTypes(combinedText, category)
    };
  });

  const wordCounts = countBy(parsedAds.flatMap((item) => tokenize(item.combinedText)));
  const hookStructureCounts = countBy(
    parsedAds.map((item) => detectHookStructure(item.hook, item.category))
  );
  const offerTypeCounts = countBy(parsedAds.flatMap((item) => item.offerTypes));

  return {
    totalAds: parsedAds.length,
    frequentWords: sortCounts(wordCounts),
    hookStructures: sortCounts(hookStructureCounts),
    offerTypes: sortCounts(offerTypeCounts)
  };
}
