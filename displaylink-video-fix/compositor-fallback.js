(function installDisplayLinkCompositorFallback() {
  "use strict";

  const MARKER = "dvfCompositorFallback";
  const observedRoots = new WeakSet();
  let appliedCount = 0;

  function applyToVideo(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return false;
    }

    const alreadyApplied = video.dataset[MARKER] === "active"
      && video.style.getPropertyValue("filter") === "sepia(0%)"
      && video.style.getPropertyValue("opacity") === "0.9999"
      && video.style.getPropertyValue("mix-blend-mode") === "normal";

    if (alreadyApplied) {
      return false;
    }

    // These visually neutral styles prevent a direct video-overlay plane and
    // keep playback in Chromium's page compositor for DisplayLink output.
    video.style.setProperty("filter", "sepia(0%)", "important");
    video.style.setProperty("opacity", "0.9999", "important");
    video.style.setProperty("mix-blend-mode", "normal", "important");
    video.style.setProperty("will-change", "filter, opacity", "important");
    video.dataset[MARKER] = "active";
    appliedCount += 1;

    window.dispatchEvent(new CustomEvent("displaylink-video-fix:compositor-applied", {
      detail: { appliedCount }
    }));
    return true;
  }

  function applyWithin(root) {
    if (!root) {
      return;
    }

    if (root instanceof HTMLVideoElement) {
      applyToVideo(root);
    }

    if (root instanceof Element && root.shadowRoot) {
      observeRoot(root.shadowRoot);
    }

    if (typeof root.querySelectorAll === "function") {
      root.querySelectorAll("video").forEach(applyToVideo);
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) {
          observeRoot(element.shadowRoot);
        }
      });
    }
  }

  function handleMediaEvent(event) {
    applyToVideo(event.target);
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) {
      return;
    }

    observedRoots.add(root);
    applyWithin(root);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          applyToVideo(mutation.target);
          continue;
        }

        mutation.addedNodes.forEach(applyWithin);
      }
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true
    });

    root.addEventListener("loadedmetadata", handleMediaEvent, true);
    root.addEventListener("playing", handleMediaEvent, true);
    root.addEventListener("enterpictureinpicture", handleMediaEvent, true);
  }

  const attachShadowDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "attachShadow"
  );
  const nativeAttachShadow = attachShadowDescriptor.value;
  const observedAttachShadow = new Proxy(nativeAttachShadow, {
    apply(target, thisArgument, argumentsList) {
      const shadowRoot = Reflect.apply(target, thisArgument, argumentsList);
      observeRoot(shadowRoot);
      return shadowRoot;
    }
  });
  Object.defineProperty(Element.prototype, "attachShadow", {
    ...attachShadowDescriptor,
    value: observedAttachShadow
  });

  function start() {
    observeRoot(document);
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("readystatechange", start, { once: true });
  }
})();
