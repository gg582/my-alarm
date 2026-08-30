/**
 * Slava Caliber 5671 — interactive mechanical alarm-clock movement simulator.
 * WebGPU rendering · Web Audio physical synthesis · Worker-based RK4 physics.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Slava5671Renderer } from '../render/renderer';
import { Slava5671AudioEngine } from '../audio/audioEngine';
import type { WorkerInMessage, WorkerOutMessage } from '../sim/physics.worker';
import type { SimSnapshot } from '../sim/physics';
import { SPEC, TRAIN_RATIO_CHECK } from '../sim/specs';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 12;
  const m = Math.floor(min % 60);
  const s = Math.floor((min * 60) % 60);
  return `${String(h === 0 ? 12 : h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const rendererRef = useRef<Slava5671Renderer | null>(null);
  const audioRef = useRef<Slava5671AudioEngine | null>(null);
  const snapRef = useRef<SimSnapshot | null>(null);

  const [gpuError, setGpuError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [alarmOn, setAlarmOn] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [timeInput, setTimeInput] = useState('10:08');
  const [alarmInput, setAlarmInput] = useState('07:00');
  const [hud, setHud] = useState({
    time: '10:08:00', alarm: '07:00', amp: 0, timeTurns: 0, alarmTurns: 0,
    ringing: false, beats: 0, running: false,
  });

  const send = useCallback((m: WorkerInMessage) => workerRef.current?.postMessage(m), []);

  // ---------- init worker + renderer ----------
  useEffect(() => {
    const worker = new Worker(new URL('../sim/physics.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const audio = new Slava5671AudioEngine();
    audioRef.current = audio;

    let raf = 0;
    let lastHudT = -1;
    const renderer = new Slava5671Renderer(canvasRef.current!);
    rendererRef.current = renderer;
    renderer.init().then((ok) => {
      if (!ok) setGpuError(renderer.error ?? 'WebGPU init failed');
    }).catch((e) => {
      setGpuError('init exception: ' + String(e));
    });

    worker.onmessage = (ev: MessageEvent<WorkerOutMessage>) => {
      const { snapshot, events } = ev.data;
      snapRef.current = snapshot;
      for (const e of events) {
        if (e.type === 'beat') audio.beat(e.value, snapshot.timeBarrelTorque);
        else if (e.type === 'strike') audio.strike(e.value);
        else if (e.type === 'windSlip') audio.windSlip();
      }
      renderer.onEvents(events);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const snap = snapRef.current;
      if (snap && renderer.ok) renderer.render(snap);
      // throttle React HUD updates to ~10 Hz
      if (snap && snap.simTime - lastHudT > 0.1) {
        lastHudT = snap.simTime;
        setHud({
          time: fmtTime(snap.timeMinutes),
          alarm: fmtTime(snap.alarmMinutes).slice(0, 5),
          amp: snap.balanceAmplitudeDeg,
          timeTurns: snap.timeBarrelTurns,
          alarmTurns: snap.alarmBarrelTurns,
          ringing: snap.alarmRinging,
          beats: snap.beatCount,
          running: snap.running,
        });
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      worker.terminate();
    };
  }, []);

  // ---------- winding (press & hold, like the real key) ----------
  const windTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startWind = (kind: 'time' | 'alarm') => {
    const tick = () => send(kind === 'time' ? { cmd: 'windTime', turns: 0.35 } : { cmd: 'windAlarm', turns: 0.12 });
    tick();
    windTimer.current = setInterval(tick, 120);
  };
  const stopWind = () => {
    if (windTimer.current) clearInterval(windTimer.current);
    windTimer.current = null;
  };

  const enableAudio = () => {
    audioRef.current?.init();
    setAudioOn(true);
  };

  const applyTime = () => {
    const [h, m] = timeInput.split(':').map((x) => parseInt(x || '0', 10));
    send({ cmd: 'setTime', minutes: ((h % 12) + 12) % 12 * 60 + (m % 60) });
  };
  const applyAlarm = () => {
    const [h, m] = alarmInput.split(':').map((x) => parseInt(x || '0', 10));
    send({ cmd: 'setAlarm', minutes: ((h % 12) + 12) % 12 * 60 + (m % 60) });
  };

  const timeFrac = hud.timeTurns / SPEC.timeBarrel.fullTurns;
  const alarmFrac = hud.alarmTurns / SPEC.alarmBarrel.fullTurns;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b0d12] text-neutral-200 select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {gpuError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0d12]">
          <div className="max-w-md rounded-lg border border-red-900 bg-red-950/40 p-6 text-sm">{gpuError}</div>
        </div>
      )}

      {/* header */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-start justify-between p-4">
        <div>
          <h1 className="text-xl font-semibold tracking-wide text-amber-200/90">
            СЛАВА · Caliber 5671
          </h1>
          <p className="text-xs text-neutral-400">
            2nd Moscow Watch Factory · 56 mm · {SPEC.jewels} jewels · {SPEC.beatsPerSecond * 3600} vph (0.4 s) · Swiss lever
          </p>
        </div>
        <div className={`rounded px-3 py-1 font-mono text-lg tabular-nums ${hud.ringing ? 'animate-pulse bg-red-900/60 text-red-200' : 'bg-neutral-800/60'}`}>
          {hud.time}
          {hud.ringing && <span className="ml-2 text-xs">ALARM</span>}
        </div>
      </div>

      {/* control panel */}
      <div className="absolute bottom-4 left-4 z-10 w-72 space-y-3 rounded-xl border border-neutral-700/60 bg-neutral-900/80 p-4 backdrop-blur">
        {!audioOn ? (
          <Button className="w-full bg-amber-700 hover:bg-amber-600" onClick={enableAudio}>
            Enable sound (bell &amp; tick synthesis)
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 text-neutral-400">Volume</span>
            <Slider value={[volume * 100]} max={100} step={1} onValueChange={(v) => { setVolume(v[0] / 100); audioRef.current?.setVolume(v[0] / 100); }} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onPointerDown={() => startWind('time')} onPointerUp={stopWind} onPointerLeave={stopWind}>
            Wind time
          </Button>
          <Button variant="secondary" onPointerDown={() => startWind('alarm')} onPointerUp={stopWind} onPointerLeave={stopWind}>
            Wind alarm
          </Button>
        </div>
        <div className="space-y-1.5 text-[10px] text-neutral-400">
          <div className="flex items-center gap-2">
            <span className="w-14">TIME</span>
            <div className="h-1.5 flex-1 rounded bg-neutral-700">
              <div className="h-1.5 rounded bg-amber-500" style={{ width: `${timeFrac * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{hud.timeTurns.toFixed(1)}t</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14">ALARM</span>
            <div className="h-1.5 flex-1 rounded bg-neutral-700">
              <div className="h-1.5 rounded bg-sky-500" style={{ width: `${alarmFrac * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{hud.alarmTurns.toFixed(2)}t</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
          <input value={timeInput} onChange={(e) => setTimeInput(e.target.value)} placeholder="HH:MM"
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono" />
          <Button size="sm" variant="outline" onClick={applyTime}>Set time</Button>
          <input value={alarmInput} onChange={(e) => setAlarmInput(e.target.value)} placeholder="HH:MM"
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono" />
          <Button size="sm" variant="outline" onClick={applyAlarm}>Set alarm</Button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-400">Alarm armed</span>
          <Switch checked={alarmOn} onCheckedChange={(on) => { setAlarmOn(on); send({ cmd: 'alarmEnabled', on }); }} />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant={paused ? 'default' : 'secondary'} className="flex-1"
            onClick={() => { const p = !paused; setPaused(p); send({ cmd: 'pause', paused: p }); }}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="secondary" className="flex-1"
            onClick={() => send({ cmd: 'step' })} disabled={!paused}>
            Step ½ beat
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-12 text-neutral-400">Speed</span>
          <Slider value={[speed]} min={1} max={50} step={1}
            onValueChange={(v) => { setSpeed(v[0]); send({ cmd: 'speed', value: v[0] }); }} />
          <span className="w-8 text-right tabular-nums">{speed}×</span>
        </div>
      </div>

      {/* status / spec panel */}
      <div className="absolute bottom-4 right-4 z-10 w-80 space-y-2 rounded-xl border border-neutral-700/60 bg-neutral-900/80 p-4 text-xs backdrop-blur">
        {/* SVG dial inset */}
        <div className="flex items-center gap-3">
          <DialInset snapRef={snapRef} />
          <div className="space-y-1 font-mono tabular-nums">
            <div>balance&nbsp; <span className="text-amber-300">{hud.amp.toFixed(0)}°</span></div>
            <div>beats&nbsp;&nbsp;&nbsp; <span className="text-amber-300">{hud.beats}</span></div>
            <div>train&nbsp;&nbsp;&nbsp; <span className={hud.running ? 'text-emerald-400' : 'text-red-400'}>{hud.running ? 'running' : 'run down'}</span></div>
            <div>alarm&nbsp;&nbsp;&nbsp; <span className="text-sky-300">{hud.alarm}</span></div>
          </div>
        </div>
        <div className="border-t border-neutral-700/60 pt-2 leading-relaxed text-neutral-400">
          <span className="text-neutral-300">Verified spec:</span> 18 000 vph · escape wheel 15T/6 s ·
          center→escape 600:1 (= {TRAIN_RATIO_CHECK.centerToEscape}) · 36 h reserve ·
          alarm ≥ 20 s · hour-wheel lug → alarm-wheel slot release · friction slipping bridle.
        </div>
      </div>
    </div>
  );
}

/** small live dial inset driven by the snapshot */
function DialInset({ snapRef }: { snapRef: React.MutableRefObject<SimSnapshot | null> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = snapRef.current;
      const svg = svgRef.current;
      if (!s || !svg) return;
      const setHand = (id: string, angle: number, len: number) => {
        const el = svg.querySelector(`#${id}`) as SVGLineElement | null;
        if (!el) return;
        const a = angle - Math.PI / 2;
        el.setAttribute('x2', String(50 + Math.cos(a) * len));
        el.setAttribute('y2', String(50 + Math.sin(a) * len));
      };
      setHand('dial-h', s.hourHandAngle, 22);
      setHand('dial-m', s.minuteHandAngle, 34);
      setHand('dial-a', s.alarmHandAngle, 30);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [snapRef]);
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return {
      x1: 50 + Math.cos(a) * 40, y1: 50 + Math.sin(a) * 40,
      x2: 50 + Math.cos(a) * 44, y2: 50 + Math.sin(a) * 44,
    };
  });
  return (
    <svg ref={svgRef} width="90" height="90" viewBox="0 0 100 100" className="shrink-0 rounded-full bg-neutral-100">
      {ticks.map((t, i) => <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#333" strokeWidth="2" />)}
      <line id="dial-a" x1="50" y1="50" x2="50" y2="20" stroke="#0284c7" strokeWidth="2" />
      <line id="dial-h" x1="50" y1="50" x2="50" y2="28" stroke="#111" strokeWidth="4" strokeLinecap="round" />
      <line id="dial-m" x1="50" y1="50" x2="50" y2="16" stroke="#111" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="2.5" fill="#b45309" />
    </svg>
  );
}
