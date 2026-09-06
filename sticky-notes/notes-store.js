/**
 * Pure note/storage helpers shared by the content script, popup, and
 * service worker. No DOM or chrome.* access here so the module can be
 * unit tested in Node.
 */
(function attachNotesStore(root) {
  "use strict";

  const STORAGE_PREFIX = "notes:"; // one page
  const SITE_PREFIX = "site:"; // every page on one host (subdomains are distinct)
  const SCOPES = ["page", "site"];
  const DEFAULT_SCOPE = "page";
  const NOTE_DEFAULT_WIDTH = 250;
  const NOTE_DEFAULT_HEIGHT = 170;
  const NOTE_MIN_WIDTH = 140;
  const NOTE_MIN_HEIGHT = 90;
  const NOTE_MAX_SIZE = 2000;
  const MAX_TEXT_LENGTH = 20000;

  // macOS Stickies palette: body, the darker strip on top, and the ink.
  const COLORS = {
    yellow: { bg: "#fff49a", header: "#f4e476", ink: "#24231e", label: "Yellow" },
    blue: { bg: "#c9e5f8", header: "#aad2ec", ink: "#1f2529", label: "Blue" },
    green: { bg: "#d4edb3", header: "#bbd995", ink: "#22271e", label: "Green" },
    pink: { bg: "#f3ccd9", header: "#deaebf", ink: "#292125", label: "Pink" },
    purple: { bg: "#ddd0ec", header: "#c5b3d9", ink: "#27222b", label: "Purple" },
    gray: { bg: "#e2e2df", header: "#ccccca", ink: "#242424", label: "Gray" }
  };
  const COLOR_NAMES = Object.keys(COLORS);
  const DEFAULT_COLOR = "yellow";

  // Query params that identify a marketing campaign, not a page.
  const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref_src|yclid)$/i;

  /**
   * Stable identity for a page. Strips the hash, tracking params, default
   * ports, trailing slashes and lowercases the host so a revisit through a
   * slightly different link still finds the same notes.
   */
  function pageKey(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const params = new URLSearchParams(parsed.search);
    for (const name of Array.from(params.keys())) {
      if (TRACKING_PARAMS.test(name)) params.delete(name);
    }
    const search = params.toString();

    let pathname = parsed.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${search ? `?${search}` : ""}`;
  }

  function storageKey(url) {
    const key = pageKey(url);
    return key ? STORAGE_PREFIX + key : null;
  }

  function isStorageKey(key) {
    return typeof key === "string" && key.startsWith(STORAGE_PREFIX);
  }

  function urlFromStorageKey(key) {
    if (typeof key !== "string") return null;
    if (key.startsWith(STORAGE_PREFIX)) return key.slice(STORAGE_PREFIX.length);
    if (key.startsWith(SITE_PREFIX)) return `${key.slice(SITE_PREFIX.length)}/`;
    return null;
  }

  /** Origin of the page, lowercased. mail.example.com and example.com differ. */
  function siteOf(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
  }

  function siteStorageKey(url) {
    const site = siteOf(url);
    return site ? SITE_PREFIX + site : null;
  }

  function isSiteKey(key) {
    return typeof key === "string" && key.startsWith(SITE_PREFIX);
  }

  function isNoteKey(key) {
    return isStorageKey(key) || isSiteKey(key);
  }

  /** Both keys a page reads from: its own notes and its site's notes. */
  function keysFor(url) {
    const page = storageKey(url);
    if (!page) return null;
    return { page, site: siteStorageKey(url) };
  }

  function keyForScope(keys, scope) {
    return scope === "site" ? keys.site : keys.page;
  }

  /** Describe a storage key: scope, the url to open, and the host to group by. */
  function parseStorageKey(key) {
    if (isStorageKey(key)) {
      const url = key.slice(STORAGE_PREFIX.length);
      return { key, scope: "page", url, host: hostOf(url), path: pathOf(url) };
    }
    if (isSiteKey(key)) {
      const site = key.slice(SITE_PREFIX.length);
      return { key, scope: "site", url: `${site}/`, host: hostOf(site), path: "" };
    }
    return null;
  }

  function hostOf(url) {
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      return "";
    }
  }

  function pathOf(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return "";
    }
  }

  function generateId() {
    const cryptoApi = root.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }
    return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalizeColor(color) {
    return COLOR_NAMES.includes(color) ? color : DEFAULT_COLOR;
  }

  function normalizeScope(scope) {
    return SCOPES.includes(scope) ? scope : DEFAULT_SCOPE;
  }

  /**
   * Coerce anything read from storage into a well-formed note so a corrupt
   * or older record can't break rendering.
   */
  function normalizeNote(raw, now = Date.now()) {
    const source = raw && typeof raw === "object" ? raw : {};
    const text = typeof source.text === "string" ? source.text.slice(0, MAX_TEXT_LENGTH) : "";
    const createdAt = clampNumber(source.createdAt, 0, Number.MAX_SAFE_INTEGER, now);
    return {
      id: typeof source.id === "string" && source.id ? source.id : generateId(),
      x: clampNumber(source.x, 0, Number.MAX_SAFE_INTEGER, 0),
      y: clampNumber(source.y, 0, Number.MAX_SAFE_INTEGER, 0),
      width: clampNumber(source.width, NOTE_MIN_WIDTH, NOTE_MAX_SIZE, NOTE_DEFAULT_WIDTH),
      height: clampNumber(source.height, NOTE_MIN_HEIGHT, NOTE_MAX_SIZE, NOTE_DEFAULT_HEIGHT),
      text,
      color: normalizeColor(source.color),
      scope: normalizeScope(source.scope),
      collapsed: source.collapsed === true,
      createdAt,
      updatedAt: clampNumber(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, createdAt)
    };
  }

  function createNote(overrides = {}, now = Date.now()) {
    return normalizeNote({ createdAt: now, updatedAt: now, ...overrides }, now);
  }

  function normalizeNotes(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const notes = [];
    for (const raw of list) {
      const note = normalizeNote(raw);
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      notes.push(note);
    }
    return notes;
  }

  function upsertNote(list, note) {
    const next = normalizeNotes(list);
    const normalized = normalizeNote(note);
    const index = next.findIndex((item) => item.id === normalized.id);
    if (index === -1) next.push(normalized);
    else next[index] = normalized;
    return next;
  }

  function removeNote(list, id) {
    return normalizeNotes(list).filter((note) => note.id !== id);
  }

  /**
   * Every note in storage as a flat list with where it lives, newest first.
   * Each entry: { key, scope, url, host, path, note }.
   */
  function listAllNotes(storageSnapshot) {
    const entries = [];
    for (const [key, value] of Object.entries(storageSnapshot || {})) {
      const where = parseStorageKey(key);
      if (!where) continue;
      for (const note of normalizeNotes(value)) {
        entries.push({ ...where, note: { ...note, scope: where.scope } });
      }
    }
    return entries.sort((a, b) => b.note.updatedAt - a.note.updatedAt);
  }

  /** Hosts with notes, most recently touched first: [{ host, count, updatedAt }]. */
  function summarizeHosts(entries) {
    const byHost = new Map();
    for (const entry of entries) {
      const current = byHost.get(entry.host) || { host: entry.host, count: 0, updatedAt: 0 };
      current.count += 1;
      current.updatedAt = Math.max(current.updatedAt, entry.note.updatedAt);
      byHost.set(entry.host, current);
    }
    return Array.from(byHost.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Summaries of every page that has notes, for an index. */
  function summarizePages(storageSnapshot) {
    const pages = new Map();
    for (const entry of listAllNotes(storageSnapshot)) {
      const current = pages.get(entry.key) || { key: entry.key, url: entry.url, count: 0, updatedAt: 0 };
      current.count += 1;
      current.updatedAt = Math.max(current.updatedAt, entry.note.updatedAt);
      pages.set(entry.key, current);
    }
    return Array.from(pages.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function relativeTime(timestamp, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
    const months = Math.round(days / 30);
    if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
    const years = Math.round(months / 12);
    return years === 1 ? "1 year ago" : `${years} years ago`;
  }

  function previewText(text, limit = 60) {
    const single = String(text || "").replace(/\s+/g, " ").trim();
    if (!single) return "";
    return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
  }

  const api = {
    STORAGE_PREFIX,
    SITE_PREFIX,
    SCOPES,
    DEFAULT_SCOPE,
    COLORS,
    COLOR_NAMES,
    DEFAULT_COLOR,
    NOTE_DEFAULT_WIDTH,
    NOTE_DEFAULT_HEIGHT,
    NOTE_MIN_WIDTH,
    NOTE_MIN_HEIGHT,
    pageKey,
    storageKey,
    siteOf,
    siteStorageKey,
    keysFor,
    keyForScope,
    isStorageKey,
    isSiteKey,
    isNoteKey,
    urlFromStorageKey,
    parseStorageKey,
    hostOf,
    pathOf,
    generateId,
    normalizeNote,
    normalizeNotes,
    createNote,
    upsertNote,
    removeNote,
    listAllNotes,
    summarizeHosts,
    summarizePages,
    relativeTime,
    previewText
  };

  root.StickyNotesStore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
