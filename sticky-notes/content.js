/**
 * Renders sticky notes for the current page inside a Shadow DOM overlay,
 * persists every change to chrome.storage.local, and keeps tabs in sync.
 *
 * A page reads three storage keys: its exact URL ("notes:<page>"), its path
 * regardless of query params ("path:<page>"), and its site ("site:<origin>").
 * Each note carries a `scope`; changing it moves the note between those keys.
 */
(function stickyNotesContent() {
  "use strict";

  if (window.top !== window) return;
  if (window.__stickyNotesLoaded) return;
  window.__stickyNotesLoaded = true;

  const store = globalThis.StickyNotesStore;
  if (!store) return;

  const SAVE_DEBOUNCE_MS = 350;
  const URL_POLL_MS = 750;
  const CONTEXT_CLICK_TTL_MS = 8000;
  const HOST_ID = "sticky-notes-host";
  const Z_TOP = 2147483646;

  let currentKeys = null; // { page, path, site }
  let notes = [];
  const lastWritten = new Map(); // storage key -> JSON we last wrote
  let zCounter = 1;
  let urlTimer = null;
  let lastContextClick = null;
  const elements = new Map(); // note id -> element bundle
  const pendingSaves = new Map(); // note id -> timeout

  function alive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function siteLabel() {
    return currentKeys ? store.hostOf(store.urlFromStorageKey(currentKeys.site)) : "this site";
  }

  // ---------------------------------------------------------------- shadow

  const CHEVRON_DOWN =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23000' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

  function buildStyles() {
    const colorRules = store.COLOR_NAMES.map((name) => {
      const c = store.COLORS[name];
      return `.note[data-color="${name}"]{--paper:${c.bg};--strip:${c.header};--ink:${c.ink}}
.menu-swatch[data-color="${name}"]{background:${c.bg};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.25)}`;
    }).join("\n");

    return `
:host { all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: ${Z_TOP}; pointer-events: none; }
*, *::before, *::after { box-sizing: border-box; }
.layer { position: absolute; top: 0; left: 0; width: 0; height: 0; }

.note {
  --paper: #fff49a; --strip: #f4e476; --ink: #24231e;
  --accent: #007aff;
  position: absolute;
  display: flex;
  flex-direction: column;
  min-width: ${store.NOTE_MIN_WIDTH}px;
  min-height: ${store.NOTE_MIN_HEIGHT}px;
  color: var(--ink);
  font: 400 13px/17px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: var(--paper);
  border-radius: 6px;
  box-shadow:
    0 0 0 .5px rgba(0, 0, 0, .22),
    0 1px 2px rgba(0, 0, 0, .12),
    0 8px 24px rgba(0, 0, 0, .18);
  resize: both;
  overflow: hidden;
  pointer-events: auto;
}
.note::-webkit-resizer { background: transparent; }
.resize-handle {
  position: absolute;
  right: 0; bottom: 0;
  width: 18px; height: 18px;
  cursor: nwse-resize;
  opacity: .45;
  background: linear-gradient(135deg, transparent 52%, rgba(0,0,0,.28) 53% 58%, transparent 59% 66%, rgba(0,0,0,.28) 67% 72%, transparent 73%);
  pointer-events: none;
}
.note:hover .resize-handle { opacity: .7; }
.note.is-collapsed .resize-handle { display: none; }
@media (prefers-reduced-motion: no-preference) {
  .note.is-new { animation: appear 180ms cubic-bezier(.2,.8,.2,1); }
  .note.is-flash { animation: flash 900ms ease-out; }
}
@keyframes appear { from { transform: scale(.96); opacity: .4; } }
@keyframes flash { 0%, 40% { box-shadow: 0 0 0 3px var(--accent), 0 8px 24px rgba(0,0,0,.18); } 100% { box-shadow: 0 0 0 .5px rgba(0,0,0,.22), 0 8px 24px rgba(0,0,0,.18); } }

.note.is-dragging { box-shadow: 0 0 0 .5px rgba(0,0,0,.24), 0 3px 8px rgba(0,0,0,.15), 0 16px 36px rgba(0,0,0,.24); }
.note.is-collapsed { resize: none; min-height: 0; height: auto !important; }
.note.is-collapsed .body, .note.is-collapsed .foot { display: none; }
.note.is-collapsed .peek { display: block; }

/* Title bar: darker tint of the paper. Drag here. */
.head {
  position: relative;
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 3px;
  background: var(--strip);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.note.is-dragging .head { cursor: grabbing; }
.head .spacer { flex: 1; }
.ctl {
  display: inline-grid;
  place-items: center;
  width: 22px; height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink);
  cursor: default;
  opacity: .48;
  transition: opacity 120ms ease, background-color 120ms ease;
}
.note:hover .ctl, .note:focus-within .ctl { opacity: .78; }
.ctl:hover, .ctl:focus-visible, .ctl[aria-expanded="true"] { opacity: 1; background: rgba(0,0,0,.09); }
.ctl:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
.ctl svg { width: 12px; height: 12px; display: block; }
@media (prefers-reduced-motion: reduce) { .ctl { transition: none; } }

.dot {
  width: 12px; height: 12px;
  border-radius: 2px;
  background: var(--paper);
  box-shadow: 0 0 0 .5px rgba(0,0,0,.4), inset 0 0 0 .5px rgba(255,255,255,.6);
}

/* Colour menu: a macOS menu. */
.menuwrap { position: relative; display: flex; }
.menu {
  --accent: #007aff;
  position: absolute;
  display: none;
  pointer-events: auto;
  min-width: 154px;
  padding: 4px;
  border-radius: 6px;
  background: rgba(246, 246, 246, 0.94);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  box-shadow: 0 0 0 .5px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.20);
  color: #1d1d1f;
  z-index: 3;
  cursor: default;
  font: 400 13px/22px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.menu.is-open { display: block; }
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 22px;
  padding: 0 8px 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: default;
}
.menu-item:hover, .menu-item:focus-visible { background: var(--accent); color: #fff; outline: 0; }
.menu-check { width: 12px; text-align: center; font-size: 11px; visibility: hidden; }
.menu-item[aria-checked="true"] .menu-check { visibility: visible; }
.menu-swatch { width: 12px; height: 12px; border-radius: 2px; }

.body {
  flex: 1;
  width: 100%;
  min-height: 0;
  margin: 0;
  padding: 8px 10px 6px;
  border: 0; outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  resize: none;
  overflow: auto;
  scrollbar-width: thin;
}
.body::placeholder { color: var(--ink); opacity: .38; }

.peek {
  display: none;
  padding: 5px 10px 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: .9;
}

/* Footer: a macOS pop-up button for where the note shows, and a transient save state. */
.foot {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 20px 0 7px;
  white-space: nowrap;
  overflow: hidden;
  user-select: none;
}
.popwrap { position: relative; display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 100%; }
/* Borderless pull-down, like a secondary macOS pop-up: text plus a small chevron. */
.scope {
  height: 20px;
  min-width: 0;
  max-width: 100%;
  padding: 0 16px 0 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 11px;
  font-weight: 500;
  line-height: 20px;
  opacity: .62;
  appearance: none;
  -webkit-appearance: none;
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scope:hover { background: rgba(0,0,0,.07); opacity: .9; }
.scope:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; opacity: 1; }
.popwrap::after {
  content: "";
  position: absolute;
  top: 7px; right: 4px;
  width: 8px; height: 6px;
  background: ${CHEVRON_DOWN} center / 8px 5px no-repeat;
  opacity: .62;
  pointer-events: none;
}
.popwrap:hover::after { opacity: .9; }
.scope-measure {
  position: absolute;
  visibility: hidden;
  white-space: nowrap;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 11px;
  font-weight: 500;
  line-height: 20px;
}
.status { flex: 0 1 auto; min-width: 0; margin-left: auto; padding-left: 8px; font-size: 10.5px; color: rgba(0,0,0,.5); overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity 300ms ease; }
.status.is-visible { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .status { transition: none; } }

/* Undo after delete */
.toast {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 6px 0 12px;
  border-radius: 8px;
  background: rgba(40, 40, 42, .94);
  color: #fff;
  font: 400 12px/30px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  box-shadow: 0 0 0 .5px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25);
  pointer-events: auto;
  white-space: nowrap;
}
.toast button {
  height: 20px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: rgba(255,255,255,.14);
  color: #fff;
  font: 600 12px/20px inherit;
  font-family: inherit;
  cursor: default;
}
.toast button:hover { background: rgba(255,255,255,.24); }
.toast button:focus-visible { outline: 2px solid #7fb4ff; }

${colorRules}
`;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = buildStyles();
  const layer = document.createElement("div");
  layer.className = "layer";
  shadow.append(style, layer);
  (document.documentElement || document.body).appendChild(host);

  const ICONS = {
    collapse: '<svg viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.2h8M4.6 3.2V2h2.8v1.2M3 3.2l.6 6.6a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7l.6-6.6M5 5.2v3.3M7 5.2v3.3"/></svg>'
  };

  // -------------------------------------------------------------- storage

  function storageGet(key) {
    return new Promise((resolve) => {
      if (!alive() || !key) return resolve([]);
      chrome.storage.local.get(key, (result) => {
        resolve(store.normalizeNotes(result && result[key]));
      });
    });
  }

  function storageSet(key, list) {
    return new Promise((resolve) => {
      if (!alive() || !key) return resolve();
      const normalized = store.normalizeNotes(list);
      lastWritten.set(key, normalized.length ? JSON.stringify(normalized) : null);
      if (normalized.length === 0) {
        chrome.storage.local.remove(key, () => resolve());
      } else {
        chrome.storage.local.set({ [key]: normalized }, () => resolve());
      }
    });
  }

  function keyFor(note) {
    return currentKeys ? store.keyForScope(currentKeys, note.scope) : null;
  }

  function setSaving(note, saving) {
    const entry = elements.get(note.id);
    if (!entry) return;
    clearTimeout(entry.statusTimer);
    entry.status.textContent = saving ? "Saving…" : "Saved";
    entry.status.title = `Last saved ${store.relativeTime(note.updatedAt)}`;
    entry.status.classList.add("is-visible");
    if (!saving) {
      entry.statusTimer = setTimeout(() => entry.status.classList.remove("is-visible"), 1500);
    }
  }

  /** Read-modify-write so two tabs on the same page never clobber each other. */
  async function commitNote(note) {
    const key = keyFor(note);
    if (!key) return;
    const keysAtStart = currentKeys;
    note.updatedAt = Date.now();
    setSaving(note, true);
    const latest = await storageGet(key);
    if (keysAtStart !== currentKeys) return; // navigated away mid-write
    await storageSet(key, store.upsertNote(latest, note));
    setSaving(note, false);
  }

  async function commitRemoval(note) {
    const key = keyFor(note);
    if (!key) return;
    const keysAtStart = currentKeys;
    const latest = await storageGet(key);
    if (keysAtStart !== currentKeys) return;
    await storageSet(key, store.removeNote(latest, note.id));
  }

  async function changeScope(note, scope) {
    if (note.scope === scope || !currentKeys || !store.keyForScope(currentKeys, scope)) return;
    const from = keyFor(note);
    note.scope = scope;
    const keysAtStart = currentKeys;
    const fromList = await storageGet(from);
    if (keysAtStart !== currentKeys) return;
    await storageSet(from, store.removeNote(fromList, note.id));
    await commitNote(note);
    const entry = elements.get(note.id);
    if (entry) updateElement(entry, note);
  }

  function scheduleSave(note) {
    setSaving(note, true);
    clearTimeout(pendingSaves.get(note.id));
    pendingSaves.set(
      note.id,
      setTimeout(() => {
        pendingSaves.delete(note.id);
        commitNote(note);
      }, SAVE_DEBOUNCE_MS)
    );
  }

  function flushSave(note) {
    if (!pendingSaves.has(note.id)) return;
    clearTimeout(pendingSaves.get(note.id));
    pendingSaves.delete(note.id);
    commitNote(note);
  }

  function flushSaves() {
    for (const id of Array.from(pendingSaves.keys())) {
      const note = notes.find((item) => item.id === id);
      if (note) flushSave(note);
      else pendingSaves.delete(id);
    }
  }

  // ------------------------------------------------------------- rendering

  function render() {
    const seen = new Set();
    for (const note of notes) {
      seen.add(note.id);
      const existing = elements.get(note.id);
      if (existing) updateElement(existing, note);
      else createElement(note);
    }
    for (const [id, entry] of elements) {
      if (!seen.has(id)) {
        entry.observer.disconnect();
        entry.root.remove();
        entry.palette.remove();
        elements.delete(id);
      }
    }
  }

  function iconButton(className, icon, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ctl ${className}`;
    button.innerHTML = icon;
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  }

  function createElement(note, options = {}) {
    const root = document.createElement("div");
    root.className = "note";
    root.dataset.id = note.id;
    root.tabIndex = -1;
    if (options.isNew) root.classList.add("is-new");

    // Strip on top: close on the left, colour menu and collapse on the right.
    const head = document.createElement("div");
    head.className = "head";
    head.title = "Drag to move";

    const deleteBtn = iconButton("deletebtn", ICONS.trash, "Delete Note");
    const spacer = document.createElement("span");
    spacer.className = "spacer";

    const menuwrap = document.createElement("div");
    menuwrap.className = "menuwrap";
    const colorBtn = iconButton("colorbtn", '<span class="dot"></span>', "Color");
    colorBtn.title = "Color";
    colorBtn.setAttribute("aria-haspopup", "menu");
    colorBtn.setAttribute("aria-expanded", "false");
    const palette = document.createElement("div");
    palette.className = "menu";
    palette.setAttribute("role", "menu");
    palette.setAttribute("aria-label", "Color");
    const swatches = [];
    for (const color of store.COLOR_NAMES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      item.dataset.color = color;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", "false");
      const check = document.createElement("span");
      check.className = "menu-check";
      check.textContent = "✓";
      const swatch = document.createElement("span");
      swatch.className = "menu-swatch";
      swatch.dataset.color = color;
      const label = document.createElement("span");
      label.textContent = store.COLORS[color].label;
      item.append(check, swatch, label);
      swatches.push(item);
      palette.appendChild(item);
    }
    menuwrap.append(colorBtn);
    layer.appendChild(palette); // outside the note so it isn't clipped

    const collapseBtn = iconButton("collapsebtn", ICONS.collapse, "Collapse");
    head.append(deleteBtn, spacer, menuwrap, collapseBtn);

    const peek = document.createElement("div");
    peek.className = "peek";

    const textarea = document.createElement("textarea");
    textarea.className = "body";
    textarea.placeholder = "Type a note. Drag the top bar to move it.";
    textarea.spellcheck = true;
    textarea.setAttribute("aria-label", "Sticky note text");

    const foot = document.createElement("div");
    foot.className = "foot";
    const popwrap = document.createElement("span");
    popwrap.className = "popwrap";
    const scope = document.createElement("select");
    scope.className = "scope";
    scope.title = "Show this note on";
    scope.setAttribute("aria-label", "Show this note on");
    const scopeOptions = [
      ["page", "This Exact View", "Includes URL options such as filters and date ranges"],
      ["path", "This Page, Any Filters", "Ignores everything after ? in the URL"],
      ["site", `All of ${siteLabel()}`, `Shows on every page of ${siteLabel()}`]
    ];
    for (const [value, label, title] of scopeOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.title = title;
      scope.appendChild(option);
    }
    const measure = document.createElement("span");
    measure.className = "scope-measure";
    popwrap.append(scope, measure);
    const status = document.createElement("span");
    status.className = "status";
    foot.append(popwrap, status);

    const grip = document.createElement("span");
    grip.className = "resize-handle";
    grip.setAttribute("aria-hidden", "true");

    root.append(head, peek, textarea, foot, grip);
    layer.appendChild(root);

    const entry = {
      root, head, colorBtn, palette, swatches, scope, measure, collapseBtn, deleteBtn,
      peek, textarea, foot, status, statusTimer: null, observer: null
    };
    elements.set(note.id, entry);
    updateElement(entry, note);
    wireInteractions(entry, note);
    bringToFront(root);
    return entry;
  }

  function updateElement(entry, note) {
    const { root, textarea, peek, swatches, scope, measure, collapseBtn, status } = entry;
    root.style.left = `${note.x}px`;
    root.style.top = `${note.y}px`;
    root.style.width = `${note.width}px`;
    root.style.height = note.collapsed ? "" : `${note.height}px`;
    root.dataset.color = note.color;
    root.classList.toggle("is-collapsed", note.collapsed);
    if (shadow.activeElement !== textarea && textarea.value !== note.text) {
      textarea.value = note.text;
    }
    peek.textContent = store.previewText(note.text, 80) || "Empty note";
    for (const swatch of swatches) {
      swatch.setAttribute("aria-checked", swatch.dataset.color === note.color ? "true" : "false");
    }
    scope.value = note.scope;
    measure.textContent = scope.options[scope.selectedIndex]?.textContent || "";
    scope.style.width = `${Math.ceil(measure.getBoundingClientRect().width) + 26}px`;
    collapseBtn.innerHTML = note.collapsed ? ICONS.expand : ICONS.collapse;
    collapseBtn.title = note.collapsed ? "Expand" : "Collapse";
    collapseBtn.setAttribute("aria-label", collapseBtn.title);
    status.title = `Last saved ${store.relativeTime(note.updatedAt)}`;
  }

  function bringToFront(root) {
    zCounter += 1;
    root.style.zIndex = String(zCounter);
  }

  function closePalette(entry) {
    entry.palette.classList.remove("is-open");
    entry.colorBtn.setAttribute("aria-expanded", "false");
  }

  function wireInteractions(entry, note) {
    const { root, head, colorBtn, palette, swatches, scope, textarea, collapseBtn, deleteBtn } = entry;

    root.addEventListener("pointerdown", () => bringToFront(root), true);

    // Colour palette
    colorBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = !palette.classList.contains("is-open");
      for (const other of elements.values()) if (other !== entry) closePalette(other);
      palette.classList.toggle("is-open", open);
      colorBtn.setAttribute("aria-expanded", String(open));
      if (open) {
        palette.style.zIndex = String(zCounter + 1);
        palette.style.left = `${Math.max(0, note.x + note.width - 154 - 4)}px`;
        palette.style.top = `${note.y + 24}px`;
        palette.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
      }
    });
    palette.addEventListener("keydown", (event) => {
      const items = swatches;
      const index = items.indexOf(shadow.activeElement);
      let next = null;
      if (event.key === "ArrowDown") next = items[(index + 1) % items.length];
      else if (event.key === "ArrowUp") next = items[(index - 1 + items.length) % items.length];
      else if (event.key === "Home") next = items[0];
      else if (event.key === "End") next = items[items.length - 1];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    });
    for (const swatch of swatches) {
      swatch.addEventListener("click", (event) => {
        event.stopPropagation();
        note.color = swatch.dataset.color;
        closePalette(entry);
        updateElement(entry, note);
        commitNote(note);
      });
    }

    // Where it's saved
    scope.addEventListener("change", () => changeScope(note, scope.value));
    scope.addEventListener("pointerdown", (event) => event.stopPropagation());

    // Text
    textarea.addEventListener("input", () => {
      note.text = textarea.value;
      entry.peek.textContent = store.previewText(note.text, 80) || "Empty note";
      scheduleSave(note);
    });
    textarea.addEventListener("blur", () => flushSave(note));
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") textarea.blur();
      event.stopPropagation(); // keep the page's shortcuts quiet while typing
    });
    for (const type of ["keyup", "keypress"]) {
      textarea.addEventListener(type, (event) => event.stopPropagation());
    }

    collapseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      note.collapsed = !note.collapsed;
      updateElement(entry, note);
      commitNote(note);
    });

    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteWithUndo(note);
    });

    // Drag by the header (but not by its controls).
    head.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, select, .menu")) return;
      startDrag(event, entry, note);
    });

    // Persist manual resizes (native CSS resize handle).
    let lastSize = { width: note.width, height: note.height };
    entry.observer = new ResizeObserver(() => {
      if (note.collapsed) return;
      const width = Math.round(root.offsetWidth);
      const height = Math.round(root.offsetHeight);
      if (width === lastSize.width && height === lastSize.height) return;
      lastSize = { width, height };
      if (width === note.width && height === note.height) return;
      note.width = width;
      note.height = height;
      scheduleSave(note);
    });
    entry.observer.observe(root);
  }

  shadow.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const entry of elements.values()) {
      if (entry.palette.classList.contains("is-open")) {
        closePalette(entry);
        entry.colorBtn.focus();
      }
    }
  });

  // Close any open colour menu when pointing anywhere outside it (page or overlay).
  document.addEventListener(
    "pointerdown",
    (event) => {
      const path = event.composedPath();
      for (const entry of elements.values()) {
        if (!entry.palette.classList.contains("is-open")) continue;
        if (path.includes(entry.palette) || path.includes(entry.colorBtn)) continue;
        closePalette(entry);
      }
    },
    true
  );

  function startDrag(event, entry, note) {
    if (event.button !== 0) return;
    event.preventDefault();
    const { root, head } = entry;
    const offsetX = event.pageX - note.x;
    const offsetY = event.pageY - note.y;
    root.classList.add("is-dragging");
    head.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      note.x = Math.max(0, Math.round(moveEvent.pageX - offsetX));
      note.y = Math.max(0, Math.round(moveEvent.pageY - offsetY));
      root.style.left = `${note.x}px`;
      root.style.top = `${note.y}px`;
    };
    const onEnd = () => {
      head.removeEventListener("pointermove", onMove);
      head.removeEventListener("pointerup", onEnd);
      head.removeEventListener("pointercancel", onEnd);
      root.classList.remove("is-dragging");
      commitNote(note);
    };
    head.addEventListener("pointermove", onMove);
    head.addEventListener("pointerup", onEnd);
    head.addEventListener("pointercancel", onEnd);
  }

  // --------------------------------------------------------------- actions

  function defaultPosition(width, height) {
    const fresh = lastContextClick && Date.now() - lastContextClick.at < CONTEXT_CLICK_TTL_MS;
    if (fresh) {
      const point = lastContextClick;
      lastContextClick = null;
      return { x: Math.max(0, point.x - 20), y: Math.max(0, point.y - 12) };
    }
    const jitter = (notes.length % 6) * 18;
    return {
      x: Math.max(0, Math.round(window.scrollX + window.innerWidth / 2 - width / 2 + jitter)),
      y: Math.max(0, Math.round(window.scrollY + Math.min(window.innerHeight * 0.28, 220) + jitter))
    };
  }

  async function addNote(payload = {}) {
    if (!currentKeys) return null;
    const width = store.NOTE_DEFAULT_WIDTH;
    const height = store.NOTE_DEFAULT_HEIGHT;
    const position =
      Number.isFinite(payload.x) && Number.isFinite(payload.y)
        ? { x: payload.x, y: payload.y }
        : defaultPosition(width, height);
    const note = store.createNote({
      ...position,
      width,
      height,
      scope: payload.scope,
      text: typeof payload.text === "string" ? payload.text : ""
    });
    notes = [...notes, note];
    const entry = createElement(note, { isNew: true });
    setTimeout(() => entry.root.classList.remove("is-new"), 400);
    entry.textarea.focus({ preventScroll: true });
    if (note.text) entry.textarea.setSelectionRange(note.text.length, note.text.length);
    await commitNote(note);
    return note;
  }

  function removeNote(id) {
    const note = notes.find((item) => item.id === id);
    notes = store.removeNote(notes, id);
    const entry = elements.get(id);
    if (entry) {
      entry.observer.disconnect();
      entry.root.remove();
      entry.palette.remove();
      elements.delete(id);
    }
    clearTimeout(pendingSaves.get(id));
    pendingSaves.delete(id);
    if (note) commitRemoval(note);
  }

  let toast = null;
  function dismissToast() {
    if (!toast) return;
    clearTimeout(toast.timer);
    toast.el.remove();
    toast = null;
  }

  /** Delete immediately, keep a 5 second Undo where the note was. */
  function deleteWithUndo(note) {
    const snapshot = { ...note };
    dismissToast();
    removeNote(note.id);

    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.style.left = `${snapshot.x}px`;
    el.style.top = `${snapshot.y}px`;
    el.style.zIndex = String(zCounter + 1);
    const label = document.createElement("span");
    label.textContent = "Note Deleted";
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "Undo";
    undo.addEventListener("click", async () => {
      dismissToast();
      notes = [...notes, snapshot];
      const entry = createElement(snapshot, { isNew: true });
      setTimeout(() => entry.root.classList.remove("is-new"), 400);
      await commitNote(snapshot);
    });
    el.append(label, undo);
    layer.appendChild(el);
    toast = { el, timer: setTimeout(dismissToast, 5000) };
    undo.focus({ preventScroll: true });
  }

  function focusNote(id) {
    const entry = elements.get(id);
    if (!entry) return false;
    bringToFront(entry.root);
    entry.root.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    entry.root.classList.remove("is-flash");
    void entry.root.offsetWidth; // restart the animation
    entry.root.classList.add("is-flash");
    setTimeout(() => entry.root.classList.remove("is-flash"), 1000);
    return true;
  }

  // ------------------------------------------------------------ lifecycle

  async function loadPage() {
    const keys = store.keysFor(location.href);
    const same = keys && currentKeys && store.SCOPES.every((scope) => keys[scope] === currentKeys[scope]);
    if (same || (!keys && !currentKeys)) return;
    flushSaves();
    currentKeys = keys;
    notes = [];
    render();
    if (!keys) return;
    const scopedNotes = await Promise.all(store.SCOPES.map((scope) => storageGet(keys[scope])));
    if (keys !== currentKeys) return;
    notes = mergeScoped(scopedNotes);
    render();
  }

  function mergeScoped(scopedNotes) {
    return store.SCOPES.flatMap((scope, index) =>
      scopedNotes[index].map((note) => ({ ...note, scope }))
    );
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !currentKeys) return;
    let touched = false;
    for (const scope of store.SCOPES) {
      const key = store.keyForScope(currentKeys, scope);
      if (!key || !(key in changes)) continue;
      const incoming = store.normalizeNotes(changes[key].newValue);
      const incomingJson = incoming.length ? JSON.stringify(incoming) : null;
      if (incomingJson === lastWritten.get(key)) continue; // our own write
      // Keep unsaved local edits for the note being typed in right now.
      const active = shadow.activeElement;
      const editingId = active && active.classList.contains("body") ? active.closest(".note").dataset.id : null;
      const replaced = incoming.map((note) => {
        const local = notes.find((item) => item.id === note.id);
        const text = note.id === editingId && local ? local.text : note.text;
        return { ...note, text, scope };
      });
      notes = [...notes.filter((note) => note.scope !== scope), ...replaced];
      touched = true;
    }
    if (touched) render();
  }

  function onMessage(message, _sender, sendResponse) {
    if (!message || typeof message.type !== "string") return undefined;
    switch (message.type) {
      case "PING":
        sendResponse({ ok: true, supported: Boolean(currentKeys) });
        return undefined;
      case "GET_PAGE_NOTES":
        sendResponse({ ok: true, keys: currentKeys, notes });
        return undefined;
      case "ADD_NOTE":
        addNote(message).then((note) => sendResponse({ ok: Boolean(note), note }));
        return true;
      case "FOCUS_NOTE":
        sendResponse({ ok: focusNote(message.id) });
        return undefined;
      default:
        return undefined;
    }
  }

  function teardown() {
    clearInterval(urlTimer);
    urlTimer = null;
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      lastContextClick = { x: event.pageX, y: event.pageY, at: Date.now() };
    },
    true
  );

  window.addEventListener("pagehide", flushSaves);
  window.addEventListener("popstate", loadPage);

  urlTimer = setInterval(() => {
    if (!alive()) {
      teardown();
      return;
    }
    loadPage();
  }, URL_POLL_MS);

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {
    teardown();
    return;
  }

  loadPage();
})();
