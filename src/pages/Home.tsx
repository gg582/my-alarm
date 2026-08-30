/**
 * Slava Caliber 5671 — interactive mechanical alarm-clock movement simulator.
 * WebGPU rendering · Web Audio physical synthesis · Worker-based RK4 physics.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Slava5671Renderer } from '../render/renderer';
import { Slava5671AudioEngine } from '../audio/audioEngine';
import type { WorkerInMessage, WorkerOutMessage } from '../sim/physics.worker';
import type { SimSnapshot } from '../sim/physics';
import { SPEC } from '../sim/specs';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Volume2, VolumeX, Play, Pause, StepForward,
  Bell, Compass, Maximize2, ChevronDown,
  Clock, Gauge, Zap, Sparkles
} from 'lucide-react';

function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 12;
  const m = Math.floor(min % 60);
  const s = Math.floor((min * 60) % 60);
  return `${String(h === 0 ? 12 : h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtHM(min: number) {
  const h = Math.floor(min / 60) % 12;
  const m = Math.floor(min % 60);
  return `${String(h === 0 ? 12 : h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseHM(str: string): number {
  const [hStr, mStr] = str.split(':');
  const h = parseInt(hStr || '0', 10);
  const m = parseInt(mStr || '0', 10);
  return (((h % 12) + 12) % 12) * 60 + (m % 60);
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
  const [alarmMinutes, setAlarmMinutes] = useState(7 * 60);
  const [currentMinutes, setCurrentMinutes] = useState(10 * 60 + 8);

  const [hud, setHud] = useState({
    time: '10:08:00',
    alarm: '07:00',
    amp: 240,
    timeTurns: 6.0,
    alarmTurns: 1.8,
    ringing: false,
    beats: 0,
    running: true,
    timeMinutes: 10 * 60 + 8,
    alarmMinutes: 7 * 60,
  });

  // Mobile / layout states
  const [activeTab, setActiveTab] = useState<'alarm' | 'movement' | 'specs'>('alarm');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [desktopPanelCollapsed, setDesktopPanelCollapsed] = useState(false);
  const [dragTarget, setDragTarget] = useState<'alarm' | 'time'>('alarm');
  const [currentCameraView, setCurrentCameraView] = useState<'default' | 'demo' | 'escapement'>('default');

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
          alarm: fmtHM(snap.alarmMinutes),
          amp: snap.balanceAmplitudeDeg,
          timeTurns: snap.timeBarrelTurns,
          alarmTurns: snap.alarmBarrelTurns,
          ringing: snap.alarmRinging,
          beats: snap.beatCount,
          running: snap.running,
          timeMinutes: snap.timeMinutes,
          alarmMinutes: snap.alarmMinutes,
        });
        setCurrentMinutes(snap.timeMinutes);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      worker.terminate();
    };
  }, []);

  // Unlock Web Audio context on first user gesture (touch / click)
  useEffect(() => {
    const unlockAudio = () => {
      audioRef.current?.init();
      setAudioOn(true);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    return () => window.removeEventListener('pointerdown', unlockAudio);
  }, []);

  // ---------- winding (press & hold, like the real key) ----------
  const windTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startWind = (kind: 'time' | 'alarm') => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(20); } catch { /* ignore */ }
    }
    const tick = () => {
      send(kind === 'time' ? { cmd: 'windTime', turns: 0.35 } : { cmd: 'windAlarm', turns: 0.15 });
    };
    tick();
    windTimer.current = setInterval(tick, 120);
  };
  const stopWind = () => {
    if (windTimer.current) clearInterval(windTimer.current);
    windTimer.current = null;
  };

  const quickWind = (kind: 'time' | 'alarm', turns: number) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(30); } catch { /* ignore */ }
    }
    send(kind === 'time' ? { cmd: 'windTime', turns } : { cmd: 'windAlarm', turns });
  };

  const enableAudio = () => {
    audioRef.current?.init();
    setAudioOn(true);
  };

  // ---------- Time & Alarm setting helpers ----------
  const setAlarmMinutesDirect = (min: number) => {
    const normalized = ((min % 720) + 720) % 720;
    setAlarmMinutes(normalized);
    setAlarmInput(fmtHM(normalized));
    send({ cmd: 'setAlarm', minutes: normalized });
  };

  const adjustAlarmBy = (deltaMinutes: number) => {
    setAlarmMinutesDirect(alarmMinutes + deltaMinutes);
  };

  const setClockMinutesDirect = (min: number) => {
    const normalized = ((min % 720) + 720) % 720;
    setTimeInput(fmtHM(normalized));
    send({ cmd: 'setTime', minutes: normalized });
  };

  const applyTimeInput = () => {
    const min = parseHM(timeInput);
    setClockMinutesDirect(min);
  };

  const applyAlarmInput = () => {
    const min = parseHM(alarmInput);
    setAlarmMinutesDirect(min);
  };

  const setAlarmRelativeToNow = (deltaMinutes: number) => {
    const target = (currentMinutes + deltaMinutes) % 720;
    setAlarmMinutesDirect(Math.round(target / 5) * 5);
  };

  const syncClockToRealTime = () => {
    const now = new Date();
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    const min = h * 60 + m + s / 60;
    setClockMinutesDirect(min);
  };

  const setCameraPreset = (preset: 'default' | 'demo' | 'escapement') => {
    setCurrentCameraView(preset);
    rendererRef.current?.setCameraView(preset);
  };

  // Calculate minutes remaining until alarm
  const diffUntilAlarm = () => {
    const diff = (hud.alarmMinutes - (hud.timeMinutes % 720) + 720) % 720;
    const hours = Math.floor(diff / 60);
    const mins = Math.floor(diff % 60);
    if (hours === 0 && mins === 0) return '지금 울림!';
    if (hours === 0) return `${mins}분 남음`;
    return `${hours}시간 ${mins}분 남음`;
  };

  const timeFrac = hud.timeTurns / SPEC.timeBarrel.fullTurns;
  const alarmFrac = hud.alarmTurns / SPEC.alarmBarrel.fullTurns;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b0d12] text-neutral-200 select-none touch-none">
      {/* 3D WebGPU Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {gpuError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0b0d12]/90 p-4 backdrop-blur">
          <div className="max-w-md rounded-xl border border-red-800 bg-red-950/80 p-6 text-sm text-red-100 shadow-2xl">
            <h2 className="text-base font-bold text-red-300 mb-2">WebGPU 초기화 오류</h2>
            <p>{gpuError}</p>
            <p className="mt-3 text-xs text-neutral-400">Chrome, Edge 또는 WebGPU 지원 브라우저를 사용해주세요.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-center justify-between p-3 sm:p-4 bg-gradient-to-b from-[#0b0d12]/90 via-[#0b0d12]/50 to-transparent">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-xl font-bold tracking-wide text-amber-200/95 flex items-center gap-1.5">
              <span>СЛАВА</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">5671</span>
            </h1>
          </div>
          <p className="hidden sm:block text-[11px] text-neutral-400 mt-0.5">
            2nd Moscow Watch Factory · 56 mm · {SPEC.jewels} Jewels · {SPEC.beatsPerSecond * 3600} vph · 4-Hand 기계식 무브먼트 (시/분/초/알람)
          </p>
        </div>

        {/* Live Clock & Alarm Status Pill */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div
            className={`flex items-center gap-2 rounded-lg px-2.5 sm:px-3 py-1 font-mono text-sm sm:text-base tabular-nums border transition-all ${
              hud.ringing
                ? 'animate-pulse bg-red-950/80 border-red-500 text-red-200 shadow-lg shadow-red-500/30 ring-2 ring-red-500/50'
                : 'bg-neutral-900/80 border-neutral-700/60 text-neutral-100'
            }`}
          >
            <Clock className="size-3.5 sm:size-4 text-amber-400" />
            <span>{hud.time}</span>
            {hud.ringing && (
              <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold text-red-300 bg-red-800/60 px-1.5 py-0.5 rounded">
                <Bell className="size-3 animate-bounce" /> 알람 울림!
              </span>
            )}
          </div>

          {/* Quick Sound Toggle */}
          <Button
            size="icon"
            variant="outline"
            className={`size-8 sm:size-9 rounded-lg border-neutral-700/60 ${audioOn ? 'bg-neutral-800/80 text-amber-300' : 'bg-neutral-900/80 text-neutral-400'}`}
            onClick={!audioOn ? enableAudio : () => {
              const newVol = volume > 0 ? 0 : 0.8;
              setVolume(newVol);
              audioRef.current?.setVolume(newVol);
            }}
            title={audioOn ? (volume > 0 ? '소리 끄기' : '소리 켜기') : '사운드 활성화'}
          >
            {!audioOn || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>

          {/* Desktop Panel Toggle */}
          <Button
            size="icon"
            variant="outline"
            className="hidden md:flex size-9 rounded-lg border-neutral-700/60 bg-neutral-900/80 text-neutral-300 hover:text-white"
            onClick={() => setDesktopPanelCollapsed(!desktopPanelCollapsed)}
            title={desktopPanelCollapsed ? '패널 펼치기' : '패널 접기'}
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </header>

      {/* Ringing Alert Bar */}
      {hud.ringing && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full border border-red-500 bg-red-950/90 px-4 py-2 text-xs sm:text-sm text-red-100 shadow-xl backdrop-blur animate-pulse">
          <Bell className="size-4 animate-bounce text-red-400" />
          <span className="font-semibold">기계식 알람이 울리고 있습니다!</span>
          <Button
            size="sm"
            className="h-7 bg-red-600 hover:bg-red-500 text-white text-xs px-3 rounded-full"
            onClick={() => {
              setAlarmOn(false);
              send({ cmd: 'alarmEnabled', on: false });
            }}
          >
            알람 끄기
          </Button>
        </div>
      )}

      {/* Floating Camera View Bar (Center Top) */}
      <div className="pointer-events-auto absolute top-16 left-3 sm:left-4 z-10 flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900/85 p-1 backdrop-blur shadow-md text-xs">
        <button
          onClick={() => setCameraPreset('default')}
          className={`px-2 py-1 rounded transition flex items-center gap-1 text-[11px] ${
            currentCameraView === 'default' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
          }`}
          title="3D 무브먼트 투시 시점"
        >
          <Compass className="size-3 text-amber-400" /> 3D 각도
        </button>
        <button
          onClick={() => setCameraPreset('demo')}
          className={`px-2 py-1 rounded transition flex items-center gap-1 text-[11px] ${
            currentCameraView === 'demo' ? 'bg-sky-500/20 text-sky-300 font-semibold' : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
          }`}
          title="완성 시계 데모 뷰 (다이얼 & 4침 정면)"
        >
          <Sparkles className="size-3 text-sky-400" /> 데모 (다이얼&4침)
        </button>
        <button
          onClick={() => setCameraPreset('escapement')}
          className={`px-2 py-1 rounded transition flex items-center gap-1 text-[11px] ${
            currentCameraView === 'escapement' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
          }`}
          title="탈진기 확대 시점"
        >
          <Zap className="size-3 text-emerald-400" /> 탈진기
        </button>
      </div>

      {/* ================= DESKTOP PANELS (Hidden on Mobile) ================= */}
      <div className={`hidden md:block transition-all duration-300 ${desktopPanelCollapsed ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100'}`}>
        {/* Left Panel: Movement & Winding Controls */}
        <div className="absolute bottom-4 left-4 z-10 w-80 space-y-3 rounded-2xl border border-neutral-800/90 bg-neutral-950/85 p-4 backdrop-blur shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Gauge className="size-3.5" /> 무브먼트 조작 & 태엽
            </h2>
            <span className="text-[10px] text-neutral-400 font-mono">
              {hud.running ? '동작 중' : '태엽 풀림'}
            </span>
          </div>

          {/* Sound volume slider */}
          {!audioOn ? (
            <Button className="w-full bg-amber-700 hover:bg-amber-600 text-xs h-8" onClick={enableAudio}>
              <Volume2 className="size-3.5 mr-1.5" /> 사운드 활성화 (벨 & 틱 합성음)
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-xs bg-neutral-900/60 p-2 rounded-lg border border-neutral-800">
              <Volume2 className="size-3.5 text-neutral-400 shrink-0" />
              <span className="w-8 text-[11px] text-neutral-400">볼륨</span>
              <Slider
                value={[volume * 100]}
                max={100}
                step={1}
                onValueChange={(v) => {
                  setVolume(v[0] / 100);
                  audioRef.current?.setVolume(v[0] / 100);
                }}
              />
              <span className="w-8 text-right font-mono text-[10px] text-neutral-300">{Math.round(volume * 100)}%</span>
            </div>
          )}

          {/* Mainspring & Alarm Spring Winding */}
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-amber-400 font-medium">시간 태엽 (Mainspring)</span>
                <span className="font-mono text-neutral-300">{hud.timeTurns.toFixed(1)} / {SPEC.timeBarrel.fullTurns}t</span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-150" style={{ width: `${Math.min(100, timeFrac * 100)}%` }} />
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1 text-xs h-7 bg-neutral-800 hover:bg-amber-900/40 active:scale-95"
                  onPointerDown={() => startWind('time')}
                  onPointerUp={stopWind}
                  onPointerLeave={stopWind}
                >
                  누르고 있어 감기
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[11px] h-7 px-2 border-neutral-700 hover:bg-neutral-800"
                  onClick={() => quickWind('time', 1.0)}
                  title="+1바퀴 감기"
                >
                  +1바퀴
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[11px] h-7 px-2 border-neutral-700 hover:bg-neutral-800 text-amber-400"
                  onClick={() => quickWind('time', SPEC.timeBarrel.fullTurns)}
                  title="완전 감기"
                >
                  완충
                </Button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-sky-400 font-medium">알람 태엽 (Alarm Spring)</span>
                <span className="font-mono text-neutral-300">{hud.alarmTurns.toFixed(2)} / {SPEC.alarmBarrel.fullTurns}t</span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-150" style={{ width: `${Math.min(100, alarmFrac * 100)}%` }} />
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1 text-xs h-7 bg-neutral-800 hover:bg-sky-900/40 active:scale-95"
                  onPointerDown={() => startWind('alarm')}
                  onPointerUp={stopWind}
                  onPointerLeave={stopWind}
                >
                  누르고 있어 감기
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[11px] h-7 px-2 border-neutral-700 hover:bg-neutral-800"
                  onClick={() => quickWind('alarm', 0.5)}
                  title="+0.5바퀴 감기"
                >
                  +½바퀴
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[11px] h-7 px-2 border-neutral-700 hover:bg-neutral-800 text-sky-400"
                  onClick={() => quickWind('alarm', SPEC.alarmBarrel.fullTurns)}
                  title="완전 감기"
                >
                  완충
                </Button>
              </div>
            </div>
          </div>

          {/* Simulation Controls (Pause / Step / Speed) */}
          <div className="pt-1 border-t border-neutral-800/80 space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={paused ? 'default' : 'secondary'}
                className={`flex-1 text-xs h-7 ${paused ? 'bg-amber-600 hover:bg-amber-500' : 'bg-neutral-800'}`}
                onClick={() => {
                  const p = !paused;
                  setPaused(p);
                  send({ cmd: 'pause', paused: p });
                }}
              >
                {paused ? <Play className="size-3 mr-1" /> : <Pause className="size-3 mr-1" />}
                {paused ? '재개' : '일시정지'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-xs h-7 bg-neutral-800"
                onClick={() => send({ cmd: 'step' })}
                disabled={!paused}
              >
                <StepForward className="size-3 mr-1" /> ½ 진동 전진
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="w-12 text-neutral-400 text-[11px]">배속</span>
              <Slider
                value={[speed]}
                min={1}
                max={50}
                step={1}
                onValueChange={(v) => {
                  setSpeed(v[0]);
                  send({ cmd: 'speed', value: v[0] });
                }}
              />
              <span className="w-8 text-right font-mono text-[11px] tabular-nums text-amber-300">{speed}×</span>
            </div>
          </div>
        </div>

        {/* Right Panel: Interactive Alarm & Clock Adjuster + Specs */}
        <div className="absolute bottom-4 right-4 z-10 w-96 space-y-3 rounded-2xl border border-neutral-800/90 bg-neutral-950/85 p-4 backdrop-blur shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Bell className="size-3.5" /> 알람 시간 조정 & 다이얼
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[11px] text-neutral-400">알람 활성</span>
              <Switch
                checked={alarmOn}
                onCheckedChange={(on) => {
                  setAlarmOn(on);
                  send({ cmd: 'alarmEnabled', on });
                }}
              />
            </div>
          </div>

          {/* Interactive Dial + Time Readouts */}
          <div className="flex items-center gap-4 bg-neutral-900/60 p-3 rounded-xl border border-neutral-800/90">
            <InteractiveDial
              snapRef={snapRef}
              dragTarget={dragTarget}
              onDragMinutes={(min) => {
                if (dragTarget === 'alarm') setAlarmMinutesDirect(min);
                else setClockMinutesDirect(min);
              }}
            />
            <div className="flex-1 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400 text-[11px]">현재 시각:</span>
                <span className="font-mono font-bold text-amber-300 text-sm">{hud.time}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400 text-[11px]">설정 알람:</span>
                <span className="font-mono font-bold text-sky-300 text-sm">{hud.alarm}</span>
              </div>
              <div className="flex items-center justify-between border-t border-neutral-800 pt-1 text-[11px]">
                <span className="text-neutral-400">알람까지:</span>
                <span className={`font-mono ${alarmOn ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  {alarmOn ? diffUntilAlarm() : '비활성화됨'}
                </span>
              </div>
              <div className="flex gap-1 pt-1">
                <button
                  onClick={() => setDragTarget('alarm')}
                  className={`flex-1 py-0.5 rounded text-[10px] font-medium border transition ${
                    dragTarget === 'alarm'
                      ? 'bg-sky-950/80 border-sky-500 text-sky-200'
                      : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  알람침 드래그
                </button>
                <button
                  onClick={() => setDragTarget('time')}
                  className={`flex-1 py-0.5 rounded text-[10px] font-medium border transition ${
                    dragTarget === 'time'
                      ? 'bg-amber-950/80 border-amber-500 text-amber-200'
                      : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  시계침 드래그
                </button>
              </div>
            </div>
          </div>

          {/* Alarm Steppers & Quick Adjustment */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-sky-300 font-medium">알람 시간 미세/빠른 조정</span>
              <span className="text-neutral-400">다이얼 터치 또는 버튼 클릭</span>
            </div>

            {/* Stepper Buttons */}
            <div className="grid grid-cols-6 gap-1">
              <Button size="sm" variant="outline" className="h-7 text-[11px] p-0 border-neutral-800 hover:bg-neutral-800" onClick={() => adjustAlarmBy(-60)}>
                -1h
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] p-0 border-neutral-800 hover:bg-neutral-800" onClick={() => adjustAlarmBy(-15)}>
                -15m
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] p-0 border-neutral-800 hover:bg-neutral-800" onClick={() => adjustAlarmBy(-5)}>
                -5m
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] p-0 border-neutral-800 hover:bg-neutral-800 text-sky-300" onClick={() => adjustAlarmBy(+5)}>
                +5m
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] p-0 border-neutral-800 hover:bg-neutral-800 text-sky-300" onClick={() => adjustAlarmBy(+15)}>
                +15m
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px] p-0 border-neutral-800 hover:bg-neutral-800 text-sky-300" onClick={() => adjustAlarmBy(+60)}>
                +1h
              </Button>
            </div>

            {/* Quick Relative Presets */}
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[10px] h-6 px-1 bg-neutral-900 hover:bg-sky-950 border border-neutral-800"
                onClick={() => setAlarmRelativeToNow(5)}
              >
                +5분 뒤
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[10px] h-6 px-1 bg-neutral-900 hover:bg-sky-950 border border-neutral-800"
                onClick={() => setAlarmRelativeToNow(15)}
              >
                +15분 뒤
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[10px] h-6 px-1 bg-neutral-900 hover:bg-sky-950 border border-neutral-800"
                onClick={() => setAlarmRelativeToNow(30)}
              >
                +30분 뒤
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 text-[10px] h-6 px-1 bg-neutral-900 hover:bg-sky-950 border border-neutral-800"
                onClick={() => setAlarmRelativeToNow(60)}
              >
                +1시간 뒤
              </Button>
            </div>

            {/* Continuous Alarm Slider (00:00 to 12:00 in 1-min increments) */}
            <div className="space-y-1 bg-neutral-900/60 p-2 rounded-lg border border-neutral-800">
              <div className="flex justify-between text-[10px] text-neutral-400">
                <span>슬라이더로 알람 설정</span>
                <span className="font-mono text-sky-300">{fmtHM(alarmMinutes)}</span>
              </div>
              <Slider
                value={[alarmMinutes]}
                min={0}
                max={719}
                step={1}
                onValueChange={(v) => setAlarmMinutesDirect(v[0])}
              />
            </div>

            {/* Direct Input Fields */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-1.5 text-xs pt-1">
              <div className="flex items-center gap-1">
                <input
                  value={alarmInput}
                  onChange={(e) => setAlarmInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyAlarmInput()}
                  placeholder="07:00"
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-sky-300"
                />
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs border-neutral-700" onClick={applyAlarmInput}>
                알람 적용
              </Button>
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-1.5 text-xs">
              <div className="flex items-center gap-1">
                <input
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyTimeInput()}
                  placeholder="10:08"
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-amber-300"
                />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-xs border-neutral-700" onClick={applyTimeInput}>
                  시간 적용
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] px-2 border-neutral-700 text-neutral-400 hover:text-amber-300"
                  onClick={syncClockToRealTime}
                  title="현재 실제 시간으로 맞춤"
                >
                  현재시각
                </Button>
              </div>
            </div>
          </div>

          {/* Quick specs badge */}
          <div className="border-t border-neutral-800 pt-2 text-[10px] text-neutral-400 flex items-center justify-between">
            <span>진동각: <b className="text-amber-300 font-mono">{hud.amp.toFixed(0)}°</b></span>
            <span>비트: <b className="text-amber-300 font-mono">{hud.beats}</b></span>
            <span>탈진비: <b className="text-neutral-300 font-mono">600:1</b></span>
          </div>
        </div>
      </div>

      {/* ================= MOBILE BOTTOM SHEET & NAVIGATION (< 768px) ================= */}
      <div className="md:hidden pointer-events-auto absolute bottom-0 left-0 right-0 z-30 flex flex-col">
        {/* Expanded Sheet Modal */}
        {mobileSheetOpen && (
          <div className="max-h-[75vh] overflow-y-auto rounded-t-3xl border-t border-neutral-700 bg-neutral-950/95 p-4 pb-6 backdrop-blur shadow-2xl space-y-4 animate-in slide-in-from-bottom duration-200">
            {/* Sheet Handle */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-neutral-900 p-0.5 border border-neutral-800">
                  <button
                    onClick={() => setActiveTab('alarm')}
                    className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                      activeTab === 'alarm' ? 'bg-sky-600 text-white' : 'text-neutral-400'
                    }`}
                  >
                    ⏰ 알람 조정
                  </button>
                  <button
                    onClick={() => setActiveTab('movement')}
                    className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                      activeTab === 'movement' ? 'bg-amber-600 text-white' : 'text-neutral-400'
                    }`}
                  >
                    🌀 태엽/동작
                  </button>
                  <button
                    onClick={() => setActiveTab('specs')}
                    className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                      activeTab === 'specs' ? 'bg-neutral-700 text-white' : 'text-neutral-400'
                    }`}
                  >
                    ℹ️ 스펙
                  </button>
                </div>
              </div>
              <button
                onClick={() => setMobileSheetOpen(false)}
                className="size-7 rounded-full bg-neutral-800 text-neutral-400 flex items-center justify-center"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>

            {/* TAB 1: ALARM & TIME ADJUSTMENT */}
            {activeTab === 'alarm' && (
              <div className="space-y-3 text-xs">
                {/* Dial + Readout */}
                <div className="flex items-center gap-3 bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
                  <InteractiveDial
                    size={85}
                    snapRef={snapRef}
                    dragTarget={dragTarget}
                    onDragMinutes={(min) => {
                      if (dragTarget === 'alarm') setAlarmMinutesDirect(min);
                      else setClockMinutesDirect(min);
                    }}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400 text-[11px]">알람 시각</span>
                      <span className="font-mono font-bold text-sky-300 text-base">{hud.alarm}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-400 text-[11px]">현재 시각</span>
                      <span className="font-mono text-amber-300">{hud.time}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-neutral-800 pt-1">
                      <span className="text-neutral-400 text-[10px]">알람 작동</span>
                      <Switch
                        checked={alarmOn}
                        onCheckedChange={(on) => {
                          setAlarmOn(on);
                          send({ cmd: 'alarmEnabled', on });
                        }}
                      />
                    </div>
                    <div className="flex gap-1 pt-1">
                      <button
                        onClick={() => setDragTarget('alarm')}
                        className={`flex-1 py-1 rounded text-[10px] font-medium border ${
                          dragTarget === 'alarm' ? 'bg-sky-900/60 border-sky-500 text-sky-200' : 'border-neutral-800 bg-neutral-900 text-neutral-400'
                        }`}
                      >
                        알람침 드래그
                      </button>
                      <button
                        onClick={() => setDragTarget('time')}
                        className={`flex-1 py-1 rounded text-[10px] font-medium border ${
                          dragTarget === 'time' ? 'bg-amber-900/60 border-amber-500 text-amber-200' : 'border-neutral-800 bg-neutral-900 text-neutral-400'
                        }`}
                      >
                        시계침 드래그
                      </button>
                    </div>
                  </div>
                </div>

                {/* Alarm Step Buttons */}
                <div>
                  <div className="text-[11px] text-sky-300 font-medium mb-1.5">알람 시간 빠른 조정 (+/-)</div>
                  <div className="grid grid-cols-6 gap-1">
                    <Button size="sm" variant="outline" className="h-8 text-xs p-0 border-neutral-800 bg-neutral-900 active:scale-95" onClick={() => adjustAlarmBy(-60)}>
                      -1h
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs p-0 border-neutral-800 bg-neutral-900 active:scale-95" onClick={() => adjustAlarmBy(-15)}>
                      -15m
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs p-0 border-neutral-800 bg-neutral-900 active:scale-95" onClick={() => adjustAlarmBy(-5)}>
                      -5m
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs p-0 border-neutral-800 bg-neutral-900 text-sky-300 active:scale-95" onClick={() => adjustAlarmBy(+5)}>
                      +5m
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs p-0 border-neutral-800 bg-neutral-900 text-sky-300 active:scale-95" onClick={() => adjustAlarmBy(+15)}>
                      +15m
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs p-0 border-neutral-800 bg-neutral-900 text-sky-300 active:scale-95" onClick={() => adjustAlarmBy(+60)}>
                      +1h
                    </Button>
                  </div>
                </div>

                {/* Relative Presets */}
                <div className="grid grid-cols-4 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-[10px] h-7 bg-neutral-900 border border-neutral-800"
                    onClick={() => setAlarmRelativeToNow(5)}
                  >
                    +5분 뒤
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-[10px] h-7 bg-neutral-900 border border-neutral-800"
                    onClick={() => setAlarmRelativeToNow(15)}
                  >
                    +15분 뒤
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-[10px] h-7 bg-neutral-900 border border-neutral-800"
                    onClick={() => setAlarmRelativeToNow(30)}
                  >
                    +30분 뒤
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-[10px] h-7 bg-neutral-900 border border-neutral-800"
                    onClick={() => setAlarmRelativeToNow(60)}
                  >
                    +1시간 뒤
                  </Button>
                </div>

                {/* Slider */}
                <div className="space-y-1 bg-neutral-900/80 p-2.5 rounded-xl border border-neutral-800">
                  <div className="flex justify-between text-[11px] text-neutral-400">
                    <span>슬라이더 알람 지정</span>
                    <span className="font-mono text-sky-300 font-bold">{fmtHM(alarmMinutes)}</span>
                  </div>
                  <Slider
                    value={[alarmMinutes]}
                    min={0}
                    max={719}
                    step={1}
                    onValueChange={(v) => setAlarmMinutesDirect(v[0])}
                  />
                </div>

                {/* Direct text inputs */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="flex gap-1">
                    <input
                      value={alarmInput}
                      onChange={(e) => setAlarmInput(e.target.value)}
                      placeholder="07:00"
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-sky-300"
                    />
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={applyAlarmInput}>
                      알람
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <input
                      value={timeInput}
                      onChange={(e) => setTimeInput(e.target.value)}
                      placeholder="10:08"
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-amber-300"
                    />
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={applyTimeInput}>
                      시간
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: MOVEMENT & WINDING */}
            {activeTab === 'movement' && (
              <div className="space-y-3 text-xs">
                {/* Time Spring */}
                <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 space-y-2">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-amber-400 font-medium">시간 메인스프링</span>
                    <span className="font-mono">{hud.timeTurns.toFixed(1)} / {SPEC.timeBarrel.fullTurns}t</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, timeFrac * 100)}%` }} />
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 text-xs h-8 bg-neutral-800 active:bg-amber-900/50"
                      onPointerDown={() => startWind('time')}
                      onPointerUp={stopWind}
                      onPointerLeave={stopWind}
                    >
                      누르고 있어 감기
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-3 border-neutral-700" onClick={() => quickWind('time', 1.0)}>
                      +1바퀴
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-3 border-neutral-700 text-amber-400" onClick={() => quickWind('time', SPEC.timeBarrel.fullTurns)}>
                      완충
                    </Button>
                  </div>
                </div>

                {/* Alarm Spring */}
                <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 space-y-2">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-sky-400 font-medium">알람 스프링</span>
                    <span className="font-mono">{hud.alarmTurns.toFixed(2)} / {SPEC.alarmBarrel.fullTurns}t</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(100, alarmFrac * 100)}%` }} />
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 text-xs h-8 bg-neutral-800 active:bg-sky-900/50"
                      onPointerDown={() => startWind('alarm')}
                      onPointerUp={stopWind}
                      onPointerLeave={stopWind}
                    >
                      누르고 있어 감기
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-3 border-neutral-700" onClick={() => quickWind('alarm', 0.5)}>
                      +½바퀴
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-3 border-neutral-700 text-sky-400" onClick={() => quickWind('alarm', SPEC.alarmBarrel.fullTurns)}>
                      완충
                    </Button>
                  </div>
                </div>

                {/* Speed & Pause */}
                <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 space-y-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={paused ? 'default' : 'secondary'}
                      className={`flex-1 h-8 ${paused ? 'bg-amber-600' : 'bg-neutral-800'}`}
                      onClick={() => {
                        const p = !paused;
                        setPaused(p);
                        send({ cmd: 'pause', paused: p });
                      }}
                    >
                      {paused ? <Play className="size-3 mr-1" /> : <Pause className="size-3 mr-1" />}
                      {paused ? '재개' : '일시정지'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 h-8 bg-neutral-800"
                      onClick={() => send({ cmd: 'step' })}
                      disabled={!paused}
                    >
                      <StepForward className="size-3 mr-1" /> ½ 진동
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-neutral-400">배속:</span>
                    <Slider
                      value={[speed]}
                      min={1}
                      max={50}
                      step={1}
                      onValueChange={(v) => {
                        setSpeed(v[0]);
                        send({ cmd: 'speed', value: v[0] });
                      }}
                    />
                    <span className="w-8 text-right font-mono text-amber-300">{speed}×</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: SPECS */}
            {activeTab === 'specs' && (
              <div className="space-y-2.5 text-xs text-neutral-300 bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] border-b border-neutral-800 pb-2">
                  <div>밸런스 진폭: <span className="text-amber-300">{hud.amp.toFixed(0)}°</span></div>
                  <div>진동 횟수: <span className="text-amber-300">{hud.beats}</span></div>
                  <div>기어열 상태: <span className={hud.running ? 'text-emerald-400' : 'text-red-400'}>{hud.running ? '동작 중' : '정지됨'}</span></div>
                  <div>진동수: <span className="text-neutral-300">18,000 vph</span></div>
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  <b className="text-neutral-200">Slava Caliber 5671:</b> 제2모스크바시계공장(2МЧЗ)에서 생산된 56mm 직경의 대표적인 기계식 알람 무브먼트입니다. 600:1의 센터-탈진 바퀴 기어비와 스위스 레버 탈진기, 슬리핑 브라이들 알람 배럴을 정밀 시뮬레이션합니다.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Persistent Mobile Bottom Navigation Bar */}
        <div className="flex items-center justify-between gap-2 border-t border-neutral-800/90 bg-neutral-950/95 p-2 px-3 backdrop-blur safe-area-pb">
          {/* Quick Wind Button */}
          <Button
            size="sm"
            variant="secondary"
            className="flex-1 h-10 text-xs bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 active:scale-95"
            onPointerDown={() => startWind('time')}
            onPointerUp={stopWind}
            onPointerLeave={stopWind}
          >
            🌀 시간 감기
          </Button>

          <Button
            size="sm"
            variant="secondary"
            className="flex-1 h-10 text-xs bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 active:scale-95 text-sky-300"
            onPointerDown={() => startWind('alarm')}
            onPointerUp={stopWind}
            onPointerLeave={stopWind}
          >
            🔔 알람 감기
          </Button>

          {/* Alarm Setting Sheet Trigger */}
          <Button
            size="sm"
            className="flex-1 h-10 text-xs bg-sky-700 hover:bg-sky-600 text-white font-semibold shadow-lg shadow-sky-900/30 active:scale-95"
            onClick={() => {
              setActiveTab('alarm');
              setMobileSheetOpen(!mobileSheetOpen);
            }}
          >
            <Clock className="size-3.5 mr-1" />
            {mobileSheetOpen ? '접기' : `알람 ${hud.alarm}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Interactive live SVG clock dial with touch/drag angle adjustment */
interface DialProps {
  snapRef: React.MutableRefObject<SimSnapshot | null>;
  size?: number;
  dragTarget?: 'alarm' | 'time';
  onDragMinutes?: (minutes: number) => void;
}

function InteractiveDial({ snapRef, size = 95, dragTarget = 'alarm', onDragMinutes }: DialProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDraggingRef = useRef(false);

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
      setHand('dial-s', s.secondHandAngle, 36);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [snapRef]);

  const handlePointerCoords = (clientX: number, clientY: number) => {
    if (!svgRef.current || !onDragMinutes) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    // angle in radians from 12 o'clock (0 = up, clockwise)
    let rad = Math.atan2(dy, dx) + Math.PI / 2;
    if (rad < 0) rad += Math.PI * 2;
    // 12-hour dial = 720 minutes
    const frac = rad / (Math.PI * 2);
    const rawMin = frac * 720;
    // snap to nearest 1 minute
    const snappedMin = Math.round(rawMin) % 720;
    onDragMinutes(snappedMin);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    handlePointerCoords(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;
    handlePointerCoords(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const isMajor = i % 3 === 0;
    return {
      x1: 50 + Math.cos(a) * (isMajor ? 38 : 41),
      y1: 50 + Math.sin(a) * (isMajor ? 38 : 41),
      x2: 50 + Math.cos(a) * 45,
      y2: 50 + Math.sin(a) * 45,
      major: isMajor,
    };
  });

  return (
    <div className="relative group shrink-0 select-none">
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="shrink-0 rounded-full bg-neutral-900 border-2 border-neutral-700/80 cursor-crosshair shadow-inner touch-none active:scale-95 transition-transform"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Dial Face circle */}
        <circle cx="50" cy="50" r="48" fill="#17191e" stroke="#26282e" strokeWidth="1.5" />

        {/* Ticks */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.major ? '#fbbf24' : '#6b7280'}
            strokeWidth={t.major ? '2.5' : '1.5'}
            strokeLinecap="round"
          />
        ))}

        {/* Alarm Hand (Cyan) */}
        <line
          id="dial-a"
          x1="50"
          y1="50"
          x2="50"
          y2="20"
          stroke="#0ea5e9"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Hour Hand (Brass/White) */}
        <line
          id="dial-h"
          x1="50"
          y1="50"
          x2="50"
          y2="28"
          stroke="#f3f4f6"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Minute Hand (White) */}
        <line
          id="dial-m"
          x1="50"
          y1="50"
          x2="50"
          y2="16"
          stroke="#d1d5db"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Second Hand (Soviet Red) */}
        <line
          id="dial-s"
          x1="50"
          y1="50"
          x2="50"
          y2="14"
          stroke="#ef4444"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* Center Cap */}
        <circle cx="50" cy="50" r="3.5" fill="#f59e0b" stroke="#92400e" strokeWidth="1" />
      </svg>
      <div className="text-[9px] text-center text-neutral-400 mt-1 font-mono">
        {dragTarget === 'alarm' ? '🔵 알람침 조정' : '🟡 시계침 조정'}
      </div>
    </div>
  );
}
