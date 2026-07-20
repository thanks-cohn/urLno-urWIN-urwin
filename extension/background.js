importScripts("matcher.js");

"use strict";

const HOST_NAME = "lol.animeplex.source_page_metadata";
const STORAGE_KEY = "sourcePageMetadataStateV1";
const GESTURE_MESSAGE = "source-page-metadata:user-gesture";
const STATUS_MESSAGE = "source-page-metadata:get-status";
const RETRY_PREFIX = "source-page-metadata:retry:";
const GESTURE_TTL_MS = 120000;
const REQUEST_TTL_MS = 120000;
const DOWNLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_GESTURES_PER_TAB = 20;
const MAX_REQUESTS = 160;
const MAX_DOWNLOADS = 300;
const MAX_WRITE_ATTEMPTS = 6;

let loadedState = null;
let operationQueue = Promise.resolve();

function blankState() {
  return {
    gesturesByTab: {},
    openersByTab: {},
    requests: [],
    downloads: {}
  };
}

async function getState() {
  if (loadedState) return loadedState;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  loadedState = stored[STORAGE_KEY] || blankState();
  loadedState.gesturesByTab ||= {};
  loadedState.openersByTab ||= {};
  loadedState.requests ||= [];
  loadedState.downloads ||= {};
  return loadedState;
}

async function saveState(state) {
  loadedState = state;
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function enqueue(operation) {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch((error) => {
    console.error("Source Page Metadata operation failed", error);
  });
  return result;
}

function newId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function flattenGestures(state) {
  return Object.values(state.gesturesByTab).flat();
}

function pruneState(state, now = Date.now()) {
  for (const [tabId, gestures] of Object.entries(state.gesturesByTab)) {
    const kept = gestures
      .filter((gesture) => now - gesture.capturedAt <= GESTURE_TTL_MS)
      .slice(-MAX_GESTURES_PER_TAB);
    if (kept.length) state.gesturesByTab[tabId] = kept;
    else delete state.gesturesByTab[tabId];
  }

  for (const [tabId, opener] of Object.entries(state.openersByTab)) {
    if (now - opener.createdAt > GESTURE_TTL_MS) delete state.openersByTab[tabId];
  }

  state.requests = state.requests
    .filter((request) => now - request.createdAt <= REQUEST_TTL_MS)
    .slice(-MAX_REQUESTS);

  const downloads = Object.values(state.downloads)
    .filter((download) => now - download.createdAt <= DOWNLOAD_TTL_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_DOWNLOADS);
  state.downloads = Object.fromEntries(downloads.map((download) => [download.downloadId, download]));
}

function pageUrlFromGestureMessage(message, sender) {
  if (message.isTopFrame && SourceMatcher.isWebUrl(message.pageUrl)) return message.pageUrl;
  if (SourceMatcher.isWebUrl(sender.tab?.url)) return sender.tab.url;
  if (SourceMatcher.isWebUrl(message.pageUrl)) return message.pageUrl;
  return "";
}

async function recordGesture(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return { ok: false, error: "No initiating tab ID" };

  const sourcePageUrl = pageUrlFromGestureMessage(message, sender);
  if (!SourceMatcher.isWebUrl(sourcePageUrl)) return { ok: false, error: "No web page URL" };

  const state = await getState();
  const key = String(tabId);
  const gesture = {
    gestureId: newId(),
    tabId,
    frameId: sender.frameId ?? 0,
    sourcePageUrl,
    sourcePageTitle: String(message.pageTitle || sender.tab?.title || "").slice(0, 1000),
    frameUrl: SourceMatcher.isWebUrl(message.frameUrl) ? message.frameUrl : "",
    targetUrl: SourceMatcher.isWebUrl(message.targetUrl) ? message.targetUrl : "",
    eventType: String(message.eventType || ""),
    capturedAt: Number(message.capturedAt) || Date.now()
  };

  state.gesturesByTab[key] ||= [];
  state.gesturesByTab[key].push(gesture);
  pruneState(state);
  await saveState(state);
  return { ok: true, gestureId: gesture.gestureId, tabId };
}

async function recordRequest(details) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;

  const state = await getState();
  const gesture = SourceMatcher.resolveGestureForRequestTab({
    gesturesByTab: state.gesturesByTab,
    openersByTab: state.openersByTab,
    requestTabId: details.tabId,
    at: details.timeStamp || Date.now()
  });
  if (!gesture) return;

  const existing = state.requests.find((request) => request.requestId === details.requestId);
  if (existing) {
    if (!existing.urls.includes(details.url)) existing.urls.push(details.url);
  } else {
    state.requests.push({
      requestId: details.requestId,
      tabId: details.tabId,
      sourceTabId: gesture.tabId,
      frameId: details.frameId,
      gestureId: gesture.gestureId,
      sourcePageUrl: gesture.sourcePageUrl,
      sourcePageTitle: gesture.sourcePageTitle,
      targetUrl: gesture.targetUrl,
      urls: [details.url],
      requestType: details.type,
      createdAt: details.timeStamp || Date.now(),
      hasAttachmentHeader: false,
      claimedByDownloadId: null
    });
  }

  pruneState(state);
  await saveState(state);
}

async function recordTabOpener(tabId, openerTabId, createdAt = Date.now()) {
  if (!Number.isInteger(tabId) || !Number.isInteger(openerTabId)) return;

  const state = await getState();
  state.openersByTab[String(tabId)] = {
    openerTabId,
    createdAt
  };
  pruneState(state);
  await saveState(state);
}

async function markDownloadInterrupted(downloadId) {
  const state = await getState();
  const record = state.downloads[downloadId];
  if (!record || record.metadataStatus === "written") return;
  record.metadataStatus = "download-interrupted";
  record.lastError = "The download did not complete";
  await saveState(state);
}

async function recordRedirect(details) {
  const state = await getState();
  const request = state.requests.find((candidate) => candidate.requestId === details.requestId);
  if (!request) return;
  if (details.redirectUrl && !request.urls.includes(details.redirectUrl)) request.urls.push(details.redirectUrl);
  await saveState(state);
}

async function recordResponseHeaders(details) {
  const state = await getState();
  const request = state.requests.find((candidate) => candidate.requestId === details.requestId);
  if (!request) return;

  const disposition = (details.responseHeaders || []).find(
    (header) => header.name?.toLowerCase() === "content-disposition"
  );
  request.hasAttachmentHeader = /attachment/i.test(disposition?.value || "");
  request.responseAt = details.timeStamp || Date.now();
  await saveState(state);
}

async function bindDownload(item) {
  const state = await getState();
  pruneState(state);

  const existing = state.downloads[item.id];
  if (existing?.sourcePageUrl) return existing;

  const binding = SourceMatcher.selectBinding({
    item,
    requests: state.requests,
    gestures: flattenGestures(state),
    now: Date.now()
  });

  if (!binding) {
    state.downloads[item.id] = {
      downloadId: item.id,
      filename: item.filename || existing?.filename || "",
      sourcePageUrl: "",
      sourcePageTitle: "",
      sourceTabId: null,
      matchedBy: "unresolved",
      downloadUrl: item.finalUrl || item.url || existing?.downloadUrl || "",
      createdAt: Date.parse(item.startTime || "") || existing?.createdAt || Date.now(),
      metadataStatus: "source-unresolved",
      writeAttempts: existing?.writeAttempts || 0,
      lastError: "No safe initiating page could be identified"
    };
    console.warn("No safe initiating page was found; file will not be tagged", item.id, item.filename);
    await saveState(state);
    return null;
  }

  if (binding.requestId) {
    const request = state.requests.find((candidate) => candidate.requestId === binding.requestId);
    if (request) request.claimedByDownloadId = item.id;
  }

  if (binding.gestureId) {
    const gesture = flattenGestures(state).find(
      (candidate) => candidate.gestureId === binding.gestureId
    );
    if (gesture) gesture.claimedByDownloadId = item.id;
  }

  const record = {
    downloadId: item.id,
    filename: item.filename || "",
    sourcePageUrl: binding.sourcePageUrl,
    sourcePageTitle: binding.sourcePageTitle,
    sourceTabId: binding.sourceTabId,
    matchedBy: binding.matchedBy,
    downloadUrl: item.finalUrl || item.url || "",
    createdAt: Date.parse(item.startTime || "") || Date.now(),
    metadataStatus: "waiting-for-completion",
    writeAttempts: existing?.writeAttempts || 0,
    lastError: ""
  };

  state.downloads[item.id] = record;
  pruneState(state);
  await saveState(state);
  return record;
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || "Metadata companion returned an error"));
      else resolve(response);
    });
  });
}

async function searchDownload(downloadId) {
  const items = await chrome.downloads.search({ id: Number(downloadId) });
  return items[0] || null;
}

async function writeMetadata(downloadId) {
  const state = await getState();
  let record = state.downloads[downloadId];
  const item = await searchDownload(downloadId);
  if (!item || item.state !== "complete") return;

  if (!record?.sourcePageUrl) record = await bindDownload(item);
  if (!record || !SourceMatcher.isWebUrl(record.sourcePageUrl)) return;
  if (record.metadataStatus === "written") return;

  record.filename = item.filename;
  record.writeAttempts = (record.writeAttempts || 0) + 1;
  record.metadataStatus = "writing";
  record.lastError = "";
  await saveState(state);

  try {
    const response = await sendNativeMessage({
      action: "set_source_page_url",
      downloadId: item.id,
      path: item.filename,
      sourcePageUrl: record.sourcePageUrl
    });
    record.metadataStatus = "written";
    record.writtenAt = Date.now();
    record.xattrName = response.xattrName;
    record.lastError = "";
    await chrome.alarms.clear(`${RETRY_PREFIX}${downloadId}`);
  } catch (error) {
    record.metadataStatus = "error";
    record.lastError = error instanceof Error ? error.message : String(error);
    if (record.writeAttempts < MAX_WRITE_ATTEMPTS) {
      chrome.alarms.create(`${RETRY_PREFIX}${downloadId}`, { delayInMinutes: 1 });
    }
  }

  await saveState(state);
}

async function statusSnapshot() {
  const state = await getState();
  const downloads = Object.values(state.downloads)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  return { ok: true, hostName: HOST_NAME, downloads };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === GESTURE_MESSAGE) {
    enqueue(() => recordGesture(message, sender)).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: String(error) })
    );
    return true;
  }

  if (message?.type === STATUS_MESSAGE) {
    enqueue(statusSnapshot).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: String(error) })
    );
    return true;
  }

  return false;
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => void enqueue(() => recordRequest(details)),
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => void enqueue(() => recordRedirect(details)),
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => void enqueue(() => recordResponseHeaders(details)),
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.downloads.onCreated.addListener((item) => {
  void enqueue(() => bindDownload(item));
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete") {
    void enqueue(() => writeMetadata(delta.id));
  } else if (delta.state?.current === "interrupted") {
    void enqueue(() => markDownloadInterrupted(delta.id));
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(RETRY_PREFIX)) return;
  const downloadId = Number(alarm.name.slice(RETRY_PREFIX.length));
  if (Number.isInteger(downloadId)) void enqueue(() => writeMetadata(downloadId));
});

chrome.tabs.onCreated.addListener((tab) => {
  void enqueue(() => recordTabOpener(tab.id, tab.openerTabId));
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  void enqueue(() => recordTabOpener(details.tabId, details.sourceTabId, details.timeStamp));
});
