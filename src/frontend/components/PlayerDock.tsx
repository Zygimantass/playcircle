import { memo } from "react";
import type { Track } from "../designTypes";
import { classNames, DEFAULT_BEAT_WAVEFORM_BEATS, Waveform, waveformClickPosition } from "./common";

type DeckId = "A" | "B";

const BEAT_WINDOW_BEATS = DEFAULT_BEAT_WAVEFORM_BEATS;

type DeckState = {
  track: Track;
  playing: boolean;
  position: number;
  volume: number;
  filterCutoff: number;
  cue: boolean;
};

type PlayerDockProps = {
  audioStatus: string;
  deckA: DeckState;
  deckB: DeckState;
  masterVolume: number;
  selectedTrack: Track;
  onLoadDeck: (deck: DeckId, track: Track) => void;
  onSetCue: (deck: DeckId, enabled: boolean) => void;
  onSetFilter: (deck: DeckId, cutoffHz: number) => void;
  onSetMasterVolume: (volume: number) => void;
  onSetPlaying: (deck: DeckId, playing: boolean) => void;
  onSetPosition: (deck: DeckId, position: number) => void;
  onSetVolume: (deck: DeckId, volume: number) => void;
};

export const PlayerDock = memo(function PlayerDock({
  audioStatus,
  deckA,
  deckB,
  masterVolume,
  selectedTrack,
  onLoadDeck,
  onSetCue,
  onSetFilter,
  onSetMasterVolume,
  onSetPlaying,
  onSetPosition,
  onSetVolume
}: PlayerDockProps) {
  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(230px,0.92fr)_minmax(210px,1fr)] overflow-hidden bg-[#0b0c10]">
      <BeatMatchWaveforms
        deckA={deckA}
        deckB={deckB}
        onSetPosition={onSetPosition}
      />
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_176px_minmax(0,1fr)] border-t border-line">
        <DeckControls
          deck="A"
          state={deckA}
          selectedTrack={selectedTrack}
          onLoadDeck={onLoadDeck}
          onSetCue={onSetCue}
          onSetFilter={onSetFilter}
          onSetPlaying={onSetPlaying}
          onSetPosition={onSetPosition}
          onSetVolume={onSetVolume}
        />
        <MixerCenter audioStatus={audioStatus} deckA={deckA} deckB={deckB} masterVolume={masterVolume} onSetMasterVolume={onSetMasterVolume} />
        <DeckControls
          deck="B"
          state={deckB}
          selectedTrack={selectedTrack}
          onLoadDeck={onLoadDeck}
          onSetCue={onSetCue}
          onSetFilter={onSetFilter}
          onSetPlaying={onSetPlaying}
          onSetPosition={onSetPosition}
          onSetVolume={onSetVolume}
        />
      </div>
    </section>
  );
});

function BeatMatchWaveforms({
  deckA,
  deckB,
  onSetPosition
}: {
  deckA: DeckState;
  deckB: DeckState;
  onSetPosition: (deck: DeckId, position: number) => void;
}) {
  const beatWindowSeconds = beatWindowSecondsForTrack(deckA.track, BEAT_WINDOW_BEATS);

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-2 bg-[#07080b]">
      <BeatWaveformDeck deck="A" state={deckA} beatWindowSeconds={beatWindowSeconds} onSetPosition={onSetPosition} />
      <BeatWaveformDeck deck="B" state={deckB} beatWindowSeconds={beatWindowSeconds} onSetPosition={onSetPosition} />
    </div>
  );
}

function BeatWaveformDeck({
  deck,
  state,
  beatWindowSeconds,
  onSetPosition
}: {
  deck: DeckId;
  state: DeckState;
  beatWindowSeconds: number;
  onSetPosition: (deck: DeckId, position: number) => void;
}) {
  const track = state.track;
  const elapsed = Math.floor(state.position * track.totalSec);

  return (
    <section className="min-h-0 min-w-0 border-b border-line last:border-b-0">
      <button
        className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-[#07080b] text-left"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const clickRatio = (event.clientX - bounds.left) / bounds.width;
          onSetPosition(deck, waveformClickPosition(track, state.position, clickRatio, "beat", BEAT_WINDOW_BEATS, beatWindowSeconds));
        }}
        type="button"
      >
        <Waveform track={track} height="100%" playhead={state.position} showBeatGrid beatWindowBeats={BEAT_WINDOW_BEATS} beatWindowSeconds={beatWindowSeconds} />
        <div className="pointer-events-none absolute left-2 top-2 rounded-sm bg-bg/75 px-1.5 py-px font-mono text-[11px] text-text-2">{formatClock(elapsed)} / {track.duration}</div>
        <div className="pointer-events-none absolute right-2 top-2 grid size-6 place-items-center rounded-sm bg-bg/75 font-mono text-[12px] font-bold text-text-1">{deck}</div>
      </button>
    </section>
  );
}

function beatWindowSecondsForTrack(track: Track, beatWindowBeats: number) {
  const beatInterval = track.bpm > 0 ? 60 / track.bpm : 0.5;
  return Math.max(0.001, Math.floor(beatWindowBeats) * beatInterval);
}

function DeckControls({
  deck,
  state,
  selectedTrack,
  onLoadDeck,
  onSetCue,
  onSetFilter,
  onSetPlaying,
  onSetPosition,
  onSetVolume
}: {
  deck: DeckId;
  state: DeckState;
  selectedTrack: Track;
  onLoadDeck: (deck: DeckId, track: Track) => void;
  onSetCue: (deck: DeckId, enabled: boolean) => void;
  onSetFilter: (deck: DeckId, cutoffHz: number) => void;
  onSetPlaying: (deck: DeckId, playing: boolean) => void;
  onSetPosition: (deck: DeckId, position: number) => void;
  onSetVolume: (deck: DeckId, volume: number) => void;
}) {
  const track = state.track;
  const color = window.PC_DATA.CAMELOT_COLORS[track.key] ?? "#cdb46a";
  const elapsed = Math.floor(state.position * track.totalSec);

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[44px_minmax(0,1fr)] overflow-hidden border-r border-line bg-gradient-to-b from-surface-1 to-[#0d0e12] last:border-r-0">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-accent font-mono text-[13px] font-bold text-bg">{deck}</span>
          <div className="min-w-0">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-text-1">{track.title}</div>
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-text-2">{track.artist} · {track.bpm || "--"} BPM · {track.key}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px]" style={{ color }}>{formatClock(elapsed)} / {track.duration}</span>
          <button
            className="rounded border border-line-2 bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-2 hover:bg-surface-3 hover:text-text-1"
            onClick={() => onLoadDeck(deck, selectedTrack)}
            type="button"
          >
            LOAD
          </button>
        </div>
      </div>
      <div className="grid min-h-0 min-w-0 grid-rows-[42px_1fr] gap-2 overflow-hidden px-4 py-3">
        <button
          className="relative min-w-0 overflow-hidden border border-line bg-[#090a0d] text-left"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const clickRatio = (event.clientX - bounds.left) / bounds.width;
            onSetPosition(deck, waveformClickPosition(track, state.position, clickRatio, "overview"));
          }}
          type="button"
        >
          <Waveform track={track} height={40} playhead={state.position} variant="overview" />
        </button>
        <div className="grid min-h-0 grid-rows-[36px_minmax(0,1fr)] gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex shrink-0 items-center gap-1">
              <button className="grid size-7 place-items-center rounded-full bg-surface-3 text-text-1 hover:bg-line-2" onClick={() => onSetPosition(deck, Math.max(0, state.position - 0.04))} type="button">‹</button>
              <button className={classNames("grid size-8 place-items-center rounded-full text-bg", state.playing ? "bg-warn" : "bg-accent")} onClick={() => onSetPlaying(deck, !state.playing)} type="button">
              {state.playing ? "Ⅱ" : "▶"}
              </button>
              <button className="grid size-7 place-items-center rounded-full bg-surface-3 text-text-1 hover:bg-line-2" onClick={() => onSetPosition(deck, Math.min(1, state.position + 0.04))} type="button">›</button>
            </div>
            <button
              className={classNames("shrink-0 rounded border px-2 py-1 font-mono text-[10px]", state.cue ? "border-accent bg-accent/15 text-accent" : "border-line-2 bg-surface-2 text-text-2")}
              onClick={() => onSetCue(deck, !state.cue)}
              type="button"
            >
              CUE
            </button>
          </div>
          <div className="grid min-w-0 grid-cols-2 items-start gap-4">
            <label className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-2 font-mono text-[10px] text-text-2">
              <span>VOL {Math.round(state.volume * 100)}</span>
              <input
                aria-label={`Deck ${deck} volume`}
                className="accent-[var(--color-accent)]"
                max="1"
                min="0"
                onChange={(event) => onSetVolume(deck, Number(event.currentTarget.value))}
                step="0.01"
                type="range"
                value={state.volume}
              />
            </label>
            <label className="grid min-w-0 grid-cols-[46px_minmax(0,1fr)] items-center gap-2 font-mono text-[10px] text-text-2">
              <span>LPF</span>
              <input
                aria-label={`Deck ${deck} low-pass filter`}
                className="accent-[var(--color-warn)]"
                max="20000"
                min="400"
                onChange={(event) => onSetFilter(deck, Number(event.currentTarget.value))}
                step="100"
                type="range"
                value={state.filterCutoff}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

function MixerCenter({
  audioStatus,
  deckA,
  deckB,
  masterVolume,
  onSetMasterVolume
}: {
  audioStatus: string;
  deckA: DeckState;
  deckB: DeckState;
  masterVolume: number;
  onSetMasterVolume: (volume: number) => void;
}) {
  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[44px_minmax(0,1fr)_126px] border-x border-line bg-surface-1">
      <div className="grid place-items-center border-b border-line font-mono text-[10px] font-semibold tracking-[0.08em] text-text-3">MIXER</div>
      <div className="grid min-h-0 grid-cols-2 items-end gap-3 px-4 pb-4 pt-3">
        <Meter label="A" value={deckA.playing ? deckA.volume : 0} />
        <Meter label="B" value={deckB.playing ? deckB.volume : 0} />
      </div>
      <div className="grid min-h-0 grid-rows-[44px_minmax(0,1fr)] gap-2 border-t border-line px-4 py-3">
        <label className="grid min-w-0 gap-1 font-mono text-[10px] text-text-2">
          <span className="flex items-center justify-between">
            <span>MASTER</span>
            <span>{Math.round(masterVolume * 100)}</span>
          </span>
          <input
            aria-label="Master volume"
            className="accent-[var(--color-accent)]"
            max="1"
            min="0"
            onChange={(event) => onSetMasterVolume(Number(event.currentTarget.value))}
            step="0.01"
            type="range"
            value={masterVolume}
          />
        </label>
        <div className="min-h-0 overflow-hidden font-mono text-[9px] leading-snug text-text-3">{audioStatus}</div>
      </div>
    </div>
  );
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

function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
