// Content script for monitoring ChatGPT UI elements
class ChatGPTMonitor {
  constructor() {
    this.currentStatus = null; // Start with null status until we can properly detect it
    this.observer = null;
    this.lastStatusChange = Date.now();
    this.statusChangeDelay = 1000; // 1 second delay to avoid rapid status changes
    this.baseTitle = null; // Store the clean base title
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

    // Wait for chat interface to be ready before initial status check
    this.waitForChatInterface(() => {
      this.checkStatus();
    });

    // Set up mutation observer to watch for DOM changes
    this.setupMutationObserver();

    // Also check periodically as a fallback
    setInterval(() => this.checkStatus(), 1000);
  }

  waitForChatInterface(callback) {
    // Check if we're on a chat page first
    if (!this.isChatPage()) {
      console.log(
        "ChatGPT Monitor: Not on a chat page, skipping interface wait"
      );
      // Still set a base title for non-chat pages
      try {
        this.baseTitle = this.getCleanTitle() || "ChatGPT";
      } catch (error) {
        console.log(
          "ChatGPT Monitor: Error getting title on non-chat page:",
          error
        );
        this.baseTitle = "ChatGPT";
      }
      callback();
      return;
    }

    const checkInterface = () => {
      // Look for the specific ProseMirror textarea that indicates chat interface is fully loaded
      const proseMirrorTextarea = document.querySelector(
        '#prompt-textarea.ProseMirror[contenteditable="true"]'
      );

      if (proseMirrorTextarea) {
        console.log(
          "ChatGPT Monitor: ProseMirror textarea detected, waiting 250ms before status check"
        );
        // Store the base title when interface is ready
        try {
          this.baseTitle = this.getCleanTitle() || "ChatGPT";
        } catch (error) {
          console.log("ChatGPT Monitor: Error getting initial title:", error);
          this.baseTitle = "ChatGPT";
        }
        // Wait additional 250ms to ensure everything is fully initialized
        setTimeout(() => {
          console.log(
            "ChatGPT Monitor: Starting status monitoring after delay"
          );
          callback();
        }, 250);
      } else {
        console.log(
          "ChatGPT Monitor: Waiting for ProseMirror textarea to load..."
        );
        setTimeout(checkInterface, 500);
      }
    };

    checkInterface();
  }

  isChatPage() {
    const url = window.location.href;
    // Monitor both conversation pages and the main chat interface
    return (
      url.includes("/c/") ||
      url === "https://chat.openai.com/" ||
      url === "https://chatgpt.com/" ||
      url.startsWith("https://chat.openai.com/?") ||
      url.startsWith("https://chatgpt.com/?")
    );
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

    // Detect title/baseTitle changes independently of status changes
    let titleChanged = false;
    try {
      const currentCleanTitle = this.getCleanTitle();
      if (
        currentCleanTitle &&
        currentCleanTitle.trim() !== "" &&
        currentCleanTitle !== this.baseTitle
      ) {
        this.baseTitle = currentCleanTitle;
        titleChanged = true;
      }
    } catch (e) {
      // ignore title read errors
    }

    const statusChanged = newStatus !== this.currentStatus;

    if (statusChanged || titleChanged) {
      const now = Date.now();
      const timeSinceLastChange = now - this.lastStatusChange;

      // Rate-limit only status changes; allow immediate title updates
      const canNotifyStatusChange =
        this.currentStatus === null ||
        newStatus === "processing" ||
        timeSinceLastChange >= this.statusChangeDelay;

      if ((statusChanged && canNotifyStatusChange) || titleChanged) {
        const oldStatus = this.currentStatus;
        if (statusChanged) {
          console.log(
            `ChatGPT Monitor: Status changed from ${this.currentStatus} to ${newStatus}`
          );
          this.currentStatus = newStatus;
          this.lastStatusChange = now;
        }
        // Always notify when either status or title changed
        this.notifyStatusChange(newStatus, oldStatus);
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

  getCleanTitle() {
    // Remove existing status emojis and clean up the title
    return document.title.replace(/^(🔴|🟢)\s+/, "").trim();
  }

  updateTitle(status) {
    try {
      // Update the base title if it has changed (e.g., new conversation started)
      const currentCleanTitle = this.getCleanTitle();
      if (
        !this.baseTitle ||
        (currentCleanTitle && currentCleanTitle !== this.baseTitle)
      ) {
        this.baseTitle = currentCleanTitle || "ChatGPT";
      }

      // Ensure we have a valid base title
      if (!this.baseTitle || this.baseTitle.trim() === "") {
        this.baseTitle = "ChatGPT";
      }

      // Apply status emoji to title
      const statusEmoji = status === "processing" ? "🔴" : "🟢";
      const newTitle = `${statusEmoji} ${this.baseTitle}`;

      // Only update if title actually changed to avoid unnecessary DOM updates
      if (document.title !== newTitle) {
        document.title = newTitle;
      }
    } catch (error) {
      console.log("ChatGPT Monitor: Error updating title:", error);
    }
  }

  async notifyStatusChange(status, oldStatus) {
    // Update title directly in content script
    this.updateTitle(status);

    // Notify background and await chime command
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: "STATUS_UPDATE", 
        status: status, 
        oldStatus: oldStatus,
        tabId: window.location.href
      });
      
      // Play the chime based on background's decision
      if (response && response.chimeCommand) {
        console.log(`Content: Playing chime: ${response.chimeCommand}`);
        
        switch (response.chimeCommand) {
          case "PLAY_PROCESSING_CHIME":
            this.playLowCChime();
            break;
          case "PLAY_TAB_READY_CHIME":
            this.playGChime();
            break;
          case "PLAY_WINDOW_READY_CHIME":
            this.playHighCChime();
            break;
        }
      }
    } catch (e) {
      console.log("Content: Error with status update or chime:", e);
    }
  }

  async playLowCChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      
      // Fundamental frequency C3
      const fundamental = ctx.createOscillator();
      const gain1 = ctx.createGain();
      fundamental.type = "sine";
      fundamental.frequency.value = 131; // C3
      fundamental.connect(gain1);
      gain1.connect(masterGain);
      gain1.gain.value = 0.4;
      
      // Octave harmonic C4
      const octave = ctx.createOscillator();
      const gain2 = ctx.createGain();
      octave.type = "sine";
      octave.frequency.value = 262; // C4
      octave.connect(gain2);
      gain2.connect(masterGain);
      gain2.gain.value = 0.2;
      
      // Fifth harmonic G4
      const fifth = ctx.createOscillator();
      const gain3 = ctx.createGain();
      fifth.type = "sine";
      fifth.frequency.value = 392; // G4
      fifth.connect(gain3);
      gain3.connect(masterGain);
      gain3.gain.value = 0.1;
      
      // Envelope
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      
      fundamental.start();
      octave.start();
      fifth.start();
      
      fundamental.stop(ctx.currentTime + 0.65);
      octave.stop(ctx.currentTime + 0.65);
      fifth.stop(ctx.currentTime + 0.65);
    } catch (e) {
      console.log("Content: Error playing low C chime:", e);
    }
  }

  async playGChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      
      // Fundamental frequency G3
      const fundamental = ctx.createOscillator();
      const gain1 = ctx.createGain();
      fundamental.type = "sine";
      fundamental.frequency.value = 196; // G3
      fundamental.connect(gain1);
      gain1.connect(masterGain);
      gain1.gain.value = 0.4;
      
      // Octave harmonic G4
      const octave = ctx.createOscillator();
      const gain2 = ctx.createGain();
      octave.type = "sine";
      octave.frequency.value = 392; // G4
      octave.connect(gain2);
      gain2.connect(masterGain);
      gain2.gain.value = 0.3;
      
      // Third harmonic D5
      const third = ctx.createOscillator();
      const gain3 = ctx.createGain();
      third.type = "sine";
      third.frequency.value = 588; // D5 (third of G)
      third.connect(gain3);
      gain3.connect(masterGain);
      gain3.gain.value = 0.15;
      
      // Envelope
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      
      fundamental.start();
      octave.start();
      third.start();
      
      fundamental.stop(ctx.currentTime + 0.55);
      octave.stop(ctx.currentTime + 0.55);
      third.stop(ctx.currentTime + 0.55);
    } catch (e) {
      console.log("Content: Error playing G chime:", e);
    }
  }

  async playHighCChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      
      // Fundamental frequency C5
      const fundamental = ctx.createOscillator();
      const gain1 = ctx.createGain();
      fundamental.type = "sine";
      fundamental.frequency.value = 523; // C5
      fundamental.connect(gain1);
      gain1.connect(masterGain);
      gain1.gain.value = 0.4;
      
      // Octave harmonic C6
      const octave = ctx.createOscillator();
      const gain2 = ctx.createGain();
      octave.type = "sine";
      octave.frequency.value = 1047; // C6
      octave.connect(gain2);
      gain2.connect(masterGain);
      gain2.gain.value = 0.25;
      
      // Fifth harmonic G5
      const fifth = ctx.createOscillator();
      const gain3 = ctx.createGain();
      fifth.type = "sine";
      fifth.frequency.value = 784; // G5
      fifth.connect(gain3);
      gain3.connect(masterGain);
      gain3.gain.value = 0.2;
      
      // Major third E5
      const third = ctx.createOscillator();
      const gain4 = ctx.createGain();
      third.type = "sine";
      third.frequency.value = 659; // E5
      third.connect(gain4);
      gain4.connect(masterGain);
      gain4.gain.value = 0.15;
      
      // Envelope - longer and more prominent for window completion
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.03);
      masterGain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.3);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      
      fundamental.start();
      octave.start();
      fifth.start();
      third.start();
      
      fundamental.stop(ctx.currentTime + 0.85);
      octave.stop(ctx.currentTime + 0.85);
      fifth.stop(ctx.currentTime + 0.85);
      third.stop(ctx.currentTime + 0.85);
    } catch (e) {
      console.log("Content: Error playing High C chime:", e);
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

// Initialize monitor (avoid double-injection)
if (!window.__CHATGPT_MONITOR_ACTIVE__) {
  window.__CHATGPT_MONITOR_ACTIVE__ = true;
  const monitor = new ChatGPTMonitor();
  
  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    monitor.destroy();
  });
} else {
  console.log(
    "ChatGPT Monitor: Already initialized, skipping duplicate injection"
  );
}
