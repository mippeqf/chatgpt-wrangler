class ChimePlayer {
  constructor(context = 'browser') {
    this.context = context;
    this.AudioContext = context === 'offscreen' 
      ? (self.AudioContext || self.webkitAudioContext)
      : (window.AudioContext || window.webkitAudioContext);
  }

  async createChime(config) {
    try {
      const ctx = new this.AudioContext();
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      
      const oscillators = [];
      const gains = [];
      
      for (const tone of config.tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = tone.type || "sine";
        osc.frequency.value = tone.frequency;
        osc.connect(gain);
        gain.connect(masterGain);
        gain.gain.value = tone.volume;
        
        oscillators.push(osc);
        gains.push(gain);
      }
      
      const envelope = config.envelope;
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.exponentialRampToValueAtTime(envelope.attack.value, ctx.currentTime + envelope.attack.time);
      
      if (envelope.sustain) {
        masterGain.gain.exponentialRampToValueAtTime(envelope.sustain.value, ctx.currentTime + envelope.sustain.time);
      }
      
      masterGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + envelope.release);
      
      oscillators.forEach(osc => osc.start());
      oscillators.forEach(osc => osc.stop(ctx.currentTime + envelope.release + 0.05));
      
    } catch (e) {
      if (this.context === 'offscreen') {
        // no-op in offscreen
      } else {
        console.log(`Chime: Error playing ${config.name}:`, e);
      }
    }
  }

  async playLowCChime() {
    await this.createChime({
      name: "Low C Chime",
      tones: [
        { frequency: 262, volume: 0.4 }, // C4
        { frequency: 524, volume: 0.25 }, // C5  
        { frequency: 784, volume: 0.15 }, // G5
        { frequency: 659, volume: 0.1 }   // E5
      ],
      envelope: {
        attack: { value: 0.35, time: 0.025 },
        sustain: { value: 0.08, time: 0.25 },
        release: 0.7
      }
    });
  }

  async playGChime() {
    await this.createChime({
      name: "G Chime", 
      tones: [
        { frequency: 196, volume: 0.4 },  // G3
        { frequency: 392, volume: 0.3 },  // G4
        { frequency: 588, volume: 0.15 }  // D5
      ],
      envelope: {
        attack: { value: 0.35, time: 0.02 },
        release: 0.5
      }
    });
  }

  async playHighCChime() {
    await this.createChime({
      name: "High C Chime",
      tones: [
        { frequency: 523, volume: 0.4 },  // C5
        { frequency: 1047, volume: 0.25 }, // C6
        { frequency: 784, volume: 0.2 },   // G5
        { frequency: 659, volume: 0.15 }   // E5
      ],
      envelope: {
        attack: { value: 0.4, time: 0.03 },
        sustain: { value: 0.1, time: 0.3 },
        release: 0.8
      }
    });
  }

  async playChime(type) {
    switch (type) {
      case "processing":
      case "PLAY_PROCESSING_CHIME":
        return this.playLowCChime();
      case "complete":
      case "PLAY_TAB_READY_CHIME":
        return this.playGChime();
      case "window":
      case "PLAY_WINDOW_READY_CHIME":
        return this.playHighCChime();
      default:
        console.warn(`Unknown chime type: ${type}`);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChimePlayer;
}

if (typeof window !== 'undefined') {
  window.ChimePlayer = ChimePlayer;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.ChimePlayer = ChimePlayer;
}