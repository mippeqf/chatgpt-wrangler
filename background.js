// Background script for managing tabs and updating badges/titles
class ChatGPTTabManager {
  constructor() {
    this.windowStages = {};
    this.init();
  }

  init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });

    // No storage listener needed after removing alarms

    this.scanExistingTabs();
    // No periodic evaluation after removing alarms
  }

  async scanExistingTabs() {
    try {
      this.updateBadge();
    } catch (error) {
    }
  }

  async handleMessage(message, sender, sendResponse) {

    switch (message.type) {
      case "GET_TABS":
        try {
          const tabs = await this.getTabsByWindow();
          sendResponse({ tabs: tabs });
        } catch (error) {
          sendResponse({ tabs: {} });
        }
        break;
      case "GET_DEBUG_INFO":
        try {
          const debugInfo = await this.getDebugInfo();
          sendResponse({ debugInfo });
        } catch (error) {
          sendResponse({ debugInfo: { error: error.message } });
        }
        break;
      case "STATUS_UPDATE":
        // Tab status changed - determine which chime to play
        try {
          this.updateBadge();
          this.cleanupWindowStages();
          const chimeCommand = await this.evaluateChimeCommand(message, sender);
          sendResponse({ ok: true, chimeCommand });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message });
        }
        break;
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (this.isChatGPTTab(tab.url)) {
      // Update badge when ChatGPT tabs change
      this.updateBadge();
      this.cleanupWindowStages();
    }
  }

  handleTabRemoved(tabId) {
    // Update badge when any tab is removed
    this.updateBadge();
    this.cleanupWindowStages();
  }

  cleanTitle(title) {
    if (!title || typeof title !== "string") return "ChatGPT";
    return title.replace(/^(🔴|🟢)\s+/, "").trim();
  }

  inferStatusFromTitle(title) {
    if (!title || typeof title !== "string") return "ready";

    // Check for red circle emoji indicating processing
    if (title.startsWith("🔴")) {
      return "processing";
    }

    // Check for green circle emoji or default to ready
    return "ready";
  }

  async updateBadge() {
    try {
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter((tab) => this.isChatGPTTab(tab.url));

      const processingCount = chatGPTTabs.filter(
        (tab) => this.inferStatusFromTitle(tab.title) === "processing"
      ).length;

      const totalCount = chatGPTTabs.length;

      // Clear badge and use dynamic icon instead
      chrome.action.setBadgeText({ text: "" });

      // Generate dynamic icon with count
      const canvas = new OffscreenCanvas(19, 19);
      const ctx = canvas.getContext("2d");

      // Clear canvas with transparent background
      ctx.clearRect(0, 0, 19, 19);

      if (totalCount > 0) {
        const count = processingCount > 0 ? processingCount : totalCount;
        const textColor = processingCount > 0 ? "#dc2626" : "#166534"; // Red or dark green

        // Draw text only (no background)
        ctx.fillStyle = textColor;
        ctx.font =
          "bold " +
          (count > 99 ? "12px" : count > 9 ? "16px" : "18px") +
          " Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(count > 99 ? "99+" : count.toString(), 9.5, 11);
      }

      // Convert canvas to ImageData and set as icon
      const imageData = ctx.getImageData(0, 0, 19, 19);
      chrome.action.setIcon({ imageData: { 19: imageData } });
    } catch (error) {
    }
  }

  isChatGPTTab(url) {
    if (!url) return false;
    // Monitor actual chat pages and the main chat interface
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
        if (!windows[tab.windowId]) {
          windows[tab.windowId] = [];
        }

        const status = this.inferStatusFromTitle(tab.title);
        const baseTitle = this.cleanTitle(tab.title);
        const prefix = status === "processing" ? "🔴 " : "🟢 ";

        windows[tab.windowId].push({
          id: tab.id,
          status: status,
          baseTitle: baseTitle,
          title: prefix + baseTitle,
          url: tab.url,
        });
      }

      // Sort tabs in each window
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

  // Removed alarm-related methods and notifications

  // Offscreen methods no longer needed - chimes play directly in content scripts

  async evaluateChimeCommand(message, sender) {
    const { status, oldStatus } = message;
    const windowId = sender.tab.windowId.toString();
    
    // Processing chime - also mark window stage as started
    if (status === "processing" && oldStatus !== "processing") {
      const stage = this.windowStages[windowId] || { started: false };
      stage.started = true;
      this.windowStages[windowId] = stage;
      return "PLAY_PROCESSING_CHIME";
    }
    
    // Ready chime - check if this completes the window
    if (status === "ready" && oldStatus === "processing") {
      try {
        const windows = await this.getTabsByWindow();
        const tabs = windows[windowId];
        
        if (!tabs || tabs.length === 0) {
          return "PLAY_TAB_READY_CHIME"; // Fallback to tab chime
        }
        
        // Check if all tabs in window are ready
        const allReady = tabs.every((t) => t.status === "ready");
        const stage = this.windowStages[windowId] || { started: false };
        
        if (allReady && stage.started) {
          // Window complete! Reset stage and play window chime
          stage.started = false;
          this.windowStages[windowId] = stage;
          return "PLAY_WINDOW_READY_CHIME";
        } else {
          // Just this tab is ready
          return "PLAY_TAB_READY_CHIME";
        }
      } catch (error) {
        return "PLAY_TAB_READY_CHIME"; // Fallback
      }
    }
    
    // No chime needed
    return null;
  }

  async cleanupWindowStages() {
    try {
      const windows = await this.getTabsByWindow();
      const knownWindowIds = new Set(Object.keys(windows));

      // Cleanup stages for windows that no longer exist
      for (const wid of Object.keys(this.windowStages)) {
        if (!knownWindowIds.has(wid)) {
          delete this.windowStages[wid];
        }
      }
    } catch (e) {
      // ignore
    }
  }

  async getDebugInfo() {
    try {
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter((tab) => this.isChatGPTTab(tab.url));

      // Debug: Also get tabs that might be ChatGPT but don't match our filter
      const potentialChatGPTTabs = allTabs.filter(
        (tab) =>
          tab.url &&
          (tab.url.includes("chatgpt.com") ||
            tab.url.includes("chat.openai.com"))
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

      // Get all ChatGPT tabs with inferred status
      for (const tab of chatGPTTabs) {
        const status = this.inferStatusFromTitle(tab.title);
        const baseTitle = this.cleanTitle(tab.title);

        debugInfo.allChatGPTTabs.push({
          id: tab.id,
          currentTitle: tab.title,
          storedBaseTitle: baseTitle,
          url: tab.url,
          status: status,
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

  // Message bus for offscreen chime
  // The offscreen document listens for PLAY_CHIME and plays an audio.
}

// Initialize the tab manager
new ChatGPTTabManager();
