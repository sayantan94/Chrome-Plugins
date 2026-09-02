(function exposeDisplayUtils(root) {
  "use strict";

  function asNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeRect(rect = {}) {
    return {
      left: asNumber(rect.left),
      top: asNumber(rect.top),
      width: Math.max(0, asNumber(rect.width)),
      height: Math.max(0, asNumber(rect.height))
    };
  }

  function intersectionArea(firstRect, secondRect) {
    const first = normalizeRect(firstRect);
    const second = normalizeRect(secondRect);
    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    const right = Math.min(first.left + first.width, second.left + second.width);
    const bottom = Math.min(first.top + first.height, second.top + second.height);

    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function findBestDisplay(windowBounds, displays = []) {
    if (!Array.isArray(displays) || displays.length === 0) {
      return null;
    }

    let bestDisplay = displays[0];
    let bestArea = -1;

    for (const display of displays) {
      const area = intersectionArea(windowBounds, display.bounds);
      if (area > bestArea) {
        bestDisplay = display;
        bestArea = area;
      }
    }

    if (bestArea === 0) {
      return displays.find((display) => display.isPrimary) || displays[0];
    }

    return bestDisplay;
  }

  function getSafeWindowBounds(display, margin = 16) {
    if (!display) {
      throw new TypeError("A target display is required.");
    }

    const workArea = normalizeRect(display.workArea || display.bounds);
    const safeMargin = Math.max(0, Math.floor(asNumber(margin)));
    const horizontalMargin = Math.min(safeMargin, Math.floor(workArea.width / 4));
    const verticalMargin = Math.min(safeMargin, Math.floor(workArea.height / 4));

    return {
      left: Math.round(workArea.left + horizontalMargin),
      top: Math.round(workArea.top + verticalMargin),
      width: Math.max(320, Math.round(workArea.width - horizontalMargin * 2)),
      height: Math.max(240, Math.round(workArea.height - verticalMargin * 2))
    };
  }

  function labelDisplay(display, index) {
    if (display && typeof display.name === "string" && display.name.trim()) {
      return display.name.trim();
    }

    return `Display ${index + 1}`;
  }

  const api = {
    findBestDisplay,
    getSafeWindowBounds,
    intersectionArea,
    labelDisplay,
    normalizeRect
  };

  root.NetflixDisplayUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
