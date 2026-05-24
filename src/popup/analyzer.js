import { parseSnapshot } from "./parser.js";

function scoreHookQuality(headline) {
  const text = String(headline || "").trim();
  const lower = text.toLowerCase();
  if (!text) return 0;

  let score = 8;
  if (text.length >= 12) score += 4;
  if (text.length >= 24) score += 2;
  if (text.includes("?")) score += 3;
  if (/\bfree\b|\bnew\b|\bhow\b|\bwhy\b|\bdiscover\b/i.test(lower)) score += 3;
  if (/\$|\d+%|\bup to\b|\btop\b|\bbest\b/i.test(text)) score += 2;
  return Math.min(20, score);
}

function scoreOfferStrength(offerText) {
  const text = String(offerText || "").trim();
  const lower = text.toLowerCase();
  if (!text) return 0;

  let score = 8;
  if (/\$|\d+%|\bup to\b|\bfrom\b/i.test(text)) score += 5;
  if (/\bfree\b|\bbonus\b|\bdiscount\b|\bsale\b|\bsave\b|\boff\b/i.test(lower)) score += 5;
  if (/\blimited\b|\btoday\b|\bnow\b|\bends soon\b/i.test(lower)) score += 2;
  return Math.min(20, score);
}

function scoreCtaPresence(cta) {
  const text = String(cta || "").trim();
  if (!text) return 0;
  if (/\bapply\b|\bbuy\b|\bshop\b|\bsign up\b|\bbook\b|\bget quote\b/i.test(text)) return 20;
  return 14;
}

function scorePsychologyTrigger(text) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  if (/\blimited\b|\btoday\b|\bnow\b|\bends soon\b|\bonly\b/.test(lower)) score += 8;
  if (/\bbest\b|\btop\b|\btrusted\b|\bproven\b|\bon average\b|\bresults\b/.test(lower)) score += 6;
  if (/\bbenefits\b|\bprotect\b|\bsafe\b|\bsecure\b|\bexclusive\b/.test(lower)) score += 6;
  return Math.min(20, score);
}

function scoreVisualPresence(images) {
  const count = Array.isArray(images) ? images.length : 0;
  if (count <= 0) return 0;
  if (count === 1) return 14;
  if (count === 2) return 18;
  return 20;
}

export function analyze(snapshot) {
  const parsed = parseSnapshot(snapshot);
  const text = (parsed.text || parsed.body || snapshot?.text || "").trim();
  const headline = (parsed.hook || "").trim();
  const images = Array.isArray(snapshot?.images) ? snapshot.images : [];

  const textLower = text.toLowerCase();
  const headlineLower = headline.toLowerCase();

  let hook = "Message is present but not very sharp.";
  if (headlineLower.includes("new") || headlineLower.includes("free")) {
    hook = "Headline uses a strong trigger word.";
  } else if (headline.includes("?") || headline.length > 20) {
    hook = "Headline creates curiosity or strong attention.";
  } else if (headline.length >= 8) {
    hook = "Headline creates a clear first impression.";
  }

  let offer = "Offer is not explicit.";
  if (parsed.offer) {
    offer = "Offer is explicit and easy to understand.";
  }

  let psychology = "Uses light attention signals.";
  if (textLower.includes("limited") || textLower.includes("today") || textLower.includes("now")) {
    psychology = "Uses urgency to push action.";
  }

  let structure = "Basic text-only structure.";
  if (headline && text && images.length > 0) {
    structure = "Balanced structure: headline, body text, and image.";
  } else if (headline && text) {
    structure = "Two-part structure: headline plus body text.";
  }

  const offerText = parsed.offer ? parsed.offer : offer === "Offer is not explicit." ? "" : offer;
  const scoreBreakdown = {
    hook_quality: scoreHookQuality(headline),
    offer_strength: scoreOfferStrength(offerText),
    CTA_presence: scoreCtaPresence(parsed.cta),
    psychology_trigger: scorePsychologyTrigger(text),
    visual_presence: scoreVisualPresence(images)
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);

  return {
    parsed,
    hook: parsed.hook && parsed.hook.length >= 8 ? parsed.hook : hook,
    offer: parsed.offer ? parsed.offer : offer,
    cta: parsed.cta,
    body: parsed.body,
    title: parsed.title || null,
    company: parsed.company || null,
    caption: parsed.caption || null,
    domain: parsed.domain || null,
    libraryId: parsed.libraryId || null,
    startedRunning: parsed.startedRunning || null,
    variants: parsed.variants || null,
    platforms: Array.isArray(parsed.platforms) ? parsed.platforms : [],
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    psychology,
    structure,
    scoreBreakdown,
    score
  };
}
