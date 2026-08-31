// Reports the version of the content-script bundle actually injected into this
// page. Tabs that have not been refreshed since an extension reload will not
// have this listener, which is useful diagnostic information in the popup.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_MONITOR_INFO") return;

  sendResponse({
    version: chrome.runtime.getManifest().version,
    status: document.title.startsWith("🔴")
      ? "processing"
      : document.title.startsWith("🟡")
      ? "uncertain"
      : "ready",
  });
});
