"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("loads the compositor fallback before Netflix initializes", () => {
  const fallback = manifest.content_scripts.find((entry) =>
    entry.js.includes("compositor-fallback.js")
  );

  assert.ok(fallback);
  assert.equal(fallback.run_at, "document_start");
  assert.equal(fallback.world, "MAIN");
  assert.equal(fallback.all_frames, true);
  assert.ok(fallback.matches.includes("https://www.netflix.com/*"));
  assert.equal(
    fs.existsSync(path.join(projectRoot, "compositor-fallback.js")),
    true
  );
});
