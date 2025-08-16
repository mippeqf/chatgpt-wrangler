// Offscreen context to play a soft chime when alarms fire

async function playChime() {
  try {
    const ctx = new (self.AudioContext || self.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880; // A5
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.45);
  } catch (e) {
    // no-op
  }
}

async function playLowChime() {
  try {
    const ctx = new (self.AudioContext || self.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 196; // G3 ~196 Hz
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // no-op
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === "PLAY_CHIME") {
    if (message.variant === "low") {
      playLowChime();
    } else {
      playChime();
    }
  }
});
