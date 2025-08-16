// Background script for managing tabs and updating badges/titles
class ChatGPTTabManager {
  constructor() {
    // Simplified state: tabId -> { status, baseTitle, url, windowId }
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
        });

        // Inject content script immediately for existing tabs
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
        } catch (scriptError) {
          console.log(
            `Background: Could not inject script into tab ${tab.id}:`,
            scriptError
          );
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
    for (const [tabId] of this.tabStatuses.entries()) {
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
new ChatGPTTabManager();
