(function exposeMatcher(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SourceMatcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMatcher() {
  "use strict";

  const MAX_AGE_MS = 120000;
  const SINGLE_GESTURE_FALLBACK_MS = 15000;

  function isWebUrl(value) {
    if (typeof value !== "string" || !value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function comparableUrl(value) {
    if (!isWebUrl(value)) return "";
    try {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }

  function sameUrl(left, right) {
    const a = comparableUrl(left);
    const b = comparableUrl(right);
    return Boolean(a && b && a === b);
  }

  function itemStartedAt(item, now) {
    const parsed = Date.parse(item?.startTime || "");
    return Number.isFinite(parsed) ? parsed : now;
  }

  function requestMatchesItem(request, item) {
    const itemUrls = [item?.url, item?.finalUrl].filter(Boolean);
    return request.urls?.some((requestUrl) =>
      itemUrls.some((itemUrl) => sameUrl(requestUrl, itemUrl))
    );
  }

  function resolveGestureForRequestTab({
    gesturesByTab = {},
    openersByTab = {},
    requestTabId,
    at = Date.now(),
    maxDepth = 8
  }) {
    let tabId = requestTabId;
    const visited = new Set();

    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (!Number.isInteger(tabId) || visited.has(tabId)) return null;
      visited.add(tabId);

      const gestures = gesturesByTab[String(tabId)] || [];
      const gesture = [...gestures]
        .reverse()
        .find((candidate) =>
          at >= candidate.capturedAt - 1000 && at - candidate.capturedAt <= MAX_AGE_MS
        );
      if (gesture) return gesture;

      const opener = openersByTab[String(tabId)];
      if (!opener || at - opener.createdAt > MAX_AGE_MS) return null;
      tabId = opener.openerTabId;
    }

    return null;
  }

  function selectBinding({ item, requests = [], gestures = [], now = Date.now() }) {
    const startedAt = itemStartedAt(item, now);
    const referrer = isWebUrl(item?.referrer) ? item.referrer : "";

    const requestCandidates = requests
      .filter((request) => !request.claimedByDownloadId)
      .filter((request) => Math.abs(startedAt - request.createdAt) <= MAX_AGE_MS)
      .map((request) => {
        let score = 0;
        if (requestMatchesItem(request, item)) score += 1000;
        if (referrer && sameUrl(request.sourcePageUrl, referrer)) score += 600;
        if (request.hasAttachmentHeader) score += 200;
        score -= Math.min(Math.abs(startedAt - request.createdAt) / 100, 500);
        return { request, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.request.createdAt - b.request.createdAt);

    if (requestCandidates.length > 0) {
      const request = requestCandidates[0].request;
      return {
        sourcePageUrl: request.sourcePageUrl,
        sourcePageTitle: request.sourcePageTitle || "",
        sourceTabId: request.sourceTabId ?? request.tabId,
        gestureId: request.gestureId || "",
        requestId: request.requestId,
        matchedBy: "tab-request"
      };
    }

    const gestureCandidates = gestures
      .filter((gesture) => Math.abs(startedAt - gesture.capturedAt) <= MAX_AGE_MS)
      .map((gesture) => {
        let score = 0;
        if (referrer && sameUrl(gesture.sourcePageUrl, referrer)) score += 800;
        if (
          gesture.targetUrl &&
          [item?.url, item?.finalUrl].some((url) => sameUrl(gesture.targetUrl, url))
        ) score += 1000;
        score -= Math.min(Math.abs(startedAt - gesture.capturedAt) / 100, 500);
        return { gesture, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.gesture.capturedAt - b.gesture.capturedAt);

    if (gestureCandidates.length > 0) {
      const gesture = gestureCandidates[0].gesture;
      return {
        sourcePageUrl: gesture.sourcePageUrl,
        sourcePageTitle: gesture.sourcePageTitle || "",
        sourceTabId: gesture.tabId,
        gestureId: gesture.gestureId,
        requestId: "",
        matchedBy: "tab-gesture"
      };
    }

    // A browser-supplied referrer belongs to this DownloadItem and therefore
    // takes precedence over any cross-tab fallback.
    if (referrer) {
      return {
        sourcePageUrl: referrer,
        sourcePageTitle: "",
        sourceTabId: null,
        gestureId: "",
        requestId: "",
        matchedBy: "download-referrer"
      };
    }

    // Some downloader extensions start chrome.downloads requests without a
    // referrer or tabId. A single fresh, unclaimed gesture is still safe: there
    // is no competing tab that could receive the wrong page. If two gestures
    // are possible, refuse to guess.
    const unclaimedRecentGestures = gestures.filter((gesture) =>
      !gesture.claimedByDownloadId &&
      startedAt >= gesture.capturedAt - 1000 &&
      startedAt - gesture.capturedAt <= SINGLE_GESTURE_FALLBACK_MS
    );

    if (unclaimedRecentGestures.length === 1) {
      const gesture = unclaimedRecentGestures[0];
      return {
        sourcePageUrl: gesture.sourcePageUrl,
        sourcePageTitle: gesture.sourcePageTitle || "",
        sourceTabId: gesture.tabId,
        gestureId: gesture.gestureId,
        requestId: "",
        matchedBy: "single-unclaimed-gesture"
      };
    }

    return null;
  }

  return {
    MAX_AGE_MS,
    SINGLE_GESTURE_FALLBACK_MS,
    comparableUrl,
    isWebUrl,
    sameUrl,
    resolveGestureForRequestTab,
    selectBinding
  };
});
