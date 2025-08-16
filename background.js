// Background script for managing tabs and updating badges/titles
class ChatGPTTabManager {
  constructor() {
    // Simplified state: tabId -> { status, baseTitle, url, windowId, contentScriptInjected }
    this.tabStatuses = new Map();
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

    chrome.windows.onFocusChanged.addListener(() => {
      this.updatePopup();
    });

    this.scanExistingTabs();
  }

  async scanExistingTabs() {
    console.log("Background: Starting to scan existing tabs");
    try {
      // Query specifically for ChatGPT tabs first for better performance
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter((tab) => this.isChatGPTTab(tab.url));

      console.log(
        `Background: Found ${chatGPTTabs.length} ChatGPT tabs out of ${allTabs.length} total tabs`
      );

      for (const tab of chatGPTTabs) {
        console.log(`Background: Initializing tab ${tab.id}: ${tab.title}`);
        // Initialize with a neutral state, content script will provide status
        this.tabStatuses.set(tab.id, {
          status: "ready", // Assume ready until told otherwise
          baseTitle: this.cleanTitle(tab.title) || "ChatGPT",
          url: tab.url,
          windowId: tab.windowId,
          contentScriptInjected: false,
        });

        // Inject content script immediately for existing tabs
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
          // Mark as injected if successful
          const tabInfo = this.tabStatuses.get(tab.id);
          if (tabInfo) {
            tabInfo.contentScriptInjected = true;
          }
        } catch (scriptError) {
          console.log(
            `Background: Could not inject script into tab ${tab.id}:`,
            scriptError
          );
          // Mark as failed injection
          const tabInfo = this.tabStatuses.get(tab.id);
          if (tabInfo) {
            tabInfo.contentScriptInjected = false;
          }
        }
      }

      this.updateBadge();
      this.updatePopup(); // Ensure popup gets updated immediately
      console.log("Background: Finished scanning existing tabs");
    } catch (error) {
      console.error("Error scanning existing tabs:", error);
    }
  }

  handleMessage(message, sender, sendResponse) {
    console.log(`Background: Received message: ${message.type}`);

    switch (message.type) {
      case "STATUS_CHANGE":
        if (!sender.tab) return;
        this.updateTabStatus(
          sender.tab.id,
          message.status,
          sender.tab,
          message.baseTitle
        );
        sendResponse({ success: true });
        break;
      case "GET_TABS":
        const tabs = this.getTabsByWindow();
        console.log(
          `Background: Sending ${Object.keys(tabs).length} windows with tabs:`,
          tabs
        );
        sendResponse({ tabs: tabs });
        break;
      case "REFRESH_TABS":
        this.refreshAllTabs();
        sendResponse({ success: true });
        break;
      case "GET_DEBUG_INFO":
        this.getDebugInfo().then(debugInfo => {
          sendResponse({ debugInfo });
        });
        break;
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (this.isChatGPTTab(tab.url)) {
      const existingTab = this.tabStatuses.get(tabId);

      // If it's a new tab or the URL changed, initialize its state
      if (!existingTab || existingTab.url !== tab.url) {
        this.tabStatuses.set(tabId, {
          status: "ready", // Default to ready
          baseTitle: this.cleanTitle(tab.title),
          url: tab.url,
          windowId: tab.windowId,
          contentScriptInjected: false,
        });
      }

      // If the tab has finished loading, ensure content script is there
      if (changeInfo.status === "complete") {
        // Content script will handle title updates automatically
      }
    } else if (this.tabStatuses.has(tabId)) {
      // Tab navigated away from a ChatGPT URL
      this.tabStatuses.delete(tabId);
      this.updateBadge();
      this.updatePopup();
    }
  }

  handleTabRemoved(tabId) {
    if (this.tabStatuses.has(tabId)) {
      this.tabStatuses.delete(tabId);
      this.updateBadge();
      this.updatePopup();
    }
  }

  updateTabStatus(tabId, newStatus, tab, baseTitle) {
    console.log(`Background: Updating tab ${tabId} status to ${newStatus}`);

    try {
      const existingTab = this.tabStatuses.get(tabId) || {};

      // Ensure we have a valid baseTitle
      let finalBaseTitle = baseTitle;
      if (!finalBaseTitle) {
        finalBaseTitle =
          existingTab.baseTitle || this.cleanTitle(tab.title) || "ChatGPT";
      }

      this.tabStatuses.set(tabId, {
        ...existingTab,
        status: newStatus,
        baseTitle: finalBaseTitle,
        url: tab.url,
        windowId: tab.windowId,
      });

      this.updateBadge();
      this.updatePopup();
    } catch (error) {
      console.error(`Background: Error updating tab ${tabId} status:`, error);
    }
  }

  cleanTitle(title) {
    if (!title || typeof title !== "string") return "ChatGPT";
    return title.replace(/^(🔴|🟢)\s+/, "").trim();
  }

  updateBadge() {
    const statuses = Array.from(this.tabStatuses.values());
    const processingCount = statuses.filter(
      (tab) => tab.status === "processing"
    ).length;

    let badgeText = "";
    let badgeColor = "#dc3545"; // Red for processing

    if (processingCount > 0) {
      badgeText = processingCount.toString();
    } else {
      badgeText = ""; // No text if nothing is processing
    }

    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
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

  getTabsByWindow() {
    const windows = {};
    for (const [tabId, tabInfo] of this.tabStatuses.entries()) {
      const { windowId, ...rest } = tabInfo;
      if (!windows[windowId]) {
        windows[windowId] = [];
      }
      windows[windowId].push({ id: tabId, ...rest });
    }
    // Add a title property to each tab for the popup
    for (const windowId in windows) {
      windows[windowId].forEach((tab) => {
        let prefix = tab.status === "processing" ? "🔴 " : "🟢 ";
        tab.title = prefix + tab.baseTitle;
      });
      windows[windowId].sort((a, b) => a.baseTitle.localeCompare(b.baseTitle));
    }
    return windows;
  }

  updatePopup() {
    chrome.runtime
      .sendMessage({
        type: "TABS_UPDATED",
        tabs: this.getTabsByWindow(),
      })
      .catch(() => {
        /* Popup not open, ignore */
      });
  }

  async refreshAllTabs() {
    try {
      // Get ALL ChatGPT tabs, not just tracked ones
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter(tab => this.isChatGPTTab(tab.url));
      
      console.log(`Background: Refreshing ${chatGPTTabs.length} ChatGPT tabs`);
      
      for (const tab of chatGPTTabs) {
        try {
          // Initialize state for untracked tabs
          if (!this.tabStatuses.has(tab.id)) {
            this.tabStatuses.set(tab.id, {
              status: "ready",
              baseTitle: this.cleanTitle(tab.title) || "ChatGPT",
              url: tab.url,
              windowId: tab.windowId,
              contentScriptInjected: false,
            });
          }
          
          // Inject content script
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
          
          // Mark as injected
          const tabInfo = this.tabStatuses.get(tab.id);
          if (tabInfo) {
            tabInfo.contentScriptInjected = true;
          }
          
          console.log(`Background: Successfully refreshed tab ${tab.id}`);
        } catch (error) {
          console.log(`Background: Could not refresh tab ${tab.id}:`, error);
          // Mark injection as failed
          const tabInfo = this.tabStatuses.get(tab.id);
          if (tabInfo) {
            tabInfo.contentScriptInjected = false;
          }
        }
      }
      
      this.updateBadge();
      this.updatePopup();
    } catch (error) {
      console.error('Error in refreshAllTabs:', error);
    }
  }

  async getDebugInfo() {
    try {
      // Get all tabs to compare with our tracked tabs
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter(tab => this.isChatGPTTab(tab.url));
      
      // Debug: Also get tabs that might be ChatGPT but don't match our filter
      const potentialChatGPTTabs = allTabs.filter(tab => 
        tab.url && (
          tab.url.includes('chatgpt.com') || 
          tab.url.includes('chat.openai.com')
        )
      );
      
      const debugInfo = {
        totalChatGPTTabs: chatGPTTabs.length,
        trackedTabs: this.tabStatuses.size,
        tabs: [],
        allChatGPTTabs: [],
        potentialChatGPTCount: potentialChatGPTTabs.length,
        allMatchingUrls: potentialChatGPTTabs.map(tab => ({ id: tab.id, url: tab.url, matches: this.isChatGPTTab(tab.url) }))
      };

      // Get current titles and injection status for each tracked tab
      for (const [tabId, tabInfo] of this.tabStatuses.entries()) {
        try {
          const currentTab = await chrome.tabs.get(tabId);
          debugInfo.tabs.push({
            id: tabId,
            currentTitle: currentTab.title,
            storedBaseTitle: tabInfo.baseTitle,
            url: tabInfo.url,
            status: tabInfo.status,
            contentScriptInjected: tabInfo.contentScriptInjected,
            windowId: tabInfo.windowId,
            tracked: true
          });
        } catch (error) {
          // Tab might have been closed
          debugInfo.tabs.push({
            id: tabId,
            currentTitle: "ERROR: Tab not found",
            storedBaseTitle: tabInfo.baseTitle,
            url: tabInfo.url,
            status: tabInfo.status,
            contentScriptInjected: tabInfo.contentScriptInjected,
            windowId: tabInfo.windowId,
            tracked: true
          });
        }
      }

      // Get all ChatGPT tabs (tracked and untracked)
      for (const tab of chatGPTTabs) {
        const tabInfo = this.tabStatuses.get(tab.id);
        debugInfo.allChatGPTTabs.push({
          id: tab.id,
          currentTitle: tab.title,
          storedBaseTitle: tabInfo ? tabInfo.baseTitle : this.cleanTitle(tab.title),
          url: tab.url,
          status: tabInfo ? tabInfo.status : 'untracked',
          contentScriptInjected: tabInfo ? tabInfo.contentScriptInjected : false,
          windowId: tab.windowId,
          tracked: !!tabInfo
        });
      }

      return debugInfo;
    } catch (error) {
      console.error('Error getting debug info:', error);
      return {
        totalChatGPTTabs: 0,
        trackedTabs: 0,
        tabs: [],
        allChatGPTTabs: [],
        error: error.message
      };
    }
  }
}

// Initialize the tab manager
new ChatGPTTabManager();
