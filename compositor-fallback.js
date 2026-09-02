(function installCompositorFallback() {
  "use strict";

  const MARKER = "ndhCompositorFallback";
  let appliedCount = 0;

  function applyToVideo(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return false;
    }

    const alreadyApplied = video.dataset[MARKER] === "active"
      && video.style.getPropertyValue("filter") === "sepia(0%)"
      && video.style.getPropertyValue("opacity") === "0.9999";

    if (alreadyApplied) {
      return false;
    }

    // A no-op filter plus fractional opacity keeps the video visually unchanged,
    // but asks Chromium to composite it with the page instead of using a direct
    // hardware-overlay plane that DisplayLink cannot present on macOS.
    video.style.setProperty("filter", "sepia(0%)", "important");
    video.style.setProperty("opacity", "0.9999", "important");
    video.style.setProperty("mix-blend-mode", "normal", "important");
    video.style.setProperty("will-change", "filter, opacity", "important");
    video.dataset[MARKER] = "active";
    appliedCount += 1;

    window.dispatchEvent(new CustomEvent("netflix-display-helper:compositor-applied", {
      detail: { appliedCount }
    }));
    return true;
  }

  function applyWithin(root) {
    if (root instanceof HTMLVideoElement) {
      applyToVideo(root);
    }

    if (root && typeof root.querySelectorAll === "function") {
      root.querySelectorAll("video").forEach(applyToVideo);
    }
  }

  function start() {
    applyWithin(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(applyWithin);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener("loadedmetadata", (event) => {
      applyToVideo(event.target);
    }, true);
    document.addEventListener("playing", (event) => {
      applyToVideo(event.target);
    }, true);
    document.addEventListener("enterpictureinpicture", (event) => {
      applyToVideo(event.target);
    }, true);
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("readystatechange", start, { once: true });
  }
})();
