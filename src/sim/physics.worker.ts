/**
 * physics.worker.ts — runs Slava5671Physics off the main thread.
 * Receives control commands, advances simulation time (speed-scaled) in a 8 ms
 * real-time loop, and posts state snapshots + acoustic events at ~60 Hz.
 */
import { Slava5671Physics, type SimSnapshot, type SimEvent } from './physics';

export type WorkerInMessage =
  | { cmd: 'windTime'; turns: number }
  | { cmd: 'windAlarm'; turns: number }
  | { cmd: 'setTime'; minutes: number }
  | { cmd: 'setAlarm'; minutes: number }
  | { cmd: 'alarmEnabled'; on: boolean }
  | { cmd: 'pause'; paused: boolean }
  | { cmd: 'step' }
  | { cmd: 'speed'; value: number };

export interface WorkerOutMessage {
  snapshot: SimSnapshot;
  events: SimEvent[];
}

const physics = new Slava5671Physics();
let speed = 1;
let last = performance.now();

function loop() {
  const now = performance.now();
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  physics.advance(realDt * speed);
  const out: WorkerOutMessage = { snapshot: physics.snapshot(), events: physics.drainEvents() };
  (self as unknown as Worker).postMessage(out);
}

setInterval(loop, 16);

self.onmessage = (ev: MessageEvent<WorkerInMessage>) => {
  const m = ev.data;
  switch (m.cmd) {
    case 'windTime': physics.windTime(m.turns); break;
    case 'windAlarm': physics.windAlarm(m.turns); break;
    case 'setTime': physics.setTimeMinutes(m.minutes); break;
    case 'setAlarm': physics.setAlarmMinutes(m.minutes); break;
    case 'alarmEnabled': physics.setAlarmEnabled(m.on); break;
    case 'pause': physics.paused = m.paused; break;
    case 'step': physics.stepOneBeat(); break;
    case 'speed': speed = Math.min(50, Math.max(1, m.value)); break;
  }
};
