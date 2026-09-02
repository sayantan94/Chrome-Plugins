(function installVideoDiagnostics() {
  "use strict";

  const MAX_EVENTS = 12;
  const playerEvents = [];
  let widevineProbe;

  function getPrimaryVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.reduce((largest, video) => {
      if (!largest) {
        return video;
      }

      const area = video.clientWidth * video.clientHeight;
      const largestArea = largest.clientWidth * largest.clientHeight;
      return area > largestArea ? video : largest;
    }, null);
  }

  function recordEvent(event) {
    const target = event.target;
    if (!(target instanceof HTMLVideoElement)) {
      return;
    }

    playerEvents.push({
      name: event.type,
      at: Date.now()
    });

    if (playerEvents.length > MAX_EVENTS) {
      playerEvents.splice(0, playerEvents.length - MAX_EVENTS);
    }
  }

  function readPageError() {
    const selectors = [
      '[data-uia="error-message-container"]',
      '[data-uia="error-message"]',
      '[data-uia="error-code"]',
      ".error-title",
      ".error-message"
    ];

    const messages = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .map((element) => element.textContent.trim())
      .filter(Boolean);

    return Array.from(new Set(messages)).join(" · ").slice(0, 500) || null;
  }

  function readPlaybackQuality(video) {
    if (!video || typeof video.getVideoPlaybackQuality !== "function") {
      return null;
    }

    const quality = video.getVideoPlaybackQuality();
    return {
      droppedFrames: quality.droppedVideoFrames,
      totalFrames: quality.totalVideoFrames
    };
  }

  function describeVideo(video) {
    if (!video) {
      return null;
    }

    return {
      currentTime: Number.isFinite(video.currentTime) ? Math.round(video.currentTime) : null,
      duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
      ended: video.ended,
      error: video.error ? {
        code: video.error.code,
        message: video.error.message || null
      } : null,
      hasMediaKeys: Boolean(video.mediaKeys),
      muted: video.muted,
      networkState: video.networkState,
      paused: video.paused,
      playbackQuality: readPlaybackQuality(video),
      readyState: video.readyState,
      size: {
        height: video.videoHeight,
        width: video.videoWidth
      }
    };
  }

  async function probeWidevine() {
    if (widevineProbe) {
      return widevineProbe;
    }

    widevineProbe = (async () => {
      if (typeof navigator.requestMediaKeySystemAccess !== "function") {
        return {
          available: false,
          reason: "Encrypted Media Extensions are unavailable in this Chrome profile."
        };
      }

      const configurations = [{
        initDataTypes: ["cenc"],
        audioCapabilities: [{
          contentType: 'audio/mp4; codecs="mp4a.40.2"'
        }],
        videoCapabilities: [{
          contentType: 'video/mp4; codecs="avc1.42E01E"'
        }],
        distinctiveIdentifier: "optional",
        persistentState: "optional",
        sessionTypes: ["temporary"]
      }];

      try {
        const access = await navigator.requestMediaKeySystemAccess(
          "com.widevine.alpha",
          configurations
        );
        const configuration = access.getConfiguration();
        return {
          available: true,
          keySystem: access.keySystem,
          persistentState: configuration.persistentState
        };
      } catch (error) {
        return {
          available: false,
          reason: error instanceof Error ? error.message : "Widevine was rejected by Chrome."
        };
      }
    })();

    return widevineProbe;
  }

  async function collectStatus() {
    const video = getPrimaryVideo();
    return {
      drm: video && video.mediaKeys
        ? await probeWidevine()
        : { available: null, reason: null },
      events: playerEvents.slice(-6),
      pageError: readPageError(),
      page: {
        fullscreen: Boolean(document.fullscreenElement),
        hidden: document.hidden,
        title: document.title
      },
      screen: {
        colorDepth: window.screen.colorDepth,
        height: window.screen.height,
        isExtended: "isExtended" in window.screen ? window.screen.isExtended : null,
        pixelRatio: window.devicePixelRatio,
        width: window.screen.width
      },
      compositorFallback: Boolean(video && video.dataset.dvfCompositorFallback === "active"),
      video: describeVideo(video)
    };
  }

  const observedEvents = [
    "abort",
    "canplay",
    "encrypted",
    "error",
    "loadeddata",
    "playing",
    "stalled",
    "waiting"
  ];

  for (const eventName of observedEvents) {
    document.addEventListener(eventName, recordEvent, true);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "GET_PLAYER_STATUS") {
      collectStatus()
        .then((status) => sendResponse({ ok: true, status }))
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to inspect the player."
        }));
      return true;
    }

    if (message && message.type === "PREPARE_DISPLAY_RESTART") {
      const video = getPrimaryVideo();
      const snapshot = describeVideo(video);
      if (video && !video.paused) {
        video.pause();
      }
      sendResponse({ ok: true, snapshot });
      return false;
    }

    return false;
  });
})();
