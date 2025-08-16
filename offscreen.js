// Offscreen context to play a soft chime when alarms fire

async function playLowCChime() {
  try {
    const ctx = new (self.AudioContext || self.webkitAudioContext)();
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
    // no-op
  }
}

async function playGChime() {
  try {
    const ctx = new (self.AudioContext || self.webkitAudioContext)();
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
    
    // Third harmonic B4
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
    // no-op
  }
}

async function playHighCChime() {
  try {
    const ctx = new (self.AudioContext || self.webkitAudioContext)();
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
    // no-op
  }
}

chrome.runtime.onMessage.addListener((message) => {
  console.log("Offscreen: Received message:", message);
  if (!message) return;
  if (message.type === "PLAY_CHIME") {
    console.log("Offscreen: Playing chime, variant:", message.variant);
    if (message.variant === "processing") {
      playLowCChime();
    } else if (message.variant === "complete") {
      playGChime();
    } else if (message.variant === "window") {
      playHighCChime();
    }
  }
});
