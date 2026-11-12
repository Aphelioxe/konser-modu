'use strict';

/**
 * Konser Modu — ses motoru
 *
 * Samsung'un "Concert Hall" efekti gibi, seçili sekmenin sesine mekân
 * yankısı ekler. Yankı, prosedürel olarak üretilen stereo bir impuls
 * yanıtının (IR) ConvolverNode ile uygulanmasıyla elde edilir; harici
 * ses dosyası gerekmez.
 *
 * Grafik:
 *   kaynak → kuru ses ───────────────────────────────┐
 *          → ön gecikme → A/B convolver → yankı toplamı
 *            → highpass → lowpass → ıslak seviye ────→ master
 *            → kompresör → hoparlör
 */

(() => {
  const FADE_SECONDS = 0.18;
  const MIX_RAMP_SECONDS = 0.08;

  const PRESETS = Object.freeze({
    hall: {
      id: 'hall',
      label: 'Konser Salonu',
      rt60: 2.9,
      preDelay: 0.019,
      wetMax: 0.72,
      lowpass: 7000,
      highpass: 150,
      damping: 0.46,
      earlyLevel: 0.42,
    },
    stadium: {
      id: 'stadium',
      label: 'Stadyum',
      rt60: 4.1,
      preDelay: 0.031,
      wetMax: 0.8,
      lowpass: 5600,
      highpass: 130,
      damping: 0.34,
      earlyLevel: 0.55,
    },
    stage: {
      id: 'stage',
      label: 'Küçük Sahne',
      rt60: 1.5,
      preDelay: 0.011,
      wetMax: 0.58,
      lowpass: 8200,
      highpass: 170,
      damping: 0.56,
      earlyLevel: 0.3,
    },
  });

  const DEFAULT_PRESET = 'hall';
  const LIMIT_THRESHOLD = 0.7;

  let softLimitCurve = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * 0,7 altında doğrusal kalan yumuşak limiter eğrisi. Giriş −1..1 aralığına
   * ölçeklendiği için eğri, softLimit(2u) değerlerini içerir.
   */
  function getSoftLimitCurve() {
    if (softLimitCurve) return softLimitCurve;
    const size = 4097;
    const curve = new Float32Array(size);
    const threshold = LIMIT_THRESHOLD;

    for (let i = 0; i < size; i += 1) {
      const u = (i / (size - 1)) * 2 - 1;
      const value = u * 2;
      const magnitude = Math.abs(value);
      if (magnitude <= threshold) {
        curve[i] = value;
      } else {
        const limited =
          threshold +
          (1 - threshold) *
            Math.tanh((magnitude - threshold) / (1 - threshold));
        curve[i] = Math.sign(value) * limited;
      }
    }

    softLimitCurve = curve;
    return curve;
  }

  function sanitizeSettings(input) {
    const preset = PRESETS[input?.preset] ? input.preset : DEFAULT_PRESET;
    let intensity = Number(input?.intensity);
    if (!Number.isFinite(intensity)) intensity = 70;
    return {
      preset,
      intensity: clamp(Math.round(intensity), 0, 100),
    };
  }

  function wetAmountFor(intensity, wetMax) {
    return wetMax * Math.pow(clamp(intensity, 0, 100) / 100, 1.25);
  }

  /** Birinci derece Schroeder allpass; genliği değiştirmeden fazı döndürür. */
  function allpass(input, gain, delaySamples) {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const delayedInput = i >= delaySamples ? input[i - delaySamples] : 0;
      const delayedOutput = i >= delaySamples ? output[i - delaySamples] : 0;
      output[i] = -gain * input[i] + delayedInput + gain * delayedOutput;
    }
    return output;
  }

  /** Sağ kanalı, sol kanalın fazı döndürülmüş kopyasından üretir. */
  function decorrelate(input, sampleRate) {
    const stages = [
      [0.62, 0.0017],
      [-0.54, 0.0023],
      [0.47, 0.0031],
      [-0.41, 0.0043],
    ];
    let output = input;
    for (const [gain, seconds] of stages) {
      output = allpass(output, gain, Math.max(1, Math.round(seconds * sampleRate)));
    }
    return output;
  }

  /**
   * Sönümlenen stereo gürültü + erken yansımalardan bir impuls yanıtı üretir.
   * İki kanal aynı spektral büyüklüğe sahiptir; sağ kanal allpass zinciriyle
   * faz açısından ayrıştırılır. Böylece hem geniş bir stereo alan hem de
   * frekanstan bağımsız kanal dengesi elde edilir. Her kanalın enerjisi
   * normalize edilir; farklı mekânlar benzer algılanan yüksekliğe sahip olur.
   */
  function buildImpulse(ctx, spec) {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.round(spec.rt60 * sampleRate) + 1);
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const fadeInSamples = Math.max(1, Math.round(sampleRate * 0.0025));
    const decayPerSample = Math.exp(-6.907755 / (spec.rt60 * sampleRate));
    const earlyTaps = [0.0047, 0.0089, 0.0131, 0.0217, 0.0331, 0.0479];

    // Ortak gürültü tabanı ve erken yansımalar; iki kanalın spektrumu aynı
    // olsun diye sağ kanal, sol kanalın allpass ile fazı döndürülmüş kopyasıdır.
    const base = new Float32Array(length);
    let lowpassed = 0;
    let envelope = 1;
    for (let i = 0; i < length; i += 1) {
      const noise = Math.random() * 2 - 1;
      lowpassed += spec.damping * (noise - lowpassed);
      const attack = i < fadeInSamples ? i / fadeInSamples : 1;
      base[i] = lowpassed * envelope * attack;
      envelope *= decayPerSample;
    }

    for (let tapIndex = 0; tapIndex < earlyTaps.length; tapIndex += 1) {
      const offset = Math.round(earlyTaps[tapIndex] * sampleRate);
      if (offset >= length) continue;
      base[offset] += spec.earlyLevel * Math.pow(0.62, tapIndex);
    }

    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    left.set(base);
    right.set(decorrelate(base, sampleRate));

    for (let channel = 0; channel < 2; channel += 1) {
      const data = channel === 0 ? left : right;

      // Kanal enerjisini 1'e normalize et: ıslak ses, kuru sesle
      // karşılaştırılabilir bir seviyede kalsın.
      let energy = 0;
      for (let i = 0; i < length; i += 1) {
        energy += data[i] * data[i];
      }
      const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
      for (let i = 0; i < length; i += 1) {
        data[i] *= scale;
      }
    }

    return buffer;
  }

  class ConcertEngine {
    constructor(ctx, settings) {
      this.ctx = ctx;
      this.settings = sanitizeSettings(settings);
      this.presetId = null;
      this.activeBranch = 0;
      this.fadeEnd = 0;
      this.pendingPreset = null;
      this.pendingTimer = null;

      // Tüm mekânlar başlangıçta hazırlanır; preset değişimi anında olsun.
      this.buffers = new Map();
      for (const id of Object.keys(PRESETS)) {
        this.buffers.set(id, buildImpulse(ctx, PRESETS[id]));
      }

      this.input = ctx.createGain();
      this.input.gain.value = 1;

      this.dryGain = ctx.createGain();
      this.dryGain.gain.value = 0.97;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;

      // Kompresörün ardından şeffaf tepe koruması.
      this.limitPreGain = ctx.createGain();
      this.limitPreGain.gain.value = 0.5;
      this.limiter = ctx.createWaveShaper();
      this.limiter.curve = getSoftLimitCurve();
      this.limiter.oversample = '2x';

      this.preDelay = ctx.createDelay(0.25);
      this.preDelay.delayTime.value = PRESETS[this.settings.preset].preDelay;

      this.convolvers = [ctx.createConvolver(), ctx.createConvolver()];
      this.branchGains = [ctx.createGain(), ctx.createGain()];
      this.branchGains[0].gain.value = 1;
      this.branchGains[1].gain.value = 0;

      const initialBuffer = this.buffers.get(this.settings.preset);
      for (const convolver of this.convolvers) {
        convolver.normalize = false;
        convolver.buffer = initialBuffer;
      }

      this.wetSum = ctx.createGain();
      this.wetSum.gain.value = 1;

      this.highpass = ctx.createBiquadFilter();
      this.highpass.type = 'highpass';
      this.highpass.frequency.value = PRESETS[this.settings.preset].highpass;
      this.highpass.Q.value = 0.7;

      this.lowpass = ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = PRESETS[this.settings.preset].lowpass;
      this.lowpass.Q.value = 0.7;

      this.wetGain = ctx.createGain();
      this.wetGain.gain.value = 0;

      this.#connect();
      this.applySettings(this.settings, true);
    }

    #connect() {
      const ctx = this.ctx;

      this.input.connect(this.dryGain);
      this.dryGain.connect(this.master);

      this.input.connect(this.preDelay);
      this.preDelay.connect(this.convolvers[0]);
      this.preDelay.connect(this.convolvers[1]);

      this.convolvers[0].connect(this.branchGains[0]);
      this.convolvers[1].connect(this.branchGains[1]);

      this.branchGains[0].connect(this.wetSum);
      this.branchGains[1].connect(this.wetSum);

      this.wetSum.connect(this.highpass);
      this.highpass.connect(this.lowpass);
      this.lowpass.connect(this.wetGain);
      this.wetGain.connect(this.master);

      this.master.connect(this.compressor);
      this.compressor.connect(this.limitPreGain);
      this.limitPreGain.connect(this.limiter);
      this.limiter.connect(ctx.destination);
    }

    /** Ayar değişikliklerini tıklama olmadan uygular. */
    applySettings(settings, immediate = false) {
      const next = sanitizeSettings(settings);
      this.settings = next;

      const spec = PRESETS[next.preset];
      const amount = wetAmountFor(next.intensity, spec.wetMax);
      const now = this.ctx.currentTime;

      if (immediate) {
        this.preDelay.delayTime.cancelScheduledValues(now);
        this.preDelay.delayTime.setValueAtTime(spec.preDelay, now);
        this.highpass.frequency.cancelScheduledValues(now);
        this.highpass.frequency.setValueAtTime(spec.highpass, now);
        this.lowpass.frequency.cancelScheduledValues(now);
        this.lowpass.frequency.setValueAtTime(spec.lowpass, now);
        this.wetGain.gain.cancelScheduledValues(now);
        this.wetGain.gain.setValueAtTime(amount, now);
        this.presetId = next.preset;
        return;
      }

      this.preDelay.delayTime.setTargetAtTime(spec.preDelay, now, 0.04);
      this.highpass.frequency.setTargetAtTime(spec.highpass, now, 0.05);
      this.lowpass.frequency.setTargetAtTime(spec.lowpass, now, 0.05);

      const gain = this.wetGain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(amount, now + MIX_RAMP_SECONDS);

      if (next.preset !== this.presetId) {
        this.#requestPreset(next.preset);
      }
    }

    #requestPreset(presetId) {
      if (!PRESETS[presetId] || presetId === this.presetId) return;

      const now = this.ctx.currentTime;
      if (now < this.fadeEnd) {
        // Önceki geçiş bitmeden tampon değiştirmemek için sıraya al.
        this.pendingPreset = presetId;
        clearTimeout(this.pendingTimer);
        const wait = Math.max(30, (this.fadeEnd - now) * 1000 + 30);
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          const pending = this.pendingPreset;
          this.pendingPreset = null;
          if (pending && pending !== this.presetId) {
            this.#crossfadeTo(pending);
          }
        }, wait);
        return;
      }

      this.#crossfadeTo(presetId);
    }

    #crossfadeTo(presetId) {
      const buffer = this.buffers.get(presetId);
      if (!buffer) return;

      const now = this.ctx.currentTime;
      const nextBranch = 1 - this.activeBranch;
      const nextGain = this.branchGains[nextBranch].gain;
      const currentGain = this.branchGains[this.activeBranch].gain;

      // Pasif kolda tamponu değiştirmek duyulabilir bir kesinti yaratmaz.
      this.convolvers[nextBranch].buffer = buffer;

      nextGain.cancelScheduledValues(now);
      currentGain.cancelScheduledValues(now);
      nextGain.setValueAtTime(nextGain.value, now);
      currentGain.setValueAtTime(currentGain.value, now);
      nextGain.linearRampToValueAtTime(1, now + FADE_SECONDS);
      currentGain.linearRampToValueAtTime(0, now + FADE_SECONDS);

      this.activeBranch = nextBranch;
      this.presetId = presetId;
      this.fadeEnd = now + FADE_SECONDS;
    }

    dispose() {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingPreset = null;

      const nodes = [
        this.input,
        this.dryGain,
        this.preDelay,
        ...this.convolvers,
        ...this.branchGains,
        this.wetSum,
        this.highpass,
        this.lowpass,
        this.wetGain,
        this.master,
        this.compressor,
        this.limitPreGain,
        this.limiter,
      ];

      for (const node of nodes) {
        try {
          node.disconnect();
        } catch (_) {
          /* zaten bağlantısız */
        }
      }

      for (const convolver of this.convolvers) {
        try {
          convolver.buffer = null;
        } catch (_) {
          /* yok say */
        }
      }

      this.buffers.clear();
    }
  }

  globalThis.ConcertEngine = ConcertEngine;
  globalThis.CONCERT_PRESETS = PRESETS;
})();
