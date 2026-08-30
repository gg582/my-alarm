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

// Stamped-steel bell partials (inharmonic, cup modes: hum, prime, tierce, quint, nominal…)
const BELL_MODES: BellMode[] = [
  { freq: 1318, decay: 1.35, gain: 0.55 },  // hum
  { freq: 1975, decay: 1.10, gain: 0.85 },  // fundamental region
  { freq: 2437, decay: 0.80, gain: 1.00 },  // tierce (prominent in stamped bells)
  { freq: 2966, decay: 0.62, gain: 0.80 },  // quint
  { freq: 3542, decay: 0.45, gain: 0.62 },  // nominal
  { freq: 4410, decay: 0.30, gain: 0.40 },  // high ring
  { freq: 5680, decay: 0.18, gain: 0.24 },  // high ring
  { freq: 7350, decay: 0.10, gain: 0.13 },  // strike shimmer
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
    this.bellOut.gain.value = 0.9;
    this.bellOut.connect(this.master);
    for (const mode of BELL_MODES) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = mode.freq;
      // Q from decay time: amplitude decay tau ≈ Q / (π f)  →  Q = π f tau
      f.Q.value = Math.PI * mode.freq * mode.decay;
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
    if (!this.ctx || !this.bellInput || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // excitation impulse: very short shaped noise burst into the modal bank
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1 + Math.random() * 0.04; // slight contact jitter
    const env = ctx.createGain();
    const amp = 0.25 + velocity * 0.75;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.0006);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.004);
    // contact click: extra broadband component of the hammer hit itself
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 5200;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(amp * 0.30, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);

    src.connect(env);
    env.connect(this.bellInput);
    src.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.bellOut!);
    src.start(t);
    src.stop(t + 0.05);
  }

  /** escapement beat — dir alternates tick/tock */
  beat(dir: number, torque: number) {
    if (!this.ctx || !this.tickGainNode || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = dir > 0 ? 3400 : 2900; // tick vs tock
    bp.Q.value = 9;

    const env = ctx.createGain();
    const amp = (0.16 + 0.1 * torque);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.0008);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.009);

    // low mechanical body of the pallet stones hitting the banking pins
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const thud = ctx.createGain();
    thud.gain.setValueAtTime(amp * 0.5, t);
    thud.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

    src.connect(bp);
    bp.connect(env);
    env.connect(this.tickGainNode);
    src.connect(lp);
    lp.connect(thud);
    thud.connect(this.tickGainNode);
    src.start(t);
    src.stop(t + 0.06);
  }

  /** slipping bridle click when alarm barrel is fully wound */
  windSlip() {
    if (!this.ctx || !this.tickGainNode || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4200;
    bp.Q.value = 6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.12, t);
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
