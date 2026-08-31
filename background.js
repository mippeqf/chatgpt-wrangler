// Background script for managing tabs and updating badges/titles.
class ChatGPTTabManager {
  constructor() {
    this.windowStages = {};
    this.networkStatusByTab = new Map();
    this.activeNetworkRequestsByTab = new Map();
    this.init();
  }

  init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });

    this.setupNetworkMonitoring();
    this.scanExistingTabs();
  }

  setupNetworkMonitoring() {
    const filter = { urls: ["https://chatgpt.com/backend-api/*"] };

    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (!this.isConversationStreamRequest(details)) return;
      this.handleConversationStreamStart(details);
    }, filter);

    chrome.webRequest.onCompleted.addListener((details) => {
      if (!this.isConversationStreamRequest(details)) return;
      this.handleConversationStreamCompleted(details);
    }, filter);

    chrome.webRequest.onErrorOccurred.addListener((details) => {
      if (!this.isConversationStreamRequest(details)) return;
      this.handleConversationStreamError(details);
    }, filter);
  }

  isConversationStreamRequest(details) {
    if (!details || details.tabId < 0 || details.method !== "POST") return false;
    try {
      const path = new URL(details.url).pathname;
      return (
        path === "/backend-api/f/conversation" ||
        path === "/backend-api/conversation"
      );
    } catch (_) {
      return false;
    }
  }

  getActiveNetworkRequests(tabId) {
    let requests = this.activeNetworkRequestsByTab.get(tabId);
    if (!requests) {
      requests = new Set();
      this.activeNetworkRequestsByTab.set(tabId, requests);
    }
    return requests;
  }

  setNetworkStatus(tabId, status) {
    this.networkStatusByTab.set(tabId, {
      status,
      updatedAt: Date.now(),
    });
  }

  async sendNetworkEvent(tabId, type, details = {}) {
    try {
      await chrome.tabs.sendMessage(tabId, { type, ...details });
    } catch (_) {
      // The content script may not be mounted yet (reload/navigation race).
    }
  }

  handleConversationStreamStart(details) {
    const requests = this.getActiveNetworkRequests(details.tabId);
    const wasIdle = requests.size === 0;
    requests.add(details.requestId);
    this.setNetworkStatus(details.tabId, "processing");

    if (wasIdle) {
      this.sendNetworkEvent(details.tabId, "NETWORK_GENERATION_START", {
        requestId: details.requestId,
      });
    }
  }

  handleConversationStreamCompleted(details) {
    const requests = this.getActiveNetworkRequests(details.tabId);
    requests.delete(details.requestId);

    if (requests.size > 0) return;
    this.activeNetworkRequestsByTab.delete(details.tabId);

    if (details.statusCode >= 400) {
      this.setNetworkStatus(details.tabId, "uncertain");
      this.sendNetworkEvent(details.tabId, "NETWORK_GENERATION_ERROR", {
        requestId: details.requestId,
        statusCode: details.statusCode,
      });
      return;
    }

    this.setNetworkStatus(details.tabId, "ready");
    this.sendNetworkEvent(details.tabId, "NETWORK_GENERATION_END", {
      requestId: details.requestId,
      statusCode: details.statusCode,
    });
  }

  handleConversationStreamError(details) {
    const requests = this.getActiveNetworkRequests(details.tabId);
    requests.delete(details.requestId);

    if (requests.size > 0) return;
    this.activeNetworkRequestsByTab.delete(details.tabId);
    this.setNetworkStatus(details.tabId, "uncertain");
    this.sendNetworkEvent(details.tabId, "NETWORK_GENERATION_ERROR", {
      requestId: details.requestId,
      error: details.error,
    });
  }

  async scanExistingTabs() {
    try {
      this.updateBadge();
    } catch (error) {
      // Ignore startup races.
    }
  }

  async handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case "GET_TABS":
        try {
          sendResponse({ tabs: await this.getTabsByWindow() });
        } catch (error) {
          sendResponse({ tabs: {} });
        }
        break;

      case "GET_DEBUG_INFO":
        try {
          sendResponse({ debugInfo: await this.getDebugInfo() });
        } catch (error) {
          sendResponse({ debugInfo: { error: error.message } });
        }
        break;

      case "STATUS_UPDATE":
        try {
          const tabId = sender.tab?.id;
          const networkState =
            typeof tabId === "number" ? this.networkStatusByTab.get(tabId) : null;

          // Once the actual ChatGPT response stream has supplied a state, it is
          // more authoritative than a hidden tab's potentially stale DOM. Ignore
          // contradictory/duplicate DOM reports so they cannot overwrite the
          // title or trigger a second completion chime later on tab activation.
          if (networkState && message.source !== "network") {
            const looksLikeNewGeneration =
              message.status === "processing" &&
              networkState.status !== "processing" &&
              Date.now() - networkState.updatedAt > 1500;

            if (looksLikeNewGeneration) {
              // Let the DOM mark the request immediately; the webRequest start
              // event will re-establish network authority milliseconds later.
              this.networkStatusByTab.delete(tabId);
            } else {
              sendResponse({ ok: true, chimeCommand: null, ignored: true });
              break;
            }
          }

          this.updateBadge();
          this.cleanupWindowStages();
          const chimeCommand = await this.evaluateChimeCommand(message, sender);
          sendResponse({ ok: true, chimeCommand });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message });
        }
        break;
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (this.isChatGPTTab(tab.url)) {
      this.updateBadge();
      this.cleanupWindowStages();
    }
  }

  handleTabRemoved(tabId) {
    this.networkStatusByTab.delete(tabId);
    this.activeNetworkRequestsByTab.delete(tabId);
    this.updateBadge();
    this.cleanupWindowStages();
  }

  cleanTitle(title) {
    if (!title || typeof title !== "string") return "ChatGPT";
    return title.replace(/^(🔴|🟢|🟡)\s+/, "").trim();
  }

  inferStatusFromTitle(title) {
    if (!title || typeof title !== "string") return "ready";
    if (title.startsWith("🔴")) return "processing";
    if (title.startsWith("🟡")) return "uncertain";
    return "ready";
  }

  statusPrefix(status) {
    if (status === "processing") return "🔴 ";
    if (status === "uncertain") return "🟡 ";
    return "🟢 ";
  }

  async updateBadge() {
    try {
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter((tab) => this.isChatGPTTab(tab.url));

      const processingCount = chatGPTTabs.filter(
        (tab) => this.inferStatusFromTitle(tab.title) === "processing"
      ).length;
      const uncertainCount = chatGPTTabs.filter(
        (tab) => this.inferStatusFromTitle(tab.title) === "uncertain"
      ).length;
      const totalCount = chatGPTTabs.length;

      chrome.action.setBadgeText({ text: "" });

      const canvas = new OffscreenCanvas(19, 19);
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 19, 19);

      let count = totalCount;
      let textColor = "#166534";

      if (processingCount > 0) {
        count = processingCount;
        textColor = "#dc2626";
      } else if (uncertainCount > 0) {
        count = uncertainCount;
        textColor = "#b45309";
      }

      if (totalCount === 0) count = 0;

      ctx.fillStyle = textColor;
      ctx.font =
        "bold " +
        (count > 99 ? "12px" : count > 9 ? "16px" : "18px") +
        " Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(count > 99 ? "99+" : count.toString(), 9.5, 11);

      const imageData = ctx.getImageData(0, 0, 19, 19);
      chrome.action.setIcon({ imageData: { 19: imageData } });
    } catch (error) {
      // Ignore transient tab/service-worker errors.
    }
  }

  isChatGPTTab(url) {
    if (!url) return false;
    return (
      url.startsWith("https://chat.openai.com/c/") ||
      url.startsWith("https://chatgpt.com/c/") ||
      url === "https://chat.openai.com/" ||
      url === "https://chatgpt.com/" ||
      url.startsWith("https://chat.openai.com/?") ||
      url.startsWith("https://chatgpt.com/?")
    );
  }

  async getTabsByWindow() {
    try {
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter((tab) => this.isChatGPTTab(tab.url));
      const windows = {};

      for (const tab of chatGPTTabs) {
        if (!windows[tab.windowId]) windows[tab.windowId] = [];

        const status = this.inferStatusFromTitle(tab.title);
        const baseTitle = this.cleanTitle(tab.title);

        windows[tab.windowId].push({
          id: tab.id,
          status,
          baseTitle,
          title: this.statusPrefix(status) + baseTitle,
          url: tab.url,
        });
      }

      for (const windowId in windows) {
        windows[windowId].sort((a, b) =>
          a.baseTitle.localeCompare(b.baseTitle)
        );
      }

      return windows;
    } catch (error) {
      return {};
    }
  }

  async evaluateChimeCommand(message, sender) {
    const { status, oldStatus } = message;
    const windowId = sender.tab.windowId.toString();

    if (status === "processing" && oldStatus !== "processing") {
      const stage = this.windowStages[windowId] || { started: false };
      stage.started = true;
      this.windowStages[windowId] = stage;
      return "PLAY_PROCESSING_CHIME";
    }

    // Yellow is intentionally silent: it represents uncertainty/interruption,
    // not successful completion. If the same generation later finishes, the
    // ready transition still chimes.
    if (
      status === "ready" &&
      (oldStatus === "processing" || oldStatus === "uncertain")
    ) {
      try {
        const windows = await this.getTabsByWindow();
        const tabs = windows[windowId];

        if (!tabs || tabs.length === 0) return "PLAY_TAB_READY_CHIME";

        const allReady = tabs.every((tab) => tab.status === "ready");
        const stage = this.windowStages[windowId] || { started: false };

        if (allReady && stage.started) {
          stage.started = false;
          this.windowStages[windowId] = stage;
          return "PLAY_WINDOW_READY_CHIME";
        }

        return "PLAY_TAB_READY_CHIME";
      } catch (error) {
        return "PLAY_TAB_READY_CHIME";
      }
    }

    return null;
  }

  async cleanupWindowStages() {
    try {
      const windows = await this.getTabsByWindow();
      const knownWindowIds = new Set(Object.keys(windows));

      for (const windowId of Object.keys(this.windowStages)) {
        if (!knownWindowIds.has(windowId)) delete this.windowStages[windowId];
      }
    } catch (error) {
      // Ignore cleanup races.
    }
  }

  async getDebugInfo() {
    try {
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter((tab) => this.isChatGPTTab(tab.url));
      const potentialChatGPTTabs = allTabs.filter(
        (tab) =>
          tab.url &&
          (tab.url.includes("chatgpt.com") || tab.url.includes("chat.openai.com"))
      );

      const debugInfo = {
        totalChatGPTTabs: chatGPTTabs.length,
        allChatGPTTabs: [],
        potentialChatGPTCount: potentialChatGPTTabs.length,
        allMatchingUrls: potentialChatGPTTabs.map((tab) => ({
          id: tab.id,
          url: tab.url,
          matches: this.isChatGPTTab(tab.url),
        })),
      };

      for (const tab of chatGPTTabs) {
        const status = this.inferStatusFromTitle(tab.title);
        const baseTitle = this.cleanTitle(tab.title);
        const networkState = this.networkStatusByTab.get(tab.id);

        debugInfo.allChatGPTTabs.push({
          id: tab.id,
          currentTitle: tab.title,
          storedBaseTitle: baseTitle,
          url: tab.url,
          status,
          networkStatus: networkState?.status || null,
          activeNetworkRequests:
            this.activeNetworkRequestsByTab.get(tab.id)?.size || 0,
          windowId: tab.windowId,
        });
      }

      return debugInfo;
    } catch (error) {
      return {
        totalChatGPTTabs: 0,
        allChatGPTTabs: [],
        error: error.message,
      };
    }
  }
}

new ChatGPTTabManager();
