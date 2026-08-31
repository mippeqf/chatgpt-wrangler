// Content script for monitoring ChatGPT generation state.
class ChatGPTMonitor {
  constructor() {
    this.currentStatus = null;
    this.baseTitle = null;
    this.observer = null;
    this.pollTimer = null;
    this.lastStatusChange = Date.now();

    // Normal response path: remember whether this generation ever exposed the
    // same explicit Stop button used by the original Wrangler.
    this.generationObserved = false;
    this.stopButtonObserved = false;
    this.generationFloorTurnIndex = null;
    this.pendingUserTurnKey = null;
    this.pendingUserTurnSince = 0;

    // Lightweight diagnostics so the popup can tell us what actually happened
    // in a background tab rather than forcing us to infer it from the title.
    this.lastDecisionReason = "initializing";
    this.lastCheckAt = 0;
    this.checkCount = 0;
    this.lastMutationAt = 0;
    this.mutationCount = 0;

    this.chimePlayer = new ChimePlayer("content");
    this.settings = new Settings();
    this.init();
  }

  init() {
    const start = () => this.startMonitoring();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }

  startMonitoring() {
    this.baseTitle = this.getCleanTitle() || "ChatGPT";

    this.observer = new MutationObserver(() => {
      // This is the critical background path: exactly as in the original
      // Wrangler, DOM mutations invoke the status check synchronously. No timer
      // or debounce sits between the mutation and the decision.
      this.mutationCount += 1;
      this.lastMutationAt = Date.now();
      this.checkStatus();
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
        "data-stream-active",
        "data-testid",
        "data-turn",
        "disabled",
      ],
    });

    window.addEventListener("online", () => this.checkStatus());
    window.addEventListener("offline", () => this.checkStatus());

    // Best-effort fallback only. Hidden-tab correctness must not depend on it.
    this.pollTimer = setInterval(() => this.checkStatus(), 700);
    this.checkStatus();
  }

  checkStatus() {
    if (!chrome.runtime?.id) return this.destroy();

    this.checkCount += 1;
    this.lastCheckAt = Date.now();

    const newStatus = this.detectStatus();
    const oldStatus = this.currentStatus;

    const cleanTitle = this.getCleanTitle();
    if (cleanTitle && cleanTitle !== this.baseTitle) this.baseTitle = cleanTitle;

    if (newStatus === oldStatus) {
      this.updateTitle(newStatus);
      this.publishMonitorInfo();
      return;
    }

    this.currentStatus = newStatus;
    this.lastStatusChange = Date.now();
    this.publishMonitorInfo();
    this.notifyStatusChange(newStatus, oldStatus);
  }

  decision(status, reason) {
    this.lastDecisionReason = reason;
    return status;
  }

  publishMonitorInfo() {
    window.__CHATGPT_MONITOR_INFO__ = {
      status: this.currentStatus || "unknown",
      reason: this.lastDecisionReason,
      generationObserved: this.generationObserved,
      stopButtonObserved: this.stopButtonObserved,
      checkCount: this.checkCount,
      mutationCount: this.mutationCount,
      lastCheckAt: this.lastCheckAt,
      lastMutationAt: this.lastMutationAt,
    };
  }

  detectStatus() {
    const now = Date.now();
    const latestTurn = this.getLatestConversationTurn();
    const latestRole = this.getTurnRole(latestTurn);
    const latestKey = this.getTurnKey(latestTurn);
    const stopButton = this.findStreamingStopButton();

    if (stopButton) this.stopButtonObserved = true;

    // A newest user turn latches a new generation immediately, even in the
    // brief interval before the composer changes to Stop.
    if (latestRole === "user") {
      if (this.pendingUserTurnKey !== latestKey) {
        this.pendingUserTurnKey = latestKey;
        this.pendingUserTurnSince = now;
        this.generationObserved = true;
        this.stopButtonObserved = Boolean(stopButton);
        const userIndex = this.getTurnIndex(latestTurn);
        this.generationFloorTurnIndex = userIndex === null ? null : userIndex + 1;
      }

      if (stopButton) return this.decision("processing", "stop present");

      // Auxiliary progress signals are useful only before we have ever seen a
      // Stop button. They cannot veto the proven Stop->gone completion path.
      if (!this.stopButtonObserved && this.hasFallbackWorkingSignal(latestTurn)) {
        return this.decision("processing", "fallback progress");
      }

      return now - this.pendingUserTurnSince < 2500
        ? this.decision("processing", "new user turn")
        : this.decision("uncertain", "awaiting assistant");
    }

    const latestBelongsToGeneration = this.completionBelongsToCurrentGeneration(latestTurn);

    // Keep explicit interruption/error state ahead of successful completion.
    // This is scoped to visible/current UI by hasExplicitError().
    if (navigator.onLine === false || this.hasExplicitError(latestTurn)) {
      return this.decision("uncertain", "explicit error");
    }

    // Strong terminal evidence: structural completed-response controls. This
    // does not depend on layout, animation state, timers, or CSS opacity.
    if (
      latestRole === "assistant" &&
      latestBelongsToGeneration &&
      this.hasCompletionAction(latestTurn)
    ) {
      this.resetGenerationLatch();
      return this.decision("ready", "completion action");
    }

    // Original Wrangler's authoritative working signal.
    if (stopButton) {
      this.generationObserved = true;
      return this.decision("processing", "stop present");
    }

    // Original Wrangler's authoritative completion transition, guarded only by
    // the fact that this generation really did expose Stop and now has an
    // assistant turn belonging to the current request. Auxiliary CSS/spinner
    // state is deliberately NOT consulted here.
    if (
      this.generationObserved &&
      this.stopButtonObserved &&
      latestRole === "assistant" &&
      latestBelongsToGeneration
    ) {
      this.resetGenerationLatch();
      return this.decision("ready", "stop disappeared");
    }

    // Richer signals are fallback-only for unusual generations where ChatGPT
    // never exposes the standard Stop button (tools/images/transitional UIs).
    if (
      this.generationObserved &&
      !this.stopButtonObserved &&
      this.hasFallbackWorkingSignal(latestTurn)
    ) {
      return this.decision("processing", "fallback progress");
    }

    if (this.generationObserved) {
      return this.decision("uncertain", "generation without stop");
    }

    // Existing historical answers on page load are complete.
    if (!latestTurn) return this.decision("ready", "no conversation turn");
    if (latestRole === "assistant" && this.hasSubstantiveAssistantContent(latestTurn)) {
      return this.decision("ready", "historical assistant");
    }

    return latestRole === "assistant"
      ? this.decision("uncertain", "assistant shell")
      : this.decision(this.currentStatus || "ready", "idle");
  }

  getLatestConversationTurn() {
    const turns = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    if (!turns.length) return null;

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
    const match = (turn.getAttribute("data-testid") || "").match(/conversation-turn-(\d+)/);
    return match ? Number(match[1]) : null;
  }

  getTurnKey(turn) {
    if (!turn) return null;
    return turn.getAttribute("data-turn-id") || turn.getAttribute("data-testid") || null;
  }

  getTurnRole(turn) {
    if (!turn) return null;
    const explicit = turn.getAttribute("data-turn");
    if (explicit === "assistant" || explicit === "user") return explicit;
    if (turn.querySelector('[data-message-author-role="assistant"]')) return "assistant";
    if (turn.querySelector('[data-message-author-role="user"]')) return "user";
    if (turn.querySelector('img[alt^="Generated image" i], img[src*="/backend-api/estuary/content"]')) {
      return "assistant";
    }
    return null;
  }

  completionBelongsToCurrentGeneration(turn) {
    if (!this.generationObserved || this.generationFloorTurnIndex === null) return true;
    const index = this.getTurnIndex(turn);
    return index !== null && index >= this.generationFloorTurnIndex;
  }

  hasCompletionAction(turn) {
    if (!turn) return false;

    const actions = turn.querySelector(
      [
        'button[data-testid="copy-turn-action-button"]',
        'button[data-testid*="copy-turn" i]',
        '[data-testid*="good-response" i]',
        '[data-testid*="bad-response" i]',
        'button[aria-label="Copy" i]',
        'button[aria-label*="Copy response" i]',
        'button[aria-label*="Read aloud" i]',
      ].join(",")
    );
    if (actions) return true;

    const images = [
      ...turn.querySelectorAll(
        'img[alt^="Generated image" i], img[src*="/backend-api/estuary/content"]'
      ),
    ];
    return images.some((img) => img.complete && img.naturalWidth > 0);
  }

  hasSubstantiveAssistantContent(turn) {
    if (!turn || this.getTurnRole(turn) !== "assistant") return false;

    if (
      turn.querySelector(
        'img[alt^="Generated image" i], img[src*="/backend-api/estuary/content"], pre, table, .markdown'
      )
    ) {
      const text = (turn.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 0) return true;
      if (turn.querySelector("img, pre, table")) return true;
    }

    const authored = turn.querySelector('[data-message-author-role="assistant"]');
    return Boolean((authored?.textContent || "").trim());
  }

  // Keep the normal Stop-button test intentionally equivalent to the original
  // Wrangler rather than routing it through our richer layout helper.
  findStreamingStopButton() {
    const streamingButton = document.querySelector(
      '#composer-submit-button[aria-label="Stop streaming"][data-testid="stop-button"]'
    );

    if (streamingButton && streamingButton.offsetParent !== null) {
      return streamingButton;
    }

    const fallbackSelectors = [
      'button[aria-label="Stop streaming"]',
      'button[data-testid="stop-button"][aria-label*="Stop"]',
      '#composer-submit-button[data-testid="stop-button"]',
    ];

    for (const selector of fallbackSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) return element;
      } catch (_) {}
    }
    return null;
  }

  hasFallbackWorkingSignal(turn) {
    return (
      this.hasStreamingAnimation(turn) ||
      this.hasVisibleStreamSpinner() ||
      this.hasInProgressIndicator(turn)
    );
  }

  hasStreamingAnimation(turn) {
    if (turn?.matches?.(".streaming-animation") || turn?.querySelector?.(".streaming-animation")) {
      return true;
    }
    return Boolean(document.querySelector('[data-testid^="conversation-turn-"] .streaming-animation'));
  }

  hasVisibleStreamSpinner() {
    const candidates = document.querySelectorAll(
      '[class*="group-data-stream-active/scroll-root:opacity-100"]'
    );
    for (const element of candidates) {
      if (!this.isVisible(element)) continue;
      const opacity = Number.parseFloat(getComputedStyle(element).opacity || "0");
      if (opacity > 0.5) return true;
    }
    return Boolean(
      document.querySelector('[data-scroll-root][data-stream-active]:not([data-stream-active="false"])')
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
        if ([...turn.querySelectorAll(selector)].some((el) => this.isVisible(el))) return true;
      } catch (_) {}
    }

    const activeText =
      /^(thinking|working|searching|browsing|analy[sz]ing|generating|creating|running|preparing)(\b|…|\.\.\.)/i;
    return [...turn.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]')]
      .some((el) => this.isVisible(el) && activeText.test((el.textContent || "").trim()));
  }

  hasExplicitError(latestTurn) {
    const pattern =
      /(connection (was )?(interrupted|lost)|network error|disconnected|reconnect(ing)?|error (generating|while generating)|something went wrong|failed to (generate|respond|load)|response interrupted|unable to connect)/i;

    const candidates = [];
    for (const selector of [
      '[role="alert"]',
      '[data-testid*="error" i]',
      '[data-testid*="toast" i]',
    ]) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (this.isVisible(el)) candidates.push(el);
        }
      } catch (_) {}
    }

    if (latestTurn) {
      for (const el of latestTurn.querySelectorAll('button, [role="status"]')) {
        if (this.isVisible(el)) candidates.push(el);
      }
    }

    return candidates.some((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return text.length > 0 && text.length <= 300 && pattern.test(text);
    });
  }

  isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return element.getClientRects().length > 0;
  }

  resetGenerationLatch() {
    this.generationObserved = false;
    this.stopButtonObserved = false;
    this.generationFloorTurnIndex = null;
    this.pendingUserTurnKey = null;
    this.pendingUserTurnSince = 0;
  }

  getCleanTitle() {
    return document.title.replace(/^(🔴|🟢|🟡)\s+/, "").trim();
  }

  updateTitle(status) {
    const clean = this.getCleanTitle();
    if (clean && clean !== this.baseTitle) this.baseTitle = clean;
    if (!this.baseTitle) this.baseTitle = "ChatGPT";

    const emoji = status === "processing" ? "🔴" : status === "uncertain" ? "🟡" : "🟢";
    const title = `${emoji} ${this.baseTitle}`;
    if (document.title !== title) document.title = title;
  }

  async notifyStatusChange(status, oldStatus) {
    this.updateTitle(status);
    this.publishMonitorInfo();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "STATUS_UPDATE",
        status,
        oldStatus,
        tabId: window.location.href,
      });

      if (!response?.chimeCommand || !this.settings.getChimesEnabled()) return;
      if (response.chimeCommand === "PLAY_PROCESSING_CHIME") await this.chimePlayer.playLowCChime();
      if (response.chimeCommand === "PLAY_TAB_READY_CHIME") await this.chimePlayer.playGChime();
      if (response.chimeCommand === "PLAY_WINDOW_READY_CHIME") await this.chimePlayer.playHighCChime();
    } catch (_) {}
  }

  destroy() {
    if (this.observer) this.observer.disconnect();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

if (!window.__CHATGPT_MONITOR_ACTIVE__) {
  window.__CHATGPT_MONITOR_ACTIVE__ = true;
  const monitor = new ChatGPTMonitor();
  window.addEventListener("beforeunload", () => monitor.destroy());
}
