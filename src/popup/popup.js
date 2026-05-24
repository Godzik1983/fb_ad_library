import { MESSAGE_TYPES } from "../shared/messages.js";
import { analyze } from "./analyzer.js";
import {
  getAllAds as getIndexedDbAds,
  saveAd as saveIndexedDbAd
} from "../storage/indexeddb.js";

const app = document.getElementById("app");

const STATES = {
  IDLE: "idle",
  DETECTED: "detected",
  LOADING: "loading",
  RESULT: "result",
  LIBRARY: "library"
};

const state = {
  status: STATES.IDLE,
  detection: null,
  analysis: null,
  saveStatus: "",
  libraryItems: [],
  idleMessage: "No ad detected"
};

const ADS_STORAGE_KEY = "ads";
const DATE_LOCALE = "en-US";

function escapeHTML(str) {
  return String(str)
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

function getCreatedAt(item) {
  if (item?.created_at) return item.created_at;
  if (item?.createdAt) return item.createdAt;
  if (typeof item?.id === "number") return new Date(item.id).toISOString();
  return "";
}

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
    const parsed = new URL(String(url || ""));
    return String(
      parsed.searchParams.get("search_keyword") ||
        parsed.searchParams.get("keyword") ||
        parsed.searchParams.get("q") ||
        parsed.searchParams.get("location[name]") ||
        ""
    ).trim();
  } catch {
    return "";
  }
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
  return String(
    item?.snapshot?.searchQuery ||
      item?.analysis?.searchQuery ||
      parseSearchQueryFromUrl(item?.snapshot?.url) ||
      ""
  ).trim();
}

function normalizeAd(item) {
  const snapshot = item?.snapshot || {};
  const images = Array.isArray(item?.images)
    ? item.images
    : Array.isArray(snapshot.images)
    ? snapshot.images
    : [];

  return {
    ...item,
    id: String(item?.id || createId()),
    snapshot: {
      ...snapshot,
      images
    },
    analysis: item?.analysis || {},
    images,
    created_at: getCreatedAt(item) || new Date().toISOString()
  };
}

function readChromeAds() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return Promise.resolve([]);

  return new Promise((resolve) => {
    chrome.storage.local.get({ [ADS_STORAGE_KEY]: [] }, (result) => {
      resolve(Array.isArray(result?.[ADS_STORAGE_KEY]) ? result[ADS_STORAGE_KEY] : []);
    });
  });
}

function writeChromeAds(items) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return Promise.resolve();

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

function mergeAds(...collections) {
  const merged = collections.flat().map(normalizeAd);
  return Array.from(new Map(merged.map((item) => [item.id, item])).values()).sort(
    (a, b) => new Date(getCreatedAt(b)) - new Date(getCreatedAt(a))
  );
}

async function saveAd(ad) {
  const record = normalizeAd(ad);
  const existing = await readChromeAds();
  await writeChromeAds(mergeAds([record], existing));
  saveIndexedDbAd(record).catch(() => {});
  return record;
}

async function getAllAds() {
  const [chromeResult, indexedDbResult] = await Promise.allSettled([
    readChromeAds(),
    getIndexedDbAds()
  ]);
  const chromeAds = chromeResult.status === "fulfilled" ? chromeResult.value : [];
  const indexedDbAds = indexedDbResult.status === "fulfilled" ? indexedDbResult.value : [];
  const merged = mergeAds(chromeAds, indexedDbAds);

  if (indexedDbAds.length > 0) {
    writeChromeAds(merged).catch(() => {});
  }

  return merged;
}

function groupAdsByDate(items) {
  return items.reduce((groups, item) => {
    const label = formatDate(getCreatedAt(item));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
    return groups;
  }, new Map());
}

function setState(next) {
  Object.assign(state, next);
  render(state);
}

function render(current) {
  if (!app) return;

  // ---------------- IDLE ----------------
  if (current.status === STATES.IDLE) {
    app.innerHTML = `
      <p>${escapeHTML(current.idleMessage)}</p>
      <button id="retry-btn">Retry</button>
    `;

    document.getElementById("retry-btn").onclick = detectPrimaryAd;
    return;
  }

  // ---------------- DETECTED ----------------
  if (current.status === STATES.DETECTED) {
    app.innerHTML = `
      <button id="analyze-btn">Analyze</button>
    `;

    document.getElementById("analyze-btn").onclick = onAnalyzeClick;
    return;
  }

  // ---------------- LOADING ----------------
  if (current.status === STATES.LOADING) {
    app.innerHTML = `<p>Analyzing...</p>`;
    return;
  }

  // ---------------- RESULT ----------------
  if (current.status === STATES.RESULT) {
    const result = current.analysis;

    if (!result) {
      app.innerHTML = `<p>No analysis</p>`;
      return;
    }

    const saveLine =
      current.saveStatus === "success"
        ? "Saved ✓"
        : current.saveStatus === "error"
        ? "Save failed"
        : "";

    app.innerHTML = `
      <div class="card">

        <h3>WHY THIS AD WORKS</h3>

        <div class="row">
          <span class="label">Hook</span>
          <span class="value">${escapeHTML(result.hook || "—")}</span>
        </div>

        <div class="row">
          <span class="label">Offer</span>
          <span class="value">${escapeHTML(result.offer || "None")}</span>
        </div>

        <div class="row">
          <span class="label">CTA</span>
          <span class="value">${escapeHTML(result.cta || "None")}</span>
        </div>

        ${
          result.body
            ? `
        <div class="row">
          <span class="label">Body</span>
          <span class="value">${escapeHTML(result.body)}</span>
        </div>`
            : ""
        }

        <div class="row">
          <span class="label">Psychology</span>
          <span class="value">${escapeHTML(result.psychology || "")}</span>
        </div>

        <div class="row">
          <span class="label">Structure</span>
          <span class="value">${escapeHTML(result.structure || "")}</span>
        </div>

        <div class="row">
          <span class="label">Score</span>
          <span class="value">${escapeHTML(result.score ?? 0)}/100</span>
        </div>

        ${saveLine ? `<p>${saveLine}</p>` : ""}

        <button id="library-btn">Library</button>

      </div>
    `;

    document.getElementById("library-btn").onclick = onViewLibraryClick;
    return;
  }

  // ---------------- LIBRARY ----------------
  if (current.status === STATES.LIBRARY) {
    const items = [...(current.libraryItems || [])].sort(
      (a, b) => new Date(getCreatedAt(b)) - new Date(getCreatedAt(a))
    );
    const grouped = groupAdsByDate(items);

    const groupedHtml = Array.from(grouped.entries())
      .map(([dateLabel, dateItems]) => {
        const cardsHtml = dateItems
          .map((item) => {
            const hook = item?.analysis?.hook || "Untitled ad";
            const score = item?.analysis?.score ?? 0;
            const createdAt = getCreatedAt(item);
            const searchQuery = getSearchQuery(item);
            const image = getPreviewImage(item);
            const imageHtml = image
              ? `<img class="library-thumb" src="${escapeHTML(image)}" alt="" />`
              : `<div class="library-thumb library-thumb-empty">No image</div>`;

            return `
              <li class="library-item">
                <div class="library-copy">
                  <div class="saved-time">Saved at ${escapeHTML(formatTime(createdAt))}</div>
                  ${searchQuery ? `<div class="saved-time">Query: ${escapeHTML(searchQuery)}</div>` : ""}
                  <strong>${escapeHTML(hook)}</strong>
                  <div>Score: ${escapeHTML(score)}/100</div>
                </div>
                ${imageHtml}
              </li>
            `;
          })
          .join("");

        return `
          <section class="library-date-group">
            <h4>${escapeHTML(dateLabel)}</h4>
            <ul class="library-list">${cardsHtml}</ul>
          </section>
        `;
      })
      .join("");

    app.innerHTML = `
      <div class="card">
        <h3>Saved Ads (${items.length})</h3>
        ${items.length === 0 ? "<p>No ads yet</p>" : groupedHtml}
        <button id="back-btn">Back</button>
      </div>
    `;

    document.getElementById("back-btn").onclick = onBackClick;
    return;
  }
}

// ---------------- DETECT ----------------
function detectPrimaryAd() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;

    if (typeof tabId !== "number") {
      setState({ status: STATES.IDLE });
      return;
    }

    chrome.tabs.sendMessage(
      tabId,
      { type: MESSAGE_TYPES.GET_SELECTED_AD },
      (response) => {
        if (response && response.ok) {
          setState({
            status: STATES.DETECTED,
            detection: response.payload
          });
          return;
        }

        setState({
          status: STATES.IDLE,
          idleMessage: "Click on an ad first"
        });
      }
    );
  });
}

// ---------------- ANALYZE ----------------
function onAnalyzeClick() {
  setState({ status: STATES.LOADING });

  requestAnimationFrame(() => {
    const snapshot = state.detection;

    if (!snapshot) {
      setState({ status: STATES.IDLE });
      return;
    }

    const result = analyze(snapshot);

    setState({
      status: STATES.RESULT,
      analysis: result,
      saveStatus: ""
    });

    saveAd({
      id: createId(),
      snapshot,
      analysis: result,
      created_at: new Date().toISOString()
    })
      .then(() => {
        setState({ saveStatus: "success" });
      })
      .catch(() => {
        setState({ saveStatus: "error" });
      });
  });
}

// ---------------- LIBRARY ----------------
function onViewLibraryClick() {
  setState({ status: STATES.LOADING });

  getAllAds()
    .then((ads) => {
      setState({
        status: STATES.LIBRARY,
        libraryItems: ads
      });
    })
    .catch(() => {
      setState({
        status: STATES.LIBRARY,
        libraryItems: []
      });
    });
}

function onBackClick() {
  setState({
    status: STATES.RESULT,
    saveStatus: ""
  });
}

// ---------------- INIT ----------------
render(state);
detectPrimaryAd();
