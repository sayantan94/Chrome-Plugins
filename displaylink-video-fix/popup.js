"use strict";

const elements = {
  browserFixButton: document.getElementById("browser-fix-button"),
  displayCount: document.getElementById("display-count"),
  displayList: document.getElementById("display-list"),
  displaySection: document.getElementById("display-section"),
  displaylinkWarning: document.getElementById("displaylink-warning"),
  drmValue: document.getElementById("drm-value"),
  moveButton: document.getElementById("move-button"),
  unsupportedPage: document.getElementById("unsupported-page"),
  protectedContentButton: document.getElementById("protected-content-button"),
  reloadButton: document.getElementById("reload-button"),
  statusDetail: document.getElementById("status-detail"),
  statusDot: document.getElementById("status-dot"),
  statusTitle: document.getElementById("status-title"),
  updateButton: document.getElementById("update-button"),
  videoValue: document.getElementById("video-value")
};

let activeTab = null;
let selectedDisplayId = null;

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function setStatus(kind, title, detail) {
  elements.statusDot.className = `status-dot status-dot--${kind}`;
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
}

function formatResolution(display) {
  const bounds = display.bounds || {};
  const scale = Number.isFinite(display.dpiX) && display.dpiX > 0
    ? ` · ${Math.round(display.dpiX)} dpi`
    : "";
  return `${bounds.width || "?"} × ${bounds.height || "?"}${scale}`;
}

function makeBadge(text) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = text;
  return badge;
}

function renderDisplays(displays, browserWindow, preferredDisplayId) {
  elements.displayList.replaceChildren();
  elements.displayCount.textContent = `${displays.length} connected`;
  elements.displaylinkWarning.hidden = displays.length < 3;

  const currentDisplay = DisplayFixUtils.findBestDisplay(browserWindow, displays);
  const connectedPreferred = displays.find(
    (display) => String(display.id) === String(preferredDisplayId)
  );
  const initialDisplay = connectedPreferred || currentDisplay || displays[0];
  selectedDisplayId = String(initialDisplay.id);

  displays.forEach((display, index) => {
    const label = document.createElement("label");
    label.className = "display-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "display";
    radio.value = String(display.id);
    radio.checked = String(display.id) === selectedDisplayId;
    radio.addEventListener("change", () => {
      selectedDisplayId = radio.value;
    });

    const copy = document.createElement("span");
    copy.className = "display-copy";

    const name = document.createElement("span");
    name.className = "display-name";
    name.textContent = DisplayFixUtils.labelDisplay(display, index);

    const meta = document.createElement("span");
    meta.className = "display-meta";
    meta.textContent = formatResolution(display);

    copy.append(name, meta);
    label.append(radio, copy);

    if (currentDisplay && String(currentDisplay.id) === String(display.id)) {
      label.append(makeBadge("Current"));
    } else if (display.isPrimary) {
      label.append(makeBadge("Primary"));
    }

    elements.displayList.append(label);
  });
}

function summarizePlayer(response) {
  if (!response || !response.ok) {
    elements.drmValue.textContent = "Unknown";
    elements.videoValue.textContent = "Not found";
    setStatus(
      "warning",
      "Video page is open",
      "Player still loading."
    );
    return;
  }

  const { compositorFallback, drm, pageError, video } = response.status;
  elements.drmValue.textContent = drm && drm.available === true
    ? "Available"
    : drm && drm.available === false ? "Unavailable" : "Not used";

  if (pageError) {
    elements.videoValue.textContent = "Blocked";
    setStatus("error", "Playback error", pageError);
    return;
  }

  if (video && video.error) {
    elements.videoValue.textContent = `Error ${video.error.code}`;
    setStatus(
      "error",
      "Video error",
      video.error.message || "Retry on this display."
    );
    return;
  }

  if (video && video.hasMediaKeys && (!drm || drm.available === false)) {
    elements.videoValue.textContent = video ? "Detected" : "Not found";
    setStatus(
      "error",
      "Protected playback unavailable",
      "Update Chrome or check content settings."
    );
    return;
  }

  if (!video) {
    elements.videoValue.textContent = "Loading";
    setStatus("warning", "Player loading", "Try again shortly.");
    return;
  }

  const hasDimensions = video.size && video.size.width > 0 && video.size.height > 0;
  elements.videoValue.textContent = hasDimensions
    ? `${video.size.width}×${video.size.height}`
    : "Detected";

  if (!video.paused && video.readyState >= 3) {
    setStatus(
      "ready",
      compositorFallback ? "Browser fix active" : "Playback active",
      compositorFallback
        ? "Compositing video for DisplayLink."
        : "If black, move and retry below."
    );
  } else {
    setStatus(
      "warning",
      "Ready to retry",
      "Choose a monitor."
    );
  }
}

async function sendRuntimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "The action failed.");
  }
  return response;
}

async function initialize() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;

  if (!activeTab || !isWebUrl(activeTab.url)) {
    elements.displaySection.hidden = true;
    elements.unsupportedPage.hidden = false;
    elements.reloadButton.disabled = true;
    elements.drmValue.textContent = "—";
    elements.videoValue.textContent = "—";
    setStatus("warning", "Open a video page", "This tab cannot be modified.");
    return;
  }

  const [displays, browserWindow, stored, playerResponse] = await Promise.all([
    chrome.system.display.getInfo(),
    chrome.windows.get(activeTab.windowId),
    chrome.storage.local.get("preferredDisplayId"),
    chrome.tabs.sendMessage(activeTab.id, { type: "GET_PLAYER_STATUS" }).catch(() => null)
  ]);

  elements.unsupportedPage.hidden = true;
  elements.displaySection.hidden = false;
  renderDisplays(displays, browserWindow, stored.preferredDisplayId);
  summarizePlayer(playerResponse);
}

elements.moveButton.addEventListener("click", async () => {
  if (!activeTab || !selectedDisplayId) {
    return;
  }

  elements.moveButton.disabled = true;
  elements.moveButton.querySelector("span").textContent = "Moving Chrome…";
  setStatus("checking", "Moving Chrome…", "Reloading video.");

  try {
    await sendRuntimeMessage({
      type: "MOVE_AND_RESTART",
      tabId: activeTab.id,
      displayId: selectedDisplayId
    });
    window.close();
  } catch (error) {
    elements.moveButton.disabled = false;
    elements.moveButton.querySelector("span").textContent = "Move & retry";
    setStatus("error", "Could not move the window", error.message);
  }
});

elements.reloadButton.addEventListener("click", async () => {
  if (!activeTab) {
    return;
  }

  elements.reloadButton.disabled = true;
  try {
    await sendRuntimeMessage({ type: "RELOAD_PLAYER", tabId: activeTab.id });
    window.close();
  } catch (error) {
    elements.reloadButton.disabled = false;
    setStatus("error", "Could not reload video", error.message);
  }
});

elements.protectedContentButton.addEventListener("click", async () => {
  try {
    await sendRuntimeMessage({
      type: "OPEN_CHROME_SETTINGS",
      path: "content/protectedContent"
    });
  } catch (error) {
    setStatus("error", "Could not open Chrome settings", error.message);
  }
});

elements.updateButton.addEventListener("click", async () => {
  try {
    await sendRuntimeMessage({ type: "OPEN_CHROME_SETTINGS", path: "help" });
  } catch (error) {
    setStatus("error", "Could not open Chrome updates", error.message);
  }
});

elements.browserFixButton.addEventListener("click", async () => {
  if (!activeTab) {
    return;
  }

  try {
    await sendRuntimeMessage({ type: "RELOAD_PLAYER", tabId: activeTab.id });
    window.close();
  } catch (error) {
    setStatus("error", "Could not reload video", error.message);
  }
});

initialize().catch((error) => {
  elements.drmValue.textContent = "Unknown";
  elements.videoValue.textContent = "Unknown";
  setStatus("error", "The helper could not start", error.message);
});
