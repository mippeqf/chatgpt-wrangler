// Popup interface logic
class PopupInterface {
  constructor() {
    this.tabsContainer = document.getElementById('tabs-container');
    this.refreshBtn = document.getElementById('refresh-btn');
    this.init();
  }

  init() {
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
    
    // Load initial tabs after setting up listeners
    this.loadTabs();
  }

  async loadTabs(retryCount = 0) {
    try {
      console.log('Popup: Loading tabs...');
      this.showLoading();
      
      const response = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
      console.log('Popup: Received response:', response);
      
      if (response && response.tabs) {
        this.displayTabs(response.tabs);
      } else if (retryCount < 2) {
        // Retry up to 2 times with a short delay
        console.log(`Popup: No tabs found, retrying... (attempt ${retryCount + 1})`);
        setTimeout(() => this.loadTabs(retryCount + 1), 500);
      } else {
        console.log('Popup: No tabs found after retries, showing no tabs message');
        this.showNoTabs();
      }
    } catch (error) {
      console.error('Error loading tabs:', error);
      if (retryCount < 2) {
        console.log(`Popup: Error occurred, retrying... (attempt ${retryCount + 1})`);
        setTimeout(() => this.loadTabs(retryCount + 1), 500);
      } else {
        this.showError('Failed to load tabs');
      }
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
    console.log('Popup: Displaying tabs:', tabsByWindow);
    
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

  renderTabsTemplate(tabsByWindow) {
    return Object.entries(tabsByWindow)
      .map(([windowId, tabs]) => this.renderWindowTemplate(windowId, tabs))
      .join('');
  }

  renderWindowTemplate(windowId, tabs) {
    if (!tabs || tabs.length === 0) return '';
    
    const tabsHTML = tabs.map(tab => this.renderTabTemplate(tab)).join('');
    
    return `
      <div class="window-group">
        <div class="window-header">
          Window ${windowId} (${tabs.length} tab${tabs.length === 1 ? '' : 's'})
        </div>
        ${tabsHTML}
      </div>
    `;
  }

  renderTabTemplate(tab) {
    if (!tab || !tab.id) {
      console.warn('Popup: Invalid tab object:', tab);
      return '';
    }
    
    const statusClass = this.getStatusClass(tab.status);
    const statusText = this.getStatusText(tab.status);
    const title = tab.title || tab.baseTitle || 'ChatGPT';
    
    return `
      <div class="tab-item" data-tab-id="${tab.id}">
        <div class="status-indicator ${statusClass}"></div>
        <div class="tab-title" title="${this.escapeHtml(tab.url || '')}">${this.escapeHtml(title)}</div>
        <div class="status-text">${statusText}</div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  attachTabEventListeners() {
    try {
      // Attach click listeners to all tab items
      const tabItems = this.tabsContainer.querySelectorAll('.tab-item[data-tab-id]');
      tabItems.forEach(tabItem => {
        const tabId = parseInt(tabItem.dataset.tabId);
        if (isNaN(tabId)) {
          console.warn('Popup: Invalid tab ID:', tabItem.dataset.tabId);
          return;
        }
        
        tabItem.style.cursor = 'pointer';
        tabItem.addEventListener('click', () => {
          this.focusTab(tabId);
        });
      });
    } catch (error) {
      console.error('Popup: Error attaching event listeners:', error);
    }
  }


  getStatusClass(status) {
    switch (status) {
      case 'processing':
        return 'status-processing';
      case 'ready':
        return 'status-idle'; // Use consistent naming
      default:
        return 'status-idle';
    }
  }

  getStatusText(status) {
    switch (status) {
      case 'processing':
        return 'AI responding...';
      case 'ready':
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