"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

test("manifest and package versions agree", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
});

test("content script runs on every web page with the shared store loaded first", () => {
  const [entry] = manifest.content_scripts;
  assert.ok(entry.matches.includes("http://*/*"));
  assert.ok(entry.matches.includes("https://*/*"));
  assert.deepEqual(entry.js, ["notes-store.js", "content.js"]);
  assert.equal(entry.run_at, "document_idle");
  assert.notEqual(entry.all_frames, true, "notes belong to the top frame only");
});

test("requests only the permissions the feature needs", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "contextMenus", "storage", "tabs"]);
  assert.equal(manifest.host_permissions, undefined);
});

test("declares the add-note keyboard shortcut", () => {
  const command = manifest.commands["add-note"];
  assert.ok(command);
  assert.equal(command.suggested_key.default, "Alt+Shift+N");
});

test("every referenced file exists", () => {
  const files = new Set([
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ]);
  for (const file of files) {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `${file} is missing`);
  }
});
