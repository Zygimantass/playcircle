import type { Track } from "../designTypes";

type CommandPaletteProps = {
  query: string;
  tracks: Track[];
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelectTrack: (track: Track) => void;
};

export function CommandPalette({ query, tracks, onClose, onQueryChange, onSelectTrack }: CommandPaletteProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/40 pt-[72px]" onClick={onClose}>
      <div className="w-[560px] overflow-hidden rounded-md border border-line-2 bg-surface-1 shadow-[0_24px_80px_rgba(0,0,0,0.5)]" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-3.5 py-3 text-[13px]"
          placeholder="Search library, jump to crate, run command..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="grid p-1.5">
          {tracks.slice(0, 6).map((track) => (
            <button
              key={track.id}
              className="flex justify-between rounded px-2 py-2 text-left hover:bg-surface-3"
              type="button"
              onClick={() => onSelectTrack(track)}
            >
              <span>{track.title}</span>
              <span className="font-mono text-[11px] text-text-3">{track.artist}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
