import { useDroppable } from "@dnd-kit/core";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { Track } from "../designTypes";
import type { DeckFxKind } from "../api/audio";
import { CONTROLLER_FX_KINDS, fxKindLabel, fxTimingLabel, type ControllerFxDebugState } from "../lib/controllerFx";
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
  levelDb: number;
  syncEnabled: boolean;
  syncRole: SyncRole;
  tempoPercent: number;
  tempoRange: number;
  volume: number;
  eq: DeckEq;
  filterAmount: number;
  cuePoint: number;
  cueEnabled: boolean;
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
  headphoneMix: number;
  headphoneVolume: number;
  fxState: ControllerFxDebugState;
  trackDragActive: boolean;
  onBeatSync: (deck: DeckId) => void;
  onCycleTempoRange: (deck: DeckId) => void;
  onSetCrossfader: (value: number) => void;
  onCueAction: (deck: DeckId) => void;
  onSetCue: (deck: DeckId, enabled: boolean) => void;
  onSetEq: (deck: DeckId, band: EqBand, value: number) => void;
  onSetFilter: (deck: DeckId, amount: number) => void;
  onSetHeadphoneMix: (value: number) => void;
  onSetHeadphoneVolume: (value: number) => void;
  onSetFxActive: (enabled: boolean) => void;
  onSetFxKind: (kind: DeckFxKind) => void;
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
  headphoneMix,
  headphoneVolume,
  fxState,
  trackDragActive,
  onBeatSync,
  onCycleTempoRange,
  onSetCrossfader,
  onCueAction,
  onSetCue,
  onSetEq,
  onSetFilter,
  onSetHeadphoneMix,
  onSetHeadphoneVolume,
  onSetFxActive,
  onSetFxKind,
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
    <section data-player-dock-drop-region className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(88px,0.42fr)_minmax(150px,1fr)] overflow-hidden bg-[#0b0c10]">
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
          trackDragActive={trackDragActive}
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
          fxState={fxState}
          headphoneMix={headphoneMix}
          headphoneVolume={headphoneVolume}
          trackDragActive={trackDragActive}
          onSetCue={onSetCue}
          onSetEq={onSetEq}
          onSetFilter={onSetFilter}
          onSetCrossfader={onSetCrossfader}
          onSetFxActive={onSetFxActive}
          onSetFxKind={onSetFxKind}
          onSetHeadphoneMix={onSetHeadphoneMix}
          onSetHeadphoneVolume={onSetHeadphoneVolume}
          onSetVolume={onSetVolume}
        />
        <DeckControls
          deck="B"
          state={deckB}
          trackDragActive={trackDragActive}
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
  const { isOver, setNodeRef } = useDroppable({ id: `deck:${deck}:beat` });

  return (
    <section className="min-h-0 min-w-0 border-b border-line last:border-b-0">
      <button
        ref={setNodeRef}
        data-deck-drop={deck}
        data-testid={`deck-${deck}-beat-drop`}
        className={classNames("relative h-full min-h-0 w-full min-w-0 cursor-grab touch-none overflow-hidden bg-[#07080b] text-left active:cursor-grabbing", isOver && "outline outline-1 -outline-offset-1 outline-accent")}
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
  trackDragActive,
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
  trackDragActive: boolean;
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
  const { isOver, setNodeRef } = useDroppable({ id: `deck:${deck}:controls` });

  return (
    <section
      ref={setNodeRef}
      data-deck-drop={deck}
      data-testid={`deck-${deck}-drop`}
      className={classNames("grid min-h-0 min-w-0 grid-rows-[44px_minmax(0,1fr)] overflow-hidden border-r border-line bg-gradient-to-b from-surface-1 to-[#0d0e12] last:border-r-0", isOver && "outline outline-1 -outline-offset-1 outline-accent")}
    >
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
        <div className={classNames("grid min-h-0 gap-3 px-4 py-3", deck === "A" ? "grid-cols-[minmax(0,1fr)_112px]" : "grid-cols-[112px_minmax(0,1fr)]")}>
          {deck === "B" && (
            <TempoControl
              deck={deck}
              playing={state.playing}
              trackDragActive={trackDragActive}
              tempoPercent={state.tempoPercent}
              tempoRange={state.tempoRange}
              syncEnabled={state.syncEnabled}
              syncRole={state.syncRole}
              onBeatSync={onBeatSync}
              onCueAction={onCueAction}
              onCycleTempoRange={onCycleTempoRange}
              onSetMasterDeck={onSetMasterDeck}
              onSetPlaying={onSetPlaying}
              onSetTempo={onSetTempo}
            />
          )}
          <div className={classNames("grid min-h-0 content-start gap-2", deck === "B" && "justify-items-end text-right")}>
            <span className="font-mono text-[10px] text-text-3">{formatClock(Math.floor(state.cuePoint * track.totalSec))}</span>
          </div>
          {deck === "A" && (
          <TempoControl
            deck={deck}
            playing={state.playing}
            trackDragActive={trackDragActive}
            tempoPercent={state.tempoPercent}
            tempoRange={state.tempoRange}
            syncEnabled={state.syncEnabled}
            syncRole={state.syncRole}
            onBeatSync={onBeatSync}
            onCueAction={onCueAction}
            onCycleTempoRange={onCycleTempoRange}
            onSetMasterDeck={onSetMasterDeck}
            onSetPlaying={onSetPlaying}
            onSetTempo={onSetTempo}
          />
          )}
        </div>
      </div>
    </section>
  );
}

function TempoControl({
  deck,
  playing,
  trackDragActive,
  tempoPercent,
  tempoRange,
  syncEnabled,
  syncRole,
  onBeatSync,
  onCueAction,
  onCycleTempoRange,
  onSetMasterDeck,
  onSetPlaying,
  onSetTempo
}: {
  deck: DeckId;
  playing: boolean;
  trackDragActive: boolean;
  tempoPercent: number;
  tempoRange: number;
  syncEnabled: boolean;
  syncRole: SyncRole;
  onBeatSync: (deck: DeckId) => void;
  onCueAction: (deck: DeckId) => void;
  onCycleTempoRange: (deck: DeckId) => void;
  onSetMasterDeck: (deck: DeckId) => void;
  onSetPlaying: (deck: DeckId, playing: boolean) => void;
  onSetTempo: (deck: DeckId, tempoPercent: number) => void;
}) {
  const isMaster = syncRole === "master";
  const tempoRangeLabel = Math.abs(tempoPercent) > tempoRange ? "SYNC LOCK" : `±${tempoRange}`;
  const clampedTempo = clamp(tempoPercent, -tempoRange, tempoRange);
  const ratio = (clampedTempo + tempoRange) / (tempoRange * 2);

  const setFromPointer = (event: PointerEvent<HTMLSpanElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const trackTop = bounds.top + 8;
    const trackHeight = Math.max(1, bounds.height - 16);
    const pointerRatio = (event.clientY - trackTop) / trackHeight;
    const nextTempo = -tempoRange + clamp(pointerRatio, 0, 1) * tempoRange * 2;
    onSetTempo(deck, Number(nextTempo.toFixed(1)));
  };

  return (
    <div className={classNames("grid h-full min-h-0 min-w-0 grid-cols-[32px_28px_44px] items-stretch justify-center gap-2 font-mono text-[9px] text-text-2", trackDragActive && "pointer-events-none")}>
      <span
        aria-label={`Deck ${deck} tempo`}
        aria-orientation="vertical"
        aria-valuemax={tempoRange}
        aria-valuemin={-tempoRange}
        aria-valuenow={Number(clampedTempo.toFixed(1))}
        className="relative min-h-0 w-8 cursor-grab touch-none rounded-sm border border-line-2 bg-[#08090c] outline-none active:cursor-grabbing"
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSetTempo(deck, 0);
        }}
        onKeyDown={(event) => handleTempoKeyDown(event, clampedTempo, tempoRange, onSetTempo, deck)}
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
        <span className="absolute left-1/2 top-1/2 h-1 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-line-2" />
        <span
          className="absolute left-1/2 h-3 w-6 -translate-x-1/2 rounded-[2px] border border-line-2 bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.45)]"
          style={{ top: `calc(2px + ${ratio * 100}% - ${ratio * 16}px)` }}
        />
      </span>
      <span className="grid content-between text-left text-[8px] text-text-3">
        <span>-{tempoRange}</span>
        <span>0</span>
        <span>+{tempoRange}</span>
      </span>
      <span className="grid min-h-0 content-start gap-1">
        <span className="text-[8px] font-semibold tracking-[0.08em] text-text-3">TEMPO</span>
        <button
          className="rounded-sm border border-line bg-surface-2 px-1 py-1 text-[9px] leading-tight text-text-1 hover:bg-surface-3"
          onClick={() => onCycleTempoRange(deck)}
          type="button"
        >
          <span className="block">{formatTempo(tempoPercent)}</span>
          <span className="block text-[8px] text-text-3">{tempoRangeLabel}</span>
        </button>
        <button
          className={classNames(
            "rounded-sm border px-1 py-1 text-[9px] leading-tight",
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
        <button className={classNames("grid h-8 place-items-center rounded-sm text-bg", playing ? "bg-warn" : "bg-accent")} onClick={() => onSetPlaying(deck, !playing)} type="button">
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button
          className={classNames("grid h-8 place-items-center rounded-sm border font-mono text-[9px]", playing ? "border-accent bg-accent/15 text-accent" : "border-line-2 bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1")}
          onClick={() => onCueAction(deck)}
          type="button"
        >
          CUE
        </button>
      </span>
    </div>
  );
}

function handleTempoKeyDown(
  event: KeyboardEvent<HTMLSpanElement>,
  value: number,
  range: number,
  onSetTempo: (deck: DeckId, tempoPercent: number) => void,
  deck: DeckId
) {
  const step = event.shiftKey ? 0.1 : 0.5;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") {
    event.preventDefault();
    onSetTempo(deck, Number(clamp(value - step, -range, range).toFixed(1)));
  } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
    event.preventDefault();
    onSetTempo(deck, Number(clamp(value + step, -range, range).toFixed(1)));
  } else if (event.key === "Home") {
    event.preventDefault();
    onSetTempo(deck, -range);
  } else if (event.key === "End") {
    event.preventDefault();
    onSetTempo(deck, range);
  } else if (event.key === "0" || event.key === "Enter") {
    event.preventDefault();
    onSetTempo(deck, 0);
  }
}

function MixerCenter({
  deckA,
  deckB,
  crossfader,
  fxState,
  headphoneMix,
  headphoneVolume,
  trackDragActive,
  onSetCue,
  onSetCrossfader,
  onSetEq,
  onSetFilter,
  onSetFxActive,
  onSetFxKind,
  onSetHeadphoneMix,
  onSetHeadphoneVolume,
  onSetVolume
}: {
  deckA: DeckState;
  deckB: DeckState;
  crossfader: number;
  fxState: ControllerFxDebugState;
  headphoneMix: number;
  headphoneVolume: number;
  trackDragActive: boolean;
  onSetCue: (deck: DeckId, enabled: boolean) => void;
  onSetCrossfader: (value: number) => void;
  onSetEq: (deck: DeckId, band: EqBand, value: number) => void;
  onSetFilter: (deck: DeckId, amount: number) => void;
  onSetFxActive: (enabled: boolean) => void;
  onSetFxKind: (kind: DeckFxKind) => void;
  onSetHeadphoneMix: (value: number) => void;
  onSetHeadphoneVolume: (value: number) => void;
  onSetVolume: (deck: DeckId, volume: number) => void;
}) {
  const focusedFx = fxState.slots[fxState.focusIndex] ?? fxState.slots[0];
  const [fxMenuOpen, setFxMenuOpen] = useState(false);
  const fxMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fxMenuOpen) return undefined;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (fxMenuRef.current?.contains(event.target as Node)) return;
      setFxMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [fxMenuOpen]);

  return (
    <div className={classNames("grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_42px_58px_34px] border-x border-line bg-surface-1", trackDragActive && "pointer-events-none")}>
      <div className="grid min-h-0 grid-cols-2 gap-2 px-3 py-2">
        <MixerDeckStrip
          deck="A"
          cueEnabled={deckA.cueEnabled}
          eq={deckA.eq}
          meterDb={deckA.levelDb}
          filterAmount={deckA.filterAmount}
          volume={deckA.volume}
          onSetCue={onSetCue}
          onSetEq={onSetEq}
          onSetFilter={onSetFilter}
          onSetVolume={onSetVolume}
        />
        <MixerDeckStrip
          deck="B"
          cueEnabled={deckB.cueEnabled}
          eq={deckB.eq}
          meterDb={deckB.levelDb}
          filterAmount={deckB.filterAmount}
          volume={deckB.volume}
          onSetCue={onSetCue}
          onSetEq={onSetEq}
          onSetFilter={onSetFilter}
          onSetVolume={onSetVolume}
        />
      </div>
      <div className="grid grid-cols-2 items-center gap-3 border-t border-line px-3 py-1.5 font-mono text-[9px] text-text-2">
        <label className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-2">
          <span>MIX</span>
          <input aria-label="Headphone mix" className="accent-[var(--color-accent)]" max="1" min="0" onChange={(event) => onSetHeadphoneMix(Number(event.currentTarget.value))} step="0.01" type="range" value={headphoneMix} />
        </label>
        <label className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-2">
          <span>PHONES</span>
          <input aria-label="Headphone volume" className="accent-[var(--color-accent)]" max="1" min="0" onChange={(event) => onSetHeadphoneVolume(Number(event.currentTarget.value))} step="0.01" type="range" value={headphoneVolume} />
        </label>
      </div>
      <div className="grid gap-1 border-t border-line px-3 py-1.5 font-mono text-[9px] text-text-2">
        <div className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)_44px] items-center gap-2">
          <span>FX</span>
          <div ref={fxMenuRef} className="relative min-w-0">
            <button
              aria-expanded={fxMenuOpen}
              aria-haspopup="listbox"
              className="grid h-6 w-full grid-cols-[minmax(0,1fr)_14px] items-center rounded-sm border border-line bg-surface-2 px-2 text-left text-[10px] text-text-1 hover:bg-surface-3"
              onClick={() => setFxMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setFxMenuOpen(false);
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setFxMenuOpen(true);
                }
              }}
              type="button"
            >
              <span className="truncate">{fxKindLabel(focusedFx.kind)}</span>
              <span className="text-right text-text-3">▾</span>
            </button>
            {fxMenuOpen && (
              <div className="absolute bottom-[calc(100%+4px)] left-0 z-20 grid max-h-[220px] w-[180px] overflow-auto rounded-sm border border-line-2 bg-[#0b0c10] p-1 shadow-[0_12px_36px_rgba(0,0,0,0.5)]" role="listbox">
                {CONTROLLER_FX_KINDS.map((kind) => (
                  <button
                    key={kind}
                    className={classNames(
                      "grid h-7 grid-cols-[minmax(0,1fr)_16px] items-center rounded-sm px-2 text-left text-[10px]",
                      kind === focusedFx.kind ? "bg-accent/15 text-text-1" : "text-text-2 hover:bg-surface-2 hover:text-text-1"
                    )}
                    onClick={() => {
                      onSetFxKind(kind);
                      setFxMenuOpen(false);
                    }}
                    role="option"
                    type="button"
                    aria-selected={kind === focusedFx.kind}
                  >
                    <span className="truncate">{fxKindLabel(kind)}</span>
                    <span className="text-right text-accent">{kind === focusedFx.kind ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center justify-end gap-1 text-text-2">
            <input checked={focusedFx.enabled} className="accent-[var(--color-accent)]" onChange={(event) => onSetFxActive(event.currentTarget.checked)} type="checkbox" />
            ON
          </label>
        </div>
        <div className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2">
          <span>MIX</span>
          <span className="min-w-0 truncate text-right text-text-1">{Math.round(focusedFx.mix * 100)}% · {fxTimingLabel(focusedFx)}</span>
        </div>
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
  cueEnabled,
  eq,
  meterDb,
  filterAmount,
  volume,
  onSetCue,
  onSetEq,
  onSetFilter,
  onSetVolume
}: {
  deck: DeckId;
  cueEnabled: boolean;
  eq: { high: number; mid: number; low: number };
  meterDb: number;
  filterAmount: number;
  volume: number;
  onSetCue: (deck: DeckId, enabled: boolean) => void;
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
  const meter = <Meter label="" levelDb={meterDb} />;
  const fader = (
    <div className="grid min-h-0 grid-rows-[1fr_14px_22px] gap-1 font-mono text-[9px] text-text-2">
      <VolumeFader deck={deck} value={volume} onChange={(value) => onSetVolume(deck, value)} />
      <span className="text-center">{Math.round(volume * 100)}</span>
      <button
        className={classNames(
          "rounded-sm border px-1 text-[9px] leading-tight",
          cueEnabled ? "border-accent bg-accent/15 text-accent" : "border-line-2 bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1"
        )}
        onClick={() => onSetCue(deck, !cueEnabled)}
        type="button"
      >
        CUE
      </button>
    </div>
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
    const trackTop = bounds.top + 8;
    const trackHeight = Math.max(1, bounds.height - 16);
    const ratio = 1 - (event.clientY - trackTop) / trackHeight;
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
        className="absolute left-1/2 top-2 h-3 w-6 -translate-x-1/2 rounded-[2px] border border-line-2 bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.45)]"
        style={{ top: `calc(2px + ${(1 - value) * 100}% - ${(1 - value) * 16}px)` }}
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

function playbackRateFromTempo(tempoPercent: number) {
  return Math.max(0.05, 1 + tempoPercent / 100);
}

function Meter({ label, levelDb }: { label: string; levelDb: number }) {
  const clampedDb = clamp(levelDb, -60, 6);
  const greenHeight = dbRangePercent(-60, Math.min(clampedDb, -12));
  const yellowHeight = clampedDb > -12 ? dbRangePercent(-12, Math.min(clampedDb, -3)) : 0;
  const redHeight = clampedDb > -3 ? dbRangePercent(-3, clampedDb) : 0;

  return (
    <div className="grid h-full grid-rows-[1fr_16px] gap-1">
      <div className="relative rounded-sm border border-line bg-[#08090c] p-1">
        <div className="absolute inset-1">
          <span className="absolute bottom-0 left-0 w-full rounded-b-[1px] bg-[#25b56f]" style={{ height: `${greenHeight}%`, opacity: levelDb > -59.9 ? 0.95 : 0.2 }} />
          <span className="absolute left-0 w-full bg-[#d8ca72]" style={{ bottom: `${dbToMeterPercent(-12)}%`, height: `${yellowHeight}%`, opacity: yellowHeight > 0 ? 0.95 : 0 }} />
          <span className="absolute left-0 w-full rounded-t-[1px] bg-[#d95757]" style={{ bottom: `${dbToMeterPercent(-3)}%`, height: `${redHeight}%`, opacity: redHeight > 0 ? 0.95 : 0 }} />
        </div>
      </div>
      <div className="text-center font-mono text-[9px] text-text-2">{label || formatLevelDb(clampedDb)}</div>
    </div>
  );
}

function dbToMeterPercent(levelDb: number) {
  return ((clamp(levelDb, -60, 6) + 60) / 66) * 100;
}

function dbRangePercent(fromDb: number, toDb: number) {
  return Math.max(0, dbToMeterPercent(toDb) - dbToMeterPercent(fromDb));
}

function formatLevelDb(levelDb: number) {
  if (levelDb <= -59.9) return "-∞";
  return `${Math.round(levelDb)}`;
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
