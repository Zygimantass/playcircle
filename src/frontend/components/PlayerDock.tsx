import { memo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { Track } from "../designTypes";
import { classNames, DEFAULT_BEAT_WAVEFORM_BEATS, Waveform, waveformClickPosition } from "./common";

type DeckId = "A" | "B";
type EqBand = "high" | "mid" | "low";
type DeckEq = Record<EqBand, number>;
type SyncRole = "master" | "follower";

const BEAT_WINDOW_BEATS = DEFAULT_BEAT_WAVEFORM_BEATS;

type DeckState = {
  track: Track;
  playing: boolean;
  position: number;
  syncEnabled: boolean;
  syncRole: SyncRole;
  tempoPercent: number;
  tempoRange: number;
  volume: number;
  eq: DeckEq;
  filterAmount: number;
  cuePoint: number;
};

type WaveformDragState = {
  pointerId: number;
  startClientX: number;
  startPosition: number;
  didDrag: boolean;
  wasPlaying: boolean;
};

type KnobDragState = {
  pointerId: number;
  startClientY: number;
  startValue: number;
};

type PlayerDockProps = {
  deckA: DeckState;
  deckB: DeckState;
  crossfader: number;
  onBeatSync: (deck: DeckId) => void;
  onCycleTempoRange: (deck: DeckId) => void;
  onSetCrossfader: (value: number) => void;
  onCueAction: (deck: DeckId) => void;
  onSetEq: (deck: DeckId, band: EqBand, value: number) => void;
  onSetFilter: (deck: DeckId, amount: number) => void;
  onSetPlaying: (deck: DeckId, playing: boolean) => void;
  onSetPosition: (deck: DeckId, position: number) => void;
  onSetTempo: (deck: DeckId, tempoPercent: number) => void;
  onSetMasterDeck: (deck: DeckId) => void;
  onSetVolume: (deck: DeckId, volume: number) => void;
  onScratchEnd: (deck: DeckId, resume: boolean) => void;
  onScratchMove: (deck: DeckId, position: number) => void;
  onScratchStart: (deck: DeckId) => void;
};

export const PlayerDock = memo(function PlayerDock({
  deckA,
  deckB,
  crossfader,
  onBeatSync,
  onCycleTempoRange,
  onSetCrossfader,
  onCueAction,
  onSetEq,
  onSetFilter,
  onSetPlaying,
  onSetPosition,
  onSetTempo,
  onSetMasterDeck,
  onSetVolume,
  onScratchEnd,
  onScratchMove,
  onScratchStart
}: PlayerDockProps) {
  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(88px,0.42fr)_minmax(150px,1fr)] overflow-hidden bg-[#0b0c10]">
      <BeatMatchWaveforms
        deckA={deckA}
        deckB={deckB}
        onSetPosition={onSetPosition}
        onScratchEnd={onScratchEnd}
        onScratchMove={onScratchMove}
        onScratchStart={onScratchStart}
      />
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_360px_minmax(0,1fr)] border-t border-line">
        <DeckControls
          deck="A"
          state={deckA}
          onBeatSync={onBeatSync}
          onCueAction={onCueAction}
          onCycleTempoRange={onCycleTempoRange}
          onSetPlaying={onSetPlaying}
          onSetPosition={onSetPosition}
          onSetTempo={onSetTempo}
          onSetMasterDeck={onSetMasterDeck}
          onScratchEnd={onScratchEnd}
          onScratchMove={onScratchMove}
          onScratchStart={onScratchStart}
        />
        <MixerCenter
          deckA={deckA}
          deckB={deckB}
          crossfader={crossfader}
          onSetEq={onSetEq}
          onSetFilter={onSetFilter}
          onSetCrossfader={onSetCrossfader}
          onSetVolume={onSetVolume}
        />
        <DeckControls
          deck="B"
          state={deckB}
          onBeatSync={onBeatSync}
          onCueAction={onCueAction}
          onCycleTempoRange={onCycleTempoRange}
          onSetPlaying={onSetPlaying}
          onSetPosition={onSetPosition}
          onSetTempo={onSetTempo}
          onSetMasterDeck={onSetMasterDeck}
          onScratchEnd={onScratchEnd}
          onScratchMove={onScratchMove}
          onScratchStart={onScratchStart}
        />
      </div>
    </section>
  );
});

function BeatMatchWaveforms({
  deckA,
  deckB,
  onSetPosition,
  onScratchEnd,
  onScratchMove,
  onScratchStart
}: {
  deckA: DeckState;
  deckB: DeckState;
  onSetPosition: (deck: DeckId, position: number) => void;
  onScratchEnd: (deck: DeckId, resume: boolean) => void;
  onScratchMove: (deck: DeckId, position: number) => void;
  onScratchStart: (deck: DeckId) => void;
}) {
  const outputWindowSeconds = beatOutputWindowSecondsForState(deckA, BEAT_WINDOW_BEATS);
  const beatWindowSecondsA = sourceWindowSecondsForOutputWindow(deckA, outputWindowSeconds);
  const beatWindowSecondsB = sourceWindowSecondsForOutputWindow(deckB, outputWindowSeconds);

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-2 bg-[#07080b]">
      <BeatWaveformDeck deck="A" state={deckA} beatWindowSeconds={beatWindowSecondsA} onSetPosition={onSetPosition} onScratchEnd={onScratchEnd} onScratchMove={onScratchMove} onScratchStart={onScratchStart} />
      <BeatWaveformDeck deck="B" state={deckB} beatWindowSeconds={beatWindowSecondsB} onSetPosition={onSetPosition} onScratchEnd={onScratchEnd} onScratchMove={onScratchMove} onScratchStart={onScratchStart} />
    </div>
  );
}

function BeatWaveformDeck({
  deck,
  state,
  beatWindowSeconds,
  onSetPosition,
  onScratchEnd,
  onScratchMove,
  onScratchStart
}: {
  deck: DeckId;
  state: DeckState;
  beatWindowSeconds: number;
  onSetPosition: (deck: DeckId, position: number) => void;
  onScratchEnd: (deck: DeckId, resume: boolean) => void;
  onScratchMove: (deck: DeckId, position: number) => void;
  onScratchStart: (deck: DeckId) => void;
}) {
  const track = state.track;
  const elapsed = Math.floor(state.position * track.totalSec);
  const dragRef = useRef<WaveformDragState | null>(null);

  return (
    <section className="min-h-0 min-w-0 border-b border-line last:border-b-0">
      <button
        className="relative h-full min-h-0 w-full min-w-0 cursor-grab touch-none overflow-hidden bg-[#07080b] text-left active:cursor-grabbing"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startPosition: state.position,
            didDrag: false,
            wasPlaying: state.playing
          };
          onScratchStart(deck);
        }}
        onPointerMove={(event) => {
          seekFromDrag(event, dragRef, deck, track, "beat", onScratchMove, beatWindowSeconds);
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (drag && !drag.didDrag) {
            seekFromPointer(event, deck, track, state.position, "beat", onScratchMove, beatWindowSeconds);
          }
          releasePointerCapture(event);
          onScratchEnd(deck, drag?.wasPlaying ?? false);
          dragRef.current = null;
        }}
        onPointerCancel={(event) => {
          const wasPlaying = dragRef.current?.wasPlaying ?? false;
          releasePointerCapture(event);
          onScratchEnd(deck, wasPlaying);
          dragRef.current = null;
        }}
        type="button"
      >
        <Waveform track={track} height="100%" playhead={state.position} showBeatGrid beatWindowBeats={BEAT_WINDOW_BEATS} beatWindowSeconds={beatWindowSeconds} />
        <div className="pointer-events-none absolute left-2 top-2 rounded-sm bg-bg/75 px-1.5 py-px font-mono text-[11px] text-text-2">{formatClock(elapsed)} / {track.duration}</div>
      </button>
    </section>
  );
}

function beatWindowSecondsForTrack(track: Track, beatWindowBeats: number) {
  const beatInterval = track.bpm > 0 ? 60 / track.bpm : 0.5;
  return Math.max(0.001, Math.floor(beatWindowBeats) * beatInterval);
}

function beatOutputWindowSecondsForState(state: DeckState, beatWindowBeats: number) {
  return beatWindowSecondsForTrack(state.track, beatWindowBeats) / playbackRateFromTempo(state.tempoPercent);
}

function sourceWindowSecondsForOutputWindow(state: DeckState, outputWindowSeconds: number) {
  return outputWindowSeconds * playbackRateFromTempo(state.tempoPercent);
}

function DeckControls({
  deck,
  state,
  onBeatSync,
  onCueAction,
  onCycleTempoRange,
  onSetPlaying,
  onSetPosition,
  onSetTempo,
  onSetMasterDeck,
  onScratchEnd,
  onScratchMove,
  onScratchStart
}: {
  deck: DeckId;
  state: DeckState;
  onBeatSync: (deck: DeckId) => void;
  onCueAction: (deck: DeckId) => void;
  onCycleTempoRange: (deck: DeckId) => void;
  onSetPlaying: (deck: DeckId, playing: boolean) => void;
  onSetPosition: (deck: DeckId, position: number) => void;
  onSetTempo: (deck: DeckId, tempoPercent: number) => void;
  onSetMasterDeck: (deck: DeckId) => void;
  onScratchEnd: (deck: DeckId, resume: boolean) => void;
  onScratchMove: (deck: DeckId, position: number) => void;
  onScratchStart: (deck: DeckId) => void;
}) {
  const track = state.track;
  const color = window.PC_DATA.CAMELOT_COLORS[track.key] ?? "#cdb46a";
  const elapsed = Math.floor(state.position * track.totalSec);
  const bpmLabel = formatDeckBpm(track.bpm, state.tempoPercent);
  const overviewDragRef = useRef<WaveformDragState | null>(null);

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[44px_minmax(0,1fr)] overflow-hidden border-r border-line bg-gradient-to-b from-surface-1 to-[#0d0e12] last:border-r-0">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-accent font-mono text-[13px] font-bold text-bg">{deck}</span>
          <div className="min-w-0">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-text-1">{track.title}</div>
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-text-2">{track.artist} · {bpmLabel} · {track.key}</div>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px]" style={{ color }}>{formatClock(elapsed)} / {track.duration}</span>
      </div>
      <div className="grid min-h-0 min-w-0 grid-rows-[42px_1fr] gap-2 overflow-hidden">
        <button
          className="relative min-w-0 cursor-grab touch-none overflow-hidden border border-line bg-[#090a0d] text-left active:cursor-grabbing"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            overviewDragRef.current = {
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startPosition: state.position,
              didDrag: false,
              wasPlaying: state.playing
            };
            onScratchStart(deck);
          }}
          onPointerMove={(event) => {
            seekFromDrag(event, overviewDragRef, deck, track, "overview", onScratchMove);
          }}
          onPointerUp={(event) => {
            const drag = overviewDragRef.current;
            if (drag && !drag.didDrag) {
              seekFromPointer(event, deck, track, state.position, "overview", onScratchMove);
            }
            releasePointerCapture(event);
            onScratchEnd(deck, drag?.wasPlaying ?? false);
            overviewDragRef.current = null;
          }}
          onPointerCancel={(event) => {
            const wasPlaying = overviewDragRef.current?.wasPlaying ?? false;
            releasePointerCapture(event);
            onScratchEnd(deck, wasPlaying);
            overviewDragRef.current = null;
          }}
          type="button"
        >
          <Waveform track={track} height={40} playhead={state.position} variant="overview" />
        </button>
        <div className="grid min-h-0 grid-rows-[36px_minmax(0,1fr)] gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex shrink-0 items-center gap-1">
              <button
                className={classNames("grid size-8 place-items-center rounded-full border font-mono text-[9px]", state.playing ? "border-accent bg-accent/15 text-accent" : "border-line-2 bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1")}
                onClick={() => onCueAction(deck)}
                type="button"
              >
                CUE
              </button>
              <button className={classNames("grid size-8 place-items-center rounded-full text-bg", state.playing ? "bg-warn" : "bg-accent")} onClick={() => onSetPlaying(deck, !state.playing)} type="button">
              {state.playing ? "Ⅱ" : "▶"}
              </button>
            </div>
            <span className="font-mono text-[10px] text-text-3">{formatClock(Math.floor(state.cuePoint * track.totalSec))}</span>
          </div>
          <TempoControl
            deck={deck}
            tempoPercent={state.tempoPercent}
            tempoRange={state.tempoRange}
            syncEnabled={state.syncEnabled}
            syncRole={state.syncRole}
            onBeatSync={onBeatSync}
            onCycleTempoRange={onCycleTempoRange}
            onSetMasterDeck={onSetMasterDeck}
            onSetTempo={onSetTempo}
          />
        </div>
      </div>
    </section>
  );
}

function TempoControl({
  deck,
  tempoPercent,
  tempoRange,
  syncEnabled,
  syncRole,
  onBeatSync,
  onCycleTempoRange,
  onSetMasterDeck,
  onSetTempo
}: {
  deck: DeckId;
  tempoPercent: number;
  tempoRange: number;
  syncEnabled: boolean;
  syncRole: SyncRole;
  onBeatSync: (deck: DeckId) => void;
  onCycleTempoRange: (deck: DeckId) => void;
  onSetMasterDeck: (deck: DeckId) => void;
  onSetTempo: (deck: DeckId, tempoPercent: number) => void;
}) {
  const isMaster = syncRole === "master";
  const tempoRangeLabel = Math.abs(tempoPercent) > tempoRange ? "SYNC LOCK" : `±${tempoRange}`;
  return (
    <label className="grid min-w-0 content-start gap-1 font-mono text-[9px] text-text-2">
      <span className="grid min-w-0 grid-cols-[auto_auto_auto] items-center justify-between gap-1">
        <span>TEMPO</span>
        <button
          className="rounded-sm border border-line bg-surface-2 px-1 py-px text-[9px] text-text-1 hover:bg-surface-3"
          onClick={() => onCycleTempoRange(deck)}
          type="button"
        >
          {formatTempo(tempoPercent)} · {tempoRangeLabel}
        </button>
        <button
          className={classNames(
            "rounded-sm border px-1 py-px text-[9px]",
            isMaster || syncEnabled ? "border-accent bg-accent/15 text-accent" : "border-line bg-surface-2 text-text-1 hover:bg-surface-3"
          )}
          onClick={() => {
            if (isMaster) onSetMasterDeck(deck);
            else onBeatSync(deck);
          }}
          type="button"
        >
          {isMaster ? "MASTER" : "SYNC"}
        </button>
      </span>
      <input
        aria-label={`Deck ${deck} tempo`}
        className="h-5 accent-[var(--color-accent)]"
        max={tempoRange}
        min={-tempoRange}
        onDoubleClick={() => onSetTempo(deck, 0)}
        onChange={(event) => onSetTempo(deck, Number(event.currentTarget.value))}
        step="0.1"
        type="range"
        value={clamp(tempoPercent, -tempoRange, tempoRange)}
      />
    </label>
  );
}

function MixerCenter({
  deckA,
  deckB,
  crossfader,
  onSetCrossfader,
  onSetEq,
  onSetFilter,
  onSetVolume
}: {
  deckA: DeckState;
  deckB: DeckState;
  crossfader: number;
  onSetCrossfader: (value: number) => void;
  onSetEq: (deck: DeckId, band: EqBand, value: number) => void;
  onSetFilter: (deck: DeckId, amount: number) => void;
  onSetVolume: (deck: DeckId, volume: number) => void;
}) {
  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_34px] border-x border-line bg-surface-1">
      <div className="grid min-h-0 grid-cols-2 gap-2 px-3 py-2">
        <MixerDeckStrip
          deck="A"
          eq={deckA.eq}
          meterValue={deckA.playing ? deckA.volume * crossfadeGain("A", crossfader) : 0}
          filterAmount={deckA.filterAmount}
          volume={deckA.volume}
          onSetEq={onSetEq}
          onSetFilter={onSetFilter}
          onSetVolume={onSetVolume}
        />
        <MixerDeckStrip
          deck="B"
          eq={deckB.eq}
          meterValue={deckB.playing ? deckB.volume * crossfadeGain("B", crossfader) : 0}
          filterAmount={deckB.filterAmount}
          volume={deckB.volume}
          onSetEq={onSetEq}
          onSetFilter={onSetFilter}
          onSetVolume={onSetVolume}
        />
      </div>
      <div className="grid min-h-0 border-t border-line px-3 py-1.5">
        <label className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-2 font-mono text-[9px] text-text-2">
          <span>A</span>
          <input
            aria-label="Crossfader"
            className="accent-[var(--color-accent)]"
            max="1"
            min="-1"
            onChange={(event) => onSetCrossfader(Number(event.currentTarget.value))}
            step="0.01"
            type="range"
            value={crossfader}
          />
          <span className="text-right">B</span>
        </label>
      </div>
    </div>
  );
}

function MixerDeckStrip({
  deck,
  eq,
  meterValue,
  filterAmount,
  volume,
  onSetEq,
  onSetFilter,
  onSetVolume
}: {
  deck: DeckId;
  eq: { high: number; mid: number; low: number };
  meterValue: number;
  filterAmount: number;
  volume: number;
  onSetEq: (deck: DeckId, band: EqBand, value: number) => void;
  onSetFilter: (deck: DeckId, amount: number) => void;
  onSetVolume: (deck: DeckId, volume: number) => void;
}) {
  const knobs = (
    <div className="grid min-h-0 grid-rows-4 gap-0">
      <Knob label="HI" value={eq.high} min={-1} max={1} centerValue={0} onChange={(value) => onSetEq(deck, "high", value)} />
      <Knob label="MID" value={eq.mid} min={-1} max={1} centerValue={0} onChange={(value) => onSetEq(deck, "mid", value)} />
      <Knob label="LOW" value={eq.low} min={-1} max={1} centerValue={0} onChange={(value) => onSetEq(deck, "low", value)} />
      <Knob label="FILTER" value={filterAmount} min={-1} max={1} centerValue={0} onChange={(value) => onSetFilter(deck, value)} />
    </div>
  );
  const meter = <Meter label="" value={meterValue} />;
  const fader = (
    <label className="grid min-h-0 grid-rows-[1fr_14px] gap-1 font-mono text-[9px] text-text-2">
      <VolumeFader deck={deck} value={volume} onChange={(value) => onSetVolume(deck, value)} />
      <span className="text-center">{Math.round(volume * 100)}</span>
    </label>
  );
  const level = (
    <div className={classNames("grid min-h-0 gap-2", deck === "A" ? "grid-cols-[18px_32px]" : "grid-cols-[32px_18px]")}>
      {deck === "A" ? meter : fader}
      {deck === "A" ? fader : meter}
    </div>
  );

  return (
    <section className={classNames("grid min-h-0 gap-2", deck === "A" ? "grid-cols-[1fr_58px]" : "grid-cols-[58px_1fr]")}>
      {deck === "A" ? knobs : level}
      {deck === "A" ? level : knobs}
    </section>
  );
}

function VolumeFader({
  deck,
  value,
  onChange
}: {
  deck: DeckId;
  value: number;
  onChange: (value: number) => void;
}) {
  const setFromPointer = (event: PointerEvent<HTMLSpanElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = 1 - (event.clientY - bounds.top) / Math.max(1, bounds.height);
    onChange(clamp(ratio, 0, 1));
  };

  return (
    <span
      aria-label={`Deck ${deck} volume`}
      aria-valuemax={1}
      aria-valuemin={0}
      aria-valuenow={Number(value.toFixed(2))}
      className="relative min-h-0 w-8 cursor-grab touch-none rounded-sm border border-line-2 bg-[#08090c] outline-none active:cursor-grabbing"
      onKeyDown={(event) => handleVolumeKeyDown(event, value, onChange)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) return;
        setFromPointer(event);
      }}
      onPointerUp={releasePointerCapture}
      onPointerCancel={releasePointerCapture}
      role="slider"
      tabIndex={0}
    >
      <span className="absolute left-1/2 top-2 h-[calc(100%-16px)] w-px -translate-x-1/2 bg-line-2" />
      <span
        className="absolute left-1/2 h-3 w-6 -translate-x-1/2 rounded-[2px] border border-line-2 bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.45)]"
        style={{ bottom: `calc(${value * 100}% - 6px)` }}
      />
    </span>
  );
}

function handleVolumeKeyDown(event: KeyboardEvent<HTMLSpanElement>, value: number, onChange: (value: number) => void) {
  const step = event.shiftKey ? 0.01 : 0.05;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") {
    event.preventDefault();
    onChange(clamp(value + step, 0, 1));
  } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
    event.preventDefault();
    onChange(clamp(value - step, 0, 1));
  } else if (event.key === "Home") {
    event.preventDefault();
    onChange(0);
  } else if (event.key === "End") {
    event.preventDefault();
    onChange(1);
  }
}

function Knob({
  label,
  value,
  min,
  max,
  centerValue,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  centerValue: number;
  onChange: (value: number) => void;
}) {
  const ratio = (value - min) / (max - min);
  const degrees = -135 + ratio * 270;
  const centered = Math.abs(value - centerValue) < 0.001;
  const dragRef = useRef<KnobDragState | null>(null);

  return (
    <label className="grid min-w-0 place-items-center gap-0 font-mono text-[8px] text-text-2">
      <span>{label}</span>
      <span
        aria-label={`${label} knob`}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={Number(value.toFixed(2))}
        className="relative grid size-8 cursor-grab touch-none place-items-center outline-none active:cursor-grabbing"
        onDoubleClick={() => onChange(centerValue)}
        onKeyDown={(event) => handleKnobKeyDown(event, value, min, max, centerValue, onChange)}
        onPointerCancel={(event) => {
          releasePointerCapture(event);
          dragRef.current = null;
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startClientY: event.clientY,
            startValue: value
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || event.buttons !== 1) return;

          const range = max - min;
          const pixelsForFullSweep = 260;
          const delta = ((drag.startClientY - event.clientY) / pixelsForFullSweep) * range;
          onChange(clamp(drag.startValue + delta, min, max));
        }}
        onPointerUp={(event) => {
          releasePointerCapture(event);
        }}
        role="slider"
        tabIndex={0}
      >
        <span className="absolute inset-0 rounded-full border border-line-2 bg-[#08090c] shadow-inner" />
        <span className="absolute h-[13px] w-[2px] origin-bottom rounded bg-accent" style={{ transform: `translateY(-6px) rotate(${degrees}deg)`, opacity: centered ? 0.55 : 1 }} />
        <span className="absolute size-1 rounded-full bg-text-2" />
      </span>
    </label>
  );
}

function handleKnobKeyDown(
  event: KeyboardEvent<HTMLSpanElement>,
  value: number,
  min: number,
  max: number,
  centerValue: number,
  onChange: (value: number) => void
) {
  const step = event.shiftKey ? 0.01 : 0.05;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") {
    event.preventDefault();
    onChange(clamp(value + step, min, max));
  } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
    event.preventDefault();
    onChange(clamp(value - step, min, max));
  } else if (event.key === "Home") {
    event.preventDefault();
    onChange(min);
  } else if (event.key === "End") {
    event.preventDefault();
    onChange(max);
  } else if (event.key === "0" || event.key === "Enter") {
    event.preventDefault();
    onChange(centerValue);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function crossfadeGain(deck: DeckId, crossfader: number) {
  const value = Math.max(-1, Math.min(1, crossfader));
  if (deck === "A") return value <= 0 ? 1 : 1 - value;
  return value >= 0 ? 1 : 1 + value;
}

function playbackRateFromTempo(tempoPercent: number) {
  return Math.max(0.05, 1 + tempoPercent / 100);
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid h-full grid-rows-[1fr_16px] gap-1">
      <div className="flex items-end rounded-sm border border-line bg-[#08090c] p-1">
        <div className="w-full rounded-[1px] bg-accent" style={{ height: `${Math.max(4, value * 100)}%`, opacity: value > 0 ? 0.9 : 0.2 }} />
      </div>
      <div className="text-center font-mono text-[10px] text-text-2">{label}</div>
    </div>
  );
}

function seekFromDrag(
  event: PointerEvent<HTMLButtonElement>,
  dragRef: { current: WaveformDragState | null },
  deck: DeckId,
  track: Track,
  variant: "beat" | "overview",
  onSetPosition: (deck: DeckId, position: number) => void,
  beatWindowSeconds?: number
) {
  const drag = dragRef.current;
  if (!drag || drag.pointerId !== event.pointerId || event.buttons !== 1) return undefined;

  const bounds = event.currentTarget.getBoundingClientRect();
  const dragDelta = event.clientX - drag.startClientX;
  if (Math.abs(dragDelta) >= 2) drag.didDrag = true;

  const spanSeconds = variant === "overview" ? track.totalSec : beatWindowSeconds ?? beatWindowSecondsForTrack(track, BEAT_WINDOW_BEATS);
  const nextSeconds = drag.startPosition * track.totalSec + (dragDelta / Math.max(1, bounds.width)) * spanSeconds;
  const position = Math.max(0, Math.min(1, nextSeconds / track.totalSec));
  onSetPosition(deck, position);
  return position;
}

function releasePointerCapture(event: PointerEvent<HTMLElement>) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function seekFromPointer(
  event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
  deck: DeckId,
  track: Track,
  position: number,
  variant: "beat" | "overview",
  onSetPosition: (deck: DeckId, position: number) => void,
  beatWindowSeconds?: number
) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const clickRatio = (event.clientX - bounds.left) / bounds.width;
  const nextPosition = waveformClickPosition(track, position, clickRatio, variant, BEAT_WINDOW_BEATS, beatWindowSeconds);
  onSetPosition(deck, nextPosition);
  return nextPosition;
}

function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatTempo(tempoPercent: number) {
  if (Math.abs(tempoPercent) < 0.05) return "0.0%";
  return `${tempoPercent > 0 ? "+" : ""}${tempoPercent.toFixed(1)}%`;
}

function formatDeckBpm(bpm: number, tempoPercent: number) {
  if (!bpm) return "-- BPM";
  const adjustedBpm = bpm * playbackRateFromTempo(tempoPercent);
  const adjustedLabel = `${adjustedBpm.toFixed(1)} BPM`;
  if (Math.abs(tempoPercent) < 0.05) return adjustedLabel;
  return `${adjustedLabel} (${bpm.toFixed(1)})`;
}
