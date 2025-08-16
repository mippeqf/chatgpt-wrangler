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
    console.log("Background: Starting to scan existing tabs");
    try {
      this.updateBadge();
      console.log("Background: Finished scanning existing tabs");
    } catch (error) {
      console.error("Error scanning existing tabs:", error);
    }
  }

  async handleMessage(message, sender, sendResponse) {
    console.log(`Background: Received message: ${message.type}`);

    switch (message.type) {
      case "GET_TABS":
        try {
          const tabs = await this.getTabsByWindow();
          console.log(
            `Background: Sending ${
              Object.keys(tabs).length
            } windows with tabs:`,
            tabs
          );
          sendResponse({ tabs: tabs });
        } catch (error) {
          console.error("Error getting tabs:", error);
          sendResponse({ tabs: {} });
        }
        break;
      case "GET_DEBUG_INFO":
        try {
          const debugInfo = await this.getDebugInfo();
          sendResponse({ debugInfo });
        } catch (error) {
          console.error("Error getting debug info:", error);
          sendResponse({ debugInfo: { error: error.message } });
        }
        break;
      case "PLAY_LOW_CHIME":
        // low chime request from content script when a tab completes
        try {
          await this.ensureOffscreen();
          chrome.runtime.sendMessage({ type: "PLAY_CHIME", variant: "low" });
          sendResponse({ ok: true });
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
      this.evaluateWindowChimes();
    }
  }

  handleTabRemoved(tabId) {
    // Update badge when any tab is removed
    this.updateBadge();
    this.evaluateWindowChimes();
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

      let badgeText = "";
      let badgeColor = "#28a745"; // Green by default

      if (totalCount === 0) {
        badgeText = "";
      } else if (processingCount > 0) {
        badgeText = `${processingCount}/${totalCount}`;
        badgeColor = "#dc3545"; // Red for processing
      } else {
        badgeText = totalCount.toString();
        badgeColor = "#28a745"; // Green for ready
      }

      chrome.action.setBadgeText({ text: badgeText });
      chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    } catch (error) {
      console.error("Error updating badge:", error);
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
      console.error("Error getting tabs by window:", error);
      return {};
    }
  }

  // Removed alarm-related methods and notifications

  async ensureOffscreen() {
    const offscreenUrl = "offscreen.html";
    // Try to create the offscreen document; if it already exists, this will throw which we ignore
    try {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play notification sound",
      });
    } catch (_) {
      // likely already exists
    }
  }

  async evaluateWindowChimes() {
    try {
      const windows = await this.getTabsByWindow();
      const knownWindowIds = new Set(Object.keys(windows));

      // Cleanup stages for windows that no longer exist
      for (const wid of Object.keys(this.windowStages)) {
        if (!knownWindowIds.has(wid)) {
          delete this.windowStages[wid];
        }
      }

      for (const [windowId, tabs] of Object.entries(windows)) {
        if (!tabs || tabs.length === 0) continue;
        const hasProcessing = tabs.some((t) => t.status === "processing");
        const allReady = tabs.every((t) => t.status === "ready");

        const stage = this.windowStages[windowId] || { started: false };
        if (!stage.started) {
          if (hasProcessing) {
            stage.started = true;
            this.windowStages[windowId] = stage;
          }
          continue;
        }

        if (allReady) {
          await this.ensureOffscreen();
          chrome.runtime.sendMessage({ type: "PLAY_CHIME" });
          // reset stage to wait for next processing cycle
          stage.started = false;
          this.windowStages[windowId] = stage;
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
      console.error("Error getting debug info:", error);
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
