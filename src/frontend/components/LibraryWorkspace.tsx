import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { isRecentlyAdded, recentAddedCutoff } from "../data/recentTracks";
import type { CurrentNode, PcData, SortState, Track } from "../designTypes";
import { collectPlaylistTrackIds, findPlaylist, indexPlaylists, mapTrackIds, sortTracks } from "../lib/library";
import { FilterBar } from "./FilterBar";
import { TrackTable } from "./TrackTable";

type LibraryWorkspaceProps = {
  baseTrack: Track | null;
  crateMembership: Record<string, Set<string>>;
  currentNode: CurrentNode;
  data: PcData;
  filterQuery: string;
  hoveredId: string | null;
  libraryWriteStatus: string | null;
  libraryFocused: boolean;
  multiSelected: Set<string>;
  onPreview: (track: Track, play?: boolean) => void;
  onVisibleTracksChange: (tracks: Track[]) => void;
  selected: string;
  setBaseTrack: (track: Track | null) => void;
  setFilterQuery: (query: string) => void;
  setHoveredId: (id: string | null) => void;
  setMultiSelected: Dispatch<SetStateAction<Set<string>>>;
  setSelected: (id: string) => void;
};

export function LibraryWorkspace({
  baseTrack,
  crateMembership,
  currentNode,
  data,
  filterQuery,
  hoveredId,
  libraryWriteStatus,
  libraryFocused,
  multiSelected,
  onPreview,
  onVisibleTracksChange,
  selected,
  setBaseTrack,
  setFilterQuery,
  setHoveredId,
  setMultiSelected,
  setSelected
}: LibraryWorkspaceProps) {
  const [sort, setSort] = useState<SortState>({ col: "added", dir: "desc" });
  const recentCutoff = useMemo(() => recentAddedCutoff(data.TRACKS), [data.TRACKS]);
  const recentTracks = useMemo(() => data.TRACKS.filter((track) => isRecentlyAdded(track, recentCutoff)), [data.TRACKS, recentCutoff]);
  const fiveStarTracks = useMemo(() => data.TRACKS.filter((track) => track.rating === 5), [data.TRACKS]);
  const historyTracks = useMemo(() => data.TRACKS.filter((track) => track.plays > 0), [data.TRACKS]);
  const tracksById = useMemo(() => new Map(data.TRACKS.map((track) => [track.id, track])), [data.TRACKS]);
  const playlistsById = useMemo(() => indexPlaylists(data.PLAYLISTS), [data.PLAYLISTS]);
  const sortedAllTracks = useMemo(() => sortTracks(data.TRACKS, sort), [data.TRACKS, sort]);
  const sortedRecentTracks = useMemo(() => sortTracks(recentTracks, sort), [recentTracks, sort]);
  const sortedFiveStarTracks = useMemo(() => sortTracks(fiveStarTracks, sort), [fiveStarTracks, sort]);
  const sortedHistoryTracks = useMemo(() => sortTracks(historyTracks, sort), [historyTracks, sort]);

  const visibleTracks = useMemo(() => {
    let list: Track[];

    if (currentNode.type === "all") {
      list = sortedAllTracks;
    } else if (currentNode.type === "recent") {
      list = sortedRecentTracks;
    } else if (currentNode.type === "fivestar") {
      list = sortedFiveStarTracks;
    } else if (currentNode.type === "history") {
      list = sortedHistoryTracks;
    } else if (currentNode.type === "crate") {
      const ids = crateMembership[currentNode.id] ?? new Set<string>();
      list = sortTracks(mapTrackIds(ids, tracksById), sort);
    } else if (currentNode.type === "playlist") {
      const playlist = playlistsById.get(currentNode.id);
      list = sortTracks(mapTrackIds(playlist ? collectPlaylistTrackIds(playlist) : [], tracksById), sort);
    } else if (currentNode.type === "smart") {
      if (currentNode.id === "sm_1") list = sortedFiveStarTracks;
      else if (currentNode.id === "sm_2") list = sortTracks(data.TRACKS.filter((track) => !track.analyzed), sort);
      else if (currentNode.id === "sm_3") list = sortTracks(data.TRACKS.filter((track) => track.bpm >= 120 && track.bpm <= 126 && track.key.endsWith("A")), sort);
      else if (currentNode.id === "sm_4") list = sortTracks(data.TRACKS.filter((track) => track.plays < 5), sort);
      else list = [];
    } else if (currentNode.type === "tag") {
      list = sortTracks(data.TRACKS.filter((track) => track.tags.includes(currentNode.id)), sort);
    } else {
      list = sortedAllTracks;
    }

    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase().trim();
      list = list.filter((track) =>
        [track.title, track.artist, track.album, track.genre, track.key, ...track.tags].some((value) =>
          value.toLowerCase().includes(query)
        )
      );
    }

    return list;
  }, [crateMembership, currentNode, data.TRACKS, filterQuery, playlistsById, sort, sortedAllTracks, sortedFiveStarTracks, sortedHistoryTracks, sortedRecentTracks, tracksById]);

  const finalTracks = useMemo(() => {
    if (!baseTrack) return visibleTracks;

    return [...visibleTracks].sort((a, b) => {
      const aCompat = data.compatibleKeys(baseTrack.key).has(a.key) ? 0 : 1;
      const bCompat = data.compatibleKeys(baseTrack.key).has(b.key) ? 0 : 1;
      if (aCompat !== bCompat) return aCompat - bCompat;
      return Math.abs(a.bpm - baseTrack.bpm) - Math.abs(b.bpm - baseTrack.bpm);
    });
  }, [baseTrack, data, visibleTracks]);

  useEffect(() => {
    onVisibleTracksChange(finalTracks);
  }, [finalTracks, onVisibleTracksChange]);

  const currentNodeLabel = useMemo(() => {
    if (currentNode.type === "all") return "All Tracks";
    if (currentNode.type === "recent") return "Recently Added";
    if (currentNode.type === "fivestar") return "5-Star";
    if (currentNode.type === "history") return "History";
    if (currentNode.type === "crate") return data.CRATES.find((crate) => crate.id === currentNode.id)?.name ?? "Crate";
    if (currentNode.type === "playlist") return findPlaylist(data.PLAYLISTS, currentNode.id)?.name ?? "Playlist";
    if (currentNode.type === "smart") return data.SMART.find((smart) => smart.id === currentNode.id)?.name ?? "Smart List";
    if (currentNode.type === "tag") return `#${currentNode.id}`;
    return "—";
  }, [currentNode, data]);

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[32px_minmax(0,1fr)_22px] border-x border-line bg-bg">
      <FilterBar
        count={finalTracks.length}
        total={data.TRACKS.length}
        query={filterQuery}
        setQuery={setFilterQuery}
        sort={sort}
        baseTrack={baseTrack}
        setBaseTrack={setBaseTrack}
        currentNodeLabel={currentNodeLabel}
      />
      <TrackTable
        tracks={finalTracks}
        controllerFocused={libraryFocused}
        sort={sort}
        setSort={setSort}
        selected={selected}
        setSelected={setSelected}
        multiSelected={multiSelected}
        setMultiSelected={setMultiSelected}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        onPreview={onPreview}
        baseTrack={baseTrack}
      />
      <div className="flex h-[22px] items-center justify-between border-t border-line bg-surface-1 px-3 font-mono text-[10px] text-text-2">
        <span><span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">B</span> set selected as base · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">⌘K</span> palette · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">/</span> filter · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">drag</span> to crate or playlist</span>
        <span>{libraryWriteStatus ?? (multiSelected.size > 1 ? `${multiSelected.size} selected` : "")}</span>
      </div>
    </section>
  );
}
