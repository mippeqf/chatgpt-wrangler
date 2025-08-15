// Content script for monitoring ChatGPT UI elements
class ChatGPTMonitor {
  constructor() {
    this.currentStatus = "ready";
    this.observer = null;
    this.lastStatusChange = Date.now();
    this.statusChangeDelay = 1000; // 1 second delay to avoid rapid status changes
    this.init();
  }

  init() {
    // Wait for page to be fully loaded
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () =>
        this.startMonitoring()
      );
    } else {
      this.startMonitoring();
    }
  }

  startMonitoring() {
    console.log("ChatGPT Monitor: Starting to monitor page");

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
      const shouldCheck = mutations.some((mutation) => {
        if (mutation.type === "childList") {
          // Check if added/removed nodes contain our target elements
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          return nodes.some((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              return this.containsRelevantElement(node);
            }
            return false;
          });
        }
        if (mutation.type === "attributes") {
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
      attributeFilter: ["disabled", "class", "aria-disabled"],
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
      ".btn-primary:has(svg)",
      'button:has([data-icon="paper-plane"])',
      'button:has([data-icon="stop"])',
    ];

    return selectors.some((selector) => {
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
      'button[aria-label*="Stop"]',
    ];

    return selectors.some((selector) => {
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
      console.log(
        "ChatGPT Monitor: Extension context invalidated, stopping monitoring"
      );
      this.destroy();
      return;
    }

    const newStatus = this.detectStatus();

    if (newStatus !== this.currentStatus) {
      // Add a small delay to avoid rapid status changes, especially for completed state
      const now = Date.now();
      const timeSinceLastChange = now - this.lastStatusChange;

      // Allow immediate changes to processing, but delay other changes
      if (
        newStatus === "processing" ||
        timeSinceLastChange >= this.statusChangeDelay
      ) {
        console.log(
          `ChatGPT Monitor: Status changed from ${this.currentStatus} to ${newStatus}`
        );
        this.currentStatus = newStatus;
        this.lastStatusChange = now;
        this.notifyStatusChange(newStatus);
      }
    }
  }

  detectStatus() {
    // Look for the specific streaming stop button
    const streamingButton = this.findStreamingStopButton();
    if (streamingButton) {
      console.log(
        "ChatGPT Monitor: Found streaming button - status: processing"
      );
      return "processing";
    }

    // Default to ready/idle
    console.log("ChatGPT Monitor: No streaming - status: ready");
    return "ready";
  }

  findStreamingStopButton() {
    // Look for the specific streaming stop button
    // <button id="composer-submit-button" aria-label="Stop streaming" data-testid="stop-button"
    const streamingButton = document.querySelector(
      '#composer-submit-button[aria-label="Stop streaming"][data-testid="stop-button"]'
    );

    if (streamingButton && streamingButton.offsetParent !== null) {
      return streamingButton;
    }

    // Fallback selectors in case the structure changes slightly
    const fallbackSelectors = [
      'button[aria-label="Stop streaming"]',
      'button[data-testid="stop-button"][aria-label*="Stop"]',
      '#composer-submit-button[data-testid="stop-button"]',
    ];

    for (const selector of fallbackSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) {
          // visible
          return element;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  notifyStatusChange(status) {
    // Send message to background script
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime
          .sendMessage({
            type: "STATUS_CHANGE",
            status: status,
            url: window.location.href,
            title: document.title,
            timestamp: Date.now(),
          })
          .catch((error) => {
            console.log(
              "ChatGPT Monitor: Error sending message to background:",
              error
            );
          });
      }
    } catch (error) {
      console.log(
        "ChatGPT Monitor: Extension context invalidated, skipping message:",
        error
      );
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
window.addEventListener("beforeunload", () => {
  monitor.destroy();
});
