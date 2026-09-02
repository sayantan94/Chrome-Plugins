"use strict";

importScripts("display-utils.js");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function requireWebTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Open a video page and try again.");
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !isWebUrl(tab.url)) {
    throw new Error("This action only works on a web page.");
  }

  return tab;
}

async function preparePlayer(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "PREPARE_DISPLAY_RESTART" });
  } catch {
    return null;
  }
}

async function moveAndRestart(tabId, displayId) {
  const tab = await requireWebTab(tabId);
  const displays = await chrome.system.display.getInfo();
  const target = displays.find((display) => String(display.id) === String(displayId));

  if (!target) {
    throw new Error("That display is no longer connected.");
  }

  const browserWindow = await chrome.windows.get(tab.windowId);
  await preparePlayer(tab.id);

  if (browserWindow.state === "fullscreen" || browserWindow.state === "maximized") {
    await chrome.windows.update(browserWindow.id, { state: "normal" });
    await delay(300);
  }

  const bounds = DisplayFixUtils.getSafeWindowBounds(target);
  await chrome.windows.update(browserWindow.id, bounds);
  await delay(700);
  await chrome.tabs.reload(tab.id, { bypassCache: false });

  await chrome.storage.local.set({ preferredDisplayId: String(target.id) });

  return {
    ok: true,
    displayId: String(target.id),
    displayName: DisplayFixUtils.labelDisplay(target, displays.indexOf(target))
  };
}

async function reloadPlayer(tabId) {
  const tab = await requireWebTab(tabId);
  await preparePlayer(tab.id);
  await chrome.tabs.reload(tab.id, { bypassCache: false });
  return { ok: true };
}

async function openChromeSettings(path) {
  const allowedPaths = new Set([
    "content/protectedContent",
    "help",
    "system"
  ]);

  if (!allowedPaths.has(path)) {
    throw new Error("Unsupported Chrome settings page.");
  }

  await chrome.tabs.create({ url: `chrome://settings/${path}` });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    MOVE_AND_RESTART: () => moveAndRestart(message.tabId, message.displayId),
    RELOAD_PLAYER: () => reloadPlayer(message.tabId),
    OPEN_CHROME_SETTINGS: () => openChromeSettings(message.path)
  };

  const handler = handlers[message && message.type];
  if (!handler) {
    return false;
  }

  handler()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "The action failed."
    }));

  return true;
});
