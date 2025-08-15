// Content script for monitoring ChatGPT UI elements
class ChatGPTMonitor {
  constructor() {
    this.currentStatus = 'idle';
    this.observer = null;
    this.init();
  }

  init() {
    // Wait for page to be fully loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startMonitoring());
    } else {
      this.startMonitoring();
    }
  }

  startMonitoring() {
    console.log('ChatGPT Monitor: Starting to monitor page');
    
    // Initial status check
    this.checkStatus();
    
    // Set up mutation observer to watch for DOM changes
    this.setupMutationObserver();
    
    // Also check periodically as a fallback
    setInterval(() => this.checkStatus(), 1000);
  }

  setupMutationObserver() {
    this.observer = new MutationObserver((mutations) => {
      // Check if any mutations affect the elements we're monitoring
      const shouldCheck = mutations.some(mutation => {
        if (mutation.type === 'childList') {
          // Check if added/removed nodes contain our target elements
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          return nodes.some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              return this.containsRelevantElement(node);
            }
            return false;
          });
        }
        if (mutation.type === 'attributes') {
          // Check if attribute changes are on elements we care about
          return this.isRelevantElement(mutation.target);
        }
        return false;
      });

      if (shouldCheck) {
        this.checkStatus();
      }
    });

    // Start observing
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class', 'aria-disabled']
    });
  }

  containsRelevantElement(element) {
    // Check if element or its descendants contain send/stop buttons
    const selectors = [
      '[data-testid="send-button"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Stop"]',
      'button:has(svg[data-icon="paper-plane"])',
      'button:has(svg[data-icon="stop"])',
      '.btn-primary:has(svg)',
      'button:has([data-icon="paper-plane"])',
      'button:has([data-icon="stop"])'
    ];

    return selectors.some(selector => {
      try {
        return element.querySelector && element.querySelector(selector);
      } catch (e) {
        return false;
      }
    });
  }

  isRelevantElement(element) {
    // Check if the element itself is a send/stop button
    const selectors = [
      '[data-testid="send-button"]',
      '[data-testid="stop-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Stop"]'
    ];

    return selectors.some(selector => {
      try {
        return element.matches && element.matches(selector);
      } catch (e) {
        return false;
      }
    });
  }

  checkStatus() {
    // Check if extension context is still valid
    if (!chrome.runtime || !chrome.runtime.id) {
      console.log('ChatGPT Monitor: Extension context invalidated, stopping monitoring');
      this.destroy();
      return;
    }

    const newStatus = this.detectStatus();
    
    if (newStatus !== this.currentStatus) {
      console.log(`ChatGPT Monitor: Status changed from ${this.currentStatus} to ${newStatus}`);
      this.currentStatus = newStatus;
      this.notifyStatusChange(newStatus);
    }
  }

  detectStatus() {
    // Look for stop button (indicates processing)
    const stopButton = this.findStopButton();
    if (stopButton && !stopButton.disabled) {
      return 'processing';
    }

    // Look for send button
    const sendButton = this.findSendButton();
    if (sendButton) {
      // If send button is disabled, might be processing
      if (sendButton.disabled) {
        return 'processing';
      } else {
        // Check if there's content in the input that suggests completion
        const hasContent = this.hasInputContent();
        return hasContent ? 'completed' : 'idle';
      }
    }

    // Look for streaming indicators
    if (this.isStreaming()) {
      return 'processing';
    }

    // Look for completion indicators
    if (this.hasRecentResponse()) {
      return 'completed';
    }

    return 'idle';
  }

  findStopButton() {
    const selectors = [
      '[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button:has(svg[data-icon="stop"])',
      'button:has([data-icon="stop"])',
      'button:has(svg):has([class*="stop"])'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) { // visible
          return element;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  findSendButton() {
    const selectors = [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button:has(svg[data-icon="paper-plane"])',
      'button:has([data-icon="paper-plane"])',
      '.btn-primary:has(svg)',
      'form button[type="submit"]:last-of-type'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) { // visible
          return element;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  isStreaming() {
    // Look for streaming indicators like animated dots or "Thinking..." text
    const streamingIndicators = [
      '.result-streaming',
      '[class*="streaming"]',
      '[class*="thinking"]',
      '.animate-pulse',
      '[data-testid="streaming"]'
    ];

    return streamingIndicators.some(selector => {
      try {
        const element = document.querySelector(selector);
        return element && element.offsetParent !== null;
      } catch (e) {
        return false;
      }
    });
  }

  hasInputContent() {
    // Check if there's content in the input area
    const inputSelectors = [
      'textarea',
      '[contenteditable="true"]',
      'input[type="text"]',
      '[role="textbox"]'
    ];

    return inputSelectors.some(selector => {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const content = element.value || element.textContent || element.innerText;
          return content && content.trim().length > 0;
        }
      } catch (e) {
        return false;
      }
      return false;
    });
  }

  hasRecentResponse() {
    // Look for recent AI responses (completed within last few seconds)
    const responseSelectors = [
      '[data-message-author-role="assistant"]',
      '.message.assistant',
      '[class*="assistant"]',
      '.response',
      '[role="article"]:has([class*="assistant"])'
    ];

    for (const selector of responseSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const lastResponse = elements[elements.length - 1];
          // Simple heuristic: if last response doesn't have streaming indicators
          const hasStreamingChild = lastResponse.querySelector('.animate-pulse, [class*="streaming"]');
          return !hasStreamingChild;
        }
      } catch (e) {
        continue;
      }
    }
    return false;
  }

  notifyStatusChange(status) {
    // Send message to background script
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'STATUS_CHANGE',
          status: status,
          url: window.location.href,
          timestamp: Date.now()
        }).catch(error => {
          console.log('ChatGPT Monitor: Error sending message to background:', error);
        });
      }
    } catch (error) {
      console.log('ChatGPT Monitor: Extension context invalidated, skipping message:', error);
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

// Initialize monitor
const monitor = new ChatGPTMonitor();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  monitor.destroy();
});