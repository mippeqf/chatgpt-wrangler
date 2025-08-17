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
        noiseGain.gain.setValueAtTime(0, ctx.currentTime);
        noiseGain.gain.linearRampToValueAtTime(
          strikeGainLevel,
          ctx.currentTime + 0.005
        );
        noiseGain.gain.linearRampToValueAtTime(
          0,
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
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(tone.volume, ctx.currentTime + 0.015);

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
        osc.stop(ctx.currentTime + envelope.release + 0.1)
      );
    } catch (e) {
      if (this.context === "offscreen") {
        // no-op in offscreen
      } else {
      }
    }
  }

  async playLowCChime() {
    await this.createChime({
      name: "Low C Chime",
      tones: [
        { frequency: 130.81, volume: 0.4, type: "sine" }, // C3 fundamental
        { frequency: 261.63, volume: 0.35, type: "sine" }, // 2nd harmonic (stronger)
        { frequency: 392.43, volume: 0.2, type: "sine" }, // 3rd harmonic
        { frequency: 523.25, volume: 0.15, type: "sine" }, // 4th harmonic
        { frequency: 654.06, volume: 0.1, type: "sine" }, // 5th harmonic
        { frequency: 785.0, volume: 0.08, type: "sine" }, // 6th harmonic
        { frequency: 916.0, volume: 0.05, type: "sine" }, // 7th harmonic
      ],
      envelope: {
        attack: { value: 1, time: 0.002 },
        sustain: { value: 0.3, time: 0.02 },
        release: 0.5,
      },
      strike: {
        duration: 0.004,
        gain: 0.25,
        centerHz: 3500,
        filterType: "highpass",
        q: 5,
      },
      effects: {
        reverb: { duration: 0.4, decay: 0.8, wet: 0.15 },
      },
    });
  }

  async playGChime() {
    await this.createChime({
      name: "Low C Chime",
      tones: [
        { frequency: 130.81, volume: 0.4, type: "sine" }, // C3 fundamental
        { frequency: 261.63, volume: 0.35, type: "sine" }, // 2nd harmonic (stronger)
        { frequency: 392.43, volume: 0.2, type: "sine" }, // 3rd harmonic
        { frequency: 523.25, volume: 0.15, type: "sine" }, // 4th harmonic
        { frequency: 654.06, volume: 0.1, type: "sine" }, // 5th harmonic
        { frequency: 785.0, volume: 0.08, type: "sine" }, // 6th harmonic
        { frequency: 916.0, volume: 0.05, type: "sine" }, // 7th harmonic
      ],
      envelope: {
        attack: { value: 1, time: 0.002 },
        sustain: { value: 0.3, time: 0.02 },
        release: 0.5,
      },
      strike: {
        duration: 0.004,
        gain: 0.25,
        centerHz: 3500,
        filterType: "highpass",
        q: 5,
      },
      effects: {
        reverb: { duration: 0.4, decay: 0.8, wet: 0.18 },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await this.createChime({
      name: "G Chime",
      tones: [
        { frequency: 196.0, volume: 0.4, type: "sine" }, // G3 fundamental
        { frequency: 392.0, volume: 0.35, type: "sine" }, // 2nd harmonic (stronger)
        { frequency: 588.0, volume: 0.2, type: "sine" }, // 3rd harmonic
        { frequency: 784.0, volume: 0.15, type: "sine" }, // 4th harmonic
        { frequency: 980.0, volume: 0.1, type: "sine" }, // 5th harmonic
        { frequency: 1176.0, volume: 0.08, type: "sine" }, // 6th harmonic
        { frequency: 1372.0, volume: 0.05, type: "sine" }, // 7th harmonic
      ],
      envelope: {
        attack: { value: 1, time: 0.002 },
        sustain: { value: 0.25, time: 0.025 },
        release: 0.5,
      },
      strike: {
        duration: 0.004,
        gain: 0.22,
        centerHz: 3800,
        filterType: "highpass",
        q: 5,
      },
      effects: {
        reverb: { duration: 0.45, decay: 0.7, wet: 0.18 },
      },
    });
  }

  async playHighCChime() {
    await this.createChime({
      name: "G Chime",
      tones: [
        { frequency: 196.0, volume: 0.5, type: "sine" }, // G3 fundamental
        { frequency: 392.0, volume: 0.25, type: "sine" }, // 2nd harmonic
        { frequency: 588.0, volume: 0.125, type: "sine" }, // 3rd harmonic
        { frequency: 784.0, volume: 0.06, type: "sine" }, // 4th harmonic
        { frequency: 980.0, volume: 0.03, type: "sine" }, // 5th harmonic
      ],
      envelope: {
        attack: { value: 1, time: 0.003 },
        release: 0.45,
      },
      strike: {
        duration: 0.008,
        gain: 0.12,
        centerHz: 2200,
        filterType: "bandpass",
        q: 8,
      },
      effects: {
        reverb: { duration: 0.45, decay: 0.7, wet: 0.2 },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await this.createChime({
      name: "High C Chime",
      tones: [
        { frequency: 261.63, volume: 0.4, type: "sine" }, // C4 fundamental
        { frequency: 523.25, volume: 0.35, type: "sine" }, // 2nd harmonic (stronger)
        { frequency: 784.89, volume: 0.2, type: "sine" }, // 3rd harmonic
        { frequency: 1046.5, volume: 0.15, type: "sine" }, // 4th harmonic
        { frequency: 1308.13, volume: 0.1, type: "sine" }, // 5th harmonic
        { frequency: 1570.0, volume: 0.08, type: "sine" }, // 6th harmonic
        { frequency: 1831.0, volume: 0.05, type: "sine" }, // 7th harmonic
      ],
      envelope: {
        attack: { value: 1.2, time: 0.001 },
        sustain: { value: 0.35, time: 0.015 },
        release: 0.5,
      },
      strike: {
        duration: 0.003,
        gain: 0.2,
        centerHz: 4200,
        filterType: "highpass",
        q: 4,
      },
      effects: {
        reverb: { duration: 0.5, decay: 0.6, wet: 0.15 },
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
