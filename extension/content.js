(() => {
  "use strict";

  const MESSAGE_TYPE = "source-page-metadata:user-gesture";
  let lastSignature = "";
  let lastSentAt = 0;

  function elementFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.find((node) => node instanceof Element) ||
      (event.target instanceof Element ? event.target : null);
  }

  function findActionElement(element) {
    if (!element) return null;
    return element.closest("a[href], area[href], button, input, [role='button']") || element;
  }

  function targetUrlFor(element) {
    if (!element) return "";

    const link = element.closest("a[href], area[href]");
    if (link?.href) return link.href;

    const form = element.closest("form[action]");
    if (form?.action) return form.action;

    return "";
  }

  function captureGesture(event) {
    if (event.type === "pointerdown" && event.button !== 0) return;
    if ("isTrusted" in event && !event.isTrusted) return;

    const actionElement = findActionElement(elementFromEvent(event));
    const targetUrl = targetUrlFor(actionElement);
    const now = Date.now();
    const signature = `${location.href}\n${targetUrl}\n${actionElement?.tagName || ""}`;

    // pointerdown and click normally describe the same action. Keeping one event
    // gives the background worker time to record it before the request begins.
    if (signature === lastSignature && now - lastSentAt < 750) return;
    lastSignature = signature;
    lastSentAt = now;

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPE,
      capturedAt: now,
      pageUrl: location.href,
      pageTitle: document.title || "",
      frameUrl: location.href,
      isTopFrame: window === window.top,
      targetUrl,
      eventType: event.type,
      elementTag: actionElement?.tagName || ""
    }).catch(() => {
      // The service worker may be restarting. The browser-provided referrer and
      // request correlation remain available as fallbacks.
    });
  }

  window.addEventListener("pointerdown", captureGesture, true);
  window.addEventListener("click", captureGesture, true);
  window.addEventListener("submit", captureGesture, true);
})();
