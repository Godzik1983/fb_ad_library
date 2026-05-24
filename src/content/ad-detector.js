console.log("AD DETECTOR LOADED");

// ---------------- STATE ----------------

let selectedAdElement = null;
let lastHoverElement = null;
let lastHoverTs = 0;
let overlayEl = null;
let currentAnalysis = null;
let currentLibraryItems = [];
let currentLibraryItem = null;
let patternsModulePromise = null;
let currentLibraryVisibleCount = 0;
let currentLibraryLoadingMore = false;
let currentLibraryUiState = {
  selectedCategory: "",
  queryFilter: "",
  scoreValue: "",
  clearDate: "",
  librarySearch: "",
  patternsHtml: ""
};

const ADS_STORAGE_KEY = "ads";
const LIBRARY_PAGE_SIZE = 24;
const MESSAGE_TYPES = {
  DETECT_PRIMARY_AD: "DETECT_PRIMARY_AD",
  GET_SELECTED_AD: "GET_SELECTED_AD",
  OPEN_LIBRARY: "OPEN_LIBRARY",
  PRIMARY_AD_RESULT: "PRIMARY_AD_RESULT"
};
const BRAND_ICON_URL = chrome.runtime.getURL("assets/icons/icon_32.png");

// ---------------- UTILS ----------------

function isValidElement(el) {
  return !!el && document.contains(el);
}

function isNativeInteractiveTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return !!target.closest(
    [
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[aria-haspopup]",
      "[contenteditable='true']"
    ].join(", ")
  );
}

function findAdContainer(el) {
  let current = el;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    const text = (current.innerText || "").trim();
    const textLength = text.length;
    const lines = extractVisibleLines(current);
    const rect = current.getBoundingClientRect();

    const hasEnoughText = textLength > 80 && textLength < 6000;
    const hasLibraryId = lines.some((line) => isLibraryIdLine(line));
    const hasStartedRunning = lines.some((line) => isStartedRunningLine(line));
    const hasCTAButton = current.querySelector('a[role="button"], button, [role="button"]');
    const libraryIdCount = lines.filter((line) => isLibraryIdLine(line)).length;
    const looksLikeSingleCard =
      rect.width >= 220 &&
      rect.width <= 760 &&
      rect.height >= 220 &&
      rect.height <= 1800 &&
      libraryIdCount >= 1 &&
      libraryIdCount <= 3;

    if (looksLikeSingleCard && hasLibraryId && hasStartedRunning && hasCTAButton && hasEnoughText) {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

function extractText(root) {
  if (!root) return "";

  return (root.innerText || "")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 10)
    .join(" ");
}

function extractImages(root) {
  if (!root) return [];

  return Array.from(root.querySelectorAll("img"))
    .map((img) => ({
      src: (img.currentSrc || img.src || "").trim(),
      area: (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0)
    }))
    .filter((image) => image.src)
    .sort((a, b) => b.area - a.area)
    .map((image) => image.src)
    .filter((src, index, all) => all.indexOf(src) === index)
    .slice(0, 4);
}

function normalizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeLine(sentence))
    .filter(Boolean);
}

function firstMeaningfulSentence(text, excluded = []) {
  const blocked = excluded.map((value) => normalizeLine(value).toLowerCase()).filter(Boolean);
  const sentences = splitSentences(text);

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
  const sentences = splitSentences(text).filter((sentence) => {
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

const AD_TYPE_TO_CATEGORY = {
  all: "All",
  employment_ads: "Employment",
  housing_ads: "Properties",
  credit_ads: "Financial",
  financial_products_and_services_ads: "Financial",
  political_and_issue_ads: "Political and issue ads"
};

const DEFAULT_PLATFORM_ORDER = ["Facebook", "Instagram", "Messenger", "Audience Network"];
const CTA_LABELS = [
  "Apply now",
  "Get quote",
  "Learn more",
  "Shop now",
  "Sign up",
  "Book now",
  "Watch more",
  "Download",
  "Get offer",
  "Buy now",
  "Contact us",
  "Send message",
  "Try now"
];

function extractVisibleLines(root) {
  if (!root) return [];

  return unique(
    (root.innerText || "")
      .split("\n")
      .map((line) => normalizeLine(line))
      .filter(Boolean)
  );
}

function extractButtons(root) {
  if (!root) return [];

  return unique(
    Array.from(root.querySelectorAll('a[role="button"], button, [role="button"]'))
      .map((node) => normalizeLine(node.innerText || node.textContent || ""))
      .filter((label) => label && label.length <= 40)
      .filter((label) => !["Save", "Library", "Close", "Back", "Open Drop-down"].includes(label))
  );
}

function extractCTAButton(buttons) {
  const normalized = Array.isArray(buttons) ? buttons.map((label) => normalizeLine(label)) : [];
  const match = normalized.find((label) =>
    CTA_LABELS.some((cta) => cta.toLowerCase() === label.toLowerCase())
  );

  return match || null;
}

function findCTAElement(root, ctaLabel) {
  if (!root || !ctaLabel) return null;

  const normalizedTarget = normalizeLine(ctaLabel).toLowerCase();
  const candidates = Array.from(root.querySelectorAll('a[role="button"], button, [role="button"]'));
  const matches = candidates.filter((node) => {
    const text = normalizeLine(node.innerText || node.textContent || "").toLowerCase();
    return text === normalizedTarget;
  });

  return matches[matches.length - 1] || null;
}

function extractTextCandidateFromNode(node, excluded = []) {
  if (!node) return null;

  const lines = unique(
    (node.innerText || "")
      .split("\n")
      .map((line) => normalizeLine(line))
      .filter(Boolean)
  );
  const blocked = new Set(excluded.map((value) => normalizeLine(value).toLowerCase()).filter(Boolean));
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (blocked.has(lower)) return false;
    if (isMetaInfoLine(line)) return false;
    if (isDomainLike(line)) return false;
    return line.length > 3;
  });

  return filtered[filtered.length - 1] || null;
}

function extractFooterCaptionFromDOM(root, ctaLabel, linkDomain) {
  const ctaElement = findCTAElement(root, ctaLabel);
  if (!ctaElement) return null;

  const excluded = [ctaLabel, linkDomain];
  const containers = unique([
    ctaElement.parentElement,
    ctaElement.parentElement?.parentElement,
    ctaElement.parentElement?.parentElement?.parentElement
  ]);

  for (const container of containers) {
    if (!container) continue;

    let sibling = container.previousElementSibling;
    let steps = 0;
    while (sibling && steps < 4) {
      const candidate = extractTextCandidateFromNode(sibling, excluded);
      if (candidate) return candidate;
      sibling = sibling.previousElementSibling;
      steps += 1;
    }

    const parent = container.parentElement;
    if (!parent) continue;

    const children = Array.from(parent.children);
    const index = children.indexOf(container);
    for (let i = index - 1; i >= 0 && i >= index - 4; i -= 1) {
      const candidate = extractTextCandidateFromNode(children[i], excluded);
      if (candidate) return candidate;
    }
  }

  return null;
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

function getPageContext() {
  const params = new URLSearchParams(location.search || "");
  const adType = normalizeLine(params.get("ad_type") || "");
  const categoryFromUrl = AD_TYPE_TO_CATEGORY[adType] || null;
  const searchQuery =
    normalizeLine(
      params.get("search_keyword") ||
        params.get("keyword") ||
        params.get("q") ||
        params.get("location[name]") ||
        ""
    ) || null;

  const chips = unique(
    Array.from(document.querySelectorAll('[role="button"], button, input, [aria-haspopup="listbox"]'))
      .map((node) => {
        const raw =
          node.value ||
          node.getAttribute?.("aria-label") ||
          node.textContent ||
          "";
        return normalizeLine(raw);
      })
      .filter(Boolean)
  );

  const categoryFromChip =
    chips.find((value) => Object.values(AD_TYPE_TO_CATEGORY).includes(value)) || null;

  return {
    adType,
    categoryFromUrl,
    categoryFromChip,
    searchQuery
  };
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

function collectAccessibleTexts(root) {
  if (!root) return [];

  const values = [];
  const nodes = [root, ...root.querySelectorAll("*")];

  for (const node of nodes) {
    for (const attr of ["aria-label", "title", "alt", "data-tooltip-content"]) {
      const value = normalizeLine(node.getAttribute?.(attr) || "");
      if (value) values.push(value);
    }
  }

  return unique(values);
}

function extractLabeledValues(root, label, lines) {
  const lowerLabel = label.toLowerCase();
  const lineValues = unique(
    lines
      .filter((line) => line.toLowerCase().startsWith(lowerLabel))
      .map((line) => normalizeLine(line.slice(label.length).replace(/^[:\s-]+/, "")))
      .filter(Boolean)
  );

  const labelNodes = Array.from(root.querySelectorAll("*")).filter((node) => {
    const text = normalizeLine(node.textContent || "");
    return text === label || text.startsWith(`${label} `);
  });

  const attrValues = unique(
    labelNodes.flatMap((node) => {
      const containers = [node.parentElement, node.parentElement?.parentElement].filter(Boolean);

      return containers.flatMap((container) =>
        collectAccessibleTexts(container).filter((value) => {
          const lowerValue = value.toLowerCase();
          return (
            lowerValue !== lowerLabel &&
            !lowerValue.startsWith("see ad details") &&
            !lowerValue.startsWith("about the advertiser") &&
            !lowerValue.startsWith("about ads and data use")
          );
        })
      );
    })
  );

  return unique([...lineValues, ...attrValues]);
}

function inferPlatformsFromIcons(root, label) {
  const labelNodes = Array.from(root.querySelectorAll("*")).filter((node) => {
    const text = normalizeLine(node.textContent || "");
    return text === label || text.startsWith(`${label} `);
  });

  for (const node of labelNodes) {
    const container = node.parentElement;
    if (!container) continue;

    const iconCount = container.querySelectorAll("svg, img").length;
    if (iconCount > 0) {
      return DEFAULT_PLATFORM_ORDER.slice(0, Math.min(iconCount, DEFAULT_PLATFORM_ORDER.length));
    }
  }

  return [];
}

function inferCategories(root, lines, pageContext) {
  const direct = extractLabeledValues(root, "Categories", lines);
  if (direct.length > 0) return direct;

  const hasCategoriesLine = lines.some((line) => line === "Categories" || line.startsWith("Categories "));
  if (hasCategoriesLine && pageContext.categoryFromChip) {
    return [pageContext.categoryFromChip];
  }

  if (pageContext.categoryFromUrl) {
    return [pageContext.categoryFromUrl];
  }

  return [];
}

function extractAdLibraryFields(root, lines, buttons, pageContext) {
  const libraryIdLine = lines.find((line) => isLibraryIdLine(line)) || null;
  const libraryId = libraryIdLine ? normalizeLibraryId(libraryIdLine) : null;
  const libraryIndex = libraryIdLine ? lines.indexOf(libraryIdLine) : -1;
  const startedRunning =
    (libraryIndex >= 0
      ? lines.slice(libraryIndex + 1, libraryIndex + 5).find((line) => isStartedRunningLine(line))
      : null) ||
    lines.find((line) => isStartedRunningLine(line)) ||
    null;
  const variants = lines.find((line) => /multiple versions/i.test(line)) || null;
  const linkDomain = lines.find((line) => isDomainLike(line)) || null;
  const parsedPlatforms = extractLabeledValues(root, "Platforms", lines);
  const platforms = parsedPlatforms.length > 0 ? parsedPlatforms : inferPlatformsFromIcons(root, "Platforms");
  const categories = inferCategories(root, lines, pageContext);

  const ignored = new Set(
    unique([
      libraryId,
      startedRunning,
      variants,
      linkDomain,
      "Platforms",
      "Categories",
      ...platforms,
      ...categories,
      ...buttons,
      "See ad details",
      "About the advertiser",
      "About ads and data use",
      "Active",
      "Sponsored",
      "Open Drop-down",
      "Close"
    ])
  );

  const buttonSet = new Set(
    (Array.isArray(buttons) ? buttons : []).map((label) => normalizeLine(label).toLowerCase())
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
    if (!line || ignored.has(line)) return false;
    if (isMetaInfoLine(line)) return false;
    return true;
  });
  const contentLines = trimLeadingNonBodyLines(filteredContentLines);

  const ctaButton = extractCTAButton(buttons);
  const footerCaption =
    extractFooterCaptionFromDOM(root, ctaButton, linkDomain) ||
    findFooterCaption(lines, buttons, linkDomain);
  const title = contentLines[contentLines.length - 2] || contentLines[0] || "";
  const company = title;
  const caption = footerCaption || "";
  const fullAdText = contentLines.join(" ").trim();

  return {
    libraryId,
    startedRunning,
    variants,
    platforms,
    categories,
    linkDomain,
    company,
    ctaButton,
    title,
    caption,
    body: fullAdText
  };
}

function buildSnapshot(root) {
  const text = extractText(root);
  const images = extractImages(root);
  const rawLines = extractVisibleLines(root);
  const buttons = extractButtons(root);
  const ctaButton = extractCTAButton(buttons);
  const pageContext = getPageContext();
  const fields = extractAdLibraryFields(root, rawLines, buttons, pageContext);
  const headline =
    fields.title ||
    text.split(/[.!?]/).filter(Boolean)[0]?.slice(0, 120).trim() ||
    "";

  return {
    text,
    headline,
    images,
    rawLines,
    buttons,
    ctaButton,
    title: fields.title,
    company: fields.company,
    caption: fields.caption,
    body: fields.body,
    libraryId: fields.libraryId,
    startedRunning: fields.startedRunning,
    variants: fields.variants,
    platforms: fields.platforms,
    categories: fields.categories,
    linkDomain: fields.linkDomain,
    adType: pageContext.adType || null,
    searchQuery: pageContext.searchQuery || null,
    url: location.href
  };
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());
}

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

function loadPatternsModule() {
  if (!patternsModulePromise) {
    patternsModulePromise = import(chrome.runtime.getURL("src/popup/patterns.js"));
  }
  return patternsModulePromise;
}

function injectOverlayStyles() {
  if (document.getElementById("ad-insight-style")) return;

  const style = document.createElement("style");
  style.id = "ad-insight-style";
  style.textContent = `
    .ad-insight-panel,
    .ad-insight-panel * {
      box-sizing: border-box;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .ad-insight-panel {
      position: fixed;
      top: 92px;
      right: 24px;
      width: min(460px, calc(100vw - 32px));
      max-height: min(82vh, 760px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      color: #111827;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(17, 24, 39, 0.10);
      border-radius: 8px;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
      backdrop-filter: blur(18px);
      z-index: 999999;
    }

    .ad-insight-shell {
      display: flex;
      min-height: 0;
      flex-direction: column;
    }

    .ad-insight-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 18px 14px;
      border-bottom: 1px solid #eef0f3;
      background: #ffffff;
    }

    .ad-insight-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .ad-insight-mark {
      width: 34px;
      height: 34px;
      display: block;
      flex: 0 0 auto;
      border-radius: 8px;
      object-fit: contain;
    }

    .ad-insight-kicker {
      color: #667085;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .ad-insight-title {
      margin-top: 2px;
      font-size: 18px;
      font-weight: 800;
      line-height: 1.15;
      color: #111827;
    }

    .ad-insight-close {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      border: 1px solid #e4e7ec;
      border-radius: 8px;
      background: #f9fafb;
      color: #344054;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
    }

    .ad-insight-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      flex: 0 0 auto;
    }

    .ad-insight-header-clear-anchor {
      margin-right: auto;
    }

    .ad-insight-header-date {
      height: 34px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      padding: 0 10px;
      color: #111827;
      background: #ffffff;
      font-size: 12px;
      font-weight: 600;
    }

    .ad-insight-header-clear {
      min-height: 34px;
      border: 1px solid #f0b4b4;
      border-radius: 8px;
      padding: 7px 10px;
      color: #b42318;
      background: #fff5f5;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }

    .ad-insight-modal-backdrop {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(15, 23, 42, 0.36);
      z-index: 5;
    }

    .ad-insight-modal-backdrop[data-open="true"] {
      display: flex;
    }

    .ad-insight-modal {
      width: min(100%, 360px);
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
    }

    .ad-insight-modal-title {
      margin-bottom: 6px;
      color: #111827;
      font-size: 15px;
      font-weight: 800;
    }

    .ad-insight-modal-copy {
      margin-bottom: 14px;
      color: #475467;
      font-size: 13px;
      line-height: 1.45;
    }

    .ad-insight-modal-fields {
      display: grid;
      gap: 10px;
      margin-bottom: 14px;
    }

    .ad-insight-modal-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .ad-insight-header-back {
      min-width: 70px;
      height: 34px;
      padding: 0 12px;
      border: 1px solid #e4e7ec;
      border-radius: 8px;
      background: #ffffff;
      color: #344054;
      cursor: pointer;
      font-size: 13px;
      font-weight: 800;
    }

    .ad-insight-content {
      min-height: 0;
      overflow-y: auto;
      padding: 16px 18px 18px;
      background: #f7f8fa;
    }

    .ad-insight-score-row {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 12px;
      align-items: stretch;
      margin-bottom: 12px;
    }

    .ad-insight-score-card,
    .ad-insight-hook-card,
    .ad-insight-detail,
    .ad-insight-empty,
    .ad-insight-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #ffffff;
    }

    .ad-insight-score-card {
      display: grid;
      place-items: center;
      min-height: 92px;
      padding: 10px;
    }

    .ad-insight-score {
      display: grid;
      place-items: center;
      width: 62px;
      height: 62px;
      border-radius: 50%;
      color: #ffffff;
      background: conic-gradient(#2563eb calc(var(--score, 0) * 1%), #e5e7eb 0);
      position: relative;
      font-size: 16px;
      font-weight: 800;
    }

    .ad-insight-score::before {
      content: "";
      position: absolute;
      inset: 5px;
      border-radius: inherit;
      background: #111827;
    }

    .ad-insight-score span {
      position: relative;
      z-index: 1;
    }

    .ad-insight-score-label {
      margin-top: 6px;
      color: #667085;
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }

    .ad-insight-hook-card {
      padding: 13px 14px;
    }

    .ad-insight-label {
      margin-bottom: 5px;
      color: #667085;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .ad-insight-hook {
      color: #111827;
      font-size: 15px;
      font-weight: 760;
      line-height: 1.35;
    }

    .ad-insight-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 10px;
    }

    .ad-insight-detail {
      padding: 12px;
      min-width: 0;
    }

    .ad-insight-detail-wide {
      grid-column: 1 / -1;
    }

    .ad-insight-value {
      color: #1f2937;
      font-size: 13px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .ad-insight-body {
      max-height: 132px;
      overflow: auto;
      padding-right: 4px;
    }

    .ad-insight-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 12px;
    }

    .ad-insight-inline-note {
      margin-top: 8px;
      color: #667085;
      font-size: 12px;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ad-insight-button {
      min-height: 38px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      padding: 8px 12px;
      color: #111827;
      background: #ffffff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 800;
    }

    .ad-insight-button-primary {
      color: #ffffff;
      border-color: #111827;
      background: #111827;
    }

    .ad-insight-status {
      min-height: 18px;
      margin-top: 10px;
      color: #16803c;
      font-size: 12px;
      font-weight: 700;
    }

    .ad-insight-library-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .ad-insight-patterns-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) 88px auto;
      gap: 10px;
      margin-bottom: 12px;
    }

    .ad-insight-patterns-section-title {
      margin-bottom: 10px;
      color: #111827;
      font-size: 13px;
      font-weight: 800;
    }

    .ad-insight-patterns-select,
    .ad-insight-patterns-input {
      min-width: 0;
      height: 38px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      padding: 0 12px;
      color: #111827;
      background: #ffffff;
      font-size: 13px;
      font-weight: 600;
    }

    .ad-insight-patterns-input::placeholder {
      color: #98a2b3;
      font-weight: 500;
    }

    .ad-insight-patterns-button {
      min-height: 38px;
      border: 1px solid #111827;
      border-radius: 8px;
      padding: 8px 12px;
      color: #ffffff;
      background: #111827;
      cursor: pointer;
      font-size: 13px;
      font-weight: 800;
      white-space: nowrap;
    }

    .ad-insight-library-search {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      margin-bottom: 12px;
    }

    .ad-insight-patterns-result {
      margin-bottom: 14px;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #ffffff;
    }

    .ad-insight-patterns-title {
      margin-bottom: 4px;
      color: #111827;
      font-size: 13px;
      font-weight: 800;
    }

    .ad-insight-patterns-subtitle {
      margin-bottom: 10px;
      color: #667085;
      font-size: 12px;
      font-weight: 600;
    }

    .ad-insight-patterns-grid {
      display: grid;
      gap: 10px;
    }

    .ad-insight-patterns-card {
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f8fafc;
    }

    .ad-insight-patterns-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .ad-insight-pattern-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 999px;
      background: #ffffff;
      color: #344054;
      font-size: 12px;
      font-weight: 700;
    }

    .ad-insight-patterns-empty {
      color: #667085;
      font-size: 12px;
      font-weight: 600;
    }

    .ad-insight-count {
      padding: 5px 9px;
      border: 1px solid #d0d5dd;
      border-radius: 999px;
      color: #475467;
      background: #ffffff;
      font-size: 12px;
      font-weight: 800;
    }

    .ad-insight-date {
      margin: 16px 0 8px;
      color: #344054;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .ad-insight-subgroup {
      margin-bottom: 14px;
    }

    .ad-insight-subgroup-title {
      margin: 10px 0 8px;
      color: #475467;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .ad-insight-card {
      display: grid;
      grid-template-columns: 1fr 92px;
      gap: 12px;
      align-items: start;
      padding: 10px;
      margin-bottom: 10px;
      cursor: pointer;
      position: relative;
    }

    .ad-insight-card-time {
      margin-bottom: 5px;
      color: #667085;
      font-size: 11px;
      font-weight: 700;
    }

    .ad-insight-card-title {
      color: #111827;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.35;
    }

    .ad-insight-card-meta {
      margin-top: 7px;
      color: #475467;
      font-size: 12px;
      font-weight: 700;
    }

    .ad-insight-card-delete {
      position: absolute;
      right: 8px;
      bottom: 8px;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 1px solid #d0d5dd;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      color: #475467;
      cursor: pointer;
      transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
    }

    .ad-insight-card-delete:hover {
      color: #b42318;
      border-color: #f0b4b4;
      background: #fff5f5;
    }

    .ad-insight-card-delete svg {
      width: 14px;
      height: 14px;
      pointer-events: none;
    }

    .ad-insight-detail-hero {
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: contain;
      border-radius: 8px;
      background: #eef2f6;
      margin-bottom: 12px;
    }

    .ad-insight-detail-stack {
      display: grid;
      gap: 10px;
    }

    .ad-insight-thumb,
    .ad-insight-thumb-empty {
      width: 92px;
      height: 92px;
      border-radius: 8px;
      background: #eef2f6;
    }

    .ad-insight-thumb {
      display: block;
      object-fit: cover;
    }

    .ad-insight-thumb-empty {
      display: grid;
      place-items: center;
      padding: 8px;
      color: #8a8f98;
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }

    .ad-insight-empty {
      padding: 24px 18px;
      color: #667085;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
    }

    .ad-insight-load-more {
      display: flex;
      justify-content: center;
      margin: 6px 0 2px;
    }

    .ad-insight-back-row {
      margin-top: 12px;
    }

    .ad-insight-selected {
      box-shadow: 0 0 0 3px #111827 inset !important;
    }

    .ad-insight-hovered {
      box-shadow: 0 0 0 2px #16a34a inset !important;
      background-color: rgba(22, 163, 74, 0.06) !important;
      background-image:
        repeating-linear-gradient(
          135deg,
          rgba(22, 163, 74, 0.16) 0 2px,
          rgba(22, 163, 74, 0) 2px 8px
        ) !important;
      background-blend-mode: multiply !important;
    }

    @media (max-width: 540px) {
      .ad-insight-panel {
        top: 16px;
        right: 16px;
        left: 16px;
        width: auto;
      }

      .ad-insight-score-row,
      .ad-insight-grid {
        grid-template-columns: 1fr;
      }

      .ad-insight-actions,
      .ad-insight-card {
        grid-template-columns: 1fr;
      }

      .ad-insight-thumb,
      .ad-insight-thumb-empty {
        width: 100%;
        height: 140px;
      }
    }
  `;

  document.documentElement.appendChild(style);
}

// ---------------- ANALYSIS ----------------

function analyzeInline(snapshot) {
  const title = normalizeLine(snapshot?.title || "");
  const company = normalizeLine(snapshot?.company || title);
  const caption = normalizeLine(snapshot?.caption || "");
  const body = normalizeLine(snapshot?.body || snapshot?.text || "");
  const lower = body.toLowerCase();
  const hookSource = stripLeadingCompany(body, company);
  const hookText = firstTwoMeaningfulSentences(hookSource, [
    company,
    title,
    snapshot?.domain,
    snapshot?.linkDomain,
    caption
  ]);
  const hook = hookText || firstMeaningfulSentence(hookSource, [company, title, snapshot?.domain, snapshot?.linkDomain]) || caption || title;

  let offer = null;
  const offerSource = `${title} ${caption} ${body}`.toLowerCase();
  if (
    offerSource.includes("%") ||
    offerSource.includes("sale") ||
    offerSource.includes("free") ||
    offerSource.includes("bonus") ||
    offerSource.includes("save")
  ) {
    offer = caption || "Explicit offer present";
  }

  const cta = snapshot?.ctaButton || null;

  let psychology = "Basic attention";
  if (lower.includes("limited") || lower.includes("today") || lower.includes("now")) {
    psychology = "Urgency";
  } else if (lower.includes("best") || lower.includes("top")) {
    psychology = "Authority / social proof";
  }

  const scoreBreakdown = {
    hook_quality: scoreHookQuality(hook),
    offer_strength: scoreOfferStrength(offer || caption),
    CTA_presence: scoreCtaPresence(cta),
    psychology_trigger: scorePsychologyTrigger(body),
    visual_presence: scoreVisualPresence(snapshot?.images)
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);

  return {
    hook,
    offer,
    cta,
    body,
    title,
    company,
    caption,
    domain: snapshot?.linkDomain || null,
    libraryId: snapshot?.libraryId || null,
    startedRunning: snapshot?.startedRunning || null,
    variants: snapshot?.variants || null,
    platforms: Array.isArray(snapshot?.platforms) ? snapshot.platforms : [],
    categories: Array.isArray(snapshot?.categories) ? snapshot.categories : [],
    psychology,
    scoreBreakdown,
    score
  };
}

// ---------------- STORAGE ----------------

function canUseChromeStorage() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

function getCreatedAt(item) {
  if (item?.created_at) return item.created_at;
  if (item?.createdAt) return item.createdAt;
  if (typeof item?.id === "number") return new Date(item.id).toISOString();
  return new Date().toISOString();
}

function normalizeAd(item) {
  const analysis = item?.analysis || {
    hook: item?.hook || "",
    offer: item?.offer || null,
    cta: item?.cta || null,
    body: item?.body || "",
    psychology: item?.psychology || "",
    score: item?.score ?? 0
  };
  const snapshot = item?.snapshot || {
    text: item?.body || "",
    headline: item?.hook || "",
    images: item?.images || []
  };
  const images = Array.isArray(item?.images)
    ? item.images
    : Array.isArray(snapshot.images)
    ? snapshot.images
    : [];

  return {
    id: String(item?.id || createId()),
    snapshot,
    analysis,
    images,
    created_at: getCreatedAt(item)
  };
}

function readLocalStorageAds() {
  try {
    return JSON.parse(localStorage.getItem(ADS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function readStoredAds() {
  if (!canUseChromeStorage()) {
    return Promise.resolve(readLocalStorageAds().map(normalizeAd));
  }

  return new Promise((resolve) => {
    chrome.storage.local.get({ [ADS_STORAGE_KEY]: [] }, (result) => {
      const stored = Array.isArray(result?.[ADS_STORAGE_KEY])
        ? result[ADS_STORAGE_KEY]
        : [];
      const legacy = readLocalStorageAds();
      const merged = [...stored, ...legacy].map(normalizeAd);
      const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());

      if (legacy.length > 0) {
        chrome.storage.local.set({ [ADS_STORAGE_KEY]: unique }, () => {
          localStorage.removeItem(ADS_STORAGE_KEY);
          resolve(unique);
        });
        return;
      }

      resolve(unique);
    });
  });
}

function writeStoredAds(items) {
  if (!canUseChromeStorage()) {
    localStorage.setItem(ADS_STORAGE_KEY, JSON.stringify(items));
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [ADS_STORAGE_KEY]: items }, () => {
      if (chrome.runtime?.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function getSavedAds() {
  const items = await readStoredAds();
  return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function saveAd(data) {
  const existing = await getSavedAds();
  const record = normalizeAd({
    id: createId(),
    ...data,
    created_at: new Date().toISOString()
  });

  await writeStoredAds([record, ...existing]);
  return record;
}

async function deleteSavedAd(id) {
  const existing = await getSavedAds();
  const filtered = existing.filter((item) => String(item.id) !== String(id));
  await writeStoredAds(filtered);
  currentLibraryItems = filtered;
}

async function clearSavedAds(category, clearDate) {
  const existing = await getSavedAds();
  const normalizedCategory = normalizeLine(category);
  const normalizedDates = Array.isArray(clearDate)
    ? clearDate.map((value) => normalizeLine(value)).filter(Boolean)
    : normalizeLine(clearDate)
    ? [normalizeLine(clearDate)]
    : [];
  const filtered = existing.filter((item) => {
    if (normalizedCategory && getPrimaryCategory(item) !== normalizedCategory) {
      return true;
    }

    if (normalizedDates.length > 0) {
      return !normalizedDates.includes(formatInputDate(item.created_at));
    }

    return false;
  });

  await writeStoredAds(filtered);
  currentLibraryItems = filtered;
}

// ---------------- OVERLAY ----------------

function createOverlay() {
  if (overlayEl) return overlayEl;

  injectOverlayStyles();
  overlayEl = document.createElement("div");
  overlayEl.className = "ad-insight-panel";

  document.body.appendChild(overlayEl);

  return overlayEl;
}

// ---------------- OVERLAY RENDER ----------------

function renderOverlay(data) {
  const el = createOverlay();
  currentAnalysis = data;
  const score = Math.max(0, Math.min(100, Number(data.score) || 0));
  const categories = Array.isArray(data.categories) ? data.categories.join(", ") : "";
  const textValue = normalizeLine(data.body || data.hook || "");
  const variantsLine = normalizeLine(data.variants || "");

  el.innerHTML = `
    <div class="ad-insight-shell">
      <div class="ad-insight-header">
        <div class="ad-insight-brand">
          <img class="ad-insight-mark" src="${BRAND_ICON_URL}" alt="FB AD LIBRARY" />
          <div>
            <div class="ad-insight-kicker">FB AD LIBRARY</div>
            <div class="ad-insight-title">Why this ad works</div>
          </div>
        </div>
        <button class="ad-insight-close" data-action="close" title="Close">&times;</button>
      </div>

      <div class="ad-insight-content">
        <div class="ad-insight-score-row">
          <div class="ad-insight-score-card">
            <div class="ad-insight-score" style="--score:${score};">
              <span>${escapeHTML(score)}</span>
            </div>
            <div class="ad-insight-score-label">Score</div>
          </div>

          <div class="ad-insight-hook-card">
            <div class="ad-insight-label">Text</div>
            <div class="ad-insight-hook">${escapeHTML(textValue || "No text")}</div>
          </div>
        </div>

        <div class="ad-insight-grid">
          <div class="ad-insight-detail">
            <div class="ad-insight-label">CTA</div>
            <div class="ad-insight-value">${escapeHTML(data.cta || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Category</div>
            <div class="ad-insight-value">${escapeHTML(categories || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Psychology</div>
            <div class="ad-insight-value">${escapeHTML(data.psychology || "Basic attention")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Domain</div>
            <div class="ad-insight-value">${escapeHTML(data.domain || "—")}</div>
          </div>
          <div class="ad-insight-detail ad-insight-detail-wide">
            <div class="ad-insight-label">Link Headline</div>
            <div class="ad-insight-value">${escapeHTML(data.caption || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Library ID</div>
            <div class="ad-insight-value">${escapeHTML(data.libraryId || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Running for</div>
            <div class="ad-insight-value">${escapeHTML(formatRunningFor(data.startedRunning))}</div>
          </div>
        </div>

        ${
          variantsLine
            ? `<div class="ad-insight-inline-note">${escapeHTML(variantsLine)}</div>`
            : ""
        }

        <div class="ad-insight-actions">
          <button class="ad-insight-button ad-insight-button-primary" data-action="save">Save</button>
          <button class="ad-insight-button" data-action="library">Library</button>
        </div>

        <div id="saved-msg" class="ad-insight-status"></div>
      </div>
    </div>
  `;

  el.onclick = (e) => {
    const action = e.target.dataset.action;
    if (!action) return;

    if (action === "save") {
      const messageEl = el.querySelector("#saved-msg");
      messageEl.style.color = "green";
      messageEl.innerText = "Saving...";
      saveAd({
        analysis: data,
        snapshot: data.snapshot || {
          text: data.body || "",
          headline: data.hook || "",
          images: data.images || [],
          url: location.href
        },
        images: data.images || data.snapshot?.images || []
      })
        .then(() => {
          messageEl.innerText = "Saved";
        })
        .catch(() => {
          messageEl.style.color = "#b42318";
          messageEl.innerText = "Save failed";
        });
    }

    if (action === "library") {
      renderLibrary();
    }

    if (action === "close") {
      el.remove();
      overlayEl = null;
    }
  };
}

// ---------------- LIBRARY ----------------

const DATE_LOCALE = "en-US";

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function parseSearchQueryFromUrl(url) {
  try {
    const parsed = new URL(String(url || ""), location.origin);
    return normalizeLine(
      parsed.searchParams.get("search_keyword") ||
        parsed.searchParams.get("keyword") ||
        parsed.searchParams.get("q") ||
        parsed.searchParams.get("location[name]") ||
        ""
    );
  } catch {
    return "";
  }
}

function parseStartedRunningDate(value) {
  const text = normalizeLine(value || "");
  if (!text) return null;

  const compact = text.replace(/\s+/g, " ").trim();
  const numeric = compact.match(/\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = Number(numeric[3]);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const words = compact.match(/\b(\d{1,2})\s+([^\s\d]+)\s+((?:19|20)\d{2})\b/);
  if (!words) return null;

  const monthMap = {
    jan: 0, january: 0, januar: 0, янв: 0,
    feb: 1, february: 1, februar: 1, фев: 1,
    mar: 2, march: 2, märz: 2, maerz: 2, мар: 2,
    apr: 3, april: 3, апр: 3,
    may: 4, mai: 4, мая: 4, май: 4,
    jun: 5, june: 5, juni: 5, июн: 5,
    jul: 6, july: 6, juli: 6, июл: 6,
    aug: 7, august: 7, авг: 7,
    sep: 8, sept: 8, september: 8, сент: 8, сен: 8,
    oct: 9, october: 9, oktober: 9, окт: 9,
    nov: 10, november: 10, ноя: 10,
    dec: 11, december: 11, dezember: 11, дек: 11
  };

  const day = Number(words[1]);
  const monthToken = words[2].toLowerCase().replace(/\.$/, "");
  const year = Number(words[3]);
  const month = monthMap[monthToken];
  if (month == null) return null;

  const parsed = new Date(year, month, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRunningFor(value) {
  const startedDate = parseStartedRunningDate(value);
  if (!startedDate) return "Unknown";

  const today = new Date();
  const startedDay = new Date(
    startedDate.getFullYear(),
    startedDate.getMonth(),
    startedDate.getDate()
  );
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = currentDay.getTime() - startedDay.getTime();
  const days = Math.max(0, Math.floor(diffMs / 86400000));

  if (days === 1) return "1 day";
  return `${days} days`;
}

function getRunningDays(value) {
  const startedDate = parseStartedRunningDate(value);
  if (!startedDate) return -1;

  const today = new Date();
  const startedDay = new Date(
    startedDate.getFullYear(),
    startedDate.getMonth(),
    startedDate.getDate()
  );
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = currentDay.getTime() - startedDay.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

function getPrimaryCategory(item) {
  const categories = item?.analysis?.categories;
  if (Array.isArray(categories) && categories.length > 0) {
    return normalizeLine(categories[0]) || "Uncategorized";
  }

  const fallback = normalizeLine(item?.analysis?.category || "");
  return fallback || "Uncategorized";
}

function getLibraryCategories(items) {
  return Array.from(new Set((items || []).map((item) => getPrimaryCategory(item)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  );
}

function formatPatternLabel(label) {
  const normalized = normalizeLine(label);
  if (normalized.startsWith("symbol_")) {
    if (normalized.includes("price")) return "✨💲";
    return "✨";
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderPatternSummaryList(items, emptyLabel) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="ad-insight-patterns-empty">${escapeHTML(emptyLabel)}</div>`;
  }

  return `
    <div class="ad-insight-patterns-tags">
      ${items
        .slice(0, 6)
        .map(
          (item) => `
        <span class="ad-insight-pattern-tag">${escapeHTML(formatPatternLabel(item.label))} <strong>${escapeHTML(item.count)}</strong></span>
      `
        )
        .join("")}
    </div>
  `;
}

function getPatternAnalysisScore(item) {
  const value = Number(item?.analysis?.score);
  return Number.isFinite(value) ? value : null;
}

function renderPatternsResult(patterns, categoryLabel, queryFilter, minScoreFilter) {
  const filterParts = [`Category: ${categoryLabel}`];
  if (queryFilter) filterParts.push(`Query: ${queryFilter}`);
  if (minScoreFilter !== null) filterParts.push(`Score >= ${minScoreFilter}`);

  return `
    <div class="ad-insight-patterns-result">
      <div class="ad-insight-patterns-title">Get pattern insights</div>
      <div class="ad-insight-patterns-subtitle">${escapeHTML(filterParts.join(" | "))}</div>
      <div class="ad-insight-patterns-grid">
        <section class="ad-insight-patterns-card">
          <div class="ad-insight-label">Frequent words</div>
          ${renderPatternSummaryList(patterns.frequentWords, "No frequent words yet")}
        </section>
        <section class="ad-insight-patterns-card">
          <div class="ad-insight-label">Hook structures</div>
          ${renderPatternSummaryList(patterns.hookStructures, "No hook structures yet")}
        </section>
        <section class="ad-insight-patterns-card">
          <div class="ad-insight-label">Offer types</div>
          ${renderPatternSummaryList(patterns.offerTypes, "No offer types yet")}
        </section>
      </div>
    </div>
  `;
}

function renderPatternsSectionTitle() {
  return `<div class="ad-insight-patterns-section-title">Get pattern insights</div>`;
}

function resetLibraryUiState() {
  currentLibraryVisibleCount = LIBRARY_PAGE_SIZE;
  currentLibraryLoadingMore = false;
  currentLibraryUiState = {
    selectedCategory: "",
    queryFilter: "",
    scoreValue: "",
    clearDate: "",
    librarySearch: "",
    patternsHtml: ""
  };
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/"/g, "&quot;");
}

function syncLibraryUiStateFromElement(el) {
  if (!el) return;
  currentLibraryUiState.selectedCategory = normalizeLine(
    el.querySelector("#patterns-category-select")?.value || currentLibraryUiState.selectedCategory
  );
  currentLibraryUiState.queryFilter = normalizeLine(
    el.querySelector("#patterns-query-input")?.value || currentLibraryUiState.queryFilter
  );
  currentLibraryUiState.scoreValue = normalizeLine(
    el.querySelector("#patterns-score-select")?.value || currentLibraryUiState.scoreValue
  );
  currentLibraryUiState.clearDate = normalizeLine(
    el.querySelector("#clear-date-input")?.value || currentLibraryUiState.clearDate
  );
  currentLibraryUiState.librarySearch = normalizeLine(
    el.querySelector("#library-search-input")?.value || currentLibraryUiState.librarySearch
  );
}

function formatInputDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function formatPublishedOn(value) {
  const startedDate = parseStartedRunningDate(value);
  if (!startedDate) return "Unknown";

  return new Intl.DateTimeFormat(DATE_LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(startedDate);
}

function getPreviewImage(item) {
  const images = Array.isArray(item?.images)
    ? item.images
    : Array.isArray(item?.snapshot?.images)
    ? item.snapshot.images
    : [];
  return images[0] || "";
}

function getSearchQuery(item) {
  return normalizeLine(
    item?.snapshot?.searchQuery ||
      item?.analysis?.searchQuery ||
      parseSearchQueryFromUrl(item?.snapshot?.url) ||
      ""
  );
}

function getLibrarySearchText(item) {
  return normalizeLine(
    [
      item?.snapshot?.text,
      item?.snapshot?.body,
      item?.snapshot?.headline,
      item?.snapshot?.title,
      item?.snapshot?.caption,
      item?.analysis?.body,
      item?.analysis?.hook,
      item?.analysis?.title,
      item?.analysis?.caption
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function renderLibraryDetail(item) {
  const el = createOverlay();
  const analysis = item?.analysis || {};
  const image = getPreviewImage(item);
  const startedRunning = analysis?.startedRunning || item?.snapshot?.startedRunning || "";
  const searchQuery = getSearchQuery(item);
  const categories = Array.isArray(analysis?.categories) ? analysis.categories.join(", ") : "";
  const detailImage = image
    ? `<img class="ad-insight-detail-hero" src="${escapeHTML(image)}" alt="" />`
    : "";

  currentLibraryItem = item;

  el.innerHTML = `
    <div class="ad-insight-shell">
      <div class="ad-insight-header">
        <div class="ad-insight-brand">
          <img class="ad-insight-mark" src="${BRAND_ICON_URL}" alt="FB AD LIBRARY" />
          <div>
            <div class="ad-insight-kicker">FB AD LIBRARY</div>
            <div class="ad-insight-title">Saved Ad</div>
          </div>
        </div>
        <div class="ad-insight-header-actions">
          <button class="ad-insight-header-back" data-action="back-library">Back</button>
          <button class="ad-insight-close" data-action="close" title="Close">&times;</button>
        </div>
      </div>

      <div class="ad-insight-content">
        ${detailImage}

        <div class="ad-insight-score-row">
          <div class="ad-insight-score-card">
            <div class="ad-insight-score" style="--score:${escapeHTML(analysis.score ?? 0)};">
              <span>${escapeHTML(analysis.score ?? 0)}</span>
            </div>
            <div class="ad-insight-score-label">Score</div>
          </div>

          <div class="ad-insight-hook-card">
            <div class="ad-insight-label">Text</div>
            <div class="ad-insight-hook">${escapeHTML(normalizeLine(analysis.body || analysis.hook || "" ) || "No text")}</div>
          </div>
        </div>

        <div class="ad-insight-grid">
          <div class="ad-insight-detail">
            <div class="ad-insight-label">CTA</div>
            <div class="ad-insight-value">${escapeHTML(analysis.cta || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Category</div>
            <div class="ad-insight-value">${escapeHTML(categories || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Psychology</div>
            <div class="ad-insight-value">${escapeHTML(analysis.psychology || "Basic attention")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Domain</div>
            <div class="ad-insight-value">${escapeHTML(analysis.domain || "—")}</div>
          </div>
          <div class="ad-insight-detail ad-insight-detail-wide">
            <div class="ad-insight-label">Link Headline</div>
            <div class="ad-insight-value">${escapeHTML(analysis.caption || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Library ID</div>
            <div class="ad-insight-value">${escapeHTML(analysis.libraryId || "—")}</div>
          </div>
          <div class="ad-insight-detail">
            <div class="ad-insight-label">Running for</div>
            <div class="ad-insight-value">${escapeHTML(formatRunningFor(startedRunning))}</div>
          </div>
        </div>

        <div class="ad-insight-detail-stack">
          ${
            searchQuery
              ? `
          <div class="ad-insight-detail ad-insight-detail-wide">
            <div class="ad-insight-label">Query</div>
            <div class="ad-insight-value">${escapeHTML(searchQuery)}</div>
          </div>`
              : ""
          }
          <div class="ad-insight-detail ad-insight-detail-wide">
            <div class="ad-insight-label">Published on</div>
            <div class="ad-insight-value">${escapeHTML(formatPublishedOn(startedRunning))}</div>
          </div>
          <div class="ad-insight-detail ad-insight-detail-wide">
            <div class="ad-insight-label">Saved on</div>
            <div class="ad-insight-value">${escapeHTML(formatDate(item.created_at))}, ${escapeHTML(formatTime(item.created_at))}</div>
          </div>
        </div>

      </div>
    </div>
  `;

  el.onclick = (e) => {
    const action = e.target.dataset.action;
    if (action === "close") {
      el.remove();
      overlayEl = null;
      return;
    }

    if (action === "back-library") {
      renderLibrary({ preserveState: true });
    }
  };
}

async function renderLibrary(options = {}) {
  const { preserveState = false, preserveScrollTop = 0 } = options;
  const el = createOverlay();
  currentLibraryItem = null;
  if (!preserveState) {
    resetLibraryUiState();
  }
  el.innerHTML = `
    <div class="ad-insight-shell">
      <div class="ad-insight-header">
        <div class="ad-insight-brand">
          <img class="ad-insight-mark" src="${BRAND_ICON_URL}" alt="FB AD LIBRARY" />
          <div>
            <div class="ad-insight-kicker">FB AD LIBRARY</div>
            <div class="ad-insight-title">Library</div>
          </div>
        </div>
        <button
          class="ad-insight-header-clear ad-insight-header-clear-anchor"
          data-action="open-clear-library"
        >
          Clear lib
        </button>
        <div class="ad-insight-header-actions">
          <button class="ad-insight-header-back" data-action="back">Back</button>
          <button class="ad-insight-close" data-action="close" title="Close">&times;</button>
        </div>
      </div>
      <div class="ad-insight-content">
        <div class="ad-insight-empty">Loading saved ads...</div>
      </div>
    </div>
  `;

  const items = await getSavedAds();
  currentLibraryItems = items;
  if (currentLibraryVisibleCount === 0) {
    currentLibraryVisibleCount = LIBRARY_PAGE_SIZE;
  }
  const categoryOptions = getLibraryCategories(items);
  const categoryOptionsHtml = categoryOptions
    .map(
      (category) =>
        `<option value="${escapeAttribute(category)}"${
          currentLibraryUiState.selectedCategory === category ? " selected" : ""
        }>${escapeHTML(category)}</option>`
    )
    .join("");
  const librarySearchTerm = normalizeLine(currentLibraryUiState.librarySearch).toLowerCase();
  const searchedItems = librarySearchTerm
    ? items.filter((item) => getLibrarySearchText(item).includes(librarySearchTerm))
    : items;
  const visibleItems = searchedItems.slice(0, currentLibraryVisibleCount);
  const grouped = visibleItems.reduce((groups, item) => {
    const label = formatDate(item.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
    return groups;
  }, new Map());

  el.innerHTML = `
    <div class="ad-insight-shell">
      <div class="ad-insight-header">
        <div class="ad-insight-brand">
          <img class="ad-insight-mark" src="${BRAND_ICON_URL}" alt="FB AD LIBRARY" />
          <div>
            <div class="ad-insight-kicker">FB AD LIBRARY</div>
            <div class="ad-insight-title">Library</div>
          </div>
        </div>
        <button
          class="ad-insight-header-clear ad-insight-header-clear-anchor"
          data-action="open-clear-library"
        >
          Clear lib
        </button>
        <div class="ad-insight-header-actions">
          <button class="ad-insight-header-back" data-action="back">Back</button>
          <button class="ad-insight-close" data-action="close" title="Close">&times;</button>
        </div>
      </div>

      <div class="ad-insight-content">
        ${renderPatternsSectionTitle()}
        <div class="ad-insight-patterns-toolbar">
          <select id="patterns-category-select" class="ad-insight-patterns-select">
            ${categoryOptionsHtml}
          </select>
          <input
            id="patterns-query-input"
            class="ad-insight-patterns-input"
            type="text"
            placeholder="Query (optional)"
            value="${escapeAttribute(currentLibraryUiState.queryFilter)}"
          />
          <select id="patterns-score-select" class="ad-insight-patterns-select">
            <option value=""${currentLibraryUiState.scoreValue === "" ? " selected" : ""}>All scores</option>
            <option value="60"${currentLibraryUiState.scoreValue === "60" ? " selected" : ""}>Score 60+</option>
            <option value="70"${currentLibraryUiState.scoreValue === "70" ? " selected" : ""}>Score 70+</option>
            <option value="80"${currentLibraryUiState.scoreValue === "80" ? " selected" : ""}>Score 80+</option>
            <option value="90"${currentLibraryUiState.scoreValue === "90" ? " selected" : ""}>Score 90+</option>
          </select>
          <button class="ad-insight-patterns-button" type="button" data-action="find-patterns">
            Find patterns
          </button>
        </div>
        <div id="patterns-result">${currentLibraryUiState.patternsHtml}</div>
        <div class="ad-insight-library-search">
          <input
            id="library-search-input"
            class="ad-insight-patterns-input"
            type="text"
            placeholder="Word in ad text"
            value="${escapeAttribute(currentLibraryUiState.librarySearch)}"
          />
          <button class="ad-insight-patterns-button" type="button" data-action="find-in-library">
            Find in library
          </button>
        </div>

        ${
          grouped.size === 0
            ? `<div class="ad-insight-empty">${
                librarySearchTerm ? "No ads found for this word" : "No saved ads"
              }</div>`
            : Array.from(grouped.entries())
                .map(([dateLabel, dateItems]) => {
                  const byCategory = dateItems.reduce((map, item) => {
                    const category = getPrimaryCategory(item);
                    if (!map.has(category)) map.set(category, []);
                    map.get(category).push(item);
                    return map;
                  }, new Map());

                  const cards = Array.from(byCategory.entries())
                    .sort(([leftCategory], [rightCategory]) =>
                      leftCategory.localeCompare(rightCategory)
                    )
                    .map(([categoryLabel, categoryItems]) => {
                      const sortedItems = [...categoryItems].sort((left, right) => {
                        const leftAnalysis = left.analysis || left;
                        const rightAnalysis = right.analysis || right;
                        const leftStarted =
                          leftAnalysis?.startedRunning || left?.snapshot?.startedRunning || "";
                        const rightStarted =
                          rightAnalysis?.startedRunning || right?.snapshot?.startedRunning || "";

                        return getRunningDays(rightStarted) - getRunningDays(leftStarted);
                      });

                      const categoryCards = sortedItems
                        .map((item) => {
                          const analysis = item.analysis || item;
                          const image = getPreviewImage(item);
                          const startedRunning =
                            analysis?.startedRunning || item?.snapshot?.startedRunning || "";
                          const searchQuery = getSearchQuery(item);
                          const imageHtml = image
                            ? `<img class="ad-insight-thumb" src="${escapeHTML(image)}" alt="" />`
                            : `<div class="ad-insight-thumb-empty">No image</div>`;

                          return `
            <article class="ad-insight-card" data-library-id="${escapeHTML(item.id)}">
              <button
                class="ad-insight-card-delete"
                type="button"
                data-action="delete-library"
                data-library-id="${escapeHTML(item.id)}"
                title="Delete ad"
                aria-label="Delete ad"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 7H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M7 7L8 19C8.04673 19.5978 8.54553 20.0588 9.14513 20.0588H14.8549C15.4545 20.0588 15.9533 19.5978 16 19L17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M10 11V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M14 11V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
              <div>
                <div class="ad-insight-card-time">Saved at ${escapeHTML(formatTime(item.created_at))}</div>
                <div class="ad-insight-card-title">${escapeHTML(analysis.hook || "Untitled ad")}</div>
                <div class="ad-insight-card-meta">Score ${escapeHTML(analysis.score ?? 0)}/100</div>
                ${searchQuery ? `<div class="ad-insight-card-meta">Query ${escapeHTML(searchQuery)}</div>` : ""}
                <div class="ad-insight-card-meta">Running for ${escapeHTML(formatRunningFor(startedRunning))}</div>
              </div>
              ${imageHtml}
            </article>
          `;
                        })
                        .join("");

                      return `
            <div class="ad-insight-subgroup">
              <div class="ad-insight-subgroup-title">${escapeHTML(categoryLabel)}</div>
              ${categoryCards}
            </div>
          `;
                    })
                    .join("");

                  return `
          <section>
            <div class="ad-insight-library-head">
              <div class="ad-insight-label">Saved ads</div>
              <div class="ad-insight-count">${escapeHTML(searchedItems.length)} total</div>
            </div>
            <div class="ad-insight-date">${escapeHTML(dateLabel)}</div>
            ${cards}
          </section>
        `;
                })
                .join("")
        }

      </div>
      <div id="library-clear-modal" class="ad-insight-modal-backdrop" data-open="false">
        <div class="ad-insight-modal">
          <div class="ad-insight-modal-title">Clear library data</div>
          <div class="ad-insight-modal-copy">
            This will delete part of your saved ads database. Choose a category and optionally a saved date before continuing.
          </div>
          <div class="ad-insight-modal-fields">
            <select id="clear-category-select" class="ad-insight-patterns-select">
              ${categoryOptionsHtml}
            </select>
            <input
              id="clear-date-input"
              class="ad-insight-patterns-input"
              type="date"
              lang="en-US"
              value="${escapeAttribute(currentLibraryUiState.clearDate)}"
            />
          </div>
          <div class="ad-insight-modal-actions">
            <button class="ad-insight-button" type="button" data-action="cancel-clear-library">Cancel</button>
            <button class="ad-insight-button ad-insight-button-primary" type="button" data-action="confirm-clear-library">Clear lib</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const contentEl = el.querySelector(".ad-insight-content");
  if (contentEl) {
    if (preserveState && preserveScrollTop > 0) {
      contentEl.scrollTop = preserveScrollTop;
    }

    contentEl.onscroll = () => {
      syncLibraryUiStateFromElement(el);
      const threshold = 180;
      const isNearBottom =
        contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - threshold;

      if (isNearBottom && currentLibraryVisibleCount < searchedItems.length) {
        if (currentLibraryLoadingMore) return;
        currentLibraryLoadingMore = true;
        currentLibraryVisibleCount = Math.min(
          currentLibraryVisibleCount + LIBRARY_PAGE_SIZE,
          searchedItems.length
        );
        renderLibrary({
          preserveState: true,
          preserveScrollTop: contentEl.scrollTop
        });
      }
    };
  }
  currentLibraryLoadingMore = false;

  el.onchange = null;

  el.onclick = async (e) => {
    const clearModalEl = el.querySelector("#library-clear-modal");

    if (e.target.dataset.action === "close") {
      el.remove();
      overlayEl = null;
      return;
    }

    if (e.target.dataset.action === "open-clear-library") {
      syncLibraryUiStateFromElement(el);
      const modalCategoryEl = el.querySelector("#clear-category-select");
      const patternsCategory = normalizeLine(
        el.querySelector("#patterns-category-select")?.value || currentLibraryUiState.selectedCategory
      );
      if (modalCategoryEl && patternsCategory) {
        modalCategoryEl.value = patternsCategory;
      }
      if (clearModalEl) {
        clearModalEl.dataset.open = "true";
      }
      return;
    }

    if (
      e.target.dataset.action === "cancel-clear-library" ||
      (e.target === clearModalEl && clearModalEl?.dataset.open === "true")
    ) {
      if (clearModalEl) {
        clearModalEl.dataset.open = "false";
      }
      return;
    }

    if (e.target.dataset.action === "find-patterns") {
      const selectEl = el.querySelector("#patterns-category-select");
      const queryInputEl = el.querySelector("#patterns-query-input");
      const scoreSelectEl = el.querySelector("#patterns-score-select");
      const resultEl = el.querySelector("#patterns-result");
      const selectedCategory = normalizeLine(selectEl?.value || "");
      const queryFilter = normalizeLine(queryInputEl?.value || "");
      const minScoreValue = normalizeLine(scoreSelectEl?.value || "");
      const minScoreFilter = minScoreValue ? Number(minScoreValue) : null;
      currentLibraryUiState.selectedCategory = selectedCategory;
      currentLibraryUiState.queryFilter = queryFilter;
      currentLibraryUiState.scoreValue = minScoreValue;
      if (!resultEl) return;
      if (!selectedCategory) {
        resultEl.innerHTML = `<div class="ad-insight-patterns-empty">Choose a category first</div>`;
        currentLibraryUiState.patternsHtml = resultEl.innerHTML;
        return;
      }

      resultEl.innerHTML = `<div class="ad-insight-patterns-empty">Searching patterns...</div>`;

      try {
        const { findPatterns } = await loadPatternsModule();
        const filteredItems = currentLibraryItems.filter((item) => {
          if (getPrimaryCategory(item) !== selectedCategory) return false;

          if (queryFilter) {
            const itemQuery = getSearchQuery(item).toLowerCase();
            if (itemQuery !== queryFilter.toLowerCase()) return false;
          }

          if (minScoreFilter !== null) {
            const score = getPatternAnalysisScore(item);
            if (score === null || score < minScoreFilter) return false;
          }

          return true;
        });
        const patterns = findPatterns(filteredItems);
        currentLibraryUiState.patternsHtml = renderPatternsResult(
          patterns,
          selectedCategory,
          queryFilter,
          minScoreFilter
        );
        resultEl.innerHTML = currentLibraryUiState.patternsHtml;
      } catch {
        resultEl.innerHTML = `<div class="ad-insight-patterns-empty">Failed to analyze patterns</div>`;
        currentLibraryUiState.patternsHtml = resultEl.innerHTML;
      }
      return;
    }

    if (e.target.dataset.action === "find-in-library") {
      currentLibraryUiState.librarySearch = normalizeLine(
        el.querySelector("#library-search-input")?.value || ""
      );
      currentLibraryVisibleCount = LIBRARY_PAGE_SIZE;
      renderLibrary({ preserveState: true });
      return;
    }

    if (e.target.dataset.action === "confirm-clear-library") {
      const selectedCategory = normalizeLine(
        el.querySelector("#clear-category-select")?.value || currentLibraryUiState.selectedCategory
      );
      const clearDate = normalizeLine(
        el.querySelector("#clear-date-input")?.value || currentLibraryUiState.clearDate
      );

      if (!selectedCategory) {
        return;
      }

      const confirmMessage = clearDate
        ? `Clear saved ads in category "${selectedCategory}" for ${clearDate}?`
        : `Clear all saved ads in category "${selectedCategory}"?`;

      if (!confirm(confirmMessage)) {
        return;
      }

      currentLibraryUiState.selectedCategory = selectedCategory;
      currentLibraryUiState.clearDate = clearDate;
      currentLibraryUiState.patternsHtml = "";
      if (clearModalEl) {
        clearModalEl.dataset.open = "false";
      }
      await clearSavedAds(selectedCategory, clearDate);
      currentLibraryVisibleCount = LIBRARY_PAGE_SIZE;
      renderLibrary({ preserveState: true });
      return;
    }

    if (e.target.dataset.action === "delete-library") {
      const itemId = e.target.dataset.libraryId;
      if (!itemId) return;
      await deleteSavedAd(itemId);
      renderLibrary({ preserveState: true });
      return;
    }

    const card = e.target.closest("[data-library-id]");
    if (card) {
      const selected = currentLibraryItems.find((item) => String(item.id) === card.dataset.libraryId);
      if (selected) {
        renderLibraryDetail(selected);
        return;
      }
    }

    if (e.target.dataset.action === "back") {
      if (currentAnalysis) {
        renderOverlay(currentAnalysis);
        return;
      }

      el.remove();
      overlayEl = null;
    }
  };
}

injectOverlayStyles();

// ---------------- HOVER ----------------

document.addEventListener(
  "mousemove",
  (e) => {
    if (e.target.closest(".ad-insight-panel")) return;
    if (isNativeInteractiveTarget(e.target)) return;

    const now = Date.now();
    if (now - lastHoverTs < 60) return;
    lastHoverTs = now;

    const el = findAdContainer(e.target);

    if (!isValidElement(el)) {
      if (lastHoverElement) {
        lastHoverElement.classList.remove("ad-insight-hovered");
        lastHoverElement = null;
      }
      return;
    }

    if (lastHoverElement && lastHoverElement !== el) {
      lastHoverElement.classList.remove("ad-insight-hovered");
    }

    if (el !== selectedAdElement) {
      el.classList.add("ad-insight-hovered");
      lastHoverElement = el;
    }
  },
  true
);

// ---------------- CLICK ----------------

document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest(".ad-insight-panel")) return;
    if (isNativeInteractiveTarget(e.target)) return;

    const el = findAdContainer(e.target);
    if (!isValidElement(el)) return;

    if (selectedAdElement && selectedAdElement !== el) {
      selectedAdElement.classList.remove("ad-insight-selected");
    }

    if (lastHoverElement && lastHoverElement !== el) {
      lastHoverElement.classList.remove("ad-insight-hovered");
    }

    el.classList.remove("ad-insight-hovered");
    el.classList.add("ad-insight-selected");
    selectedAdElement = el;

    const snapshot = buildSnapshot(el);
    const analysis = {
      ...analyzeInline(snapshot),
      images: snapshot.images,
      snapshot
    };

    renderOverlay(analysis);
  },
  false
);

// ---------------- MESSAGES ----------------

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.OPEN_LIBRARY) {
      renderLibrary();
      sendResponse({
        type: MESSAGE_TYPES.PRIMARY_AD_RESULT,
        ok: true
      });
      return undefined;
    }

    if (
      !message ||
      (message.type !== MESSAGE_TYPES.GET_SELECTED_AD &&
        message.type !== MESSAGE_TYPES.DETECT_PRIMARY_AD)
    ) {
      return undefined;
    }

    if (!isValidElement(selectedAdElement)) {
      sendResponse({
        type: MESSAGE_TYPES.PRIMARY_AD_RESULT,
        ok: false,
        error: "ad_not_selected"
      });
      return undefined;
    }

    sendResponse({
      type: MESSAGE_TYPES.PRIMARY_AD_RESULT,
      ok: true,
      payload: buildSnapshot(selectedAdElement)
    });

    return undefined;
  });
}

// ---------------- RESET ----------------

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;

  if (selectedAdElement) selectedAdElement.classList.remove("ad-insight-selected");
  if (lastHoverElement) lastHoverElement.classList.remove("ad-insight-hovered");
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }

  selectedAdElement = null;
  lastHoverElement = null;
});
