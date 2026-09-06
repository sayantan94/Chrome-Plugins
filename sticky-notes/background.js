/**
 * Service worker: context menu, keyboard shortcut, and the per-tab badge
 * that shows how many notes are pinned to the page you're looking at.
 */
importScripts("notes-store.js");

const store = globalThis.StickyNotesStore;
const MENU_ID = "sticky-notes-add";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add sticky note here",
    contexts: ["page", "selection", "frame", "link", "image"]
  });
  chrome.action.setBadgeBackgroundColor({ color: "#3b3200" });
  chrome.action.setBadgeTextColor?.({ color: "#fff59d" });
});

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  const text = typeof info.selectionText === "string" ? info.selectionText.trim() : "";
  sendToTab(tab.id, { type: "ADD_NOTE", source: "contextmenu", text });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "add-note") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && tab.id != null) sendToTab(tab.id, { type: "ADD_NOTE", source: "shortcut" });
});

// ------------------------------------------------------------------ badge

async function countFor(url) {
  const keys = store.keysFor(url || "");
  if (!keys) return 0;
  const visibleKeys = Object.values(keys);
  const result = await chrome.storage.local.get(visibleKeys);
  return visibleKeys.reduce((count, key) => count + store.normalizeNotes(result[key]).length, 0);
}

async function refreshBadge(tabId, url) {
  const count = await countFor(url);
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") refreshBadge(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) refreshBadge(tabId, tab.url);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const changedKeys = new Set(Object.keys(changes).filter(store.isNoteKey));
  if (changedKeys.size === 0) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null || !tab.url) continue;
    const keys = store.keysFor(tab.url);
    if (keys && Object.values(keys).some((key) => changedKeys.has(key))) {
      refreshBadge(tab.id, tab.url);
    }
  }
});
