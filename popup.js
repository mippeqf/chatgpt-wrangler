// Popup interface logic
class PopupInterface {
  constructor() {
    this.tabsContainer = document.getElementById('tabs-container');
    this.refreshBtn = document.getElementById('refresh-btn');
    this.init();
  }

  init() {
    // Load initial tabs
    this.loadTabs();
    
    // Set up refresh button
    this.refreshBtn.addEventListener('click', () => {
      this.refreshTabs();
    });
    
    // Listen for updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'TABS_UPDATED') {
        this.displayTabs(message.tabs);
      }
    });
    
    // Auto-refresh every 5 seconds
    setInterval(() => this.loadTabs(), 5000);
  }

  async loadTabs() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
      if (response && response.tabs) {
        this.displayTabs(response.tabs);
      }
    } catch (error) {
      console.error('Error loading tabs:', error);
      this.showError('Failed to load tabs');
    }
  }

  async refreshTabs() {
    try {
      this.refreshBtn.disabled = true;
      this.refreshBtn.textContent = 'Refreshing...';
      
      await chrome.runtime.sendMessage({ type: 'REFRESH_TABS' });
      await this.loadTabs();
      
      this.refreshBtn.disabled = false;
      this.refreshBtn.textContent = 'Refresh';
    } catch (error) {
      console.error('Error refreshing tabs:', error);
      this.refreshBtn.disabled = false;
      this.refreshBtn.textContent = 'Refresh';
      this.showError('Failed to refresh tabs');
    }
  }

  displayTabs(tabsByWindow) {
    this.tabsContainer.innerHTML = '';
    
    const windowIds = Object.keys(tabsByWindow);
    
    if (windowIds.length === 0) {
      this.showNoTabs();
      return;
    }

    windowIds.forEach(windowId => {
      const tabs = tabsByWindow[windowId];
      if (tabs && tabs.length > 0) {
        this.createWindowGroup(parseInt(windowId), tabs);
      }
    });
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

  createWindowGroup(windowId, tabs) {
    const windowGroup = document.createElement('div');
    windowGroup.className = 'window-group';

    // Create window header
    const windowHeader = document.createElement('div');
    windowHeader.className = 'window-header';
    windowHeader.textContent = `Window ${windowId} (${tabs.length} tab${tabs.length === 1 ? '' : 's'})`;
    windowGroup.appendChild(windowHeader);

    // Create tabs
    tabs.forEach(tab => {
      const tabItem = this.createTabItem(tab);
      windowGroup.appendChild(tabItem);
    });

    this.tabsContainer.appendChild(windowGroup);
  }

  createTabItem(tab) {
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';

    // Status indicator
    const statusIndicator = document.createElement('div');
    statusIndicator.className = `status-indicator status-${tab.status}`;
    tabItem.appendChild(statusIndicator);

    // Tab title
    const tabTitle = document.createElement('div');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = tab.title || 'ChatGPT';
    tabTitle.title = tab.url; // Show URL on hover
    tabItem.appendChild(tabTitle);

    // Status text
    const statusText = document.createElement('div');
    statusText.className = 'status-text';
    statusText.style.fontSize = '11px';
    statusText.style.color = '#6c757d';
    statusText.textContent = this.getStatusText(tab.status);
    tabItem.appendChild(statusText);

    // Click to focus tab
    tabItem.style.cursor = 'pointer';
    tabItem.addEventListener('click', () => {
      this.focusTab(tab.id);
    });

    return tabItem;
  }

  getStatusText(status) {
    switch (status) {
      case 'processing':
        return 'AI responding...';
      case 'completed':
        return 'Response ready';
      case 'idle':
        return 'Ready';
      default:
        return 'Unknown';
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
      console.error('Error focusing tab:', error);
    }
  }
}

// Initialize popup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupInterface());
} else {
  new PopupInterface();
}