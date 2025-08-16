// Background script for managing tabs and updating badges/titles
class ChatGPTTabManager {
  constructor() {
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
      this.updateBadge();
      this.updatePopup();
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
            `Background: Sending ${Object.keys(tabs).length} windows with tabs:`,
            tabs
          );
          sendResponse({ tabs: tabs });
        } catch (error) {
          console.error('Error getting tabs:', error);
          sendResponse({ tabs: {} });
        }
        break;
      case "REFRESH_TABS":
        this.updatePopup();
        sendResponse({ success: true });
        break;
      case "GET_DEBUG_INFO":
        try {
          const debugInfo = await this.getDebugInfo();
          sendResponse({ debugInfo });
        } catch (error) {
          console.error('Error getting debug info:', error);
          sendResponse({ debugInfo: { error: error.message } });
        }
        break;
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    if (this.isChatGPTTab(tab.url)) {
      // Update badge and popup when ChatGPT tabs change
      this.updateBadge();
      this.updatePopup();
    }
  }

  handleTabRemoved(tabId) {
    // Update badge and popup when any tab is removed
    this.updateBadge();
    this.updatePopup();
  }


  cleanTitle(title) {
    if (!title || typeof title !== "string") return "ChatGPT";
    return title.replace(/^(🔴|🟢)\s+/, "").trim();
  }

  inferStatusFromTitle(title) {
    if (!title || typeof title !== "string") return "ready";
    
    // Check for common patterns that indicate processing
    const processingPatterns = [
      /thinking/i,
      /generating/i,
      /loading/i,
      /processing/i,
      /writing/i,
      /typing/i,
      /working/i
    ];
    
    return processingPatterns.some(pattern => pattern.test(title)) ? "processing" : "ready";
  }

  async updateBadge() {
    try {
      const allTabs = await chrome.tabs.query({});
      const chatGPTTabs = allTabs.filter(tab => this.isChatGPTTab(tab.url));
      
      const processingCount = chatGPTTabs.filter(tab => 
        this.inferStatusFromTitle(tab.title) === "processing"
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
      console.error('Error updating badge:', error);
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
      const chatGPTTabs = allTabs.filter(tab => this.isChatGPTTab(tab.url));
      
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
          url: tab.url
        });
      }
      
      // Sort tabs in each window
      for (const windowId in windows) {
        windows[windowId].sort((a, b) => a.baseTitle.localeCompare(b.baseTitle));
      }
      
      return windows;
    } catch (error) {
      console.error('Error getting tabs by window:', error);
      return {};
    }
  }

  async updatePopup() {
    try {
      const tabs = await this.getTabsByWindow();
      chrome.runtime
        .sendMessage({
          type: "TABS_UPDATED",
          tabs: tabs,
        })
        .catch(() => {
          /* Popup not open, ignore */
        });
    } catch (error) {
      console.error('Error updating popup:', error);
    }
  }


  async getDebugInfo() {
    try {
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
        allChatGPTTabs: [],
        potentialChatGPTCount: potentialChatGPTTabs.length,
        allMatchingUrls: potentialChatGPTTabs.map(tab => ({ id: tab.id, url: tab.url, matches: this.isChatGPTTab(tab.url) }))
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
          windowId: tab.windowId
        });
      }

      return debugInfo;
    } catch (error) {
      console.error('Error getting debug info:', error);
      return {
        totalChatGPTTabs: 0,
        allChatGPTTabs: [],
        error: error.message
      };
    }
  }
}

// Initialize the tab manager
new ChatGPTTabManager();
