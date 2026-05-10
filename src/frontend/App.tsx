import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { FilterBar } from "./components/FilterBar";
import { Inspector } from "./components/Inspector";
import { PlayerDock } from "./components/PlayerDock";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { TrackTable } from "./components/TrackTable";
import { loadAudioDeck, pauseAudioDeck, playAudioDeck, seekAudioDeck, setAudioDeckCue, setAudioDeckFilter, setAudioDeckVolume, setAudioMasterVolume, type DeckId } from "./api/audio";
import { loadRekordboxBeatGrid, loadRekordboxLibrary } from "./api/rekordbox";
import { withRekordboxLibrary } from "./data/libraryMapping";
import type { CurrentNode, PcData, PlaylistEntry, SortableTrackKey, SortState, Track } from "./designTypes";

declare global {
  interface Window {
    PC_DATA: PcData;
  }
}

export function App() {
  const mockData = useMemo(() => window.PC_DATA, []);
  const [data, setData] = useState<PcData>(mockData);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "rekordbox" | "mock" | "error">("loading");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [mode, setMode] = useState<"library" | "mix">("library");
  const [currentNode, setCurrentNode] = useState<CurrentNode>({ type: "all" });
  const [filterQuery, setFilterQuery] = useState("");
  const [selected, setSelected] = useState(mockData.TRACKS[0].id);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set([mockData.TRACKS[0].id]));
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [previewTrack, setPreviewTrack] = useState<Track>(mockData.TRACKS[0]);
  const [deckATrack, setDeckATrack] = useState<Track>(mockData.TRACKS[0]);
  const [deckBTrack, setDeckBTrack] = useState<Track>(mockData.TRACKS[1] ?? mockData.TRACKS[0]);
  const [deckPlaying, setDeckPlaying] = useState({ A: false, B: false });
  const [deckPositions, setDeckPositions] = useState({ A: 0.32, B: 0.12 });
  const [deckVolumes, setDeckVolumes] = useState({ A: 0.82, B: 0.82 });
  const [deckFilters, setDeckFilters] = useState({ A: 20_000, B: 20_000 });
  const [deckCue, setDeckCue] = useState({ A: false, B: false });
  const [loadedDeckPaths, setLoadedDeckPaths] = useState<{ A: string | null; B: string | null }>({ A: null, B: null });
  const [masterVolume, setMasterVolume] = useState(0.9);
  const [audioStatus, setAudioStatus] = useState("Rust audio engine ready");
  const [baseTrack, setBaseTrack] = useState<Track | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [dragHoverCrate, setDragHoverCrate] = useState<string | null>(null);
  const [flashCrate, setFlashCrate] = useState<string | null>(null);
  const [crateMembership, setCrateMembership] = useState<Record<string, Set<string>>>(() => {
    const membership: Record<string, Set<string>> = {};
    data.CRATES.forEach((crate, index) => {
      membership[crate.id] = new Set(data.TRACKS.slice(index * 3, index * 3 + crate.count).map((track) => track.id));
    });
    return membership;
  });

  useEffect(() => {
    let cancelled = false;

    loadRekordboxLibrary()
      .then((library) => {
        if (cancelled) return;
        const nextData = withRekordboxLibrary(mockData, library);
        const firstTrack = nextData.TRACKS[0] ?? mockData.TRACKS[0];

        setData(nextData);
        setSelected(firstTrack.id);
        setMultiSelected(new Set([firstTrack.id]));
        setPreviewTrack(firstTrack);
        setDeckATrack(firstTrack);
        setDeckBTrack(nextData.TRACKS[1] ?? firstTrack);
        setCurrentNode({ type: "all" });
        setLibraryStatus("rekordbox");
        setLibraryError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLibraryStatus("error");
        setLibraryError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [mockData]);

  useEffect(() => {
    const membership: Record<string, Set<string>> = {};
    data.CRATES.forEach((crate, index) => {
      membership[crate.id] = new Set(data.TRACKS.slice(index * 3, index * 3 + crate.count).map((track) => track.id));
    });
    setCrateMembership(membership);
  }, [data.CRATES, data.TRACKS]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "/" && !isInput) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".fb-search input")?.focus();
      } else if (event.key.toLowerCase() === "b" && !event.metaKey && !event.ctrlKey && !isInput) {
        const track = data.TRACKS.find((item) => item.id === selected);
        if (track) setBaseTrack(track);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.TRACKS, selected]);

  useEffect(() => {
    if (!deckPlaying.A && !deckPlaying.B) return undefined;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      setDeckPositions((positions) => {
        const nextA = deckPlaying.A ? Math.min(1, positions.A + delta / deckATrack.totalSec) : positions.A;
        const nextB = deckPlaying.B ? Math.min(1, positions.B + delta / deckBTrack.totalSec) : positions.B;
        if ((deckPlaying.A && nextA >= 1) || (deckPlaying.B && nextB >= 1)) {
          setDeckPlaying((playing) => ({
            A: playing.A && nextA < 1,
            B: playing.B && nextB < 1
          }));
        }
        return { A: nextA, B: nextB };
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deckATrack.totalSec, deckBTrack.totalSec, deckPlaying.A, deckPlaying.B]);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
  }, []);

  const onDropToCrate = useCallback((crateId: string, trackId: string) => {
    setCrateMembership((current) => {
      const next = { ...current, [crateId]: new Set(current[crateId] ?? []) };
      if (multiSelected.has(trackId) && multiSelected.size > 1) {
        multiSelected.forEach((id) => next[crateId].add(id));
      } else {
        next[crateId].add(trackId);
      }
      return next;
    });
    setFlashCrate(crateId);
    window.setTimeout(() => setFlashCrate(null), 700);
  }, [multiSelected]);

  const reportAudioError = useCallback((error: unknown) => {
    setAudioStatus(error instanceof Error ? error.message : String(error));
  }, []);

  const ensureDeckLoaded = useCallback(async (deck: DeckId, track: Track) => {
    if (!track.filePath) {
      throw new Error(`${track.title} has no local file path from Rekordbox`);
    }
    if (loadedDeckPaths[deck] === track.filePath) return;
    setAudioStatus(`Loading deck ${deck}...`);
    await loadAudioDeck(deck, track.filePath);
    setLoadedDeckPaths((current) => ({ ...current, [deck]: track.filePath }));
    setAudioStatus(`Deck ${deck} loaded`);
  }, [loadedDeckPaths]);

  const loadBeatGridForTrack = useCallback(async (track: Track) => {
    if (track.beatGrid?.length || !track.analysisDataPath) return track;

    const beatGrid = await loadRekordboxBeatGrid(track.analysisDataPath);
    if (beatGrid.length === 0) return track;

    return {
      ...track,
      beatGrid: beatGrid.map((beat) => ({
        timeSec: beat.time_seconds,
        beatNumber: beat.beat_number,
        bpm: beat.bpm
      }))
    };
  }, []);

  const loadDeck = useCallback((deck: DeckId, track: Track) => {
    if (deck === "A") setDeckATrack(track);
    else setDeckBTrack(track);
    setDeckPositions((positions) => ({ ...positions, [deck]: 0 }));
    setDeckPlaying((playing) => ({ ...playing, [deck]: false }));
    ensureDeckLoaded(deck, track).catch(reportAudioError);
    loadBeatGridForTrack(track)
      .then((trackWithBeatGrid) => {
        if (deck === "A") setDeckATrack(trackWithBeatGrid);
        else setDeckBTrack(trackWithBeatGrid);
      })
      .catch(reportAudioError);
  }, [ensureDeckLoaded, loadBeatGridForTrack, reportAudioError]);

  const setDeckPlayback = useCallback((deck: DeckId, playing: boolean) => {
    const track = deck === "A" ? deckATrack : deckBTrack;
    setDeckPlaying((current) => ({ ...current, [deck]: playing }));

    const command = async () => {
      if (playing) {
        await ensureDeckLoaded(deck, track);
        await playAudioDeck(deck);
        setAudioStatus(`Deck ${deck} playing`);
      } else {
        await pauseAudioDeck(deck);
        setAudioStatus(`Deck ${deck} paused`);
      }
    };

    command().catch((error) => {
      setDeckPlaying((current) => ({ ...current, [deck]: false }));
      reportAudioError(error);
    });
  }, [deckATrack, deckBTrack, ensureDeckLoaded, reportAudioError]);

  const setDeckPosition = useCallback((deck: DeckId, position: number) => {
    setDeckPositions((current) => ({ ...current, [deck]: position }));
    seekAudioDeck(deck, position).catch(reportAudioError);
  }, [reportAudioError]);

  const setDeckVolume = useCallback((deck: DeckId, volume: number) => {
    setDeckVolumes((current) => ({ ...current, [deck]: volume }));
    setAudioDeckVolume(deck, volume).catch(reportAudioError);
  }, [reportAudioError]);

  const setDeckFilter = useCallback((deck: DeckId, cutoffHz: number) => {
    setDeckFilters((current) => ({ ...current, [deck]: cutoffHz }));
    setAudioDeckFilter(deck, cutoffHz).catch(reportAudioError);
  }, [reportAudioError]);

  const setDeckCueEnabled = useCallback((deck: DeckId, enabled: boolean) => {
    setDeckCue((current) => ({ ...current, [deck]: enabled }));
    setAudioDeckCue(deck, enabled).catch(reportAudioError);
  }, [reportAudioError]);

  const updateMasterVolume = useCallback((volume: number) => {
    setMasterVolume(volume);
    setAudioMasterVolume(volume).catch(reportAudioError);
  }, [reportAudioError]);

  const onPreview = useCallback((track: Track, play = false) => {
    setPreviewTrack(track);
    if (play) {
      setDeckATrack(track);
      setDeckPositions((positions) => ({ ...positions, A: 0 }));
      setSelected(track.id);
      setDeckPlaying((playing) => ({ ...playing, A: true }));
      ensureDeckLoaded("A", track)
        .then(() => playAudioDeck("A"))
        .then(() => setAudioStatus("Deck A playing"))
        .catch((error) => {
          setDeckPlaying((playing) => ({ ...playing, A: false }));
          reportAudioError(error);
        });
      loadBeatGridForTrack(track)
        .then(setDeckATrack)
        .catch(reportAudioError);
    }
  }, [ensureDeckLoaded, loadBeatGridForTrack, reportAudioError]);

  useEffect(() => {
    if (libraryStatus !== "rekordbox") return undefined;

    let cancelled = false;
    loadBeatGridForTrack(deckATrack)
      .then((track) => {
        if (!cancelled && track !== deckATrack) setDeckATrack(track);
      })
      .catch(reportAudioError);
    loadBeatGridForTrack(deckBTrack)
      .then((track) => {
        if (!cancelled && track !== deckBTrack) setDeckBTrack(track);
      })
      .catch(reportAudioError);

    return () => {
      cancelled = true;
    };
  }, [deckATrack, deckBTrack, libraryStatus, loadBeatGridForTrack, reportAudioError]);

  return (
    <div className="grid h-screen grid-rows-[32px_1fr] bg-bg" data-screen-label={mode === "library" ? "Library" : "Mix"}>
      <TopBar
        mode={mode}
        onSearchClick={openPalette}
        query={paletteQuery || statusText(libraryStatus, data.TRACKS.length, libraryError)}
        setMode={setMode}
      />
      {mode === "library" ? (
        <div className="grid min-h-0 grid-cols-[220px_1fr_304px]">
          <Sidebar
            data={data}
            currentNode={currentNode}
            setCurrentNode={setCurrentNode}
            onDropToCrate={onDropToCrate}
            dragHoverCrate={flashCrate || dragHoverCrate}
            setDragHoverCrate={setDragHoverCrate}
          />
          <LibraryWorkspace
            baseTrack={baseTrack}
            crateMembership={crateMembership}
            currentNode={currentNode}
            data={data}
            filterQuery={filterQuery}
            hoveredId={hoveredId}
            multiSelected={multiSelected}
            onPreview={onPreview}
            selected={selected}
            setBaseTrack={setBaseTrack}
            setFilterQuery={setFilterQuery}
            setHoveredId={setHoveredId}
            setMultiSelected={setMultiSelected}
            setSelected={setSelected}
          />
          <Inspector track={previewTrack} />
        </div>
      ) : (
        <PlayerDock
          audioStatus={audioStatus}
          deckA={{ track: deckATrack, playing: deckPlaying.A, position: deckPositions.A, volume: deckVolumes.A, filterCutoff: deckFilters.A, cue: deckCue.A }}
          deckB={{ track: deckBTrack, playing: deckPlaying.B, position: deckPositions.B, volume: deckVolumes.B, filterCutoff: deckFilters.B, cue: deckCue.B }}
          masterVolume={masterVolume}
          selectedTrack={previewTrack}
          onLoadDeck={loadDeck}
          onSetCue={setDeckCueEnabled}
          onSetFilter={setDeckFilter}
          onSetMasterVolume={updateMasterVolume}
          onSetPlaying={setDeckPlayback}
          onSetPosition={setDeckPosition}
          onSetVolume={setDeckVolume}
        />
      )}
      {paletteOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/40 pt-[72px]" onClick={() => setPaletteOpen(false)}>
          <div className="w-[560px] overflow-hidden rounded-md border border-line-2 bg-surface-1 shadow-[0_24px_80px_rgba(0,0,0,0.5)]" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              className="w-full border-b border-line bg-transparent px-3.5 py-3 text-[13px]"
              placeholder="Search library, jump to crate, run command..."
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
            />
            <div className="grid p-1.5">
              {data.TRACKS.slice(0, 6).map((track) => (
                <button
                  key={track.id}
                  className="flex justify-between rounded px-2 py-2 text-left hover:bg-surface-3"
                  type="button"
                  onClick={() => {
                    setPreviewTrack(track);
                    setSelected(track.id);
                    setPaletteOpen(false);
                  }}
                >
                  <span>{track.title}</span>
                  <span className="font-mono text-[11px] text-text-3">{track.artist}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LibraryWorkspace({
  baseTrack,
  crateMembership,
  currentNode,
  data,
  filterQuery,
  hoveredId,
  multiSelected,
  onPreview,
  selected,
  setBaseTrack,
  setFilterQuery,
  setHoveredId,
  setMultiSelected,
  setSelected
}: {
  baseTrack: Track | null;
  crateMembership: Record<string, Set<string>>;
  currentNode: CurrentNode;
  data: PcData;
  filterQuery: string;
  hoveredId: string | null;
  multiSelected: Set<string>;
  onPreview: (track: Track, play?: boolean) => void;
  selected: string;
  setBaseTrack: (track: Track | null) => void;
  setFilterQuery: (query: string) => void;
  setHoveredId: (id: string | null) => void;
  setMultiSelected: Dispatch<SetStateAction<Set<string>>>;
  setSelected: (id: string) => void;
}) {
  const [sort, setSort] = useState<SortState>({ col: "added", dir: "desc" });

  const visibleTracks = useMemo(() => {
    let list = [...data.TRACKS];

    if (currentNode.type === "recent") {
      list = list.filter((track) => track.added.startsWith("2025"));
    } else if (currentNode.type === "fivestar") {
      list = list.filter((track) => track.rating === 5);
    } else if (currentNode.type === "history") {
      list = list.filter((track) => track.plays > 0).sort((a, b) => b.plays - a.plays);
    } else if (currentNode.type === "crate") {
      const ids = crateMembership[currentNode.id] ?? new Set<string>();
      list = list.filter((track) => ids.has(track.id));
    } else if (currentNode.type === "playlist") {
      const playlist = findPlaylist(data.PLAYLISTS, currentNode.id);
      const ids = new Set(playlist ? collectPlaylistTrackIds(playlist) : []);
      list = list.filter((track) => ids.has(track.id));
    } else if (currentNode.type === "smart") {
      if (currentNode.id === "sm_1") list = list.filter((track) => track.rating === 5);
      else if (currentNode.id === "sm_2") list = list.filter((track) => !track.analyzed);
      else if (currentNode.id === "sm_3") list = list.filter((track) => track.bpm >= 120 && track.bpm <= 126 && track.key.endsWith("A"));
      else if (currentNode.id === "sm_4") list = list.filter((track) => track.plays < 5);
    } else if (currentNode.type === "tag") {
      list = list.filter((track) => track.tags.includes(currentNode.id));
    }

    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase().trim();
      list = list.filter((track) =>
        [track.title, track.artist, track.album, track.genre, track.key, ...track.tags].some((value) =>
          value.toLowerCase().includes(query)
        )
      );
    }

    list.sort(trackComparator(sort.col, sort.dir));

    return list;
  }, [crateMembership, currentNode, data, filterQuery, sort]);

  const finalTracks = useMemo(() => {
    if (!baseTrack) return visibleTracks;

    return [...visibleTracks].sort((a, b) => {
      const aCompat = data.compatibleKeys(baseTrack.key).has(a.key) ? 0 : 1;
      const bCompat = data.compatibleKeys(baseTrack.key).has(b.key) ? 0 : 1;
      if (aCompat !== bCompat) return aCompat - bCompat;
      return Math.abs(a.bpm - baseTrack.bpm) - Math.abs(b.bpm - baseTrack.bpm);
    });
  }, [baseTrack, data, visibleTracks]);

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
        <span><span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">B</span> set selected as base · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">⌘K</span> palette · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">/</span> filter · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">drag</span> to crate</span>
        <span>{multiSelected.size > 1 ? `${multiSelected.size} selected` : ""}</span>
      </div>
    </section>
  );
}

function findPlaylist(playlists: PlaylistEntry[], id: string): PlaylistEntry | null {
  for (const playlist of playlists) {
    if (playlist.id === id) return playlist;
    const child = findPlaylist(playlist.children, id);
    if (child) return child;
  }
  return null;
}

function collectPlaylistTrackIds(playlist: PlaylistEntry): string[] {
  return [
    ...playlist.trackIds,
    ...playlist.children.flatMap((child) => collectPlaylistTrackIds(child))
  ];
}

function trackComparator(column: SortableTrackKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;

  return (a: Track, b: Track) => {
    const aValue = a.sortKeys?.[column] ?? (column === "duration" ? a.totalSec : a[column]);
    const bValue = b.sortKeys?.[column] ?? (column === "duration" ? b.totalSec : b[column]);

    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * multiplier;
    }

    if (aValue < bValue) return -1 * multiplier;
    if (aValue > bValue) return 1 * multiplier;
    return 0;
  };
}

function statusText(status: "loading" | "rekordbox" | "mock" | "error", count: number, error: string | null) {
  if (status === "loading") return "Loading Rekordbox library…";
  if (status === "rekordbox") return `${count.toLocaleString()} tracks loaded from Rekordbox`;
  if (status === "error") return `Rekordbox load failed: ${error ?? "unknown error"}`;
  return "Using mock library";
}
