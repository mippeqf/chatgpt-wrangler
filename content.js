// Content script for monitoring ChatGPT generation state.
class ChatGPTMonitor {
  constructor() {
    this.currentStatus = null;
    this.observer = null;
    this.checkTimer = null;
    this.pollTimer = null;
    this.lastStatusChange = Date.now();
    this.statusChangeDelay = 750;
    this.baseTitle = null;

    // Generation state is latched so losing a DOM signal cannot silently become green.
    this.generationObserved = false;
    this.lastWorkingSignalAt = 0;
    this.pendingUserTurnKey = null;
    this.pendingUserTurnSince = 0;
    this.lastLatestTurnMutationAt = 0;
    this.lastLatestTurnMutationKey = null;
    this.generationFloorTurnIndex = null;

    this.chimePlayer = new ChimePlayer("content");
    this.settings = new Settings();
    this.init();
  }

  init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.startMonitoring());
    } else {
      this.startMonitoring();
    }
  }

  startMonitoring() {
    this.waitForChatInterface(() => this.checkStatus());
    this.setupMutationObserver();

    window.addEventListener("online", () => this.scheduleCheck(0));
    window.addEventListener("offline", () => this.scheduleCheck(0));

    // Polling is deliberately retained as a fallback for UI changes that do not
    // produce a mutation we recognize.
    this.pollTimer = setInterval(() => this.checkStatus(), 750);
  }

  waitForChatInterface(callback) {
    if (!this.isChatPage()) {
      this.baseTitle = this.getCleanTitle() || "ChatGPT";
      callback();
      return;
    }

    const checkInterface = () => {
      const prompt = document.querySelector(
        '#prompt-textarea.ProseMirror[contenteditable="true"], #prompt-textarea[contenteditable="true"]'
      );

      if (prompt) {
        this.baseTitle = this.getCleanTitle() || "ChatGPT";
        setTimeout(callback, 250);
      } else {
        setTimeout(checkInterface, 500);
      }
    };

    checkInterface();
  }

  isChatPage() {
    const url = window.location.href;
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
      this.recordLatestTurnMutation(mutations);
      this.scheduleCheck(60);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "aria-busy",
        "aria-disabled",
        "aria-label",
        "data-state",
        "data-loading",
        "data-testid",
        "data-turn",
        "disabled",
      ],
    });
  }

  scheduleCheck(delay = 60) {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.checkStatus();
    }, delay);
  }

  recordLatestTurnMutation(mutations) {
    const latestTurn = this.getLatestConversationTurn();
    if (!latestTurn) return;

    const latestKey = this.getTurnKey(latestTurn);
    const touchedLatest = mutations.some((mutation) => {
      const target =
        mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target.parentElement;

      if (target && target.closest?.('[data-testid^="conversation-turn-"]') === latestTurn) {
        return true;
      }

      if (mutation.type === "childList") {
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return (
            node === latestTurn ||
            latestTurn.contains(node) ||
            node.contains?.(latestTurn)
          );
        });
      }

      return false;
    });

    if (touchedLatest) {
      this.lastLatestTurnMutationAt = Date.now();
      this.lastLatestTurnMutationKey = latestKey;
    }
  }

  checkStatus() {
    if (!chrome.runtime || !chrome.runtime.id) {
      this.destroy();
      return;
    }

    const newStatus = this.detectStatus();

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
      // Ignore title read errors.
    }

    const statusChanged = newStatus !== this.currentStatus;
    if (!statusChanged && !titleChanged) return;

    const now = Date.now();
    const timeSinceLastChange = now - this.lastStatusChange;

    // Working/error states should appear immediately. Green gets a small debounce
    // to avoid flashing ready during React transitions at the end of a response.
    const canNotifyStatusChange =
      this.currentStatus === null ||
      newStatus === "processing" ||
      newStatus === "uncertain" ||
      timeSinceLastChange >= this.statusChangeDelay;

    if ((statusChanged && canNotifyStatusChange) || titleChanged) {
      const oldStatus = this.currentStatus;
      if (statusChanged) {
        this.currentStatus = newStatus;
        this.lastStatusChange = now;
      }
      this.notifyStatusChange(newStatus, oldStatus);
    }
  }

  detectStatus() {
    const now = Date.now();
    const latestTurn = this.getLatestConversationTurn();
    const latestRole = this.getTurnRole(latestTurn);
    const latestKey = this.getTurnKey(latestTurn);

    if (navigator.onLine === false || this.hasExplicitError(latestTurn)) {
      return "uncertain";
    }

    const hasStrongWorkingSignal =
      this.findStreamingStopButton() ||
      this.hasStreamingAnimation(latestTurn) ||
      this.hasVisibleStreamSpinner() ||
      this.hasInProgressIndicator(latestTurn);

    // A newly submitted user turn is itself evidence that a generation was
    // requested. This covers the short gap before ChatGPT mounts its response UI.
    if (latestRole === "user") {
      if (this.pendingUserTurnKey !== latestKey) {
        this.pendingUserTurnKey = latestKey;
        this.pendingUserTurnSince = now;
        this.generationObserved = true;
        const userIndex = this.getTurnIndex(latestTurn);
        this.generationFloorTurnIndex =
          userIndex === null ? null : userIndex + 1;
        this.lastWorkingSignalAt = now;
      }

      if (hasStrongWorkingSignal) {
        this.lastWorkingSignalAt = now;
        return "processing";
      }

      // Brief grace period for the response UI to appear; after that, do not
      // silently call an unmatched user turn "ready".
      return now - this.pendingUserTurnSince < 1500 ? "processing" : "uncertain";
    }

    if (hasStrongWorkingSignal) {
      if (!this.generationObserved) {
        const workingIndex = this.getTurnIndex(latestTurn);
        this.generationFloorTurnIndex = workingIndex;
      } else if (latestRole === "assistant") {
        const workingIndex = this.getTurnIndex(latestTurn);
        if (
          workingIndex !== null &&
          (this.generationFloorTurnIndex === null ||
            workingIndex > this.generationFloorTurnIndex)
        ) {
          this.generationFloorTurnIndex = workingIndex;
        }
      }
      this.generationObserved = true;
      this.lastWorkingSignalAt = now;
      return "processing";
    }

    // Once generation has started, mutations in the current assistant turn are
    // useful evidence for tools/image/thinking UIs that do not expose the normal
    // stop button. They are intentionally not allowed to start a generation by
    // themselves, which avoids scroll-virtualization false positives.
    const recentTurnMutation =
      this.generationObserved &&
      latestKey &&
      this.lastLatestTurnMutationKey === latestKey &&
      now - this.lastLatestTurnMutationAt < 1200;

    if (recentTurnMutation) {
      this.lastWorkingSignalAt = now;
      return "processing";
    }

    if (
      this.isCompletedTurn(latestTurn) &&
      this.completionBelongsToCurrentGeneration(latestTurn)
    ) {
      this.resetGenerationLatch();
      return "ready";
    }

    if (this.generationObserved) {
      // DOM transitions can momentarily remove every working signal. Keep red
      // briefly; if no normal completion ever appears, degrade to yellow.
      if (now - this.lastWorkingSignalAt < 1000) return "processing";
      return "uncertain";
    }

    // Fresh/empty chats are ready. An assistant-like turn without its normal
    // completion action is ambiguous (partial response, virtualized content,
    // or changed UI), so never infer green from absence alone.
    if (!latestTurn) return "ready";
    if (latestRole === "assistant") return "uncertain";

    return this.currentStatus || "ready";
  }

  completionBelongsToCurrentGeneration(turn) {
    if (!this.generationObserved || this.generationFloorTurnIndex === null) {
      return true;
    }

    const index = this.getTurnIndex(turn);
    return index !== null && index >= this.generationFloorTurnIndex;
  }

  resetGenerationLatch() {
    this.generationObserved = false;
    this.lastWorkingSignalAt = 0;
    this.pendingUserTurnKey = null;
    this.pendingUserTurnSince = 0;
    this.generationFloorTurnIndex = null;
  }

  getLatestConversationTurn() {
    const turns = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    if (turns.length === 0) return null;

    // DOM order is normally sufficient. Prefer the numeric test-id suffix when
    // available because virtualization may remount turns.
    let best = turns[turns.length - 1];
    let bestIndex = this.getTurnIndex(best);

    for (const turn of turns) {
      const index = this.getTurnIndex(turn);
      if (index !== null && (bestIndex === null || index > bestIndex)) {
        best = turn;
        bestIndex = index;
      }
    }

    return best;
  }

  getTurnIndex(turn) {
    if (!turn) return null;
    const testId = turn.getAttribute("data-testid") || "";
    const match = testId.match(/conversation-turn-(\d+)/);
    return match ? Number(match[1]) : null;
  }

  getTurnKey(turn) {
    if (!turn) return null;
    return (
      turn.getAttribute("data-turn-id") ||
      turn.getAttribute("data-testid") ||
      null
    );
  }

  getTurnRole(turn) {
    if (!turn) return null;

    const explicitRole = turn.getAttribute("data-turn");
    if (explicitRole === "assistant" || explicitRole === "user") return explicitRole;

    if (turn.querySelector('[data-message-author-role="assistant"]')) return "assistant";
    if (turn.querySelector('[data-message-author-role="user"]')) return "user";

    // Image-generation turns can omit data-message-author-role while still being
    // assistant turns.
    if (
      turn.querySelector(
        'img[alt^="Generated image" i], img[src*="/backend-api/estuary/content"]'
      )
    ) {
      return "assistant";
    }

    return null;
  }

  isCompletedTurn(turn) {
    if (!turn || this.getTurnRole(turn) !== "assistant") return false;

    const completionAction = turn.querySelector(
      'button[data-testid="copy-turn-action-button"], button[aria-label*="Copy response" i]'
    );
    if (completionAction) return true;

    // Generated images sometimes live outside data-message-author-role. A fully
    // loaded generated image with no active working signal is a terminal result.
    const generatedImages = [
      ...turn.querySelectorAll(
        'img[alt^="Generated image" i], img[src*="/backend-api/estuary/content"]'
      ),
    ];
    return generatedImages.some(
      (img) => img.complete && (img.naturalWidth > 0 || img.width > 0)
    );
  }

  findStreamingStopButton() {
    const selectors = [
      '#composer-submit-button[aria-label="Stop streaming"][data-testid="stop-button"]',
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label*="Stop" i][data-testid*="stop" i]',
    ];

    for (const selector of selectors) {
      try {
        const elements = [...document.querySelectorAll(selector)];
        const visible = elements.find((element) => this.isVisible(element));
        if (visible) return visible;
      } catch (e) {
        // Ignore selector incompatibilities.
      }
    }

    return null;
  }

  hasStreamingAnimation(turn) {
    if (!turn) return false;
    return Boolean(
      turn.matches?.(".streaming-animation") ||
        turn.querySelector(".streaming-animation")
    );
  }

  hasVisibleStreamSpinner() {
    // ChatGPT currently leaves Tailwind group-data-stream-active classes in the
    // DOM even while idle. Checking for the class string alone is therefore a
    // false positive; inspect the computed active-state spinner instead.
    const candidates = document.querySelectorAll(
      '[class*="group-data-stream-active/scroll-root:opacity-100"]'
    );

    for (const element of candidates) {
      if (!this.isVisible(element)) continue;
      const opacity = Number.parseFloat(getComputedStyle(element).opacity || "0");
      if (opacity > 0.5) return true;
    }

    // Support a direct data attribute if ChatGPT exposes it in a future/current
    // variant of the scroll root.
    return Boolean(
      document.querySelector(
        '[data-scroll-root][data-stream-active]:not([data-stream-active="false"])'
      )
    );
  }

  hasInProgressIndicator(turn) {
    if (!turn) return false;

    const selectors = [
      '[aria-busy="true"]',
      '[data-loading="true"]',
      '[data-state="loading"]',
      '[data-state="streaming"]',
      '[role="progressbar"]',
      '[data-testid*="progress" i]',
      '[data-testid*="loading" i]',
    ];

    for (const selector of selectors) {
      try {
        const visible = [...turn.querySelectorAll(selector)].some((el) =>
          this.isVisible(el)
        );
        if (visible) return true;
      } catch (e) {
        // Ignore selector incompatibilities.
      }
    }

    // Tool/image status UIs often expose short live-region labels even when they
    // do not use a progressbar.
    const liveRegions = turn.querySelectorAll(
      '[role="status"], [aria-live="polite"], [aria-live="assertive"]'
    );
    const activeText =
      /^(thinking|working|searching|browsing|analy[sz]ing|generating|creating|running|preparing)(\b|…|\.\.\.)/i;

    return [...liveRegions].some((element) => {
      if (!this.isVisible(element)) return false;
      const text = (element.textContent || "").trim();
      return text.length <= 120 && activeText.test(text);
    });
  }

  hasExplicitError(latestTurn) {
    const errorText =
      /(connection (was )?(interrupted|lost)|network error|disconnected|reconnect(ing)?|error (generating|while generating)|something went wrong|failed to (generate|respond|load)|response interrupted|unable to connect)/i;

    const scopes = [];
    const selectors = [
      '[role="alert"]',
      '[data-testid*="error" i]',
      '[data-testid*="toast" i]',
      '[class*="error" i]',
    ];

    for (const selector of selectors) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          if (this.isVisible(element)) scopes.push(element);
        }
      } catch (e) {
        // Ignore selector incompatibilities.
      }
    }

    // Some interruption notices are rendered as ordinary controls inside the
    // current turn. Inspect only short button/status text rather than the whole
    // assistant answer, so discussing an error cannot itself trigger yellow.
    if (latestTurn) {
      for (const element of latestTurn.querySelectorAll('button, [role="status"]')) {
        if (this.isVisible(element)) scopes.push(element);
      }
    }

    return scopes.some((scope) => {
      const text = (scope.textContent || "").replace(/\s+/g, " ").trim();
      return text.length > 0 && text.length <= 300 && errorText.test(text);
    });
  }

  isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return element.getClientRects().length > 0;
  }

  getCleanTitle() {
    return document.title.replace(/^(🔴|🟢|🟡)\s+/, "").trim();
  }

  updateTitle(status) {
    try {
      const currentCleanTitle = this.getCleanTitle();
      if (
        !this.baseTitle ||
        (currentCleanTitle && currentCleanTitle !== this.baseTitle)
      ) {
        this.baseTitle = currentCleanTitle || "ChatGPT";
      }

      if (!this.baseTitle || this.baseTitle.trim() === "") {
        this.baseTitle = "ChatGPT";
      }

      const statusEmoji =
        status === "processing" ? "🔴" : status === "uncertain" ? "🟡" : "🟢";
      const newTitle = `${statusEmoji} ${this.baseTitle}`;

      if (document.title !== newTitle) document.title = newTitle;
    } catch (error) {
      // Ignore title update errors.
    }
  }

  async notifyStatusChange(status, oldStatus) {
    this.updateTitle(status);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "STATUS_UPDATE",
        status,
        oldStatus,
        tabId: window.location.href,
      });

      if (
        response &&
        response.chimeCommand &&
        this.settings.getChimesEnabled()
      ) {
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
      // Extension context may disappear during reload/update.
    }
  }

  async playLowCChime() {
    await this.chimePlayer.playLowCChime();
  }

  async playGChime() {
    await this.chimePlayer.playGChime();
  }

  async playHighCChime() {
    await this.chimePlayer.playHighCChime();
  }

  destroy() {
    if (this.observer) this.observer.disconnect();
    if (this.checkTimer) clearTimeout(this.checkTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

if (!window.__CHATGPT_MONITOR_ACTIVE__) {
  window.__CHATGPT_MONITOR_ACTIVE__ = true;
  const monitor = new ChatGPTMonitor();

  window.addEventListener("beforeunload", () => monitor.destroy());
}
