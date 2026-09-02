"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("loads the compositor fallback before video sites initialize", () => {
  const fallback = manifest.content_scripts.find((entry) =>
    entry.js.includes("compositor-fallback.js")
  );

  assert.ok(fallback);
  assert.equal(fallback.run_at, "document_start");
  assert.equal(fallback.world, "MAIN");
  assert.equal(fallback.all_frames, true);
  assert.equal(fallback.match_about_blank, true);
  assert.equal(fallback.match_origin_as_fallback, true);
  assert.ok(fallback.matches.includes("http://*/*"));
  assert.ok(fallback.matches.includes("https://*/*"));
  assert.equal(
    fs.existsSync(path.join(projectRoot, "compositor-fallback.js")),
    true
  );
});
