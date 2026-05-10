import type { Track } from "../designTypes";

export function TrackDragOverlay({ track }: { track: Track }) {
  return (
    <div className="pointer-events-none grid h-[30px] w-[560px] max-w-[70vw] grid-cols-[minmax(0,1fr)_110px_58px] items-center gap-3 rounded-sm border border-accent/70 bg-surface-2 px-3 text-[12px] text-text-1 shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">{track.title}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-2">{track.artist}</span>
      <span className="text-right font-mono text-[11px] text-accent">{track.bpm > 0 ? track.bpm.toFixed(1) : "--"}</span>
    </div>
  );
}
