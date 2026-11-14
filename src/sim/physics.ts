/**
 * Slava5671Physics — kinematic & dynamic model of the Slava cal. 5671.
 *
 * Pure TypeScript, DOM-free: runs inside a Web Worker.
 *
 * Model summary
 * -------------
 * · Balance + flat hairspring integrated with RK4 at a fixed 1/12000 s sub-step
 *   (≈ 3000 RK4 steps per 0.4 s period — far above the 5 beats/s event rate, so the
 *   angle-threshold-driven escapement state machine can never tunnel through a contact).
 * · Swiss lever escapement as a discrete phase machine keyed on balance zero-crossings:
 *   locking → unlocking → impulse → drop, with the escape wheel advancing one
 *   half-tooth-pitch (12°) per beat, exactly 15 teeth per 6-second revolution.
 * · Going train ratios enforced rigidly from SPEC (center:escape = 600:1).
 * · Independent barrels with non-linear torque curves; alarm barrel models the verified
 *   friction slipping bridle (winding clamps at full turns instead of breaking).
 * · Alarm: spring 20 preloads the hour wheel and its bent end retains the hammer stem;
 *   full seating of the hour-wheel tab in the alarm-wheel slot lifts spring 20 and
 *   releases the hammer. A separate button inserts the stop stem between saw-wheel
 *   teeth. The two locks react barrel torque independently of the striking motion.
 */

import { SPEC } from './specs';

export interface SimEvent {
  type: 'beat' | 'strike' | 'alarmStart' | 'alarmStop' | 'windSlip';
  /** beat: +1/-1 direction; strike: contact velocity 0..1 */
  value: number;
}

export interface SimSnapshot {
  simTime: number;
  running: boolean;
  paused: boolean;

  balanceAngle: number;      // rad
  balanceVelocity: number;   // rad/s
  balanceAmplitudeDeg: number;
  forkAngle: number;         // rad
  escapeAngle: number;       // rad (cumulative)
  impulseActive: boolean;

  barrelAngle: number;
  centerAngle: number;
  thirdAngle: number;
  fourthAngle: number;
  minuteWheelAngle: number;

  minuteHandAngle: number;   // rad, 0 = 12 o'clock
  hourHandAngle: number;
  alarmHandAngle: number;

  timeBarrelTurns: number;
  timeBarrelTorque: number;  // 0..1
  alarmBarrelTurns: number;
  alarmBarrelTorque: number;

  alarmEnabled: boolean;
  alarmRinging: boolean;
  alarmLocked: boolean;
  alarmLockLoad: number;     // normalized saw-wheel torque reacted by the active lock
  hammerStemReleased: boolean;
  manualStopEngaged: boolean;
  stopStemInsertion: number; // 0..1 button-driven saw-wheel stop travel
  stopSpringDeflection: number; // 0..1 spring-20 lift from the mainplate
  hourWheelDrop: number;     // 0..1 axial drop animation
  hammerAngle: number;       // rad
  hammerResting: boolean;
  alarmWheelAngle: number;   // hammer-fork saw wheel

  timeMinutes: number;       // 0..720 (12 h dial)
  alarmMinutes: number;
  beatCount: number;
}

const TAU = Math.PI * 2;
const SUB_DT = 1 / 12000; // fixed integration sub-step (s)

export class Slava5671Physics {
  // ---- oscillator ----
  private theta = 0.35;         // balance angle (starts with kick)
  private omega = 0;            // balance angular velocity
  private readonly I = SPEC.balanceInertia;
  private readonly k = SPEC.balanceInertia * Math.pow(TAU / SPEC.balancePeriod, 2) * SPEC.rateCalibration;
  // Q ≈ 120 for the balance assembly → viscous damping coefficient below
  private readonly c = (SPEC.balanceInertia * (TAU / SPEC.balancePeriod)) / 120;

  // ---- escapement ----
  private escapeAngle = 0;      // cumulative rad
  private escapeTarget = 0;
  private forkAngle = 0;
  private forkTarget = 0;
  private impulseTimer = 0;
  private readonly impulseDuration = 0.028; // s of fork contact per beat
  private readonly impulseArcHalf = 0.45;   // rad of balance rotation under impulse
  private readonly impMax = 132;            // tuned to sustain ~270° at full wind
  private amplitudeEstimate = 0.35;
  private lastBeatDir = 1;

  // ---- barrels ----
  private timeTurns = 3.0;      // pre-wound (~24h reserve) so movement runs immediately
  private alarmTurns = 1.8;     // pre-wound alarm spring

  // ---- time ----
  private simTime = 0;
  private beatCount = 0;
  private timeOffsetMin = 10 * 60 + 8; // hands start at 10:08
  private alarmMin = 7 * 60;           // alarm preset 7:00

  // ---- alarm ----
  alarmEnabled = true;
  private ringing = false;
  private locked = true;
  private lockLoad = 0;
  private hammerReleased = false;
  private manualStop = false;
  private stopStem = 0;
  private hourDrop = 0;
  private hammerPhase = Math.asin(-0.42 / 0.62);
  private hammerRestTimer = 0;
  private hammerAngle = -0.42;
  private hammerResting = false;
  private alarmWheelAngle = 0;

  paused = false;

  private events: SimEvent[] = [];

  // ================= control API =================

  windTime(amount: number) { // amount in turns
    const before = this.timeTurns;
    this.timeTurns = Math.min(SPEC.timeBarrel.fullTurns, this.timeTurns + amount);
    if (before < this.timeTurns && Math.abs(this.theta) < 0.2 && Math.abs(this.omega) < 1) {
      this.theta = 0.4; // self-start kick, as a real movement starts when wound
    }
  }

  windAlarm(amount: number) {
    // slipping bridle: torque is capped; extra winding just slips (verified behaviour)
    const capped = this.alarmTurns >= SPEC.alarmBarrel.fullTurns - 1e-6;
    this.alarmTurns = Math.min(SPEC.alarmBarrel.fullTurns, this.alarmTurns + amount);
    if (capped && amount > 0) this.events.push({ type: 'windSlip', value: 1 });
  }

  setTimeMinutes(m: number) {
    this.timeOffsetMin = ((m - this.centerAngle() / TAU * 60) % 720 + 720) % 720;
  }

  setAlarmMinutes(m: number) {
    this.alarmMin = ((m % 720) + 720) % 720;
  }

  setAlarmEnabled(on: boolean) {
    this.alarmEnabled = on;
  }

  /** advance exactly one half-oscillation (for the Step button) */
  stepOneBeat() {
    const targetBeat = this.beatCount + 1;
    let guard = 0;
    while (this.beatCount < targetBeat && guard < 12000 * 2) {
      this.subStep(SUB_DT);
      guard++;
    }
  }

  // ================= derived quantities =================

  private timeTorque(): number {
    return Math.pow(Math.max(0, this.timeTurns) / SPEC.timeBarrel.fullTurns, 0.65) * SPEC.timeBarrel.maxTorque;
  }
  private alarmTorque(): number {
    return Math.pow(Math.max(0, this.alarmTurns) / SPEC.alarmBarrel.fullTurns, 0.6) * SPEC.alarmBarrel.maxTorque;
  }
  private centerAngle(): number {
    return this.escapeAngle / SPEC.centerToEscapeRatio;
  }
  timeMinutes(): number {
    return ((this.timeOffsetMin + (this.centerAngle() / TAU) * 60) % 720 + 720) % 720;
  }

  // ================= integration =================

  /** hairspring + escapement acceleration (RK4 derivative) */
  private accel(theta: number, omega: number): number {
    let torque = -this.k * theta - this.c * omega;
    if (this.impulseTimer > 0 && Math.abs(theta) < this.impulseArcHalf) {
      // impulse face contact: torque falls off along the impulse arc (cosine face profile)
      const falloff = Math.cos((theta / this.impulseArcHalf) * (Math.PI / 2));
      torque += Math.sign(omega || this.lastBeatDir) * this.impMax * this.timeTorque() * falloff;
    }
    return torque / this.I;
  }

  private rk4(dt: number) {
    const t0 = this.theta, w0 = this.omega;
    const a1 = this.accel(t0, w0);
    const w1 = w0 + a1 * dt * 0.5;
    const t1 = t0 + w0 * dt * 0.5;
    const a2 = this.accel(t1, w1);
    const w2 = w0 + a2 * dt * 0.5;
    const t2 = t0 + w1 * dt * 0.5;
    const a3 = this.accel(t2, w2);
    const w3 = w0 + a3 * dt;
    const t3 = t0 + w2 * dt;
    const a4 = this.accel(t3, w3);
    this.theta = t0 + (dt / 6) * (w0 + 2 * w1 + 2 * w2 + w3);
    this.omega = w0 + (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
  }

  private subStep(dt: number) {
    const thetaBefore = this.theta;
    const wound = this.timeTurns > 1e-4;

    if (wound) {
      this.rk4(dt);
    } else {
      // run-down movement: balance coasts to rest, escapement locked
      this.impulseTimer = 0;
      this.rk4(dt);
      this.escapeTarget = this.escapeAngle;
    }

    // amplitude tracking (slow envelope follower)
    const absT = Math.abs(this.theta);
    if (absT > this.amplitudeEstimate) this.amplitudeEstimate = absT;
    this.amplitudeEstimate *= 1 - dt * 0.05;

    // ---- escapement beat detection: impulse jewel passes through the fork ----
    if (wound && thetaBefore !== this.theta && Math.sign(thetaBefore) !== Math.sign(this.theta) && Math.abs(this.omega) > 2) {
      const dir = Math.sign(this.omega);
      this.lastBeatDir = dir;
      this.beatCount++;
      this.impulseTimer = this.impulseDuration;
      // escape wheel advances one half tooth pitch (12°), drop-to-lock
      this.escapeTarget += Math.PI / SPEC.escapeWheelTeeth;
      this.forkTarget = dir > 0 ? SPEC.palletForkTotalSwingRad / 2 : -SPEC.palletForkTotalSwingRad / 2;
      this.events.push({ type: 'beat', value: dir });
      // train consumes the mainspring
      this.timeTurns = Math.max(0, this.timeTurns - dt * 0 + 0); // drained continuously below
    }
    if (this.impulseTimer > 0) this.impulseTimer = Math.max(0, this.impulseTimer - dt);

    // escape wheel snap toward target (fast critically-damped jump, ~4 ms)
    this.escapeAngle += (this.escapeTarget - this.escapeAngle) * Math.min(1, dt / 0.004);
    // pallet fork follows its banking with draw
    const forkRate = this.impulseTimer > 0 ? dt / 0.006 : dt / 0.02;
    this.forkAngle += (this.forkTarget - this.forkAngle) * Math.min(1, forkRate);

    // ---- barrel drains ----
    if (wound) this.timeTurns = Math.max(0, this.timeTurns - dt / (SPEC.timeBarrel.revHours * 3600));

    // ---- alarm release: hour-wheel lug vs alarm-wheel slot ----
    const hourAngle = (this.timeMinutes() / 720) * TAU;
    const alarmAngle = (this.alarmMin / 720) * TAU;
    let diff = (hourAngle - alarmAngle) % TAU;
    if (diff > Math.PI) diff -= TAU;
    if (diff < -Math.PI) diff += TAU;
    const stopTarget = this.alarmEnabled ? 0 : 1;
    const stopRate = dt / 0.08;
    this.stopStem += Math.sign(stopTarget - this.stopStem) * Math.min(Math.abs(stopTarget - this.stopStem), stopRate);
    this.manualStop = this.stopStem >= 0.80;

    const inSlot = diff >= 0 && diff < 2 * SPEC.alarmSlotHalfWidthRad;
    const dropTarget = inSlot ? 1 : 0;
    const dropRate = dt / (inSlot ? 0.15 : 0.22);
    this.hourDrop += Math.sign(dropTarget - this.hourDrop) * Math.min(Math.abs(dropTarget - this.hourDrop), dropRate);
    this.hammerReleased = inSlot && this.hourDrop >= 0.98;

    if (!inSlot && this.hourDrop < 0.2 && this.ringing) this.stopRinging();
    if (this.ringing && (this.alarmTurns <= 1e-4 || this.manualStop)) this.stopRinging();
    if (this.hammerReleased && !this.manualStop && !this.ringing && this.alarmTurns > 0.02) {
      this.ringing = true;
      this.hammerPhase = Math.asin(-0.42 / 0.62);
      this.events.push({ type: 'alarmStart', value: 1 });
    }
    this.locked = !this.ringing && (this.manualStop || !this.hammerReleased);
    this.lockLoad = this.locked ? this.alarmTorque() * (SPEC.alarmBarrel.wheelTeeth / SPEC.alarmBarrel.pinion) : 0;

    // ---- striking train: hammer-fork saw wheel → hammer oscillation ----
    if (this.ringing) {
      const torque = this.alarmTorque();
      const strikeRate = SPEC.strikeRateHz * (0.55 + 0.45 * Math.sqrt(torque));
      // saw wheel advances one half-tooth per hammer swing
      this.alarmWheelAngle += (Math.PI / SPEC.hammerForkWheelTeeth) * 2 * strikeRate * dt;
      this.alarmTurns = Math.max(0, this.alarmTurns - dt * (SPEC.alarmBarrel.fullTurns / 20));

      if (this.hammerRestTimer > 0) {
        // hammer head lies on the bell — bell is damped (hammer-lift damping)
        this.hammerRestTimer = Math.max(0, this.hammerRestTimer - dt);
        this.hammerResting = true;
        this.hammerAngle = 0.62; // contact angle
        if (this.hammerRestTimer === 0) this.hammerResting = false;
      } else {
        const prev = Math.sin(this.hammerPhase);
        this.hammerPhase += TAU * strikeRate * dt;
        const now = Math.sin(this.hammerPhase);
        this.hammerAngle = 0.62 * now;
        // contact: rising edge through the bell plane
        if (prev < 0.985 && now >= 0.985) {
          const vel = Math.abs(Math.cos(this.hammerPhase)) * (0.5 + 0.5 * torque);
          this.events.push({ type: 'strike', value: Math.min(1, vel) });
          this.hammerRestTimer = 0.004; // 4 ms rest on the bell
          this.hammerResting = true;
        }
      }
    } else {
      if (!this.manualStop && !this.hammerReleased) this.hammerAngle = -0.42;
      else if (!this.manualStop) this.hammerAngle *= 1 - Math.min(1, dt / 0.1);
      this.hammerResting = false;
    }

    this.simTime += dt;
  }

  private stopRinging() {
    if (this.ringing) this.events.push({ type: 'alarmStop', value: 1 });
    this.ringing = false;
  }

  /** advance the whole movement by simDt seconds of movement time */
  advance(simDt: number) {
    if (this.paused) return;
    let remaining = Math.min(simDt, 2.0); // hard cap per call for stability
    while (remaining > 1e-9) {
      const dt = Math.min(SUB_DT, remaining);
      this.subStep(dt);
      remaining -= dt;
    }
  }

  // ================= snapshot =================

  snapshot(): SimSnapshot {
    const esc = this.escapeAngle;
    const fourth = -esc / (SPEC.train.fourth.wheelTeeth / SPEC.train.escape.pinion);
    const third = -fourth / (SPEC.train.third.wheelTeeth / SPEC.train.fourth.pinion);
    const center = -third / (SPEC.train.center.wheelTeeth / SPEC.train.third.pinion);
    const barrel = -center / SPEC.barrelToCenterRatio;
    const minuteHand = (this.timeMinutes() / 60) * TAU;
    const hourHand = (this.timeMinutes() / 720) * TAU;
    const snap: SimSnapshot = {
      simTime: this.simTime,
      running: this.timeTurns > 1e-4,
      paused: this.paused,
      balanceAngle: this.theta,
      balanceVelocity: this.omega,
      balanceAmplitudeDeg: (this.amplitudeEstimate * 180) / Math.PI,
      forkAngle: this.forkAngle,
      escapeAngle: esc,
      impulseActive: this.impulseTimer > 0,
      barrelAngle: barrel,
      centerAngle: center,
      thirdAngle: third,
      fourthAngle: fourth,
      minuteWheelAngle: -(center / 3),
      minuteHandAngle: minuteHand,
      hourHandAngle: hourHand,
      alarmHandAngle: (this.alarmMin / 720) * TAU,
      timeBarrelTurns: this.timeTurns,
      timeBarrelTorque: this.timeTorque(),
      alarmBarrelTurns: this.alarmTurns,
      alarmBarrelTorque: this.alarmTorque(),
      alarmEnabled: this.alarmEnabled,
      alarmRinging: this.ringing,
      alarmLocked: this.locked,
      alarmLockLoad: this.lockLoad,
      hammerStemReleased: this.hammerReleased,
      manualStopEngaged: this.manualStop,
      stopStemInsertion: this.stopStem,
      stopSpringDeflection: this.hourDrop,
      hourWheelDrop: this.hourDrop,
      hammerAngle: this.hammerAngle,
      hammerResting: this.hammerResting,
      alarmWheelAngle: this.alarmWheelAngle,
      timeMinutes: this.timeMinutes(),
      alarmMinutes: this.alarmMin,
      beatCount: this.beatCount,
    };
    return snap;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
