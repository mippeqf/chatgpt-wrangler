// Reports the version and live monitor state of the content-script bundle
// actually injected into this page. Tabs that have not been refreshed since an
// extension reload will not have this listener, which is useful diagnostic info.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_MONITOR_INFO") return;

  const info = window.__CHATGPT_MONITOR_INFO__ || {};
  sendResponse({
    version: chrome.runtime.getManifest().version,
    status:
      info.status ||
      (document.title.startsWith("🔴")
        ? "processing"
        : document.title.startsWith("🟡")
        ? "uncertain"
        : "ready"),
    reason: info.reason || "no monitor state",
    generationObserved: Boolean(info.generationObserved),
    stopButtonObserved: Boolean(info.stopButtonObserved),
    checkCount: Number(info.checkCount || 0),
    mutationCount: Number(info.mutationCount || 0),
    lastCheckAt: Number(info.lastCheckAt || 0),
    lastMutationAt: Number(info.lastMutationAt || 0),
  });
});
