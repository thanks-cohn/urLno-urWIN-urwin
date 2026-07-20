"use strict";

const summary = document.querySelector("#summary");
const list = document.querySelector("#downloads");

function basename(path) {
  return String(path || "Unknown file").split(/[\\/]/).pop();
}

function addDownload(record) {
  const item = document.createElement("li");
  item.className = "download";

  const name = document.createElement("div");
  name.className = "filename";
  name.title = record.filename || "";
  name.textContent = basename(record.filename);

  const source = document.createElement("a");
  source.className = "source";
  source.href = record.sourcePageUrl;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.title = record.sourcePageUrl;
  source.textContent = record.sourcePageUrl;

  const status = document.createElement("div");
  status.className = `status${record.metadataStatus === "error" ? " error" : ""}`;
  status.textContent = record.metadataStatus === "written"
    ? "URL attached"
    : record.metadataStatus === "download-interrupted"
      ? "Download interrupted; no file was tagged"
    : record.metadataStatus === "source-unresolved"
      ? "Download detected, but no safe source page was resolved"
    : record.metadataStatus === "error"
      ? `Could not attach URL: ${record.lastError}`
      : "Waiting for download completion";

  item.append(name, source, status);
  list.append(item);
}

chrome.runtime.sendMessage({ type: "source-page-metadata:get-status" }, (response) => {
  if (chrome.runtime.lastError || !response?.ok) {
    summary.textContent = "The extension background worker is unavailable.";
    return;
  }

  const written = response.downloads.filter((item) => item.metadataStatus === "written").length;
  const errors = response.downloads.filter((item) => item.metadataStatus === "error").length;
  summary.textContent = errors
    ? `${written} recent URL(s) attached · ${errors} need attention`
    : `${written} recent URL(s) attached`;

  if (!response.downloads.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Your next download will appear here.";
    list.append(empty);
    return;
  }

  response.downloads.forEach(addDownload);
});
