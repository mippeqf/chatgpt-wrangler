class ChimePlayer {
  constructor(context = "browser") {
    this.context = context;
    this.AudioContext =
      context === "offscreen"
        ? self.AudioContext || self.webkitAudioContext
        : window.AudioContext || window.webkitAudioContext;
  }

  async createChime(config) {
    try {
      const ctx = new this.AudioContext();
      const masterGain = ctx.createGain();
      // Final mix bus (enables simple dry/wet effects routing)
      const finalMix = ctx.createGain();
      finalMix.connect(ctx.destination);
      const dryGain = ctx.createGain();
      dryGain.gain.value = 1.0;
      dryGain.connect(finalMix);

      const oscillators = [];
      const gains = [];

      // Optional mallet-like strike transient (filtered noise burst)
      if (config.strike && typeof config.strike.duration === "number") {
        const strikeDuration = Math.max(0.005, config.strike.duration);
        const strikeGainLevel =
          typeof config.strike.gain === "number" ? config.strike.gain : 0.15;
        const strikeCenterHz =
          typeof config.strike.centerHz === "number"
            ? config.strike.centerHz
            : 2500;
        const strikeFilterType = config.strike.filterType || "bandpass";
        const strikeQ =
          typeof config.strike.q === "number" ? config.strike.q : 10;

        const noiseBuffer = ctx.createBuffer(
          1,
          Math.max(1, Math.floor(ctx.sampleRate * strikeDuration)),
          ctx.sampleRate
        );
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
          noiseData[i] = Math.random() * 2 - 1;
        }

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = strikeFilterType;
        filter.frequency.value = strikeCenterHz;
        if (typeof filter.Q !== "undefined") {
          filter.Q.value = strikeQ;
        }

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(
          Math.max(0.0001, strikeGainLevel),
          ctx.currentTime
        );
        noiseGain.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + strikeDuration
        );

        noiseSource.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(masterGain);

        noiseSource.start();
        noiseSource.stop(ctx.currentTime + strikeDuration + 0.01);
      }

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

      // Optional effects: delay and reverb (simple dry/wet routing)
      if (config.effects) {
        // Simple feedback delay
        if (config.effects.delay) {
          const delayTime = Math.max(
            0,
            Math.min(1, config.effects.delay.time ?? 0.04)
          );
          const feedback = Math.max(
            0,
            Math.min(0.95, config.effects.delay.feedback ?? 0.25)
          );
          const wet = Math.max(
            0,
            Math.min(1, config.effects.delay.wet ?? 0.12)
          );

          const delay = ctx.createDelay(1.0);
          delay.delayTime.value = delayTime;
          const feedbackGain = ctx.createGain();
          feedbackGain.gain.value = feedback;
          const delayWetGain = ctx.createGain();
          delayWetGain.gain.value = wet;

          // Master feeds delay; delay feeds wet and feedback; feedback back into delay input
          masterGain.connect(delay);
          delay.connect(delayWetGain);
          delayWetGain.connect(finalMix);
          delay.connect(feedbackGain);
          feedbackGain.connect(delay);
        }

        // Simple convolution reverb with generated impulse response
        if (config.effects.reverb) {
          const durationSec = Math.max(
            0.05,
            config.effects.reverb.duration ?? 0.25
          );
          const decay = Math.max(0.1, config.effects.reverb.decay ?? 2.0);
          const reverse = !!config.effects.reverb.reverse;
          const wet = Math.max(
            0,
            Math.min(1, config.effects.reverb.wet ?? 0.12)
          );

          const convolver = ctx.createConvolver();
          const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
          const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
          for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
              const n = reverse ? length - i : i;
              // Exponential-ish decay shaping
              data[i] =
                (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
            }
          }
          convolver.buffer = impulse;

          const reverbWetGain = ctx.createGain();
          reverbWetGain.gain.value = wet;

          masterGain.connect(convolver);
          convolver.connect(reverbWetGain);
          reverbWetGain.connect(finalMix);
        }
      }

      // Always connect master to dry path so behavior is unchanged without effects
      masterGain.connect(dryGain);

      const envelope = config.envelope;
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.exponentialRampToValueAtTime(
        envelope.attack.value,
        ctx.currentTime + envelope.attack.time
      );

      if (envelope.sustain) {
        masterGain.gain.exponentialRampToValueAtTime(
          envelope.sustain.value,
          ctx.currentTime + envelope.sustain.time
        );
      }

      masterGain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + envelope.release
      );

      oscillators.forEach((osc) => osc.start());
      oscillators.forEach((osc) =>
        osc.stop(ctx.currentTime + envelope.release + 0.05)
      );
    } catch (e) {
      if (this.context === "offscreen") {
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
        { frequency: 130.81, volume: 0.4, type: "sine" }, // C3 fundamental
        { frequency: 261.63, volume: 0.2, type: "sine" }, // C4 octave
        { frequency: 523.25, volume: 0.08, type: "sine" }, // C5 second octave
      ],
      envelope: {
        attack: { value: 1, time: 0.02 },
        release: 0.5,
      },
      effects: {
        reverb: { duration: 0.3, decay: 1.0, wet: 0.1 },
      },
    });
  }

  async playGChime() {
    await this.createChime({
      name: "G Chime",
      tones: [
        { frequency: 196.0, volume: 0.42, type: "sine" }, // G3 fundamental
        { frequency: 392.0, volume: 0.25, type: "sine" }, // G4 octave
        { frequency: 783.99, volume: 0.1, type: "sine" }, // G5 second octave
      ],
      envelope: {
        attack: { value: 1, time: 0.018 },
        release: 0.7,
      },
      effects: {
        reverb: { duration: 0.32, decay: 1.1, wet: 1 },
      },
    });
  }

  async playHighCChime() {
    await this.createChime({
      name: "High C Chime",
      tones: [
        { frequency: 261.63, volume: 0.38, type: "sine" }, // C4 fundamental
        { frequency: 329.63, volume: 0.13, type: "sine" }, // E4 (C4 e)
        { frequency: 392.0, volume: 0.13, type: "sine" }, // G4 (C4 g)
        { frequency: 523.25, volume: 0.22, type: "sine" }, // C5 octave
        { frequency: 1046.5, volume: 0.08, type: "sine" }, // C6 second octave
      ],
      envelope: {
        attack: { value: 1, time: 0.02 },
        release: 1,
      },
      effects: {
        reverb: { duration: 0.28, decay: 0.9, wet: 0.14 },
      },
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = ChimePlayer;
}

if (typeof window !== "undefined") {
  window.ChimePlayer = ChimePlayer;
}

if (typeof self !== "undefined" && typeof window === "undefined") {
  self.ChimePlayer = ChimePlayer;
}
