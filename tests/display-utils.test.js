"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findBestDisplay,
  getSafeWindowBounds,
  intersectionArea,
  labelDisplay,
  normalizeRect
} = require("../display-utils.js");

test("normalizes invalid rectangle values", () => {
  assert.deepEqual(normalizeRect({ left: -50, top: 10, width: -2, height: NaN }), {
    left: -50,
    top: 10,
    width: 0,
    height: 0
  });
});

test("calculates overlap between a browser window and a display", () => {
  assert.equal(
    intersectionArea(
      { left: 100, top: 100, width: 800, height: 600 },
      { left: 500, top: 0, width: 1000, height: 900 }
    ),
    400 * 600
  );
});

test("selects the display containing most of the browser window", () => {
  const displays = [
    {
      id: "internal",
      isPrimary: true,
      bounds: { left: 0, top: 0, width: 1440, height: 900 }
    },
    {
      id: "external",
      isPrimary: false,
      bounds: { left: 1440, top: 0, width: 2560, height: 1440 }
    }
  ];

  assert.equal(
    findBestDisplay({ left: 1300, top: 100, width: 1500, height: 900 }, displays).id,
    "external"
  );
});

test("falls back to the primary display for an off-screen window", () => {
  const displays = [
    {
      id: "external",
      bounds: { left: 1440, top: 0, width: 1920, height: 1080 }
    },
    {
      id: "primary",
      isPrimary: true,
      bounds: { left: 0, top: 0, width: 1440, height: 900 }
    }
  ];

  assert.equal(
    findBestDisplay({ left: -3000, top: -3000, width: 800, height: 600 }, displays).id,
    "primary"
  );
});

test("creates nearly full-size bounds inside the work area", () => {
  assert.deepEqual(
    getSafeWindowBounds({
      workArea: { left: 1440, top: 25, width: 1920, height: 1055 }
    }, 20),
    { left: 1460, top: 45, width: 1880, height: 1015 }
  );
});

test("uses stable fallback labels", () => {
  assert.equal(labelDisplay({ name: "  Studio Display  " }, 0), "Studio Display");
  assert.equal(labelDisplay({}, 1), "Display 2");
});
