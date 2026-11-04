/** Procedural WebAudio sound design. Every sound is synthesized, no audio files. */
export class Sfx {
  enabled = true;
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private wind?: { source: AudioBufferSourceNode; gain: GainNode };
  private jet?: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
  private charge?: { osc: OscillatorNode; gain: GainNode };
  private lastPlayed = new Map<string, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.9 : 0;
    if (!enabled) { this.setJet(0); this.stopCharge(); }
  }

  /** Must be called from a user gesture to unlock audio on mobile browsers. */
  unlock(): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private context(): AudioContext | undefined {
    if (!this.enabled) return undefined;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 6;
        this.master.connect(compressor).connect(this.ctx.destination);
        const length = this.ctx.sampleRate * 1.5;
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch { return undefined; }
  }

  private throttle(key: string, seconds: number): boolean {
    const now = performance.now() / 1000;
    if ((this.lastPlayed.get(key) ?? 0) + seconds > now) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private tone(freq: number, duration: number, type: OscillatorType, volume: number, endFreq = freq * 0.35, delay = 0): void {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private burst(duration: number, volume: number, filterType: BiquadFilterType, freq: number, endFreq = freq, q = 0.8, delay = 0): void {
    const ctx = this.context();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t, Math.random() * 0.5);
    source.stop(t + duration + 0.02);
  }

  mg(): void { this.burst(0.07, 0.22, 'bandpass', 1800, 600, 1.2); this.tone(140 + Math.random() * 40, 0.06, 'square', 0.05, 60); }
  shotgun(): void { this.burst(0.32, 0.5, 'lowpass', 2600, 180, 0.7); this.tone(85, 0.25, 'sine', 0.35, 35); this.burst(0.08, 0.15, 'highpass', 3000, 2000, 1, 0.38); this.tone(500, 0.05, 'square', 0.04, 300, 0.4); }
  laser(power: number): void { this.tone(1600, 0.35 + power * 0.2, 'sawtooth', 0.09 + power * 0.06, 120); this.tone(90, 0.4, 'sine', 0.25 * power + 0.08, 40); this.burst(0.25, 0.1, 'highpass', 4000, 1200); }
  missile(): void { this.burst(0.5, 0.18, 'bandpass', 600, 2400, 1.5); this.tone(220, 0.3, 'triangle', 0.08, 520); }
  explosion(size = 1): void { if (!this.throttle('boom', 0.04)) return; this.burst(0.9 * size, 0.6, 'lowpass', 900, 60, 0.6); this.tone(70, 0.7, 'sine', 0.5, 25); }
  hit(critical: boolean): void { if (!this.throttle('hit', 0.035)) return; this.tone(critical ? 1700 : 1150, 0.05, 'square', critical ? 0.07 : 0.04, critical ? 2400 : 900); }
  kill(): void { this.tone(330, 0.12, 'square', 0.07, 330); this.tone(660, 0.18, 'square', 0.06, 660, 0.09); this.burst(0.4, 0.2, 'bandpass', 1200, 200); }
  enemyShot(): void { if (!this.throttle('enemyShot', 0.03)) return; this.tone(420, 0.12, 'sawtooth', 0.035, 140); }
  telegraph(): void { if (!this.throttle('tele', 0.12)) return; this.tone(880, 0.09, 'square', 0.035, 880); this.tone(1320, 0.09, 'square', 0.03, 1320, 0.1); }
  sniperLock(): void { if (!this.throttle('lock', 0.3)) return; this.tone(1900, 0.5, 'sine', 0.04, 2400); }
  playerHurt(): void { if (!this.throttle('hurt', 0.08)) return; this.burst(0.18, 0.25, 'lowpass', 500, 120); this.tone(110, 0.15, 'square', 0.08, 55); }
  shieldHit(): void { if (!this.throttle('shieldHit', 0.05)) return; this.tone(900, 0.12, 'sine', 0.06, 1500); }
  dash(): void { this.burst(0.3, 0.3, 'bandpass', 400, 2600, 1.2); }
  jump(): void { this.burst(0.22, 0.18, 'bandpass', 300, 1200, 1); }
  land(force: number): void { if (!this.throttle('land', 0.15)) return; this.tone(70, 0.18, 'sine', Math.min(0.4, 0.08 * force), 30); this.burst(0.15, 0.12, 'lowpass', 600, 100); }
  step(): void { if (!this.throttle('step', 0.18)) return; this.tone(55 + Math.random() * 15, 0.09, 'sine', 0.09, 30); }
  shield(): void { this.tone(300, 0.5, 'sine', 0.12, 900); this.tone(600, 0.4, 'triangle', 0.05, 1200, 0.05); }
  impact(): void { this.burst(0.35, 0.45, 'lowpass', 1200, 80); this.tone(60, 0.35, 'square', 0.18, 30); }
  swap(): void { this.tone(300, 0.05, 'square', 0.04, 500); this.tone(700, 0.06, 'square', 0.04, 900, 0.05); }
  overheat(): void { this.burst(0.8, 0.2, 'highpass', 3000, 6000, 0.5); this.tone(600, 0.6, 'sawtooth', 0.05, 200); }
  pickup(): void { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.08, f, i * 0.06)); }
  wave(): void { [196, 262, 330, 392].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.05, f, i * 0.12)); this.burst(1.2, 0.08, 'lowpass', 300, 1500); }
  victory(): void { [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.08, f, i * 0.11)); }
  defeat(): void { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.06, f * 0.95, i * 0.16)); }
  ui(): void { this.tone(1200, 0.04, 'square', 0.025, 1400); }
  slamWarning(): void { this.tone(70, 0.8, 'sawtooth', 0.12, 140); }

  startCharge(): void {
    const ctx = this.context();
    if (!ctx || !this.master || this.charge) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 180;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.1);
    osc.connect(gain).connect(this.master);
    osc.start();
    this.charge = { osc, gain };
  }

  setCharge(charge01: number): void {
    if (!this.charge || !this.ctx) return;
    this.charge.osc.frequency.setTargetAtTime(180 + charge01 * 900, this.ctx.currentTime, 0.03);
  }

  stopCharge(): void {
    if (!this.charge || !this.ctx) return;
    const { osc, gain } = this.charge;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
    osc.stop(this.ctx.currentTime + 0.1);
    this.charge = undefined;
  }

  /** Continuous thruster hiss while hovering. */
  setJet(level: number): void {
    const ctx = level > 0 ? this.context() : this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (!this.jet && level > 0) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.jet = { source, gain, filter };
    }
    if (this.jet) {
      this.jet.gain.gain.setTargetAtTime(level * 0.16, ctx.currentTime, 0.05);
      this.jet.filter.frequency.setTargetAtTime(500 + level * 900, ctx.currentTime, 0.05);
    }
  }

  /** Soft arctic wind bed under the arena. */
  ambience(on: boolean, storm = false): void {
    const ctx = on ? this.context() : this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (!this.wind) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      source.playbackRate.value = 0.35;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.wind = { source, gain };
    }
    this.wind.gain.gain.setTargetAtTime(on ? (storm ? 0.09 : 0.045) : 0, ctx.currentTime, 0.6);
  }
}
