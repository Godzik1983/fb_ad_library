function splitSentences(text) {
  return (text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function trimMax(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen).trim();
}

function firstMeaningfulSentence(text, excluded = []) {
  const blocked = excluded.map((value) => normalizeLine(value).toLowerCase()).filter(Boolean);
  const sentences = splitSentences(text)
    .map((sentence) => normalizeLine(sentence))
    .filter(Boolean);

  const match = sentences.find((sentence) => {
    const lower = sentence.toLowerCase();
    if (blocked.includes(lower)) return false;
    if (isDomainLike(sentence)) return false;
    return sentence.length >= 12;
  });

  return match || sentences[0] || "";
}

function firstTwoMeaningfulSentences(text, excluded = []) {
  const blocked = excluded.map((value) => normalizeLine(value).toLowerCase()).filter(Boolean);
  const sentences = splitSentences(text)
    .map((sentence) => normalizeLine(sentence))
    .filter(Boolean)
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      if (blocked.includes(lower)) return false;
      if (isDomainLike(sentence)) return false;
      return sentence.length >= 12;
    });

  return sentences.slice(0, 2).join(" ").trim() || sentences[0] || "";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingCompany(text, company) {
  const normalizedText = normalizeLine(text);
  const normalizedCompany = normalizeLine(company);
  if (!normalizedText || !normalizedCompany) return normalizedText;

  const pattern = new RegExp(`^${escapeRegExp(normalizedCompany)}(?:\\s+|[:\\-–|])+`, "i");
  const stripped = normalizedText.replace(pattern, "").trim();
  return stripped || normalizedText;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isDomainLike(value) {
  return /^[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || "").trim());
}

function normalizeLibraryId(value) {
  const match = String(value || "").match(/\b(\d{13,})\b/);
  return match ? match[1] : normalizeLine(value);
}

function isLibraryIdLine(value) {
  const line = normalizeLine(value);
  return line.length <= 90 && /\b\d{13,}\b/.test(line);
}

function isStartedRunningLine(value) {
  const line = normalizeLine(value);
  if (!line || line.length > 90) return false;
  if (isLibraryIdLine(line)) return false;
  if (/\b\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}\b/.test(line)) return true;
  if (/\b(?:19|20)\d{2}\b/.test(line) && /\b\d{1,2}\b/.test(line)) return true;
  if (/\b\d{1,2}\s+\S+\s+(?:19|20)\d{2}\b/.test(line)) return true;
  return false;
}

function findOffer(lines) {
  const offerKeywords = ["discount", "%", "sale", "free", "bonus", "save", "off"];

  return (
    lines.find((line) => {
      const lower = line.toLowerCase();
      return offerKeywords.some((word) => lower.includes(word));
    }) || null
  );
}

const CTA_LABELS = [
  "shop now",
  "apply now",
  "get quote",
  "learn more",
  "sign up",
  "book now",
  "watch more",
  "download",
  "get offer",
  "buy now",
  "contact us",
  "send message",
  "try now"
];

function findCTA(snapshot, lines, textLower) {
  const explicitButton = normalizeLine(snapshot?.ctaButton || "");
  if (explicitButton) return explicitButton;

  const buttons = Array.isArray(snapshot?.buttons) ? snapshot.buttons : [];
  const ctaButton = buttons.find(
    (label) =>
      label &&
      label.length <= 40 &&
      CTA_LABELS.includes(String(label).trim().toLowerCase())
  );
  if (ctaButton) return ctaButton;

  return (
    CTA_LABELS.find((phrase) => textLower.includes(phrase)) ||
    lines.find((line) => CTA_LABELS.includes(line.toLowerCase())) ||
    null
  );
}

function isTimecodeLine(value) {
  return /^\d{1,2}:\d{2}(?:\s*\/\s*\d{1,2}:\d{2})?$/.test(normalizeLine(value));
}

function isMetaInfoLine(value) {
  const line = normalizeLine(value);
  if (!line) return true;
  if (isLibraryIdLine(line)) return true;
  if (isStartedRunningLine(line)) return true;
  if (/multiple versions/i.test(line)) return true;
  if (/^This advertisement has several versions\.?$/i.test(line)) return true;
  if (/^Platforms\b/i.test(line)) return true;
  if (/^Платформы\b/i.test(line)) return true;
  if (/^Categories\b/i.test(line)) return true;
  if (/^Категории\b/i.test(line)) return true;
  if (/^Active$/i.test(line)) return true;
  if (/^Активно$/i.test(line)) return true;
  if (/^Sponsored$/i.test(line)) return true;
  if (/^See ad details$/i.test(line)) return true;
  if (/^Информация об объявлении$/i.test(line)) return true;
  if (/^About the advertiser$/i.test(line)) return true;
  if (/^О рекламодателе$/i.test(line)) return true;
  if (/^About ads and data use$/i.test(line)) return true;
  if (/^Open Drop-down$/i.test(line)) return true;
  if (/^Открыть раскрывающееся меню$/i.test(line)) return true;
  if (/^\d+\s+of\s+\d+$/i.test(line)) return true;
  if (/^\d+\s+ads use this creative and text$/i.test(line)) return true;
  if (/^This creative and text are used in \d+ ads\.?$/i.test(line)) return true;
  if (/^Advertising$/i.test(line)) return true;
  if (/^Ad information$/i.test(line)) return true;
  if (/^\d+\s+объявлен/i.test(line) && /использ/i.test(line) && /креатив/i.test(line)) return true;
  if (/креатив/i.test(line) && /текст/i.test(line) && /использ/i.test(line)) return true;
  if (/^(TEXT|CTA|CATEGORIES|PSYCHOLOGY|DOMAIN|CAPTION|LIBRARY ID|RUNNING FOR|SCORE)$/i.test(line)) return true;
  if (/^AI INSIGHT$/i.test(line) || /^Why this ad works$/i.test(line)) return true;
  if (/^Активно\s+ID Библиотеки:/i.test(line)) return true;
  if (isTimecodeLine(line)) return true;
  return false;
}

function isBodyLikeLine(line) {
  const text = normalizeLine(line);
  if (!text) return false;
  if (isMetaInfoLine(text)) return false;
  if (isDomainLike(text)) return false;

  const words = text.split(/\s+/).filter(Boolean).length;
  const hasSentencePunctuation = /[,.!?;:]/.test(text);
  return hasSentencePunctuation || words >= 7 || text.length >= 45;
}

function trimLeadingNonBodyLines(lines) {
  const items = Array.isArray(lines) ? [...lines] : [];
  while (items.length > 0 && !isBodyLikeLine(items[0])) {
    items.shift();
  }
  return items;
}

function findFooterCaption(lines, buttons, linkDomain) {
  const normalizedLines = Array.isArray(lines) ? lines.map((line) => normalizeLine(line)) : [];
  const normalizedButtons = new Set(
    (Array.isArray(buttons) ? buttons : []).map((label) => normalizeLine(label).toLowerCase())
  );
  const ctaIndex = normalizedLines.findIndex((line) => normalizedButtons.has(line.toLowerCase()));

  if (ctaIndex === -1) return null;

  for (let i = ctaIndex - 1; i >= 0 && i >= ctaIndex - 4; i -= 1) {
    const candidate = normalizedLines[i];
    if (!candidate) continue;
    if (candidate === linkDomain) continue;
    if (normalizedButtons.has(candidate.toLowerCase())) continue;
    if (isMetaInfoLine(candidate)) continue;
    return candidate;
  }

  return null;
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return unique(values.map(normalizeLine));
}

const AD_TYPE_TO_CATEGORY = {
  all: "All",
  employment_ads: "Employment",
  housing_ads: "Properties",
  credit_ads: "Financial",
  financial_products_and_services_ads: "Financial",
  political_and_issue_ads: "Political and issue ads"
};

function parseStructuredAdLibrary(snapshot) {
  const rawLines = Array.isArray(snapshot?.rawLines) ? snapshot.rawLines.map(normalizeLine) : [];
  const lines = unique(rawLines);
  if (lines.length === 0) return null;

  const libraryIdLine = lines.find((line) => isLibraryIdLine(line)) || null;
  const libraryId = libraryIdLine ? normalizeLibraryId(libraryIdLine) : null;
  const libraryIndex = libraryIdLine ? lines.indexOf(libraryIdLine) : -1;
  const startedRunningLine =
    (libraryIndex >= 0
      ? lines.slice(libraryIndex + 1, libraryIndex + 5).find((line) => isStartedRunningLine(line))
      : null) ||
    lines.find((line) => isStartedRunningLine(line)) ||
    null;
  const versionsLine = lines.find((line) => /multiple versions/i.test(line)) || null;
  const domain = lines.find((line) => isDomainLike(line)) || String(snapshot?.linkDomain || "").trim() || null;
  const platforms = normalizeList(snapshot?.platforms);
  const categories =
    normalizeList(snapshot?.categories).length > 0
      ? normalizeList(snapshot?.categories)
      : snapshot?.adType && AD_TYPE_TO_CATEGORY[snapshot.adType]
      ? [AD_TYPE_TO_CATEGORY[snapshot.adType]]
      : [];

  const ignored = new Set(
    unique([
      libraryIdLine,
      startedRunningLine,
      versionsLine,
      domain,
      "Platforms",
      "Categories",
      ...platforms,
      ...categories,
      ...(Array.isArray(snapshot?.buttons) ? snapshot.buttons : [])
    ])
  );

  const buttonSet = new Set(
    (Array.isArray(snapshot?.buttons) ? snapshot.buttons : []).map((label) => normalizeLine(label).toLowerCase())
  );
  let contentStartIndex = libraryIndex >= 0 ? libraryIndex + 1 : 0;
  while (contentStartIndex < lines.length) {
    const current = lines[contentStartIndex];
    if (!current) {
      contentStartIndex += 1;
      continue;
    }
    if (buttonSet.has(current.toLowerCase()) || isMetaInfoLine(current)) {
      contentStartIndex += 1;
      continue;
    }
    break;
  }
  const candidateContentLines = lines.slice(contentStartIndex);

  const filteredContentLines = candidateContentLines.filter((line) => {
    if (!line) return false;
    if (ignored.has(line)) return false;
    if (isMetaInfoLine(line)) return false;
    return true;
  });
  const contentLines = trimLeadingNonBodyLines(filteredContentLines);

  const footerCaption = findFooterCaption(lines, snapshot?.buttons, domain);
  const title = String(snapshot?.title || "").trim() || contentLines[contentLines.length - 2] || contentLines[0] || "";
  const company = String(snapshot?.company || "").trim() || title;
  const caption = String(snapshot?.caption || "").trim() || footerCaption || "";
  const fullAdText = contentLines.join(" ").trim();
  const bodyLines = contentLines.filter((line) => !isTimecodeLine(line));
  const mainTextLines = contentLines.filter(
    (line) =>
      line !== title &&
      line !== company &&
      line !== caption &&
      line !== domain &&
      !isDomainLike(line) &&
      !isTimecodeLine(line)
  );
  const hookSource = stripLeadingCompany(mainTextLines.join(" ").trim() || fullAdText || caption || title, company);
  const hook = trimMax(
    firstTwoMeaningfulSentences(hookSource, [company, title, domain, caption]) ||
      firstMeaningfulSentence(hookSource, [company, title, domain]),
    120
  );
  const body = fullAdText;
  const textParts = unique([
    libraryId,
    startedRunningLine,
    versionsLine,
    body,
    domain,
    title,
    caption
  ]);
  const text = textParts.join(" ").trim();
  const cta = findCTA(snapshot, lines, text.toLowerCase());
  const offer = findOffer(unique([caption, title, ...bodyLines]));

  return {
    hook,
    body,
    offer,
    cta,
    title: title || null,
    company: company || null,
    caption: caption || null,
    domain: domain || null,
    libraryId: libraryId || null,
    startedRunning: startedRunningLine || null,
    variants: versionsLine || null,
    platforms,
    categories,
    text
  };
}

export function parseSnapshot(snapshot) {
  const structured = parseStructuredAdLibrary(snapshot);
  if (structured) {
    return structured;
  }

  const text = String(snapshot?.text || "").trim();
  const headline = String(snapshot?.headline || "").trim();

  const sentences = splitSentences(text);
  const hookBase = headline || sentences[0] || "";
  const hook = trimMax(hookBase, 120);

  const body = text.startsWith(hook) ? text.slice(hook.length).trim() : text.replace(hook, "").trim();

  const offer = findOffer(sentences);
  const cta = findCTA(snapshot, sentences, text.toLowerCase());

  return {
    hook,
    body,
    offer,
    cta
  };
}
