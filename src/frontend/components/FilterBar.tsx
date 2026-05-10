import type { SortState, Track } from "../designTypes";

type FilterBarProps = {
  count: number;
  total: number;
  query: string;
  setQuery: (query: string) => void;
  sort: SortState;
  baseTrack: Track | null;
  setBaseTrack: (track: Track | null) => void;
  currentNodeLabel: string;
};

export function FilterBar({ count, total, query, setQuery, sort, baseTrack, setBaseTrack, currentNodeLabel }: FilterBarProps) {
  return (
    <div className="grid h-8 grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-surface-1 px-3 text-[11px]">
      <div className="flex items-center gap-2.5">
        <span className="text-[12px] font-semibold text-text-1">{currentNodeLabel}</span>
        <span className="font-mono text-[11px] text-text-2">{count} / {total}</span>
      </div>
      <div className="flex justify-center gap-2">
        {baseTrack && (
          <button className="flex items-center gap-1.5 rounded border border-accent-dim bg-accent/10 px-2 py-[3px] text-[11px]" onClick={() => setBaseTrack(null)}>
            Base: <strong>{baseTrack.title}</strong> <span className="font-mono">{baseTrack.key}</span> ×
          </button>
        )}
        <span className="font-mono text-[10px] text-text-3">sort · {sort.col} · {sort.dir}</span>
      </div>
      <div className="flex justify-end">
        <label className="flex w-60 items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-[3px] text-text-3 focus-within:border-line-2">
          <span>⌕</span>
          <input className="w-full bg-transparent text-[11px] text-text-1" value={query} placeholder="Filter" onChange={(event) => setQuery(event.target.value)} />
          {query && <button className="px-0.5 text-text-3 hover:text-text-1" onClick={() => setQuery("")}>×</button>}
        </label>
      </div>
    </div>
  );
}
