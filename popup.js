// Popup interface logic
class PopupInterface {
  constructor() {
    this.tabsContainer = document.getElementById("tabs-container");
    this.refreshBtn = document.getElementById("refresh-btn");
    this.debugToggle = document.getElementById("debug-toggle");
    this.debugInfo = document.getElementById("debug-info");
    this.chimesToggle = document.getElementById("chimes-toggle");
    this.debugMode = false;
    this.currentTabsData = null;
    this.settings = new Settings();
    this.init();
  }

  init() {
    // Set up refresh button
    this.refreshBtn.addEventListener("click", () => {
      this.refreshTabs();
    });

    // Set up debug toggle
    this.debugToggle.addEventListener("click", () => {
      this.toggleDebugMode();
    });

    // Set up chimes toggle
    this.initChimesToggle();

    // Load initial tabs
    this.loadTabs();

    // Set up auto-refresh every 250ms
    this.refreshInterval = setInterval(() => {
      this.loadTabs();
    }, 250);
  }

  initChimesToggle() {
    // Load current setting and update UI
    const chimesEnabled = this.settings.getChimesEnabled();
    this.chimesToggle.checked = chimesEnabled;

    // Set up event listener
    this.chimesToggle.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      this.settings.setChimesEnabled(enabled);
      console.log(`Popup: Chimes ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  async loadTabs() {
    try {
      // Only show loading on first load
      if (!this.currentTabsData) {
        console.log("Popup: Loading tabs...");
        this.showLoading();
      }

      const tabs = await this.getTabsByWindow();
      this.updateTabs(tabs);
    } catch (error) {
      console.error("Error loading tabs:", error);
      this.showError("Failed to load tabs");
    }
  }

  showLoading() {
    this.tabsContainer.innerHTML = `
      <div class="no-tabs">
        Loading ChatGPT tabs...
      </div>
    `;
  }

  async refreshTabs() {
    try {
      this.refreshBtn.disabled = true;
      this.refreshBtn.textContent = "Refreshing...";

      await this.loadTabs();

      this.refreshBtn.disabled = false;
      this.refreshBtn.textContent = "Refresh";
    } catch (error) {
      console.error("Error refreshing tabs:", error);
      this.refreshBtn.disabled = false;
      this.refreshBtn.textContent = "Refresh";
      this.showError("Failed to refresh tabs");
    }
  }

  updateTabs(newTabsData) {
    const windowIds = Object.keys(newTabsData);

    if (windowIds.length === 0) {
      this.showNoTabs();
      this.currentTabsData = null;
      return;
    }

    // If this is the first load, do full render
    if (!this.currentTabsData) {
      this.displayTabs(newTabsData);
      this.currentTabsData = newTabsData;
      return;
    }

    // Compare and update only changed tabs
    this.updateChangedTabs(this.currentTabsData, newTabsData);
    this.currentTabsData = newTabsData;
  }

  displayTabs(tabsByWindow) {
    console.log("Popup: Displaying tabs:", tabsByWindow);

    const windowIds = Object.keys(tabsByWindow);

    if (windowIds.length === 0) {
      this.showNoTabs();
      return;
    }

    // Use template-based rendering
    const tabsHTML = this.renderTabsTemplate(tabsByWindow);
    this.tabsContainer.innerHTML = tabsHTML;

    // Attach event listeners after rendering
    this.attachTabEventListeners();
  }

  showNoTabs() {
    this.tabsContainer.innerHTML = `
      <div class="no-tabs">
        No ChatGPT tabs found.<br>
        <small>Open chat.openai.com or chatgpt.com in a tab</small>
      </div>
    `;
  }

  showError(message) {
    this.tabsContainer.innerHTML = `
      <div class="no-tabs" style="color: #dc3545;">
        Error: ${message}
      </div>
    `;
  }

  updateChangedTabs(oldData, newData) {
    // Create flat maps of tabs by ID for easy comparison
    const oldTabs = this.flattenTabsData(oldData);
    const newTabs = this.flattenTabsData(newData);

    // Check for new, removed, or changed tabs
    const oldTabIds = new Set(Object.keys(oldTabs));
    const newTabIds = new Set(Object.keys(newTabs));

    // If structure changed significantly, do full re-render
    if (this.hasStructuralChanges(oldData, newData)) {
      this.displayTabs(newData);
      return;
    }

    // Update individual tabs that changed
    for (const tabId of newTabIds) {
      const oldTab = oldTabs[tabId];
      const newTab = newTabs[tabId];

      if (!oldTab || this.tabChanged(oldTab, newTab)) {
        this.updateTabElement(tabId, newTab);
      }
    }

    // Remove tabs that no longer exist
    for (const tabId of oldTabIds) {
      if (!newTabIds.has(tabId)) {
        const tabElement = this.tabsContainer.querySelector(
          `[data-tab-id="${tabId}"]`
        );
        if (tabElement) {
          tabElement.remove();
        }
      }
    }

    // No alarm buttons anymore
  }

  flattenTabsData(tabsByWindow) {
    const flattened = {};
    for (const windowId in tabsByWindow) {
      for (const tab of tabsByWindow[windowId]) {
        flattened[tab.id] = { ...tab, windowId };
      }
    }
    return flattened;
  }

  hasStructuralChanges(oldData, newData) {
    const oldWindows = Object.keys(oldData).sort();
    const newWindows = Object.keys(newData).sort();

    // Check if window count changed
    if (oldWindows.length !== newWindows.length) {
      return true;
    }

    // Check if any window has different tab count
    for (const windowId of oldWindows) {
      if (
        !newData[windowId] ||
        oldData[windowId].length !== newData[windowId].length
      ) {
        return true;
      }
    }

    return false;
  }

  tabChanged(oldTab, newTab) {
    return (
      oldTab.title !== newTab.title ||
      oldTab.status !== newTab.status ||
      oldTab.url !== newTab.url
    );
  }

  updateTabElement(tabId, tab) {
    const tabElement = this.tabsContainer.querySelector(
      `[data-tab-id="${tabId}"]`
    );
    if (!tabElement) {
      // Tab doesn't exist in DOM, need full re-render
      this.displayTabs(this.currentTabsData);
      return;
    }

    console.log(`Updating tab ${tabId} with status: ${tab.status}`);

    // Update status indicator
    const statusIndicator = tabElement.querySelector(".status-indicator");
    if (statusIndicator) {
      const newStatusClass = this.getStatusClass(tab.status);
      console.log(`Setting status class: ${newStatusClass} for tab ${tabId}`);
      statusIndicator.className = `status-indicator ${newStatusClass}`;
    }

    // Update title
    const titleElement = tabElement.querySelector(".tab-title");
    if (titleElement) {
      const title = tab.title || tab.baseTitle || "ChatGPT";
      titleElement.textContent = title;
      titleElement.title = tab.url || "";
    }

    // Update status text
    const statusTextElement = tabElement.querySelector(".status-text");
    if (statusTextElement) {
      statusTextElement.textContent = this.getStatusText(tab.status);
    }
  }

  renderTabsTemplate(tabsByWindow) {
    return Object.entries(tabsByWindow)
      .map(([windowId, tabs]) => this.renderWindowTemplate(windowId, tabs))
      .join("");
  }

  renderWindowTemplate(windowId, tabs) {
    if (!tabs || tabs.length === 0) return "";

    const tabsHTML = tabs.map((tab) => this.renderTabTemplate(tab)).join("");

    return `
      <div class="window-group">
        <div class="window-header" data-window-id="${windowId}">
          <div class="window-title">Window ${windowId} (${tabs.length} tab${
      tabs.length === 1 ? "" : "s"
    })</div>
        </div>
        ${tabsHTML}
      </div>
    `;
  }

  renderTabTemplate(tab) {
    if (!tab || !tab.id) {
      console.warn("Popup: Invalid tab object:", tab);
      return "";
    }

    const statusClass = this.getStatusClass(tab.status);
    const statusText = this.getStatusText(tab.status);
    const title = tab.title || tab.baseTitle || "ChatGPT";

    return `
      <div class="tab-item" data-tab-id="${tab.id}">
        <div class="status-indicator ${statusClass}"></div>
        <div class="tab-title" title="${this.escapeHtml(
          tab.url || ""
        )}">${this.escapeHtml(title)}</div>
        <div class="status-text">${statusText}</div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  attachTabEventListeners() {
    try {
      // Attach click listeners to all tab items
      const tabItems = this.tabsContainer.querySelectorAll(
        ".tab-item[data-tab-id]"
      );
      tabItems.forEach((tabItem) => {
        const tabId = parseInt(tabItem.dataset.tabId);
        if (isNaN(tabId)) {
          console.warn("Popup: Invalid tab ID:", tabItem.dataset.tabId);
          return;
        }

        tabItem.style.cursor = "pointer";
        tabItem.addEventListener("click", () => {
          this.focusTab(tabId);
        });
      });

      // No alarm buttons anymore
    } catch (error) {
      console.error("Popup: Error attaching event listeners:", error);
    }
  }

  getStatusClass(status) {
    switch (status) {
      case "processing":
        return "status-processing";
      case "ready":
        return "status-idle"; // Use consistent naming
      default:
        return "status-idle";
    }
  }

  getStatusText(status) {
    switch (status) {
      case "processing":
        return "AI responding...";
      case "ready":
        return "Ready";
      default:
        return "Unknown";
    }
  }

  async focusTab(tabId) {
    try {
      // Switch to the tab
      await chrome.tabs.update(tabId, { active: true });

      // Get tab info to focus its window
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }

      // Close popup
      window.close();
    } catch (error) {
      console.error("Error focusing tab:", error);
    }
  }

  toggleDebugMode() {
    this.debugMode = !this.debugMode;

    if (this.debugMode) {
      this.debugToggle.classList.add("active");
      this.debugToggle.textContent = "Debug ON";
      this.debugInfo.classList.add("show");
      this.loadDebugInfo();
    } else {
      this.debugToggle.classList.remove("active");
      this.debugToggle.textContent = "Debug";
      this.debugInfo.classList.remove("show");
    }
  }

  async loadDebugInfo() {
    try {
      const debugInfo = await this.getDebugInfo();
      this.displayDebugInfo(debugInfo);
    } catch (error) {
      console.error("Error loading debug info:", error);
      this.displayDebugError("Failed to load debug info: " + error.message);
    }
  }

  displayDebugInfo(debugInfo) {
    // Update tab count
    document.getElementById("debug-tab-count").textContent =
      debugInfo.totalChatGPTTabs;

    // Remove injection status section
    const injectionStatus = document.getElementById("debug-injection-status");
    injectionStatus.innerHTML = "Status inference from titles only";

    // Update tab titles - show all ChatGPT tabs
    const tabTitles = document.getElementById("debug-tab-titles");
    const allTabs = debugInfo.allChatGPTTabs || [];

    if (allTabs.length === 0) {
      tabTitles.innerHTML = "No ChatGPT tabs found";
    } else {
      const tabsHtml = allTabs
        .map((tab) => {
          return `
          <div style="margin: 4px 0; padding: 4px; background: #e9ecef; border-radius: 2px;">
            <strong>Tab ${tab.id}:</strong><br>
            Current: "${tab.currentTitle}"<br>
            Clean: "${tab.storedBaseTitle}"<br>
            Status: ${tab.status}<br>
            URL: ${tab.url}
          </div>
        `;
        })
        .join("");

      tabTitles.innerHTML = tabsHtml;
    }

    if (debugInfo.error) {
      tabTitles.innerHTML += `<div style="color: red; margin-top: 8px;">Error: ${debugInfo.error}</div>`;
    }

    // Show debug info about URL matching
    if (debugInfo.potentialChatGPTCount && debugInfo.allMatchingUrls) {
      tabTitles.innerHTML += `
        <div style="margin-top: 12px; padding: 6px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 2px; font-size: 10px;">
          <strong>URL Matching Debug:</strong><br>
          Total tabs with chatgpt/openai URLs: ${
            debugInfo.potentialChatGPTCount
          }<br>
          Matched by filter: ${debugInfo.totalChatGPTTabs}<br>
          <details style="margin-top: 4px;">
            <summary>All ChatGPT-related URLs</summary>
            ${debugInfo.allMatchingUrls
              .map(
                (item) => `
              <div style="margin: 2px 0; font-family: monospace;">
                Tab ${item.id}: ${item.matches ? "✓" : "✗"} ${item.url}
              </div>
            `
              )
              .join("")}
          </details>
        </div>
      `;
    }
  }

  displayDebugError(message) {
    document.getElementById("debug-tab-count").textContent = "ERROR";
    document.getElementById("debug-injection-status").textContent = message;
    document.getElementById("debug-tab-titles").textContent = "";
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
}

// Initialize popup when DOM is ready
let popupInstance;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    popupInstance = new PopupInterface();
  });
} else {
  popupInstance = new PopupInterface();
}

// Clean up interval when popup is closed
window.addEventListener("beforeunload", () => {
  if (popupInstance && popupInstance.refreshInterval) {
    clearInterval(popupInstance.refreshInterval);
  }
});
