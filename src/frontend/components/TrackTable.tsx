import { useDraggable } from "@dnd-kit/core";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SortableTrackKey, SortState, Track } from "../designTypes";
import { classNames, EnergyBars, formatPlays, StarRating, ui } from "./common";

type TrackTableProps = {
  tracks: Track[];
  controllerFocused: boolean;
  sort: SortState;
  setSort: (sort: SortState) => void;
  selected: string;
  setSelected: (id: string) => void;
  multiSelected: Set<string>;
  setMultiSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  onPreview: (track: Track, play?: boolean) => void;
  baseTrack: Track | null;
};

const cols: Array<{ id: SortableTrackKey | "idx" | "compat"; label: string; w: string; align: "left" | "right" | "center"; sortable: boolean }> = [
  { id: "idx", label: "#", w: "44px", align: "right", sortable: false },
  { id: "compat", label: "", w: "16px", align: "center", sortable: false },
  { id: "title", label: "Title", w: "minmax(220px,2fr)", align: "left", sortable: true },
  { id: "artist", label: "Artist", w: "minmax(140px,1fr)", align: "left", sortable: true },
  { id: "album", label: "Album", w: "minmax(140px,1fr)", align: "left", sortable: true },
  { id: "genre", label: "Genre", w: "108px", align: "left", sortable: true },
  { id: "bpm", label: "BPM", w: "50px", align: "right", sortable: true },
  { id: "key", label: "Key", w: "38px", align: "left", sortable: true },
  { id: "duration", label: "Time", w: "46px", align: "right", sortable: true },
  { id: "energy", label: "Energy", w: "72px", align: "left", sortable: true },
  { id: "rating", label: "★", w: "60px", align: "left", sortable: true },
  { id: "plays", label: "↻", w: "32px", align: "right", sortable: true },
  { id: "added", label: "Added", w: "80px", align: "left", sortable: true }
];

const rowHeight = 26;
const overscan = 10;

export function TrackTable({ tracks, controllerFocused, sort, setSort, selected, setSelected, multiSelected, setMultiSelected, hoveredId, setHoveredId, onPreview, baseTrack }: TrackTableProps) {
  const data = window.PC_DATA;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const gridTemplateColumns = cols.map((col) => col.w).join(" ");
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.ceil(scrollTop / rowHeight));
    const count = Math.ceil(viewportHeight / rowHeight) + overscan;
    const end = Math.min(tracks.length, start + count);
    return { start, end };
  }, [scrollTop, tracks.length, viewportHeight]);
  const visibleTracks = tracks.slice(visibleRange.start, visibleRange.end);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const index = tracks.findIndex((track) => track.id === selected);
    if (index === -1) return;

    const rowTop = index * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < element.scrollTop) {
      element.scrollTop = rowTop;
      setScrollTop(rowTop);
    } else if (rowBottom > element.scrollTop + element.clientHeight) {
      const nextScrollTop = rowBottom - element.clientHeight;
      element.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  }, [selected, tracks]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[24px_minmax(0,1fr)] overflow-hidden bg-bg pl-2">
      <div className="sticky top-0 z-10 grid h-6 items-center border-b border-line bg-surface-1" style={{ gridTemplateColumns }}>
        {cols.map((col) => (
          <button
            key={col.id}
            data-testid={col.sortable ? `sort-${col.id}` : undefined}
            className={classNames(ui.tableHead, alignClass(col.align), col.sortable && "cursor-pointer hover:text-text-1", sort.col === col.id && "text-text-1")}
            onClick={() => {
              if (!col.sortable) return;
              const id = col.id as SortableTrackKey;
              setSort({ col: id, dir: sort.col === id && sort.dir === "asc" ? "desc" : "asc" });
            }}
          >
            <span>{col.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={scrollRef}
        data-testid="track-table-scroll"
        className="min-h-0 overflow-y-auto [scrollbar-color:var(--color-line-2)_transparent] [scrollbar-width:thin]"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="relative" style={{ height: tracks.length * rowHeight }}>
        <div style={{ transform: `translateY(${visibleRange.start * rowHeight}px)` }}>
        {visibleTracks.map((track, visibleIndex) => {
          const index = visibleRange.start + visibleIndex;
          return (
            <TrackRow
              key={track.id}
              baseTrack={baseTrack}
              controllerFocused={controllerFocused}
              gridTemplateColumns={gridTemplateColumns}
              hovered={hoveredId === track.id}
              index={index}
              keyColors={data.CAMELOT_COLORS}
              multiSelected={multiSelected.has(track.id)}
              onPreview={onPreview}
              selected={selected === track.id}
              setHoveredId={setHoveredId}
              setMultiSelected={setMultiSelected}
              setSelected={setSelected}
              track={track}
            />
          );
        })}
        </div>
        </div>
      </div>
    </div>
  );
}

const TrackRow = memo(function TrackRow({
  baseTrack,
  controllerFocused,
  gridTemplateColumns,
  hovered,
  index,
  keyColors,
  multiSelected,
  onPreview,
  selected,
  setHoveredId,
  setMultiSelected,
  setSelected,
  track
}: {
  baseTrack: Track | null;
  controllerFocused: boolean;
  gridTemplateColumns: string;
  hovered: boolean;
  index: number;
  keyColors: Record<string, string>;
  multiSelected: boolean;
  onPreview: (track: Track, play?: boolean) => void;
  selected: boolean;
  setHoveredId: (id: string | null) => void;
  setMultiSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelected: (id: string) => void;
  track: Track;
}) {
  const compatColor = baseTrack && baseTrack.id !== track.id ? "#3a3c44" : "#3a3c44";
  const keyColor = keyColors[track.key] ?? "#cdb46a";
  const energyColor = track.energy >= 8 ? "#c95a72" : track.energy >= 6 ? "#cdb46a" : track.energy >= 4 ? "#4ea892" : "#5b5e67";
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `track:${track.id}`,
    data: { trackId: track.id }
  });

  return (
    <div
      ref={setNodeRef}
      data-testid="track-row"
      data-track-id={track.id}
      className={classNames(
        "grid h-[26px] cursor-grab select-none items-center border-b border-[#131418] text-[12px] text-text-1 hover:bg-surface-2 active:cursor-grabbing",
        selected && "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)] hover:bg-accent/15",
        selected && controllerFocused && "outline outline-1 -outline-offset-1 outline-accent",
        multiSelected && "bg-accent/5",
        hovered && "bg-surface-2",
        !track.analyzed && "text-text-2"
      )}
      style={{
        gridTemplateColumns,
        opacity: isDragging ? 0.35 : undefined
      }}
      {...attributes}
      {...listeners}
      onMouseEnter={() => setHoveredId(track.id)}
      onMouseLeave={() => setHoveredId(null)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          setMultiSelected((current) => {
            const next = new Set(current);
            if (next.has(track.id)) next.delete(track.id);
            else next.add(track.id);
            return next;
          });
        } else {
          setSelected(track.id);
          setMultiSelected(new Set([track.id]));
          onPreview(track);
        }
      }}
      onDoubleClick={() => onPreview(track, true)}
    >
      <div className={classNames(ui.tableCell, "justify-end font-mono text-[11px] text-text-3")}>{String(index + 1).padStart(2, "0")}</div>
      <div className={classNames(ui.tableCell, "justify-center")}>{track.analyzed ? <span className="size-1.5 rounded-full" style={{ background: compatColor }} /> : <span className="size-1.5 rounded-full bg-warn" />}</div>
      <div className={classNames(ui.tableCell, "justify-start")}>
        <span className="h-3.5 w-1 shrink-0 rounded-[1px]" style={{ background: `${keyColor}55` }} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={track.title}>{track.title}</span>
        {track.tags.includes("edit") && <span className="rounded-sm border px-1 font-mono text-[9px] font-semibold tracking-[0.05em] text-accent">EDIT</span>}
      </div>
      <Cell>{track.artist}</Cell>
      <Cell dim>{track.album}</Cell>
      <Cell dim>{track.genre}</Cell>
      <Cell right mono>{track.bpm > 0 ? track.bpm.toFixed(1) : "—"}</Cell>
      <div className={classNames(ui.tableCell, "justify-start font-mono text-[11px]")} style={{ color: keyColor }}>{track.key}</div>
      <Cell right mono dim2>{track.duration}</Cell>
      <div className={classNames(ui.tableCell, "justify-start")}><div className="flex items-center gap-1.5"><span className="min-w-2 font-mono text-[11px] font-semibold" style={{ color: energyColor }}>{track.energy}</span><EnergyBars value={track.energy} color={energyColor} /></div></div>
      <div className={classNames(ui.tableCell, "justify-start")}><StarRating value={track.rating} /></div>
      <Cell right mono dim2>{formatPlays(track.plays)}</Cell>
      <Cell mono dim2>{track.added.slice(2).replace(/-/g, "·")}</Cell>
    </div>
  );
});

function Cell({ children, right, mono, dim, dim2 }: { children: React.ReactNode; right?: boolean; mono?: boolean; dim?: boolean; dim2?: boolean }) {
  return (
    <div className={classNames(ui.tableCell, right ? "justify-end" : "justify-start", mono && "font-mono text-[11px]", dim && "text-text-3", dim2 && "text-text-2")}>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{children}</span>
    </div>
  );
}

function alignClass(align: "left" | "right" | "center") {
  if (align === "right") return "justify-end";
  if (align === "center") return "justify-center";
  return "justify-start";
}
