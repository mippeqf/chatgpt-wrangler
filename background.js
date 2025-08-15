// Background script for managing tabs and updating badges/titles
class ChatGPTTabManager {
  constructor() {
    this.tabStatuses = new Map(); // tabId -> { status, url, title, windowId, timestamp, originalTitle }
    this.init();
  }

  init() {
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // Listen for tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });

    // Listen for window focus changes to update popup
    chrome.windows.onFocusChanged.addListener(() => {
      this.updatePopup();
    });

    // Initial scan of existing tabs
    this.scanExistingTabs();
  }

  async scanExistingTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (this.isChatGPTTab(tab.url)) {
          this.tabStatuses.set(tab.id, {
            status: "ready",
            url: tab.url,
            title: tab.title,
            originalTitle: tab.title,
            windowId: tab.windowId,
            timestamp: Date.now(),
          });
        }
      }
      this.updateBadge();
    } catch (error) {
      console.error("Error scanning existing tabs:", error);
    }
  }

  handleMessage(message, sender, sendResponse) {
    try {
      if (message.type === "STATUS_CHANGE" && sender.tab) {
        this.updateTabStatus(sender.tab.id, message.status, sender.tab, message.title);
        sendResponse({ success: true });
      } else if (message.type === "GET_TABS") {
        sendResponse({ tabs: this.getTabsByWindow() });
      } else if (message.type === "REFRESH_TABS") {
        this.refreshAllTabs();
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep message channel open for async response
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (this.isChatGPTTab(tab.url)) {
      // Initialize or update tab info
      const existingStatus = this.tabStatuses.get(tabId);
      const status = existingStatus ? existingStatus.status : "ready";

      this.tabStatuses.set(tabId, {
        status: status,
        url: tab.url,
        title: tab.title,
        originalTitle: existingStatus
          ? existingStatus.originalTitle
          : tab.title,
        capturedTitle: existingStatus ? existingStatus.capturedTitle : null,
        windowId: tab.windowId,
        timestamp: existingStatus ? existingStatus.timestamp : Date.now(),
      });

      // If tab was reloaded, reset to ready
      if (changeInfo.status === "loading") {
        this.updateTabStatus(tabId, "ready", tab);
      }
    } else if (this.tabStatuses.has(tabId)) {
      // Tab navigated away from ChatGPT
      this.restoreTabTitle(tabId);
      this.tabStatuses.delete(tabId);
      this.updateBadge();
    }
  }

  handleTabRemoved(tabId) {
    if (this.tabStatuses.has(tabId)) {
      this.tabStatuses.delete(tabId);
      this.updateBadge();
    }
  }

  updateTabStatus(tabId, status, tab, currentTitle = null) {
    console.log(`Background: Updating tab ${tabId} status to ${status}`);

    const existingTab = this.tabStatuses.get(tabId);
    const titleToUse = currentTitle || tab.title;
    
    // When switching from processing to ready, capture the final title
    let capturedTitle = existingTab ? existingTab.capturedTitle : null;
    if (status === 'ready' && existingTab && existingTab.status === 'processing') {
      capturedTitle = titleToUse; // Capture title when processing finishes
    }
    
    const tabInfo = {
      status: status,
      url: tab.url,
      title: titleToUse,
      originalTitle: existingTab ? existingTab.originalTitle : titleToUse,
      capturedTitle: capturedTitle,
      windowId: tab.windowId,
      timestamp: Date.now(),
    };

    this.tabStatuses.set(tabId, tabInfo);

    // Update tab title and badge
    this.updateTabTitle(tabId, status);
    this.updateBadge();

    // Notify popup if open
    this.updatePopup();
  }

  updateTabTitle(tabId, status) {
    const tabInfo = this.tabStatuses.get(tabId);
    if (!tabInfo) return;

    chrome.tabs
      .get(tabId)
      .then((currentTab) => {
        let statusPrefix = "";
        let baseTitle = "";

        switch (status) {
          case "processing":
            statusPrefix = "🔴 ";
            baseTitle = currentTab.title.replace(/^🔴 |^🟢 /, ''); // Remove existing prefixes
            break;
          case "ready":
            statusPrefix = "🟢 ";
            // Use captured title from when processing finished, or current title
            baseTitle = (tabInfo.capturedTitle || currentTab.title).replace(/^🔴 |^🟢 /, '');
            break;
        }

        const targetTitle = statusPrefix + baseTitle;

        chrome.scripting
          .executeScript({
            target: { tabId: tabId },
            function: (title) => {
              document.title = title;
            },
            args: [targetTitle],
          })
          .catch((error) => {
            console.log(`Could not update title for tab ${tabId}:`, error);
          });
      })
      .catch((error) => {
        console.log(`Tab ${tabId} no longer exists:`, error);
        this.tabStatuses.delete(tabId);
        this.updateBadge();
      });
  }

  restoreTabTitle(tabId) {
    const tabInfo = this.tabStatuses.get(tabId);
    if (!tabInfo) return;

    chrome.tabs
      .get(tabId)
      .then(() => {
        chrome.scripting
          .executeScript({
            target: { tabId: tabId },
            function: (originalTitle) => {
              document.title = originalTitle;
            },
            args: [tabInfo.originalTitle || "ChatGPT"],
          })
          .catch((error) => {
            console.log(`Could not restore title for tab ${tabId}:`, error);
          });
      })
      .catch((error) => {
        console.log(`Tab ${tabId} no longer exists during restore:`, error);
      });
  }

  updateBadge() {
    const statuses = Array.from(this.tabStatuses.values());
    const processingCount = statuses.filter(
      (tab) => tab.status === "processing"
    ).length;
    const readyCount = statuses.filter((tab) => tab.status === "ready").length;

    let badgeText = "";
    let badgeColor = "#6c757d"; // gray default

    if (processingCount > 0) {
      badgeText = processingCount.toString();
      badgeColor = "#dc3545"; // red
    } else if (readyCount > 0) {
      badgeText = readyCount.toString();
      badgeColor = "#28a745"; // green
    }

    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  }

  isChatGPTTab(url) {
    if (!url) return false;
    return url.includes("chat.openai.com") || url.includes("chatgpt.com");
  }

  getTabsByWindow() {
    const windows = new Map();

    for (const [tabId, tabInfo] of this.tabStatuses.entries()) {
      const windowId = tabInfo.windowId;

      if (!windows.has(windowId)) {
        windows.set(windowId, []);
      }

      windows.get(windowId).push({
        id: tabId,
        ...tabInfo,
      });
    }

    // Convert to object for easier serialization
    const result = {};
    for (const [windowId, tabs] of windows.entries()) {
      result[windowId] = tabs.sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
  }

  updatePopup() {
    // Send message to popup if it's open
    chrome.runtime
      .sendMessage({
        type: "TABS_UPDATED",
        tabs: this.getTabsByWindow(),
      })
      .catch(() => {
        // Popup might not be open, ignore error
      });
  }

  async refreshAllTabs() {
    // Re-inject content scripts to all ChatGPT tabs
    for (const [tabId, tabInfo] of this.tabStatuses.entries()) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        });
      } catch (error) {
        console.log(`Could not refresh tab ${tabId}:`, error);
      }
    }

    this.updatePopup();
  }
}

// Initialize the tab manager
const tabManager = new ChatGPTTabManager();
