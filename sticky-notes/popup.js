(function stickyNotesPopup() {
  "use strict";

  const store = globalThis.StickyNotesStore;

  const totals = document.getElementById("totals");
  const addButton = document.getElementById("add-button");
  const pageHint = document.getElementById("page-hint");
  const whereSelect = document.getElementById("where-select");
  const search = document.getElementById("search");
  const noteList = document.getElementById("note-list");
  const empty = document.getElementById("empty");
  const emptyTitle = document.getElementById("empty-title");
  const emptyBody = document.getElementById("empty-body");
  const footCount = document.getElementById("foot-count");
  const deleteShown = document.getElementById("delete-shown");
  const undoBar = document.getElementById("undo-bar");
  const undoText = document.getElementById("undo-text");
  const undoButton = document.getElementById("undo-button");
  const confirmBox = document.getElementById("confirm");
  const confirmTitle = document.getElementById("confirm-title");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmDelete = document.getElementById("confirm-delete");
  const TRASH = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.2h8M4.6 3.2V2h2.8v1.2M3 3.2l.6 6.6a.8.8 0 0 0 .8.7h3.2a.8.8 0 0 0 .8-.7l.6-6.6M5 5.2v3.3M7 5.2v3.3"/></svg>';

  let tab = null;
  let keys = null; // { page, path, site } for the active tab, or null
  let entries = []; // every note in storage, newest first
  let shown = [];
  let undoState = null; // { entries: [...], timer }

  const FILTER_PAGE = "page";
  const FILTER_SITE = "site";
  const FILTER_ALL = "all";
  const HOST_PREFIX = "host:";

  function sendToTab(message) {
    if (!tab || tab.id == null) return Promise.resolve(null);
    return chrome.tabs.sendMessage(tab.id, message).catch(() => null);
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  function pluralCap(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  // ------------------------------------------------------------ loading

  async function loadEntries() {
    const snapshot = await chrome.storage.local.get(null);
    entries = store.listAllNotes(snapshot);
  }

  function entriesFor(filter) {
    if (filter === FILTER_ALL) return entries;
    if (filter === FILTER_PAGE) {
      const visibleKeys = new Set(Object.values(keys || {}));
      return keys ? entries.filter((e) => visibleKeys.has(e.key)) : [];
    }
    if (filter === FILTER_SITE) return keys ? entries.filter((e) => e.host === currentHost()) : [];
    if (filter.startsWith(HOST_PREFIX)) {
      const host = filter.slice(HOST_PREFIX.length);
      return entries.filter((e) => e.host === host);
    }
    return entries;
  }

  function currentHost() {
    return keys ? store.hostOf(store.urlFromStorageKey(keys.page)) : null;
  }

  function buildWhereOptions(previous) {
    whereSelect.replaceChildren();
    const add = (parent, value, label) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      parent.appendChild(option);
      return option;
    };

    const host = currentHost();
    if (keys) {
      add(whereSelect, FILTER_PAGE, `Visible on This Page (${entriesFor(FILTER_PAGE).length})`);
      add(whereSelect, FILTER_SITE, `All Notes on ${host} (${entriesFor(FILTER_SITE).length})`);
    }
    add(whereSelect, FILTER_ALL, `All Notes (${entries.length})`);

    const hosts = store.summarizeHosts(entries).filter((h) => h.host !== host);
    if (hosts.length) {
      const group = document.createElement("optgroup");
      group.label = "Sites";
      for (const item of hosts) add(group, HOST_PREFIX + item.host, `${item.host} (${item.count})`);
      whereSelect.appendChild(group);
    }

    const values = Array.from(whereSelect.options).map((o) => o.value);
    let pick = previous && values.includes(previous) ? previous : null;
    if (!pick) {
      if (keys && entriesFor(FILTER_PAGE).length) pick = FILTER_PAGE;
      else if (keys && entriesFor(FILTER_SITE).length) pick = FILTER_SITE;
      else pick = keys ? FILTER_PAGE : FILTER_ALL;
    }
    whereSelect.value = pick;
  }

  // ----------------------------------------------------------- rendering

  function renderTotals() {
    const hosts = store.summarizeHosts(entries).length;
    totals.textContent = entries.length
      ? `${plural(entries.length, "note")} on ${plural(hosts, "site")}`
      : "No notes yet";
  }

  function renderList() {
    const filter = whereSelect.value;
    const query = search.value.trim().toLowerCase();
    shown = entriesFor(filter).filter((e) => !query || e.note.text.toLowerCase().includes(query) || e.host.includes(query) || e.path.toLowerCase().includes(query));

    noteList.replaceChildren();
    for (const entry of shown) noteList.appendChild(renderItem(entry, filter));

    const none = shown.length === 0;
    empty.hidden = !none;
    if (none) {
      if (query) {
        emptyTitle.textContent = "No Results";
        emptyBody.textContent = "Try a different search.";
      } else if (filter === FILTER_PAGE) {
        emptyTitle.textContent = "No Notes on This Page";
        emptyBody.textContent = "Click Add Note to pin one here.";
      } else if (filter === FILTER_SITE) {
        emptyTitle.textContent = `No Notes on ${currentHost()}`;
        emptyBody.textContent = "";
      } else {
        emptyTitle.textContent = "No Notes Yet";
        emptyBody.textContent = "Open a website, then click Add Note.";
      }
    }

    footCount.textContent = keys ? "⌥⇧N adds a note" : "";
    deleteShown.hidden = shown.length === 0;
    deleteShown.textContent = `Delete ${pluralCap(shown.length, "Note")}…`;
    confirmBox.hidden = true;
  }

  function renderItem(entry, filter) {
    const item = document.createElement("li");
    item.className = "item";
    item.dataset.color = entry.note.color;

    const swatch = document.createElement("span");
    swatch.className = "swatch";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "open";
    open.title = isOnCurrentPage(entry) ? "Scroll to this note" : `Open ${entry.url}`;

    const text = document.createElement("p");
    text.className = "text";
    const preview = store.previewText(entry.note.text, 140);
    text.textContent = preview || "Empty note";
    if (!preview) text.classList.add("is-empty");

    const meta = document.createElement("p");
    meta.className = "meta";
    const showHost = filter === FILTER_ALL;
    if (showHost) {
      const host = document.createElement("span");
      host.className = "host";
      host.textContent = entry.host;
      meta.appendChild(host);
    }
    if (entry.scope === "site") {
      const tag = document.createElement("span");
      tag.className = "site-tag";
      tag.textContent = "every page";
      meta.appendChild(tag);
    } else {
      const path = document.createElement("span");
      path.className = "path";
      path.textContent = entry.path || "/";
      path.title = entry.url;
      meta.appendChild(path);
      if (entry.scope === "path") {
        const tag = document.createElement("span");
        tag.className = "site-tag";
        tag.textContent = "any filters";
        meta.appendChild(tag);
      }
    }
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = store.relativeTime(entry.note.updatedAt);
    meta.appendChild(when);

    open.append(text, meta);
    open.addEventListener("click", () => openEntry(entry));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-delete";
    del.innerHTML = TRASH;
    del.title = "Delete Note";
    del.setAttribute("aria-label", "Delete Note");
    del.addEventListener("click", () => deleteEntries([entry], { undoable: true }));

    item.append(swatch, open, del);
    return item;
  }

  function isOnCurrentPage(entry) {
    return Boolean(keys && Object.values(keys).includes(entry.key));
  }

  async function openEntry(entry) {
    if (isOnCurrentPage(entry)) {
      const response = await sendToTab({ type: "FOCUS_NOTE", id: entry.note.id });
      if (response && response.ok) {
        window.close();
        return;
      }
    }
    chrome.tabs.create({ url: entry.url });
    window.close();
  }

  // ------------------------------------------------------------ deleting

  async function writeRemoval(list) {
    const byKey = new Map();
    for (const entry of list) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, new Set());
      byKey.get(entry.key).add(entry.note.id);
    }
    const snapshot = await chrome.storage.local.get(Array.from(byKey.keys()));
    const updates = {};
    const removals = [];
    for (const [key, ids] of byKey) {
      const remaining = store.normalizeNotes(snapshot[key]).filter((note) => !ids.has(note.id));
      if (remaining.length) updates[key] = remaining;
      else removals.push(key);
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    if (removals.length) await chrome.storage.local.remove(removals);
  }

  async function restore(list) {
    const byKey = new Map();
    for (const entry of list) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, []);
      byKey.get(entry.key).push(entry.note);
    }
    const snapshot = await chrome.storage.local.get(Array.from(byKey.keys()));
    const updates = {};
    for (const [key, restored] of byKey) {
      let merged = store.normalizeNotes(snapshot[key]);
      for (const note of restored) merged = store.upsertNote(merged, note);
      updates[key] = merged;
    }
    await chrome.storage.local.set(updates);
  }

  function hideUndo() {
    if (undoState) clearTimeout(undoState.timer);
    undoState = null;
    undoBar.hidden = true;
  }

  async function deleteEntries(list, { undoable } = {}) {
    hideUndo();
    await writeRemoval(list);
    await refresh(whereSelect.value);
    if (undoable) {
      undoText.textContent = list.length === 1 ? "Note Deleted" : `${pluralCap(list.length, "Note")} Deleted`;
      undoBar.hidden = false;
      undoState = { entries: list, timer: setTimeout(hideUndo, 5000) };
    }
  }

  undoButton.addEventListener("click", async () => {
    if (!undoState) return;
    const { entries: list } = undoState;
    hideUndo();
    await restore(list);
    await refresh(whereSelect.value);
  });

  deleteShown.addEventListener("click", () => {
    confirmTitle.textContent = `Delete ${pluralCap(shown.length, "Note")}?`;
    confirmBox.hidden = false;
    confirmCancel.focus();
  });
  confirmCancel.addEventListener("click", () => {
    confirmBox.hidden = true;
  });
  confirmDelete.addEventListener("click", async () => {
    confirmBox.hidden = true;
    await deleteEntries(shown);
  });

  // ------------------------------------------------------------- wiring

  async function refresh(previousFilter) {
    await loadEntries();
    renderTotals();
    buildWhereOptions(previousFilter);
    renderList();
  }

  whereSelect.addEventListener("change", renderList);
  search.addEventListener("input", renderList);

  addButton.addEventListener("click", async () => {
    const response = await sendToTab({ type: "ADD_NOTE", source: "popup" });
    if (response && response.ok) {
      window.close();
      return;
    }
    pageHint.hidden = false;
    pageHint.textContent = "Reload this page to enable Sticky Notes.";
  });

  async function init() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active || null;
    keys = tab ? store.keysFor(tab.url || "") : null;
    if (keys) {
      addButton.hidden = false;
    } else {
      pageHint.hidden = false;
      pageHint.textContent = "Sticky Notes isn’t available on this page.";
    }
    await refresh(null);
    if (keys) {
      // Warn early if the content script isn't running yet (installed after page load).
      const ping = await sendToTab({ type: "PING" });
      if (!ping) {
        pageHint.hidden = false;
        pageHint.textContent = "Reload this page to enable Sticky Notes.";
      }
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some(store.isNoteKey)) refresh(whereSelect.value);
  });

  init();
})();
