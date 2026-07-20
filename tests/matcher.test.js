"use strict";

const assert = require("node:assert/strict");
const { resolveGestureForRequestTab, selectBinding } = require("../extension/matcher.js");

const now = Date.now();
const pageA = "https://example.test/gallery/a";
const pageB = "https://example.test/gallery/b";
const fileA = "https://cdn.test/files/a.cbz?token=111";
const fileB = "https://cdn.test/files/b.zip?token=222";

const requests = [
  {
    requestId: "request-a",
    tabId: 10,
    gestureId: "gesture-a",
    sourcePageUrl: pageA,
    sourcePageTitle: "Gallery A",
    urls: [fileA],
    createdAt: now - 100,
    hasAttachmentHeader: true,
    claimedByDownloadId: null
  },
  {
    requestId: "request-b",
    tabId: 20,
    gestureId: "gesture-b",
    sourcePageUrl: pageB,
    sourcePageTitle: "Gallery B",
    urls: [fileB],
    createdAt: now - 90,
    hasAttachmentHeader: true,
    claimedByDownloadId: null
  }
];

const bindingB = selectBinding({
  item: { url: fileB, finalUrl: fileB, referrer: pageB, startTime: new Date(now).toISOString() },
  requests,
  gestures: [],
  now
});

const bindingA = selectBinding({
  item: { url: fileA, finalUrl: fileA, referrer: pageA, startTime: new Date(now).toISOString() },
  requests,
  gestures: [],
  now
});

assert.equal(bindingA.sourceTabId, 10);
assert.equal(bindingA.sourcePageUrl, pageA);
assert.equal(bindingB.sourceTabId, 20);
assert.equal(bindingB.sourcePageUrl, pageB);

const openerGesture = {
  gestureId: "gesture-opener",
  tabId: 30,
  sourcePageUrl: "https://hitomi.test/gallery/from-opener",
  sourcePageTitle: "Opening gallery",
  targetUrl: "",
  capturedAt: now - 200
};

const inheritedGesture = resolveGestureForRequestTab({
  gesturesByTab: { 30: [openerGesture] },
  openersByTab: { 31: { openerTabId: 30, createdAt: now - 100 } },
  requestTabId: 31,
  at: now
});

assert.equal(inheritedGesture.sourcePageUrl, openerGesture.sourcePageUrl);
assert.equal(inheritedGesture.tabId, 30, "a blank child tab must retain its opener as the source tab");

const nestedGesture = resolveGestureForRequestTab({
  gesturesByTab: { 30: [openerGesture] },
  openersByTab: {
    31: { openerTabId: 30, createdAt: now - 100 },
    32: { openerTabId: 31, createdAt: now - 50 }
  },
  requestTabId: 32,
  at: now
});

assert.equal(nestedGesture.sourcePageUrl, openerGesture.sourcePageUrl);

const sharedFile = "https://cdn.test/files/shared.cbz";
const sharedRequests = [
  { ...requests[0], requestId: "shared-a", urls: [sharedFile] },
  { ...requests[1], requestId: "shared-b", urls: [sharedFile] }
];

const sharedB = selectBinding({
  item: { url: sharedFile, finalUrl: sharedFile, referrer: pageB, startTime: new Date(now).toISOString() },
  requests: sharedRequests,
  gestures: [],
  now
});

assert.equal(sharedB.sourceTabId, 20, "the referrer must disambiguate identical file URLs");
assert.equal(sharedB.sourcePageUrl, pageB);

const referrerOnly = selectBinding({
  item: {
    url: "https://cdn.test/unknown.pdf",
    finalUrl: "https://cdn.test/unknown.pdf",
    referrer: pageA,
    startTime: new Date(now).toISOString()
  },
  requests: [],
  gestures: [],
  now
});

assert.equal(referrerOnly.sourcePageUrl, pageA);
assert.equal(referrerOnly.sourceTabId, null);

const unresolved = selectBinding({
  item: {
    url: "https://cdn.test/unmatched.png",
    finalUrl: "https://cdn.test/unmatched.png",
    referrer: "",
    startTime: new Date(now).toISOString()
  },
  requests: [],
  gestures: [],
  now
});

assert.equal(unresolved, null, "an unknown download must remain untagged instead of borrowing another tab");

console.log("matcher tests passed");
