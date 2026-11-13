/**
 * Slava (Слава) caliber 5671, early all-metal version.
 *
 * Primary references:
 *  - V. A. Shamonova, "Repair of Mechanical Alarm Clocks" (1987), pp. 4, 12–14:
 *    55.8 mm reduced caliber, 19 mm height, 11 jewels, 0.4 s balance period,
 *    at least 36 h reserve, at least 15 s alarm, ±5 min alarm release tolerance,
 *    central alarm hand, brass monometallic balance, Swiss lever escapement.
 *    https://www.cccp-forum.it/docs/books/Shamonova%20-%20Remont%20mekhanicheskikh%20budilnikov%20(1987).pdf
 *  - A. A. Kharitonchuk, "Watch Repair Reference Book" (1977), pp. 143–145:
 *    caliber nomenclature, going train, alarm train and motion-work construction.
 *    https://www.cccp-forum.it/docs/books/Kharitonchuk%20-%20Spravochnaya%20Kniga%20Po%20Remontu%20Chasov%20(1977).pdf
 *  - LePart's early all-metal 5671 teardown: component layout, five-spoke train
 *    wheels, blued hour/minute hands, brass alarm needle, 14-tooth hammer-fork
 *    wheel, barrel teeth, bridges, jewels and slipping alarm-spring bridle.
 *    https://mysku.club/blog/diy/86519.html
 *  - Official Slava 1983 catalog: the many case/dial variants and the standard
 *    blued steel hands with a brass central alarm hand (not a seconds hand).
 *    https://slava.su/spravochnaja-informatsija/istoricheskie-katalogi-chasov-slava/katalog-chasov-slava-1983-budilniki/
 *
 * The factory literature does not publish every tooth count or component size.
 * Photo-derived counts and normalized dynamics below are simulation parameters,
 * not claims of factory metrology. The time-indicating train is ratio-exact:
 * 15 escape teeth, one half-tooth per 0.2 s beat, one escape revolution per 6 s,
 * and one center-wheel revolution per hour (600:1).
 */

export const SPEC = {
  caliber: '5671',
  jewels: 11,
  mainplateRadius: 27.9,
  movementHeight: 19,

  balancePeriod: 0.4,
  get balanceFrequencyHz() { return 1 / this.balancePeriod; },
  beatsPerSecond: 5,
  balanceAmplitudeRad: (270 * Math.PI) / 180,
  balanceInertia: 1.0,

  escapeWheelTeeth: 15,
  escapeWheelRevSeconds: 15 * 0.4,
  palletForkTotalSwingRad: (12 * Math.PI) / 180,
  unlockAngleRad: (1.5 * Math.PI) / 180,
  impulseFractionOfTooth: 0.55,

  train: {
    barrel:      { wheelTeeth: 96, pitch: 13.5 },
    center:      { pinion: 12, wheelTeeth: 80, pitch: 9.0 },
    third:       { pinion: 8,  wheelTeeth: 75, pitch: 11.0 },
    fourth:      { pinion: 10, wheelTeeth: 64, pitch: 7.0 },
    escape:      { pinion: 8,  wheelTeeth: 15, pitch: 4.6 },
  },
  centerToEscapeRatio: (80 / 8) * (75 / 10) * (64 / 8),
  barrelToCenterRatio: 96 / 12,

  timeBarrel: {
    fullTurns: 4.5,
    maxTorque: 1.0,
    reserveHours: 36,
    revHours: 8,
  },

  motionWorks: {
    cannonPinionTeeth: 12,
    minuteWheelTeeth: 36,
    minuteWheelPinion: 8,
    hourWheelTeeth: 32,
  },

  alarmBarrel: {
    fullTurns: 2.2,
    maxTorque: 1.0,
    wheelTeeth: 96,
    pinion: 12,
    slippingBridle: true,
  },
  hammerForkWheelTeeth: 14,
  strikeRateHz: 25.0,
  alarmMinDurationSeconds: 15,

  alarmSlotHalfWidthRad: (2.5 * Math.PI) / 180,
  hourWheelAxialDrop: 1.6,
} as const;

export const TRAIN_RATIO_CHECK = (() => {
  const t = SPEC.train;
  const centerToEscape =
    (t.center.wheelTeeth / t.third.pinion) *
    (t.third.wheelTeeth / t.fourth.pinion) *
    (t.fourth.wheelTeeth / t.escape.pinion);
  return {
    centerToEscape,
    escapeRevSeconds: 3600 / centerToEscape,
    toothPeriod: 3600 / centerToEscape / SPEC.escapeWheelTeeth,
  };
})();
