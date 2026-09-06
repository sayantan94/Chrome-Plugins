"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STORAGE_PREFIX,
  PATH_PREFIX,
  COLOR_NAMES,
  pageKey,
  storageKey,
  pathPageKey,
  pathStorageKey,
  urlFromStorageKey,
  normalizeNote,
  normalizeNotes,
  createNote,
  upsertNote,
  removeNote,
  summarizePages,
  previewText
} = require("../notes-store.js");

test("page key ignores the hash so anchors share notes", () => {
  assert.equal(pageKey("https://example.com/docs#intro"), "https://example.com/docs");
});

test("page key keeps meaningful query params but strips tracking ones", () => {
  assert.equal(
    pageKey("https://www.youtube.com/watch?v=abc&utm_source=x&fbclid=1&gclid=2"),
    "https://www.youtube.com/watch?v=abc"
  );
});

test("page key lowercases the host and drops the trailing slash", () => {
  assert.equal(pageKey("HTTPS://Example.COM/Path/"), "https://example.com/Path");
  assert.equal(pageKey("https://example.com/"), "https://example.com/");
});

test("page key rejects non-web urls", () => {
  assert.equal(pageKey("chrome://extensions"), null);
  assert.equal(pageKey("file:///tmp/a.html"), null);
  assert.equal(pageKey("not a url"), null);
});

test("storage key round-trips through the prefix", () => {
  const key = storageKey("https://example.com/a?b=1#c");
  assert.equal(key, `${STORAGE_PREFIX}https://example.com/a?b=1`);
  assert.equal(urlFromStorageKey(key), "https://example.com/a?b=1");
  assert.equal(storageKey("about:blank"), null);
});

test("path scope ignores query options while keeping the page path", () => {
  const finance = "https://www.google.com/finance/beta/quote/SPY:NYSEARCA?window=5D";
  assert.equal(
    pathPageKey(finance),
    "https://www.google.com/finance/beta/quote/SPY:NYSEARCA"
  );
  assert.equal(
    pathStorageKey(finance),
    `${PATH_PREFIX}https://www.google.com/finance/beta/quote/SPY:NYSEARCA`
  );
  assert.equal(
    pathStorageKey(finance),
    pathStorageKey("https://www.google.com/finance/beta/quote/SPY:NYSEARCA?window=1M")
  );
  assert.notEqual(
    pathStorageKey(finance),
    pathStorageKey("https://www.google.com/finance/beta/quote/QQQ:NASDAQ?window=5D")
  );
});

test("creates a note with sane defaults", () => {
  const note = createNote({ x: 10.4, y: 20.6 }, 1000);
  assert.ok(note.id);
  assert.equal(note.x, 10);
  assert.equal(note.y, 21);
  assert.equal(note.width, 250);
  assert.equal(note.height, 170);
  assert.equal(note.text, "");
  assert.equal(note.color, "yellow");
  assert.equal(note.collapsed, false);
  assert.equal(note.createdAt, 1000);
  assert.equal(note.updatedAt, 1000);
});

test("normalizes corrupt stored records", () => {
  const note = normalizeNote(
    { id: "keep", x: -40, y: "nope", width: 5, height: 99999, color: "neon", text: 42, collapsed: "yes" },
    500
  );
  assert.equal(note.id, "keep");
  assert.equal(note.x, 0);
  assert.equal(note.y, 0);
  assert.equal(note.width, 140);
  assert.equal(note.height, 2000);
  assert.equal(note.color, "yellow");
  assert.equal(note.text, "");
  assert.equal(note.collapsed, false);
  assert.equal(note.createdAt, 500);
});

test("every color name is accepted", () => {
  for (const color of COLOR_NAMES) {
    assert.equal(normalizeNote({ color }).color, color);
  }
});

test("normalizeNotes drops non-arrays and duplicate ids", () => {
  assert.deepEqual(normalizeNotes(null), []);
  assert.deepEqual(normalizeNotes("x"), []);
  const notes = normalizeNotes([{ id: "a", text: "1" }, { id: "a", text: "2" }, { id: "b" }]);
  assert.deepEqual(notes.map((n) => n.id), ["a", "b"]);
  assert.equal(notes[0].text, "1");
});

test("upsert replaces an existing note in place and appends new ones", () => {
  const initial = [createNote({ id: "a", text: "old" }), createNote({ id: "b" })];
  const updated = upsertNote(initial, { id: "a", text: "new" });
  assert.deepEqual(updated.map((n) => n.id), ["a", "b"]);
  assert.equal(updated[0].text, "new");
  const appended = upsertNote(updated, { id: "c" });
  assert.equal(appended.length, 3);
  assert.equal(initial[0].text, "old", "does not mutate the input");
});

test("removeNote filters by id", () => {
  const notes = [createNote({ id: "a" }), createNote({ id: "b" })];
  assert.deepEqual(removeNote(notes, "a").map((n) => n.id), ["b"]);
});

test("summarizePages lists only note keys, newest first, skipping empties", () => {
  const pages = summarizePages({
    [`${STORAGE_PREFIX}https://a.com/`]: [createNote({ id: "1", updatedAt: 10, createdAt: 1 })],
    [`${STORAGE_PREFIX}https://b.com/x`]: [
      createNote({ id: "2", updatedAt: 50, createdAt: 1 }),
      createNote({ id: "3", updatedAt: 20, createdAt: 1 })
    ],
    [`${STORAGE_PREFIX}https://c.com/`]: [],
    unrelated: { foo: 1 }
  });
  assert.deepEqual(
    pages.map((p) => [p.url, p.count, p.updatedAt]),
    [
      ["https://b.com/x", 2, 50],
      ["https://a.com/", 1, 10]
    ]
  );
});

test("previewText collapses whitespace and truncates", () => {
  assert.equal(previewText("  hello \n  world  "), "hello world");
  assert.equal(previewText(""), "");
  assert.equal(previewText("a".repeat(100), 10), "aaaaaaaaa…");
});

const {
  SITE_PREFIX,
  siteOf,
  siteStorageKey,
  keysFor,
  keyForScope,
  parseStorageKey,
  listAllNotes,
  summarizeHosts,
  relativeTime
} = require("../notes-store.js");

test("site key is the full host, so subdomains are separate sites", () => {
  assert.equal(siteOf("https://mail.google.com/mail/u/0/#inbox"), "https://mail.google.com");
  assert.equal(siteOf("https://docs.google.com/x"), "https://docs.google.com");
  assert.notEqual(siteStorageKey("https://mail.google.com/"), siteStorageKey("https://google.com/"));
  assert.equal(siteStorageKey("https://Example.com:8080/a"), `${SITE_PREFIX}https://example.com:8080`);
  assert.equal(siteOf("chrome://extensions"), null);
});

test("keysFor gives exact URL, path, and site keys", () => {
  const keys = keysFor("https://app.example.com/board/1?x=1#top");
  assert.deepEqual(keys, {
    page: `${STORAGE_PREFIX}https://app.example.com/board/1?x=1`,
    path: `${PATH_PREFIX}https://app.example.com/board/1`,
    site: `${SITE_PREFIX}https://app.example.com`
  });
  assert.equal(keyForScope(keys, "site"), keys.site);
  assert.equal(keyForScope(keys, "path"), keys.path);
  assert.equal(keyForScope(keys, "page"), keys.page);
  assert.equal(keyForScope(keys, "bogus"), keys.path);
  assert.equal(keysFor("about:blank"), null);
});

test("parseStorageKey explains where a key's notes live", () => {
  assert.deepEqual(parseStorageKey(`${STORAGE_PREFIX}https://a.b.com/path?q=1`), {
    key: `${STORAGE_PREFIX}https://a.b.com/path?q=1`,
    scope: "page",
    url: "https://a.b.com/path?q=1",
    host: "a.b.com",
    path: "/path?q=1"
  });
  assert.deepEqual(parseStorageKey(`${SITE_PREFIX}https://a.b.com`), {
    key: `${SITE_PREFIX}https://a.b.com`,
    scope: "site",
    url: "https://a.b.com/",
    host: "a.b.com",
    path: ""
  });
  assert.deepEqual(parseStorageKey(`${PATH_PREFIX}https://a.b.com/path`), {
    key: `${PATH_PREFIX}https://a.b.com/path`,
    scope: "path",
    url: "https://a.b.com/path",
    host: "a.b.com",
    path: "/path"
  });
  assert.equal(parseStorageKey("settings"), null);
});

test("note scope defaults to the page path and only accepts known scopes", () => {
  assert.equal(normalizeNote({}).scope, "path");
  assert.equal(normalizeNote({ scope: "path" }).scope, "path");
  assert.equal(normalizeNote({ scope: "site" }).scope, "site");
  assert.equal(normalizeNote({ scope: "global" }).scope, "path");
});

test("listAllNotes flattens every key, tags scope from the key, newest first", () => {
  const entries = listAllNotes({
    [`${STORAGE_PREFIX}https://a.com/x`]: [createNote({ id: "1", updatedAt: 10, createdAt: 1 })],
    [`${SITE_PREFIX}https://b.com`]: [createNote({ id: "2", updatedAt: 50, createdAt: 1, scope: "page" })],
    [`${PATH_PREFIX}https://c.com/report`]: [createNote({ id: "3", updatedAt: 30, createdAt: 1 })],
    junk: 1
  });
  assert.deepEqual(
    entries.map((e) => [e.note.id, e.scope, e.note.scope, e.host, e.url]),
    [
      ["2", "site", "site", "b.com", "https://b.com/"],
      ["3", "path", "path", "c.com", "https://c.com/report"],
      ["1", "page", "page", "a.com", "https://a.com/x"]
    ]
  );
});

test("summarizeHosts counts per host, keeping subdomains apart", () => {
  const hosts = summarizeHosts(
    listAllNotes({
      [`${STORAGE_PREFIX}https://mail.google.com/a`]: [createNote({ id: "1", updatedAt: 5, createdAt: 1 })],
      [`${SITE_PREFIX}https://mail.google.com`]: [createNote({ id: "2", updatedAt: 9, createdAt: 1 })],
      [`${STORAGE_PREFIX}https://google.com/`]: [createNote({ id: "3", updatedAt: 7, createdAt: 1 })]
    })
  );
  assert.deepEqual(
    hosts.map((h) => [h.host, h.count]),
    [
      ["mail.google.com", 2],
      ["google.com", 1]
    ]
  );
});

test("relativeTime reads naturally", () => {
  const now = 1_000_000_000;
  assert.equal(relativeTime(now - 5_000, now), "just now");
  assert.equal(relativeTime(now - 3 * 60_000, now), "3 min ago");
  assert.equal(relativeTime(now - 60 * 60_000, now), "1 hour ago");
  assert.equal(relativeTime(now - 26 * 3_600_000, now), "yesterday");
  assert.equal(relativeTime(now - 40 * 86_400_000, now), "1 month ago");
});
