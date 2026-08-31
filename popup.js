// Popup interface logic.
class PopupInterface {
  constructor() {
    this.tabsContainer = document.getElementById("tabs-container");
    this.refreshBtn = document.getElementById("refresh-btn");
    this.debugToggle = document.getElementById("debug-toggle");
    this.debugInfo = document.getElementById("debug-info");
    this.chimesToggle = document.getElementById("chimes-toggle");
    this.debugMode = false;
    this.settings = new Settings();
    this.init();
  }

  init() {
    this.chimesToggle.checked = this.settings.getChimesEnabled();
    this.chimesToggle.addEventListener("change", (event) => {
      this.settings.setChimesEnabled(event.target.checked);
    });

    this.refreshBtn.addEventListener("click", () => this.loadTabs());
    this.debugToggle.addEventListener("click", () => this.toggleDebugMode());

    this.loadTabs();
    this.refreshInterval = setInterval(() => this.loadTabs(), 500);
  }

  async sendMessage(message) {
    return await chrome.runtime.sendMessage(message);
  }

  async loadTabs() {
    try {
      const response = await this.sendMessage({ type: "GET_TABS" });
      this.renderTabs(response?.tabs || {});
      if (this.debugMode) this.loadDebugInfo();
    } catch (error) {
      this.tabsContainer.innerHTML = '<div class="no-tabs">Failed to load tabs</div>';
    }
  }

  renderTabs(tabsByWindow) {
    const entries = Object.entries(tabsByWindow);
    if (entries.length === 0) {
      this.tabsContainer.innerHTML = `
        <div class="no-tabs">
          No ChatGPT tabs found.<br>
          <small>Open chat.openai.com or chatgpt.com in a tab</small>
        </div>`;
      return;
    }

    this.tabsContainer.innerHTML = entries
      .map(([windowId, tabs]) => this.renderWindow(windowId, tabs))
      .join("");

    for (const item of this.tabsContainer.querySelectorAll(".tab-item[data-tab-id]")) {
      item.addEventListener("click", () => this.focusTab(Number(item.dataset.tabId)));
    }
  }

  renderWindow(windowId, tabs) {
    const items = tabs.map((tab) => this.renderTab(tab)).join("");
    return `
      <div class="window-group">
        <div class="window-header">
          <div class="window-title">Window ${this.escapeHtml(windowId)} (${tabs.length} tab${
      tabs.length === 1 ? "" : "s"
    })</div>
        </div>
        ${items}
      </div>`;
  }

  renderTab(tab) {
    const statusClass = this.getStatusClass(tab.status);
    const statusText = this.getStatusText(tab.status);
    const statusStyle = tab.status === "uncertain" ? ' style="background:#f0ad4e"' : "";
    const title = tab.title || tab.baseTitle || "ChatGPT";

    return `
      <div class="tab-item" data-tab-id="${Number(tab.id)}" style="cursor:pointer">
        <div class="status-indicator ${statusClass}"${statusStyle}></div>
        <div class="tab-title" title="${this.escapeHtml(tab.url || "")}">${this.escapeHtml(
      title
    )}</div>
        <div class="status-text">${statusText}</div>
      </div>`;
  }

  getStatusClass(status) {
    if (status === "processing") return "status-processing";
    if (status === "uncertain") return "status-uncertain";
    return "status-idle";
  }

  getStatusText(status) {
    if (status === "processing") return "AI responding...";
    if (status === "uncertain") return "Uncertain / interrupted";
    return "Ready";
  }

  async focusTab(tabId) {
    if (!Number.isFinite(tabId)) return;
    try {
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      window.close();
    } catch (error) {
      // Tab may have closed between refresh and click.
    }
  }

  toggleDebugMode() {
    this.debugMode = !this.debugMode;
    this.debugToggle.classList.toggle("active", this.debugMode);
    this.debugToggle.textContent = this.debugMode ? "Debug ON" : "Debug";
    this.debugInfo.classList.toggle("show", this.debugMode);
    if (this.debugMode) this.loadDebugInfo();
  }

  async loadDebugInfo() {
    try {
      const response = await this.sendMessage({ type: "GET_DEBUG_INFO" });
      const debugInfo = response?.debugInfo || {};

      document.getElementById("debug-tab-count").textContent =
        debugInfo.totalChatGPTTabs ?? 0;
      document.getElementById("debug-injection-status").textContent =
        "Status inferred from content-script state (red / green / yellow)";

      const tabs = debugInfo.allChatGPTTabs || [];
      document.getElementById("debug-tab-titles").innerHTML = tabs.length
        ? tabs
            .map(
              (tab) => `
                <div style="margin:4px 0;padding:4px;background:#e9ecef;border-radius:2px;">
                  <strong>Tab ${Number(tab.id)}:</strong><br>
                  Current: "${this.escapeHtml(tab.currentTitle || "")}"<br>
                  Clean: "${this.escapeHtml(tab.storedBaseTitle || "")}"<br>
                  Status: ${this.escapeHtml(tab.status || "unknown")}<br>
                  URL: ${this.escapeHtml(tab.url || "")}
                </div>`
            )
            .join("")
        : "No ChatGPT tabs found";
    } catch (error) {
      document.getElementById("debug-tab-count").textContent = "ERROR";
      document.getElementById("debug-injection-status").textContent =
        "Failed to load debug info";
      document.getElementById("debug-tab-titles").textContent = "";
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text ?? "");
    return div.innerHTML;
  }
}

let popupInstance;
const start = () => {
  popupInstance = new PopupInterface();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

window.addEventListener("beforeunload", () => {
  if (popupInstance?.refreshInterval) clearInterval(popupInstance.refreshInterval);
});
