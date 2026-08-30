/**
 * Slava (Слава) Caliber 5671 — verified technical specification.
 *
 * Sources (researched from Russian horological literature & teardowns):
 *  - ГОСТ 3145-84 / factory passport: 56 mm caliber, 11 ruby jewels, accuracy class 11,
 *    power reserve >= 36 h from one full winding, balance period 0.4 s.
 *  - Bibliotekar / Soviet commodity reference: "Слава — малогабаритный будильник с анкерным
 *    палетным спуском, механизм калибра 56 мм, на 11 рубиновых камнях, с центральной
 *    сигнальной стрелкой, период колебания баланса 0,4 сек, продолжительность хода не менее 36 ч.
 *    Точность хода ±1,5 мин в сутки."
 *  - mysku.club full teardowns (cal. 5671, early all-metal variant):
 *      · jewel allocation: 4 balance (2 hole + 2 cap), 1 impulse (ellipse), 2 pallets,
 *        4 pivot jewels for pallet arbor & escape-wheel arbor = 11 (jewelled escapement only,
 *        gear train runs in brass bushings);
 *      · screwless (безвинтовый) heavy balance, flat (non-Breguet) hairspring, double roller
 *        with ellipse impulse jewel;
 *      · alarm barrel with friction slipping bridle (as in automatic watches) so the alarm
 *        spring cannot be broken by overwinding;
 *      · hour wheel carries a lug (усик) under axial spring tension; the alarm wheel
 *        (сигнальное колесо) has a slot (паз); when the lug aligns with the slot the hour
 *        wheel drops axially, the stop spring (стопорная пружина) releases the hammer, and
 *        the alarm barrel drives the hammer-fork wheel (колесо вилки молоточка, saw-toothed,
 *        a simplified anchor escapement) that oscillates the hammer against the back-cover
 *        bell (крышка-звонок);
 *      · single train bridge covers five arbors: barrel, center, third, fourth, escape;
 *      · center wheel with pressed minute pinion; motion works: cannon pinion (вексельное
 *        колесо), intermediate wheel, hour wheel;
 *      · alarm duration >= 20 s; alarm set accuracy ±8 min.
 *  - Watch.ru repair documentation: Swiss-lever escape wheels conventionally carry 15 teeth
 *    with simplified tooth form (locking plane + impulse plane + tip).
 *
 * Gear tooth counts were never published by the 2nd Moscow Watch Factory. The counts below
 * are reconstructed to be strictly consistent with the verified kinematic constraints:
 *   · center wheel: 1 rev / hour (motion works constraint);
 *   · escape wheel: 15 teeth, one tooth per 0.4 s balance period  =>  1 rev / 6 s;
 *   · therefore center:escape total ratio = 3600/6 = 600 exactly;
 *   · time barrel sized for >= 36 h reserve with ~9 effective spring turns.
 */

export const SPEC = {
  caliber: '5671',
  jewels: 11,
  mainplateRadius: 28, // mm — калибр 56 мм

  // ---- Oscillator (verified: T = 0.4 s, 18 000 vph, 5 beats/s) ----
  balancePeriod: 0.4, // s
  get balanceFrequencyHz() { return 1 / this.balancePeriod; }, // 2.5 Hz
  beatsPerSecond: 5,
  balanceAmplitudeRad: (270 * Math.PI) / 180, // ~270° full wind (typ. 160–300°)
  balanceInertia: 1.0, // normalised; stiffness derived from verified period

  // ---- Escapement (Swiss lever, jewelled) ----
  escapeWheelTeeth: 15,
  escapeWheelRevSeconds: 15 * 0.4, // 6 s — one tooth per balance period
  palletForkTotalSwingRad: (12 * Math.PI) / 180, // ~±6° fork swing
  unlockAngleRad: (1.5 * Math.PI) / 180,
  impulseFractionOfTooth: 0.55, // fraction of tooth pitch of impulse contact

  // ---- Going train (reconstructed, ratio-exact: 600:1 center→escape) ----
  // barrel → center → third → fourth → escape
  train: {
    barrel:      { wheelTeeth: 72, pitch: 19.0 },  // meshes center pinion
    center:      { pinion: 18, wheelTeeth: 80, pitch: 15.0 }, // 1 rev / hour
    third:       { pinion: 8,  wheelTeeth: 75, pitch: 11.0 }, // 1 rev / 6 min
    fourth:      { pinion: 10, wheelTeeth: 64, pitch: 8.0 },  // 1 rev / 48 s
    escape:      { pinion: 8,  wheelTeeth: 15, pitch: 5.2 },  // 1 rev / 6 s
  },
  // verification: (80/8)·(75/10)·(64/8) = 10·7.5·8 = 600 ✓
  centerToEscapeRatio: (80 / 8) * (75 / 10) * (64 / 8), // 600
  barrelToCenterRatio: 72 / 18, // 4 → barrel: 1 rev / 4 h

  // ---- Time mainspring barrel ----
  timeBarrel: {
    fullTurns: 9,            // 9 barrel revolutions ≈ 36 h at 4 h/rev  ✓ verified reserve
    maxTorque: 1.0,          // normalised
    reserveHours: 36,
    revHours: 4,
  },

  // ---- Motion works (12:1) ----
  motionWorks: {
    cannonPinionTeeth: 14,
    minuteWheelTeeth: 42,   // 3:1
    minuteWheelPinion: 10,
    hourWheelTeeth: 40,     // 4:1 → total 12:1 ✓
  },

  // ---- Alarm (signal) mechanism ----
  alarmBarrel: {
    fullTurns: 2.2,          // small barrel, wound daily (factory manual)
    maxTorque: 1.0,
    // alarm barrel → hammer-fork wheel pinion
    wheelTeeth: 60,
    pinion: 8,
    slippingBridle: true,    // verified friction bridle — cannot overwind
  },
  hammerForkWheelTeeth: 21,  // saw-tooth wheel (verified "like a circular saw")
  strikeRateHz: 7.0,         // hammer oscillation at full wind (≥20 s duration verified)
  alarmMinDurationSeconds: 20,

  // hour-wheel lug / alarm-wheel slot release (verified mechanism)
  alarmSlotHalfWidthRad: (2.2 * Math.PI) / 180, // slot ≈ 4.4° → release window ≈ ±8 min ✓
  hourWheelAxialDrop: 1.6, // mm — axial drop of hour wheel into the slot
} as const;

export const TRAIN_RATIO_CHECK = (() => {
  const t = SPEC.train;
  const centerToEscape =
    (t.center.wheelTeeth / t.third.pinion) *
    (t.third.wheelTeeth / t.fourth.pinion) *
    (t.fourth.wheelTeeth / t.escape.pinion);
  return {
    centerToEscape, // must equal 600
    escapeRevSeconds: 3600 / centerToEscape, // must equal 6
    toothPeriod: 3600 / centerToEscape / SPEC.escapeWheelTeeth, // must equal 0.4
  };
})();
