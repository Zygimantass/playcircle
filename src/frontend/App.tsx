import { DndContext, DragOverlay, MouseSensor, pointerWithin, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { FilterBar } from "./components/FilterBar";
import { Inspector } from "./components/Inspector";
import { PlayerDock } from "./components/PlayerDock";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { TrackTable } from "./components/TrackTable";
import { audioDeckError, audioDeckLevelDb, audioDeckPosition, endAudioDeckScrub, loadAudioDeck, loadAudioWaveform, pauseAudioDeck, playAudioDeck, scrubAudioDeckToPosition, seekAudioDeck, setAudioDeckEq, setAudioDeckFilterAmount, setAudioDeckTempo, setAudioDeckVolume, setAudioMasterVolume, startAudioDeckScrub, usesBrowserAudioFixture, type DeckId } from "./api/audio";
import { addRekordboxTracksToPlaylist, createRekordboxPlaylist, loadRekordboxBeatGrid, loadRekordboxLibrary } from "./api/rekordbox";
import { withRekordboxLibrary } from "./data/libraryMapping";
import type { CurrentNode, PcData, PlaylistEntry, SortableTrackKey, SortState, Track } from "./designTypes";

declare global {
  interface Window {
    PC_DATA: PcData;
  }
}

type EqBand = "high" | "mid" | "low";
type DeckEq = Record<EqBand, number>;

export function App() {
  const mockData = useMemo(() => window.PC_DATA, []);
  const [data, setData] = useState<PcData>(mockData);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "rekordbox" | "mock" | "error">("loading");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryWriteStatus, setLibraryWriteStatus] = useState<string | null>(null);
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
  const [deckTempos, setDeckTempos] = useState({ A: 0, B: 0 });
  const [deckTempoRanges, setDeckTempoRanges] = useState({ A: 10, B: 10 });
  const [syncMaster, setSyncMaster] = useState<DeckId>("A");
  const [syncEnabled, setSyncEnabled] = useState({ A: false, B: false });
  const [deckVolumes, setDeckVolumes] = useState({ A: 1, B: 1 });
  const [deckLevelsDb, setDeckLevelsDb] = useState({ A: -60, B: -60 });
  const [deckEq, setDeckEqState] = useState<Record<DeckId, DeckEq>>({
    A: { high: 0, mid: 0, low: 0 },
    B: { high: 0, mid: 0, low: 0 }
  });
  const [deckFilterAmounts, setDeckFilterAmounts] = useState({ A: 0, B: 0 });
  const [deckCuePoints, setDeckCuePoints] = useState({ A: 0, B: 0 });
  const tempoSendTimeouts = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const deckPositionsRef = useRef(deckPositions);
  const [loadedDeckPaths, setLoadedDeckPaths] = useState<{ A: string | null; B: string | null }>({ A: null, B: null });
  const [crossfader, setCrossfader] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.9);
  const [audioStatus, setAudioStatus] = useState("Rust audio engine ready");
  const [baseTrack, setBaseTrack] = useState<Track | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [activeDragTrackId, setActiveDragTrackId] = useState<string | null>(null);
  const [dragHoverCrate, setDragHoverCrate] = useState<string | null>(null);
  const [flashCrate, setFlashCrate] = useState<string | null>(null);
  const [crateMembership, setCrateMembership] = useState<Record<string, Set<string>>>(() => {
    const membership: Record<string, Set<string>> = {};
    data.CRATES.forEach((crate, index) => {
      membership[crate.id] = new Set(data.TRACKS.slice(index * 3, index * 3 + crate.count).map((track) => track.id));
    });
    return membership;
  });
  const tracksById = useMemo(() => new Map(data.TRACKS.map((track) => [track.id, track])), [data.TRACKS]);

  const reportAudioError = useCallback((error: unknown) => {
    setAudioStatus(error instanceof Error ? error.message : String(error));
  }, []);

  const reloadRekordboxLibrary = useCallback(async () => {
    const library = await loadRekordboxLibrary();
    const nextData = withRekordboxLibrary(mockData, library);
    setData(nextData);
    setLibraryStatus("rekordbox");
    setLibraryError(null);
    return nextData;
  }, [mockData]);

  useEffect(() => {
    deckPositionsRef.current = deckPositions;
  }, [deckPositions]);

  useEffect(() => {
    let cancelled = false;

    reloadRekordboxLibrary()
      .then((nextData) => {
        if (cancelled) return;
        const firstTrack = nextData.TRACKS[0] ?? mockData.TRACKS[0];

        setSelected(firstTrack.id);
        setMultiSelected(new Set([firstTrack.id]));
        setPreviewTrack(firstTrack);
        setDeckATrack(firstTrack);
        setDeckBTrack(nextData.TRACKS[1] ?? firstTrack);
        setCurrentNode({ type: "all" });
      })
      .catch((error) => {
        if (cancelled) return;
        setLibraryStatus("error");
        setLibraryError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [mockData, reloadRekordboxLibrary]);

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
        const nextA = deckPlaying.A ? Math.min(1, positions.A + (delta * playbackRateFromTempo(deckTempos.A)) / deckATrack.totalSec) : positions.A;
        const nextB = deckPlaying.B ? Math.min(1, positions.B + (delta * playbackRateFromTempo(deckTempos.B)) / deckBTrack.totalSec) : positions.B;
        const nextPositions = { A: nextA, B: nextB };
        const follower = otherDeck(syncMaster);
        if (syncEnabled[follower] && deckPlaying[follower] && deckPlaying[syncMaster]) {
          const lockedPosition = syncedPositionForDeck(follower, syncMaster, deckATrack, deckBTrack, nextPositions);
          if (lockedPosition !== null) nextPositions[follower] = lockedPosition;
        }

        if ((deckPlaying.A && nextA >= 1) || (deckPlaying.B && nextB >= 1)) {
          setDeckPlaying((playing) => ({
            A: playing.A && nextA < 1,
            B: playing.B && nextB < 1
          }));
        }
        return nextPositions;
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deckATrack, deckBTrack, deckPlaying.A, deckPlaying.B, deckTempos.A, deckTempos.B, syncEnabled, syncMaster]);

  useEffect(() => {
    if (usesBrowserAudioFixture()) return undefined;
    if (!deckPlaying.A && !deckPlaying.B) return undefined;

    let cancelled = false;
    const syncPosition = () => {
      const requests: Array<Promise<[DeckId, number]>> = [];
      if (deckPlaying.A) requests.push(audioDeckPosition("A").then((position) => ["A", position] as [DeckId, number]));
      if (deckPlaying.B) requests.push(audioDeckPosition("B").then((position) => ["B", position] as [DeckId, number]));

      Promise.all(requests)
        .then((positions) => {
          if (cancelled) return;
          setDeckPositions((current) => {
            const next = { ...current };
            positions.forEach(([deck, position]) => {
              next[deck] = position;
            });
            return next;
          });
        })
        .catch(reportAudioError);
    };

    syncPosition();
    const interval = window.setInterval(syncPosition, 250);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deckPlaying.A, deckPlaying.B, reportAudioError]);

  useEffect(() => {
    if (!deckPlaying.A && !deckPlaying.B) {
      setDeckLevelsDb({ A: -60, B: -60 });
      return undefined;
    }

    let cancelled = false;
    const updateLevels = () => {
      if (usesBrowserAudioFixture()) {
        setDeckLevelsDb((current) => {
          const target = {
            A: deckPlaying.A ? estimatedDeckLevelDb(deckATrack, deckPositions.A, deckVolumes.A, crossfadeGain("A", crossfader)) : -60,
            B: deckPlaying.B ? estimatedDeckLevelDb(deckBTrack, deckPositions.B, deckVolumes.B, crossfadeGain("B", crossfader)) : -60
          };
          return {
            A: smoothMeterDb(current.A, target.A),
            B: smoothMeterDb(current.B, target.B)
          };
        });
        return;
      }

      const requests: Array<Promise<[DeckId, number]>> = [];
      if (deckPlaying.A) requests.push(audioDeckLevelDb("A").then((levelDb) => ["A", levelDb] as [DeckId, number]));
      if (deckPlaying.B) requests.push(audioDeckLevelDb("B").then((levelDb) => ["B", levelDb] as [DeckId, number]));

      Promise.all(requests)
        .then((levels) => {
          if (cancelled) return;
          setDeckLevelsDb((current) => {
            const next = {
              A: deckPlaying.A ? current.A : -60,
              B: deckPlaying.B ? current.B : -60
            };
            levels.forEach(([deck, levelDb]) => {
              next[deck] = smoothMeterDb(current[deck], levelDb);
            });
            return next;
          });
        })
        .catch(reportAudioError);
    };

    updateLevels();
    const interval = window.setInterval(updateLevels, 50);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [crossfader, deckATrack, deckBTrack, deckPlaying.A, deckPlaying.B, deckPositions.A, deckPositions.B, deckVolumes.A, deckVolumes.B, reportAudioError]);

  useEffect(() => {
    if (usesBrowserAudioFixture()) return undefined;
    if (!deckPlaying.A && !deckPlaying.B) return undefined;

    let cancelled = false;
    const checkErrors = () => {
      const requests: Array<Promise<[DeckId, string | null]>> = [];
      if (deckPlaying.A) requests.push(audioDeckError("A").then((error) => ["A", error] as [DeckId, string | null]));
      if (deckPlaying.B) requests.push(audioDeckError("B").then((error) => ["B", error] as [DeckId, string | null]));

      Promise.all(requests)
        .then((errors) => {
          if (cancelled) return;
          errors.forEach(([deck, error]) => {
            if (!error) return;
            setDeckPlaying((current) => ({ ...current, [deck]: false }));
            setAudioStatus(`Deck ${deck}: ${error}`);
          });
        })
        .catch(reportAudioError);
    };

    checkErrors();
    const interval = window.setInterval(checkErrors, 250);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deckPlaying.A, deckPlaying.B, reportAudioError]);

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

  const createPlaylist = useCallback(() => {
    const name = window.prompt("Playlist name");
    if (name === null || name.trim() === "") return;

    setLibraryWriteStatus("Creating playlist...");
    createRekordboxPlaylist(name)
      .then((playlist) => reloadRekordboxLibrary().then(() => playlist))
      .then((playlist) => {
        setCurrentNode({ type: "playlist", id: playlist.id });
        setLibraryWriteStatus(`Created ${playlist.name}`);
      })
      .catch((error) => {
        setLibraryWriteStatus(null);
        setLibraryError(error instanceof Error ? error.message : String(error));
        setLibraryStatus("error");
      });
  }, [reloadRekordboxLibrary]);

  const addTracksToPlaylist = useCallback((playlistId: string, activeTrackId: string) => {
    const trackIds = multiSelected.has(activeTrackId) && multiSelected.size > 1
      ? [...multiSelected]
      : [activeTrackId];

    setLibraryWriteStatus(`Adding ${trackIds.length} track${trackIds.length === 1 ? "" : "s"}...`);
    addRekordboxTracksToPlaylist(playlistId, trackIds)
      .then((playlist) => reloadRekordboxLibrary().then(() => playlist))
      .then((playlist) => {
        setCurrentNode({ type: "playlist", id: playlist.id });
        setLibraryWriteStatus(`Added to ${playlist.name}`);
      })
      .catch((error) => {
        setLibraryWriteStatus(null);
        setLibraryError(error instanceof Error ? error.message : String(error));
        setLibraryStatus("error");
      });
  }, [multiSelected, reloadRekordboxLibrary]);

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

  const loadWaveformForTrack = useCallback(async (track: Track) => {
    if (track.waveformSource === "audio" || !track.filePath) return track;

    const waveform = await loadAudioWaveform(track.filePath, 512);
    if (waveform.length === 0) return track;

    return {
      ...track,
      waveform,
      waveformSource: "audio" as const,
      energyCurve: sampleEnergyCurve(waveform, 24)
    };
  }, []);

  const loadAnalysisForTrack = useCallback(async (track: Track) => {
    const [trackWithBeatGrid, trackWithWaveform] = await Promise.all([
      loadBeatGridForTrack(track),
      loadWaveformForTrack(track)
    ]);

    if (trackWithBeatGrid === track && trackWithWaveform === track) return track;

    return {
      ...trackWithBeatGrid,
      waveform: trackWithWaveform.waveform,
      waveformSource: trackWithWaveform.waveformSource,
      energyCurve: trackWithWaveform.energyCurve
    };
  }, [loadBeatGridForTrack, loadWaveformForTrack]);

  const loadDeck = useCallback((deck: DeckId, track: Track) => {
    if (deck === "A") setDeckATrack(track);
    else setDeckBTrack(track);
    setDeckPositions((positions) => ({ ...positions, [deck]: 0 }));
    setDeckCuePoints((cuePoints) => ({ ...cuePoints, [deck]: 0 }));
    setDeckPlaying((playing) => ({ ...playing, [deck]: false }));
    window.setTimeout(() => {
      ensureDeckLoaded(deck, track).catch(reportAudioError);
      loadAnalysisForTrack(track)
        .then((trackWithAnalysis) => {
          if (deck === "A") {
            setDeckATrack((current) => current.id === track.id ? trackWithAnalysis : current);
          } else {
            setDeckBTrack((current) => current.id === track.id ? trackWithAnalysis : current);
          }
        })
        .catch(reportAudioError);
    }, 0);
  }, [ensureDeckLoaded, loadAnalysisForTrack, reportAudioError]);

  const loadDeckByTrackId = useCallback((deck: DeckId, trackId: string) => {
    const track = tracksById.get(trackId);
    if (!track) return;
    setSelected(track.id);
    setPreviewTrack(track);
    loadDeck(deck, track);
  }, [loadDeck, tracksById]);

  const dndSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 }
    })
  );

  const activeDragTrack = useMemo(
    () => activeDragTrackId ? data.TRACKS.find((track) => track.id === activeDragTrackId) ?? null : null,
    [activeDragTrackId, data.TRACKS]
  );

  const handleDndDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    setActiveDragTrackId(activeId.startsWith("track:") ? activeId.slice("track:".length) : null);
  }, []);

  const handleDndDragEnd = useCallback((event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    setActiveDragTrackId(null);
    if (!activeId.startsWith("track:")) return;
    const trackId = activeId.slice("track:".length);

    if (overId.startsWith("playlist:")) {
      addTracksToPlaylist(overId.slice("playlist:".length), trackId);
      return;
    }

    const deck = deckFromDndDropId(overId) ?? deckFromDndTranslatedRect(event);
    if (!deck) return;

    loadDeckByTrackId(deck, trackId);
  }, [addTracksToPlaylist, loadDeckByTrackId]);

  const setDeckPlayback = useCallback((deck: DeckId, playing: boolean) => {
    const track = deck === "A" ? deckATrack : deckBTrack;
    const requestedPosition = deck === "A" ? deckPositions.A : deckPositions.B;
    setDeckPlaying((current) => ({ ...current, [deck]: playing }));

    const command = async () => {
      if (playing) {
        await ensureDeckLoaded(deck, track);
        await seekAudioDeck(deck, requestedPosition);
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
  }, [deckATrack, deckBTrack, deckPositions.A, deckPositions.B, ensureDeckLoaded, reportAudioError]);

  const setDeckPosition = useCallback((deck: DeckId, position: number) => {
    deckPositionsRef.current = { ...deckPositionsRef.current, [deck]: position };
    setDeckPositions((current) => ({ ...current, [deck]: position }));
    seekAudioDeck(deck, position).catch(reportAudioError);
  }, [reportAudioError]);

  const startDeckScrub = useCallback((deck: DeckId) => {
    setDeckPlaying((current) => ({ ...current, [deck]: false }));
    pauseAudioDeck(deck)
      .then(() => startAudioDeckScrub(deck))
      .catch(reportAudioError);
  }, [reportAudioError]);

  const scrubDeckPosition = useCallback((deck: DeckId, position: number) => {
    deckPositionsRef.current = { ...deckPositionsRef.current, [deck]: position };
    setDeckPositions((current) => ({ ...current, [deck]: position }));
    scrubAudioDeckToPosition(deck, position).catch(reportAudioError);
  }, [reportAudioError]);

  const endDeckScrub = useCallback((deck: DeckId, resume: boolean) => {
    endAudioDeckScrub(deck)
      .then(async () => {
        if (!resume) return;

        const track = deck === "A" ? deckATrack : deckBTrack;
        const requestedPosition = deckPositionsRef.current[deck];
        setDeckPlaying((current) => ({ ...current, [deck]: true }));
        await ensureDeckLoaded(deck, track);
        await seekAudioDeck(deck, requestedPosition);
        await playAudioDeck(deck);
        setAudioStatus(`Deck ${deck} playing`);
      })
      .catch((error) => {
        setDeckPlaying((current) => ({ ...current, [deck]: false }));
        reportAudioError(error);
      });
  }, [deckATrack, deckBTrack, ensureDeckLoaded, reportAudioError]);

  const setDeckVolume = useCallback((deck: DeckId, volume: number) => {
    setDeckVolumes((current) => ({ ...current, [deck]: volume }));
    setAudioDeckVolume(deck, volume * crossfadeGain(deck, crossfader)).catch(reportAudioError);
  }, [crossfader, reportAudioError]);

  const setDeckTempo = useCallback((deck: DeckId, tempoPercent: number) => {
    setDeckTempos((current) => ({ ...current, [deck]: tempoPercent }));
    const pending = tempoSendTimeouts.current[deck];
    if (pending !== null) window.clearTimeout(pending);
    tempoSendTimeouts.current[deck] = window.setTimeout(() => {
      tempoSendTimeouts.current[deck] = null;
      setAudioDeckTempo(deck, tempoPercent).catch(reportAudioError);
    }, 40);
  }, [reportAudioError]);

  const beatSyncDeck = useCallback((deck: DeckId) => {
    if (deck === syncMaster) {
      setSyncMaster(deck);
      setSyncEnabled((current) => ({ ...current, [deck]: false }));
      return;
    }

    if (syncEnabled[deck]) {
      setSyncEnabled((current) => ({ ...current, [deck]: false }));
      return;
    }

    const master = syncMaster;
    const nextTempo = syncedTempoForDeck(deck, master, deckATrack, deckBTrack, deckTempos);
    const nextPosition = syncedPositionForDeck(deck, master, deckATrack, deckBTrack, deckPositions);

    setSyncEnabled((current) => ({ ...current, [deck]: true, [master]: false }));
    if (nextTempo !== null) setDeckTempo(deck, nextTempo);
    if (nextPosition !== null) setDeckPosition(deck, nextPosition);
  }, [deckATrack, deckBTrack, deckPositions, deckTempos, setDeckPosition, setDeckTempo, syncEnabled, syncMaster]);

  const setDeckAsMaster = useCallback((deck: DeckId) => {
    setSyncMaster(deck);
    setSyncEnabled((current) => ({ ...current, [deck]: false }));
  }, []);

  useEffect(() => {
    const follower = otherDeck(syncMaster);
    if (!syncEnabled[follower]) return;

    const nextTempo = syncedTempoForDeck(follower, syncMaster, deckATrack, deckBTrack, deckTempos);
    if (nextTempo === null || Math.abs(nextTempo - deckTempos[follower]) < 0.01) return;
    setDeckTempo(follower, nextTempo);
  }, [deckATrack, deckBTrack, deckTempos, setDeckTempo, syncEnabled, syncMaster]);

  useEffect(() => {
    const follower = otherDeck(syncMaster);
    if (!syncEnabled[follower] || !deckPlaying[follower] || !deckPlaying[syncMaster]) return undefined;

    const interval = window.setInterval(() => {
      const positions = deckPositionsRef.current;
      const targetPosition = syncedPositionForDeck(follower, syncMaster, deckATrack, deckBTrack, positions);
      if (targetPosition === null) return;

      const followerTrack = follower === "A" ? deckATrack : deckBTrack;
      const diffSec = Math.abs(targetPosition - positions[follower]) * followerTrack.totalSec;
      if (diffSec < 0.012) return;
      setDeckPosition(follower, targetPosition);
    }, 125);

    return () => window.clearInterval(interval);
  }, [deckATrack, deckBTrack, deckPlaying, setDeckPosition, syncEnabled, syncMaster]);

  const cycleDeckTempoRange = useCallback((deck: DeckId) => {
    const nextRange = nextTempoRange(deckTempoRanges[deck]);
    setDeckTempoRanges((current) => ({ ...current, [deck]: nextRange }));

    const clampedTempo = clamp(deckTempos[deck], -nextRange, nextRange);
    if (clampedTempo !== deckTempos[deck]) {
      setDeckTempo(deck, clampedTempo);
    }
  }, [deckTempoRanges, deckTempos, setDeckTempo]);

  useEffect(() => {
    const pending = tempoSendTimeouts.current;
    return () => {
      if (pending.A !== null) window.clearTimeout(pending.A);
      if (pending.B !== null) window.clearTimeout(pending.B);
    };
  }, []);

  const setMixerCrossfader = useCallback((value: number) => {
    setCrossfader(value);
    setAudioDeckVolume("A", deckVolumes.A * crossfadeGain("A", value)).catch(reportAudioError);
    setAudioDeckVolume("B", deckVolumes.B * crossfadeGain("B", value)).catch(reportAudioError);
  }, [deckVolumes.A, deckVolumes.B, reportAudioError]);

  const setDeckEq = useCallback((deck: DeckId, band: EqBand, value: number) => {
    const nextEq = { ...deckEq[deck], [band]: value };
    setDeckEqState((current) => ({ ...current, [deck]: nextEq }));
    setAudioDeckEq(deck, nextEq.high, nextEq.mid, nextEq.low).catch(reportAudioError);
  }, [deckEq, reportAudioError]);

  const setDeckFilter = useCallback((deck: DeckId, amount: number) => {
    setDeckFilterAmounts((current) => ({ ...current, [deck]: amount }));
    setAudioDeckFilterAmount(deck, amount).catch(reportAudioError);
  }, [reportAudioError]);

  const handleDeckCueAction = useCallback((deck: DeckId) => {
    const playing = deck === "A" ? deckPlaying.A : deckPlaying.B;
    const position = deck === "A" ? deckPositions.A : deckPositions.B;
    const cuePoint = deck === "A" ? deckCuePoints.A : deckCuePoints.B;

    if (playing) {
      setDeckPosition(deck, cuePoint);
    } else {
      setDeckCuePoints((current) => ({ ...current, [deck]: position }));
    }
  }, [deckCuePoints.A, deckCuePoints.B, deckPlaying.A, deckPlaying.B, deckPositions.A, deckPositions.B, setDeckPosition]);

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
      loadAnalysisForTrack(track)
        .then((trackWithAnalysis) => {
          setDeckATrack((current) => current.id === track.id ? trackWithAnalysis : current);
        })
        .catch(reportAudioError);
    }
  }, [ensureDeckLoaded, loadAnalysisForTrack, reportAudioError]);

  useEffect(() => {
    if (libraryStatus !== "rekordbox") return undefined;

    let cancelled = false;
    const deckATrackId = deckATrack.id;
    const deckBTrackId = deckBTrack.id;
    loadAnalysisForTrack(deckATrack)
      .then((track) => {
        if (!cancelled && track.id === deckATrackId && track !== deckATrack) {
          setDeckATrack((current) => current.id === deckATrackId ? track : current);
        }
      })
      .catch(reportAudioError);
    loadAnalysisForTrack(deckBTrack)
      .then((track) => {
        if (!cancelled && track.id === deckBTrackId && track !== deckBTrack) {
          setDeckBTrack((current) => current.id === deckBTrackId ? track : current);
        }
      })
      .catch(reportAudioError);

    return () => {
      cancelled = true;
    };
  }, [deckATrack, deckBTrack, libraryStatus, loadAnalysisForTrack, reportAudioError]);

  return (
    <DndContext
      collisionDetection={pointerWithin}
      sensors={dndSensors}
      onDragCancel={() => setActiveDragTrackId(null)}
      onDragEnd={handleDndDragEnd}
      onDragStart={handleDndDragStart}
    >
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
            onCreatePlaylist={createPlaylist}
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
            libraryWriteStatus={libraryWriteStatus}
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
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
          <PlayerDock
            deckA={{ track: deckATrack, playing: deckPlaying.A, position: deckPositions.A, levelDb: deckLevelsDb.A, syncEnabled: syncEnabled.A, syncRole: syncMaster === "A" ? "master" : "follower", tempoPercent: deckTempos.A, tempoRange: deckTempoRanges.A, volume: deckVolumes.A, eq: deckEq.A, filterAmount: deckFilterAmounts.A, cuePoint: deckCuePoints.A }}
            deckB={{ track: deckBTrack, playing: deckPlaying.B, position: deckPositions.B, levelDb: deckLevelsDb.B, syncEnabled: syncEnabled.B, syncRole: syncMaster === "B" ? "master" : "follower", tempoPercent: deckTempos.B, tempoRange: deckTempoRanges.B, volume: deckVolumes.B, eq: deckEq.B, filterAmount: deckFilterAmounts.B, cuePoint: deckCuePoints.B }}
            crossfader={crossfader}
            trackDragActive={activeDragTrackId !== null}
            onBeatSync={beatSyncDeck}
            onCycleTempoRange={cycleDeckTempoRange}
            onSetMasterDeck={setDeckAsMaster}
            onSetCrossfader={setMixerCrossfader}
            onCueAction={handleDeckCueAction}
            onSetEq={setDeckEq}
            onSetFilter={setDeckFilter}
            onSetPlaying={setDeckPlayback}
            onSetPosition={setDeckPosition}
            onSetTempo={setDeckTempo}
            onSetVolume={setDeckVolume}
            onScratchEnd={endDeckScrub}
            onScratchMove={scrubDeckPosition}
            onScratchStart={startDeckScrub}
          />
          <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] border-t border-line">
            <Sidebar
              data={data}
              currentNode={currentNode}
              setCurrentNode={setCurrentNode}
              onDropToCrate={onDropToCrate}
              onCreatePlaylist={createPlaylist}
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
              libraryWriteStatus={libraryWriteStatus}
              multiSelected={multiSelected}
              onPreview={onPreview}
              selected={selected}
              setBaseTrack={setBaseTrack}
              setFilterQuery={setFilterQuery}
              setHoveredId={setHoveredId}
              setMultiSelected={setMultiSelected}
              setSelected={setSelected}
            />
          </div>
        </div>
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
      <DragOverlay dropAnimation={null}>
        {activeDragTrack && <TrackDragOverlay track={activeDragTrack} />}
      </DragOverlay>
    </div>
    </DndContext>
  );
}

function sampleEnergyCurve(waveform: Array<[number, number]>, count: number) {
  if (waveform.length === 0) return [];

  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    const sampleIndex = Math.min(waveform.length - 1, Math.round(ratio * (waveform.length - 1)));
    return waveform[sampleIndex]?.[1] ?? 0;
  });
}

function crossfadeGain(deck: DeckId, crossfader: number) {
  const value = Math.max(-1, Math.min(1, crossfader));
  if (deck === "A") return value <= 0 ? 1 : 1 - value;
  return value >= 0 ? 1 : 1 + value;
}

function playbackRateFromTempo(tempoPercent: number) {
  return Math.max(0.05, 1 + tempoPercent / 100);
}

function estimatedDeckLevelDb(track: Track, position: number, volume: number, crossfade: number) {
  if (track.waveform.length === 0 || volume <= 0 || crossfade <= 0) return -60;

  const sampleIndex = Math.min(track.waveform.length - 1, Math.max(0, Math.round(position * (track.waveform.length - 1))));
  const peak = (track.waveform[sampleIndex]?.[1] ?? 0) * volume * crossfade;
  if (peak <= 0.000_001) return -60;

  return Math.max(-60, Math.min(6, 20 * Math.log10(peak)));
}

function smoothMeterDb(currentDb: number, targetDb: number) {
  const current = Number.isFinite(currentDb) ? currentDb : -60;
  const target = Number.isFinite(targetDb) ? targetDb : -60;
  const coefficient = target > current ? 0.55 : 0.18;

  return current + (target - current) * coefficient;
}

function TrackDragOverlay({ track }: { track: Track }) {
  return (
    <div className="pointer-events-none grid h-[30px] w-[560px] max-w-[70vw] grid-cols-[minmax(0,1fr)_110px_58px] items-center gap-3 rounded-sm border border-accent/70 bg-surface-2 px-3 text-[12px] text-text-1 shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold">{track.title}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-2">{track.artist}</span>
      <span className="text-right font-mono text-[11px] text-accent">{track.bpm > 0 ? track.bpm.toFixed(1) : "--"}</span>
    </div>
  );
}

function otherDeck(deck: DeckId): DeckId {
  return deck === "A" ? "B" : "A";
}

function deckFromDndDropId(id: string): DeckId | null {
  if (id.startsWith("deck:A")) return "A";
  if (id.startsWith("deck:B")) return "B";
  return null;
}

function deckFromDndTranslatedRect(event: DragEndEvent): DeckId | null {
  const translated = event.active.rect.current.translated;
  if (!translated) return null;

  const dock = document.querySelector<HTMLElement>("[data-player-dock-drop-region]");
  if (!dock) return null;

  const bounds = dock.getBoundingClientRect();
  const centerX = translated.left + translated.width / 2;
  const centerY = translated.top + translated.height / 2;
  if (centerX < bounds.left || centerX > bounds.right || centerY < bounds.top || centerY > bounds.bottom) {
    return null;
  }

  const waveformBottom = bounds.top + bounds.height * 0.42;
  if (centerY < waveformBottom) {
    const waveformMid = bounds.top + (waveformBottom - bounds.top) / 2;
    return centerY < waveformMid ? "A" : "B";
  }

  return centerX < bounds.left + bounds.width / 2 ? "A" : "B";
}

function nextTempoRange(currentRange: number) {
  if (currentRange === 6) return 10;
  if (currentRange === 10) return 16;
  return 6;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function syncedTempoForDeck(
  follower: DeckId,
  master: DeckId,
  deckATrack: Track,
  deckBTrack: Track,
  deckTempos: Record<DeckId, number>
) {
  const masterTrack = master === "A" ? deckATrack : deckBTrack;
  const followerTrack = follower === "A" ? deckATrack : deckBTrack;
  if (masterTrack.bpm <= 0 || followerTrack.bpm <= 0) return null;

  const masterBpm = masterTrack.bpm * playbackRateFromTempo(deckTempos[master]);
  return ((masterBpm / followerTrack.bpm) - 1) * 100;
}

function syncedPositionForDeck(
  follower: DeckId,
  master: DeckId,
  deckATrack: Track,
  deckBTrack: Track,
  deckPositions: Record<DeckId, number>
) {
  const masterTrack = master === "A" ? deckATrack : deckBTrack;
  const followerTrack = follower === "A" ? deckATrack : deckBTrack;
  const masterPositionSec = deckPositions[master] * masterTrack.totalSec;
  const followerPositionSec = deckPositions[follower] * followerTrack.totalSec;
  const masterPhase = beatPhaseAt(masterTrack, masterPositionSec);
  const followerSegment = beatSegmentAt(followerTrack, followerPositionSec);
  const nextFollowerSec = followerSegment.startSec + masterPhase * followerSegment.spanSec;

  return clamp(nextFollowerSec / followerTrack.totalSec, 0, 1);
}

function beatPhaseAt(track: Track, positionSec: number) {
  const segment = beatSegmentAt(track, positionSec);
  return clamp((positionSec - segment.startSec) / segment.spanSec, 0, 1);
}

function beatSegmentAt(track: Track, positionSec: number) {
  const beatGrid = track.beatGrid ?? [];
  if (beatGrid.length >= 2) {
    const nextIndex = beatGrid.findIndex((beat) => beat.timeSec > positionSec);
    const currentIndex = Math.max(0, nextIndex === -1 ? beatGrid.length - 2 : nextIndex - 1);
    const current = beatGrid[currentIndex];
    const next = beatGrid[Math.min(beatGrid.length - 1, currentIndex + 1)];
    return {
      startSec: current.timeSec,
      spanSec: Math.max(0.001, next.timeSec - current.timeSec)
    };
  }

  const spanSec = track.bpm > 0 ? 60 / track.bpm : 0.5;
  return {
    startSec: Math.floor(positionSec / spanSec) * spanSec,
    spanSec
  };
}

function LibraryWorkspace({
  baseTrack,
  crateMembership,
  currentNode,
  data,
  filterQuery,
  hoveredId,
  libraryWriteStatus,
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
  libraryWriteStatus: string | null;
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
  const recentTracks = useMemo(() => data.TRACKS.filter((track) => track.added.startsWith("2025")), [data.TRACKS]);
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
        <span><span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">B</span> set selected as base · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">⌘K</span> palette · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">/</span> filter · <span className="rounded-[3px] border border-line-2 bg-surface-1 px-1 py-0 text-[9px] text-text-2">drag</span> to crate or playlist</span>
        <span>{libraryWriteStatus ?? (multiSelected.size > 1 ? `${multiSelected.size} selected` : "")}</span>
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

function indexPlaylists(playlists: PlaylistEntry[]) {
  const index = new Map<string, PlaylistEntry>();
  const visit = (playlist: PlaylistEntry) => {
    index.set(playlist.id, playlist);
    playlist.children.forEach(visit);
  };
  playlists.forEach(visit);
  return index;
}

function mapTrackIds(ids: Iterable<string>, tracksById: Map<string, Track>) {
  const tracks: Track[] = [];
  for (const id of ids) {
    const track = tracksById.get(id);
    if (track) tracks.push(track);
  }
  return tracks;
}

function sortTracks(tracks: Track[], sort: SortState) {
  return [...tracks].sort(trackComparator(sort.col, sort.dir));
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
