// Content script for monitoring ChatGPT generation state.
class ChatGPTMonitor {
  constructor() {
    this.currentStatus = null;
    this.baseTitle = null;
    this.observer = null;
    this.pollTimer = null;
    this.checkTimer = null;
    this.lastStatusChange = Date.now();

    // Generation latch: once a request starts, absence of a stop button can
    // never by itself mean "done".
    this.generationObserved = false;
    this.generationFloorTurnIndex = null;
    this.pendingUserTurnKey = null;
    this.pendingUserTurnSince = 0;
    this.lastWorkingSignalAt = 0;
    this.lastLatestTurnMutationAt = 0;
    this.lastLatestTurnMutationKey = null;

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

    this.observer = new MutationObserver((mutations) => {
      this.recordLatestTurnMutation(mutations);
      this.scheduleCheck(80);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "aria-busy",
        "aria-label",
        "data-state",
        "data-loading",
        "data-testid",
        "data-turn",
      ],
    });

    window.addEventListener("online", () => this.scheduleCheck(0));
    window.addEventListener("offline", () => this.scheduleCheck(0));

    this.pollTimer = setInterval(() => this.checkStatus(), 700);
    this.checkStatus();
  }

  scheduleCheck(delay = 80) {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.checkStatus();
    }, delay);
  }

  recordLatestTurnMutation(mutations) {
    const latestTurn = this.getLatestConversationTurn();
    if (!latestTurn) return;

    const key = this.getTurnKey(latestTurn);
    const touched = mutations.some((mutation) => {
      const target =
        mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target.parentElement;

      if (target?.closest?.('[data-testid^="conversation-turn-"]') === latestTurn) {
        return true;
      }

      if (mutation.type !== "childList") return false;
      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        return node === latestTurn || latestTurn.contains(node) || node.contains?.(latestTurn);
      });
    });

    if (touched) {
      this.lastLatestTurnMutationAt = Date.now();
      this.lastLatestTurnMutationKey = key;
    }
  }

  checkStatus() {
    if (!chrome.runtime?.id) return this.destroy();

    const newStatus = this.detectStatus();
    const oldStatus = this.currentStatus;

    const cleanTitle = this.getCleanTitle();
    if (cleanTitle && cleanTitle !== this.baseTitle) this.baseTitle = cleanTitle;

    if (newStatus === oldStatus) {
      this.updateTitle(newStatus);
      return;
    }

    // Red/yellow should appear immediately. Green is already protected by the
    // completion/stability rules below, so it needs no extra long debounce.
    this.currentStatus = newStatus;
    this.lastStatusChange = Date.now();
    this.notifyStatusChange(newStatus, oldStatus);
  }

  detectStatus() {
    const now = Date.now();
    const latestTurn = this.getLatestConversationTurn();
    const latestRole = this.getTurnRole(latestTurn);
    const latestKey = this.getTurnKey(latestTurn);

    if (navigator.onLine === false || this.hasExplicitError(latestTurn)) {
      return "uncertain";
    }

    const strongWorking =
      this.findStreamingStopButton() ||
      this.hasStreamingAnimation(latestTurn) ||
      this.hasVisibleStreamSpinner() ||
      this.hasInProgressIndicator(latestTurn);

    // A newest user turn means a response has been requested, regardless of
    // what the composer button currently looks like.
    if (latestRole === "user") {
      if (this.pendingUserTurnKey !== latestKey) {
        this.pendingUserTurnKey = latestKey;
        this.pendingUserTurnSince = now;
        this.generationObserved = true;
        const userIndex = this.getTurnIndex(latestTurn);
        this.generationFloorTurnIndex = userIndex === null ? null : userIndex + 1;
        this.lastWorkingSignalAt = now;
      }

      if (strongWorking) this.lastWorkingSignalAt = now;
      return now - this.pendingUserTurnSince < 2500 || strongWorking
        ? "processing"
        : "uncertain";
    }

    if (strongWorking) {
      this.generationObserved = true;
      this.lastWorkingSignalAt = now;
      return "processing";
    }

    const latestBelongsToGeneration = this.completionBelongsToCurrentGeneration(latestTurn);

    // Strong terminal evidence: action toolbar or a completed generated image.
    if (
      latestRole === "assistant" &&
      latestBelongsToGeneration &&
      this.hasCompletionAction(latestTurn)
    ) {
      this.resetGenerationLatch();
      return "ready";
    }

    // Fallback terminal evidence: the current assistant turn has real content,
    // no active-working/error signal, and has stopped changing for a short
    // period. This is deliberately similar to robust browser-automation logic:
    // completion is a stable response, not a particular composer-button shape.
    if (
      latestRole === "assistant" &&
      latestBelongsToGeneration &&
      this.hasSubstantiveAssistantContent(latestTurn) &&
      this.isLatestTurnStable(latestTurn, now, 1800)
    ) {
      this.resetGenerationLatch();
      return "ready";
    }

    // While a response is visibly changing, keep red even if ChatGPT has changed
    // the composer back to a normal Send button (e.g. because the user is typing).
    if (
      this.generationObserved &&
      latestKey &&
      this.lastLatestTurnMutationKey === latestKey &&
      now - this.lastLatestTurnMutationAt < 1800
    ) {
      this.lastWorkingSignalAt = now;
      return "processing";
    }

    if (this.generationObserved) {
      if (now - this.lastWorkingSignalAt < 1200) return "processing";
      return "uncertain";
    }

    // On page load, an existing stable assistant answer is simply complete.
    if (!latestTurn) return "ready";
    if (
      latestRole === "assistant" &&
      this.hasSubstantiveAssistantContent(latestTurn) &&
      this.isLatestTurnStable(latestTurn, now, 1000)
    ) {
      return "ready";
    }

    return latestRole === "assistant" ? "uncertain" : this.currentStatus || "ready";
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

    // ChatGPT has used both test IDs and short aria labels (often simply "Copy").
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

  isLatestTurnStable(turn, now, stableMs) {
    if (!turn) return false;
    const key = this.getTurnKey(turn);
    if (!key) return false;

    // If this turn has never mutated since the extension loaded, it is an
    // already-existing historical answer and therefore stable.
    if (this.lastLatestTurnMutationKey !== key) return true;
    return now - this.lastLatestTurnMutationAt >= stableMs;
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
        const visible = [...document.querySelectorAll(selector)].find((el) => this.isVisible(el));
        if (visible) return visible;
      } catch (_) {}
    }
    return null;
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
    this.generationFloorTurnIndex = null;
    this.pendingUserTurnKey = null;
    this.pendingUserTurnSince = 0;
    this.lastWorkingSignalAt = 0;
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
    if (this.checkTimer) clearTimeout(this.checkTimer);
  }
}

if (!window.__CHATGPT_MONITOR_ACTIVE__) {
  window.__CHATGPT_MONITOR_ACTIVE__ = true;
  const monitor = new ChatGPTMonitor();
  window.addEventListener("beforeunload", () => monitor.destroy());
}
