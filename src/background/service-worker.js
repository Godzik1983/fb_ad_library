import { MESSAGE_TYPES } from "../shared/messages.js";

const WELCOME_URL = "https://godzik1983.github.io/fb_ad_library/welcome/";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;

  chrome.tabs.create({ url: WELCOME_URL }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab?.id !== "number") return;

  chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.OPEN_LIBRARY }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPES.DETECT_PRIMARY_AD) {
    return undefined;
  }

  const tabId = sender?.tab?.id;
  if (typeof tabId === "number") {
    chrome.tabs
      .sendMessage(tabId, message)
      .then((response) => {
        sendResponse(response);
      })
      .catch(() => {
        sendResponse({
          type: MESSAGE_TYPES.PRIMARY_AD_RESULT,
          ok: false,
          error: "content_script_not_ready"
        });
      });
    return true;
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTabId = tabs[0]?.id;
    if (typeof activeTabId !== "number") {
      sendResponse({
        type: MESSAGE_TYPES.PRIMARY_AD_RESULT,
        ok: false,
        error: "active_tab_not_found"
      });
      return;
    }

    chrome.tabs
      .sendMessage(activeTabId, message)
      .then((response) => {
        sendResponse(response);
      })
      .catch(() => {
        sendResponse({
          type: MESSAGE_TYPES.PRIMARY_AD_RESULT,
          ok: false,
          error: "content_script_not_ready"
        });
      });
  });

  return true;
});
