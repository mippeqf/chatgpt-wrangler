// Network-backed generation status. The background service worker observes the
// real ChatGPT streaming request, which is not subject to hidden-tab DOM/timer
// throttling, and forwards start/end/error events here.
(() => {
  let authoritativeStatus = null;
  let lastAppliedTitle = null;

  function inferStatus(title) {
    if (title?.startsWith("🔴")) return "processing";
    if (title?.startsWith("🟡")) return "uncertain";
    return "ready";
  }

  function cleanTitle(title = document.title) {
    return (title || "ChatGPT").replace(/^(🔴|🟢|🟡)\s+/, "").trim() || "ChatGPT";
  }

  function prefix(status) {
    if (status === "processing") return "🔴 ";
    if (status === "uncertain") return "🟡 ";
    return "🟢 ";
  }

  function writeAuthoritativeTitle() {
    if (!authoritativeStatus) return;
    const nextTitle = prefix(authoritativeStatus) + cleanTitle();
    lastAppliedTitle = nextTitle;
    if (document.title !== nextTitle) document.title = nextTitle;
  }

  async function applyNetworkStatus(status) {
    const oldStatus = inferStatus(document.title);
    authoritativeStatus = status;
    writeAuthoritativeTitle();

    if (oldStatus === status) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "STATUS_UPDATE",
        source: "network",
        status,
        oldStatus,
        tabId: window.location.href,
      });

      // The ordinary content monitor owns audio playback. Network transitions
      // must play here because the DOM monitor may remain frozen until focus.
      if (
        !response?.chimeCommand ||
        typeof ChimePlayer === "undefined" ||
        typeof Settings === "undefined"
      ) return;
      const settings = new Settings();
      if (!settings.getChimesEnabled()) return;
      const player = new ChimePlayer("content");
      if (response.chimeCommand === "PLAY_PROCESSING_CHIME") await player.playLowCChime();
      if (response.chimeCommand === "PLAY_TAB_READY_CHIME") await player.playGChime();
      if (response.chimeCommand === "PLAY_WINDOW_READY_CHIME") await player.playHighCChime();
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "NETWORK_GENERATION_START") {
      applyNetworkStatus("processing");
    } else if (message.type === "NETWORK_GENERATION_END") {
      applyNetworkStatus("ready");
    } else if (message.type === "NETWORK_GENERATION_ERROR") {
      applyNetworkStatus("uncertain");
    }
  });

  // If ChatGPT or the old DOM monitor rewrites the title from stale hidden-tab
  // state, immediately restore the network-backed status without using timers.
  const titleObserver = new MutationObserver(() => {
    if (!authoritativeStatus) return;
    if (document.title === lastAppliedTitle) return;
    writeAuthoritativeTitle();
  });

  const observeTitle = () => {
    const title = document.querySelector("title");
    if (title) {
      titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
    } else {
      titleObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  };

  observeTitle();
})();
