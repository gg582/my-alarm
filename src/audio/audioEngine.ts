/**
 * Slava5671AudioEngine — real-time physical sound synthesis (no audio files).
 *
 * · Bell: modal synthesis. A stamped-steel bell/cover (крышка-звонок) radiates a set of
 *   inharmonic partials whose frequencies are set by the cup's geometry and whose decay
 *   times follow material damping (higher modes die faster). Implemented as a bank of
 *   high-Q parallel resonators (digital modal filter bank) excited by a short impulse
 *   burst at the exact simulation moment of hammer–bell contact, scaled by contact
 *   velocity. Between strikes the resonators ring freely — the natural decay between
 *   discrete strikes produces the characteristic "ring-ring-ring" shimmer, and while the
 *   hammer rests on the bell (16 ms after each strike) no new excitation occurs, i.e.
 *   hammer-lift damping is inherent to the triggering, not faked with a gate.
 * · Escapement tick: alternating unlock/impulse clicks — shaped noise transients through
 *   a resonant band-pass (tick ~3.4 kHz, tock ~2.9 kHz) plus a low mechanical thud.
 */

interface BellMode {
  freq: number;   // Hz — partial frequency
  decay: number;  // s — amplitude decay time constant
  gain: number;   // relative excitation sensitivity
}

// Authentic brass/steel clock bell acoustic modes (warm fundamental body + metallic inharmonic overtones)
const BELL_MODES: BellMode[] = [
  { freq: 580, decay: 0.35, gain: 1.0 },   // Deep brass cup body resonance (D5 fundamental)
  { freq: 890, decay: 0.28, gain: 0.9 },   // Primary bell chime overtone (A5)
  { freq: 1380, decay: 0.22, gain: 0.75 }, // Metallic tierce clang
  { freq: 2150, decay: 0.16, gain: 0.55 }, // High brass ring
  { freq: 3280, decay: 0.10, gain: 0.35 }, // Rim overtone
  { freq: 4950, decay: 0.06, gain: 0.20 }, // Strike transient shimmer
];

export class Slava5671AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // bell modal bank
  private bellInput: GainNode | null = null;
  private bellModes: BiquadFilterNode[] = [];
  private bellOut: GainNode | null = null;

  // shared noise buffer for excitation bursts
  private noiseBuf: AudioBuffer | null = null;

  private tickGainNode: GainNode | null = null;

  volume = 0.8;
  muted = false;

  /** must be called from a user gesture */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // gentle limiter so repeated strikes never clip harshly
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // ---- bell modal filter bank ----
    this.bellInput = ctx.createGain();
    this.bellInput.gain.value = 1;
    this.bellOut = ctx.createGain();
    this.bellOut.gain.value = 1.0;
    this.bellOut.connect(this.master);
    for (const mode of BELL_MODES) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = mode.freq;
      // Q from decay time: amplitude decay tau ≈ Q / (π f)  →  Q = π f tau
      f.Q.value = Math.max(12, Math.PI * mode.freq * mode.decay * 0.25);
      const g = ctx.createGain();
      g.gain.value = mode.gain;
      this.bellInput.connect(f);
      f.connect(g);
      g.connect(this.bellOut);
      this.bellModes.push(f);
    }

    // ---- tick path ----
    this.tickGainNode = ctx.createGain();
    this.tickGainNode.gain.value = 0.5;
    this.tickGainNode.connect(this.master);

    // shared white-noise buffer (1 s)
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.02);
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  /** hammer strikes the bell — velocity 0..1, exact trigger from physics contact event */
  strike(velocity: number) {
    if (!this.ctx || !this.bellOut) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const amp = Math.max(0.25, Math.min(1.0, velocity));

    // ---- 1. Brass Bell Resonant Partial Cluster (Acoustic Cup Modes) ----
    // Frequencies modeled from the 55.8mm movement's stamped-steel back-cover bell
    const partials = [
      { f: 580, g: 0.70, d: 0.22, modF: 890, modIdx: 850 },   // Deep brass body + chime FM (D5)
      { f: 890, g: 0.85, d: 0.18, modF: 1340, modIdx: 600 },  // Primary bell chime overtone (A5)
      { f: 1420, g: 0.50, d: 0.14, modF: 2150, modIdx: 350 }, // Tierce metallic clang
      { f: 2280, g: 0.35, d: 0.09, modF: 0, modIdx: 0 },      // High brass ring
      { f: 3650, g: 0.22, d: 0.06, modF: 0, modIdx: 0 },      // Metallic rim shimmer
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.f * (0.992 + Math.random() * 0.016), t);

      if (p.modIdx > 0) {
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        mod.type = 'triangle';
        mod.frequency.setValueAtTime(p.modF, t);
        modGain.gain.setValueAtTime(p.modIdx * amp, t);
        modGain.gain.exponentialRampToValueAtTime(1.0, t + 0.04);
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        mod.start(t);
        mod.stop(t + p.d + 0.02);
      }

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(p.g * amp * 0.32, t + 0.0008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + p.d);

      osc.connect(gain);
      gain.connect(this.bellOut);

      osc.start(t);
      osc.stop(t + p.d + 0.02);
    }

    // ---- 2. Steel Hammer Clapper Impact (Transient Click) ----
    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 2.5;

      const env = ctx.createGain();
      env.gain.setValueAtTime(amp * 0.35, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

      src.connect(bp);
      bp.connect(env);
      env.connect(this.bellOut);
      src.start(t);
      src.stop(t + 0.03);
    }
  }

  /** escapement beat — dir alternates tick/tock */
  beat(dir: number, torque: number) {
    if (!this.ctx || !this.tickGainNode || !this.noiseBuf) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = dir > 0 ? 3200 : 2700; // tick vs tock
    bp.Q.value = 6;

    const env = ctx.createGain();
    const amp = 0.22 + 0.12 * Math.min(1, torque);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.0008);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.012);

    // low mechanical body of the pallet stones hitting the banking pins
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const thud = ctx.createGain();
    thud.gain.setValueAtTime(amp * 0.45, t);
    thud.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    src.connect(bp);
    bp.connect(env);
    env.connect(this.tickGainNode);
    src.connect(lp);
    lp.connect(thud);
    thud.connect(this.tickGainNode);
    src.start(t);
    src.stop(t + 0.04);
  }

  /** slipping bridle click when alarm barrel is fully wound */
  windSlip() {
    if (!this.ctx || !this.tickGainNode || !this.noiseBuf) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    bp.Q.value = 6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(bp);
    bp.connect(env);
    env.connect(this.tickGainNode);
    src.start(t);
    src.stop(t + 0.05);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }
}
