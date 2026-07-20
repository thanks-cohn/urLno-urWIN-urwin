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

const hiddenRequestGesture = {
  gestureId: "hidden-request-gesture",
  tabId: 40,
  sourcePageUrl: "https://hitomi.test/gallery/hidden-request",
  sourcePageTitle: "Hidden request gallery",
  targetUrl: "",
  capturedAt: now - 500,
  claimedByDownloadId: null
};

const singleGestureBinding = selectBinding({
  item: {
    url: "https://extension-download.test/generated.cbz",
    finalUrl: "https://extension-download.test/generated.cbz",
    referrer: "",
    startTime: new Date(now).toISOString()
  },
  requests: [],
  gestures: [hiddenRequestGesture],
  now
});

assert.equal(singleGestureBinding.sourcePageUrl, hiddenRequestGesture.sourcePageUrl);
assert.equal(singleGestureBinding.sourceTabId, 40);
assert.equal(singleGestureBinding.matchedBy, "single-unclaimed-gesture");

const ambiguousGestures = selectBinding({
  item: {
    url: "https://extension-download.test/ambiguous.cbz",
    finalUrl: "https://extension-download.test/ambiguous.cbz",
    referrer: "",
    startTime: new Date(now).toISOString()
  },
  requests: [],
  gestures: [
    hiddenRequestGesture,
    {
      ...hiddenRequestGesture,
      gestureId: "competing-tab-gesture",
      tabId: 41,
      sourcePageUrl: "https://hitomi.test/gallery/another-tab"
    }
  ],
  now
});

assert.equal(ambiguousGestures, null, "two possible tabs must never be guessed between");

const claimedGestureIgnored = selectBinding({
  item: {
    url: "https://extension-download.test/second-file.cbz",
    finalUrl: "https://extension-download.test/second-file.cbz",
    referrer: "",
    startTime: new Date(now).toISOString()
  },
  requests: [],
  gestures: [{ ...hiddenRequestGesture, claimedByDownloadId: 999 }],
  now
});

assert.equal(claimedGestureIgnored, null, "one click must not be reused for another download");

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
