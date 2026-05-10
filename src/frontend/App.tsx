import { DndContext, DragOverlay, MouseSensor, pointerWithin, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { DebugWindow, type DebugTab } from "./components/DebugWindow";
import { Inspector } from "./components/Inspector";
import { LibraryWorkspace } from "./components/LibraryWorkspace";
import { PlayerDock } from "./components/PlayerDock";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { TrackDragOverlay } from "./components/TrackDragOverlay";
import { audioDeckError, audioDeckLevelDb, audioDeckPosition, endAudioDeckScrub, loadAudioDeck, loadAudioWaveform, pauseAudioDeck, playAudioDeck, scrubAudioDeckToPosition, seekAudioDeck, setAudioDeckEq, setAudioDeckFilterAmount, setAudioDeckFxChain, setAudioDeckTempo, setAudioDeckVolume, setAudioMasterVolume, startAudioDeckScrub, usesBrowserAudioFixture, type DeckId } from "./api/audio";
import type { ControllerAction } from "./api/controller";
import { addRekordboxTracksToPlaylist, createRekordboxPlaylist, loadRekordboxBeatGrid, loadRekordboxLibrary, moveRekordboxPlaylistToFolder } from "./api/rekordbox";
import { withRekordboxLibrary } from "./data/libraryMapping";
import type { CurrentNode, PcData, PlaylistEntry, Track } from "./designTypes";
import { clamp, crossfadeGain, estimatedDeckLevelDb, nextTempoRange, otherDeck, playbackRateFromTempo, sampleEnergyCurve, smoothMeterDb, syncedPositionForDeck, syncedTempoForDeck } from "./lib/audioMath";
import { CONTROLLER_FX_KINDS, adjustFxBeat, audioFxConfigForSlot, cloneControllerFxState, controllerFxTarget, createControllerFxState, deckIdFromControllerAction, defaultControllerFxSlot, fxKindLabel, fxTargetLabel, fxTimingLabel, sendControllerFxFeedback, wrapIndex, type ControllerFxDebugState, type ControllerFxState } from "./lib/controllerFx";
import { deckFromDndDropId, deckFromDndTranslatedRect } from "./lib/dnd";
import { currentNodesEqual, findPlaylist, findPlaylistParentNode, libraryBrowserNodes, movePlaylistEntry, playlistContains, recalculatePlaylistCounts, statusText, updatePlaylistEntries } from "./lib/library";
import { useControllerPolling } from "./hooks/useControllerPolling";

declare global {
  interface Window {
    PC_DATA: PcData;
  }
}

type EqBand = "high" | "mid" | "low";
type DeckEq = Record<EqBand, number>;
type LibraryFocus = "tree" | "tracks";

const CONTROLLER_JOG_SECONDS_PER_TICK = 0.012;

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
  const seekSendFrames = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const pendingSeekPositions = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const scrubSendFrames = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const pendingScrubPositions = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const deckPositionsRef = useRef(deckPositions);
  const deckPlayingRef = useRef(deckPlaying);
  const deckTempoRangesRef = useRef(deckTempoRanges);
  const deckTracksRef = useRef({ A: deckATrack, B: deckBTrack });
  const controllerJogActiveRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const controllerJogWasPlayingRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const controllerFxRef = useRef<ControllerFxState>(createControllerFxState());
  const [controllerFxDebug, setControllerFxDebug] = useState<ControllerFxDebugState>(() => cloneControllerFxState(controllerFxRef.current));
  const selectedRef = useRef(selected);
  const currentNodeRef = useRef(currentNode);
  const libraryFocusRef = useRef<LibraryFocus>("tracks");
  const libraryTracksRef = useRef<Track[]>([]);
  const [libraryFocus, setLibraryFocus] = useState<LibraryFocus>("tracks");
  const [loadedDeckPaths, setLoadedDeckPaths] = useState<{ A: string | null; B: string | null }>({ A: null, B: null });
  const [crossfader, setCrossfader] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.9);
  const [audioStatus, setAudioStatus] = useState("Rust audio engine ready");
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTab, setDebugTab] = useState<DebugTab>("midi");
  const [baseTrack, setBaseTrack] = useState<Track | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [activeDragTrackId, setActiveDragTrackId] = useState<string | null>(null);
  const [activeDragPlaylistId, setActiveDragPlaylistId] = useState<string | null>(null);
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
    deckPlayingRef.current = deckPlaying;
  }, [deckPlaying]);

  useEffect(() => {
    deckTempoRangesRef.current = deckTempoRanges;
  }, [deckTempoRanges]);

  useEffect(() => {
    deckTracksRef.current = { A: deckATrack, B: deckBTrack };
  }, [deckATrack, deckBTrack]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    currentNodeRef.current = currentNode;
  }, [currentNode]);

  useEffect(() => {
    libraryFocusRef.current = libraryFocus;
  }, [libraryFocus]);

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
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setDebugOpen((open) => !open);
        setDebugTab("midi");
      } else if (event.key === "Escape" && debugOpen) {
        event.preventDefault();
        setDebugOpen(false);
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
  }, [data.TRACKS, debugOpen, selected]);

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

  const createPlaylist = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setLibraryWriteStatus("Creating playlist...");

    if (new URLSearchParams(window.location.search).get("fixture") === "rekordbox") {
      const playlist: PlaylistEntry = {
        id: `fixture_playlist_${Date.now()}`,
        name: trimmedName,
        count: 0,
        trackIds: [],
        isFolder: false,
        children: []
      };
      setData((current) => ({ ...current, PLAYLISTS: [playlist, ...current.PLAYLISTS] }));
      setCurrentNode({ type: "playlist", id: playlist.id });
      setLibraryWriteStatus(`Created ${playlist.name}`);
      return;
    }

    createRekordboxPlaylist(trimmedName)
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

    if (new URLSearchParams(window.location.search).get("fixture") === "rekordbox") {
      let playlistName = "playlist";
      setData((current) => ({
        ...current,
        PLAYLISTS: updatePlaylistEntries(current.PLAYLISTS, playlistId, (playlist) => {
          playlistName = playlist.name;
          const existing = new Set(playlist.trackIds);
          const nextTrackIds = [
            ...playlist.trackIds,
            ...trackIds.filter((trackId) => !existing.has(trackId))
          ];
          return {
            ...playlist,
            trackIds: nextTrackIds,
            count: nextTrackIds.length
          };
        })
      }));
      setLibraryWriteStatus(`Added to ${playlistName}`);
      return;
    }

    addRekordboxTracksToPlaylist(playlistId, trackIds)
      .then((playlist) => reloadRekordboxLibrary().then(() => playlist))
      .then((playlist) => {
        setLibraryWriteStatus(`Added to ${playlist.name}`);
      })
      .catch((error) => {
        setLibraryWriteStatus(null);
        setLibraryError(error instanceof Error ? error.message : String(error));
        setLibraryStatus("error");
      });
  }, [multiSelected, reloadRekordboxLibrary]);

  const movePlaylistToFolder = useCallback((playlistId: string, folderId: string) => {
    if (playlistId === folderId) return;
    const playlist = findPlaylist(data.PLAYLISTS, playlistId);
    const folder = findPlaylist(data.PLAYLISTS, folderId);
    if (!playlist || !folder?.isFolder || playlistContains(playlist, folderId)) return;

    setLibraryWriteStatus(`Moving ${playlist.name}...`);

    if (new URLSearchParams(window.location.search).get("fixture") === "rekordbox") {
      const moved = movePlaylistEntry(data.PLAYLISTS, playlistId, folderId);
      if (!moved) {
        setLibraryWriteStatus(null);
        return;
      }
      setData((current) => ({ ...current, PLAYLISTS: recalculatePlaylistCounts(moved) }));
      setCurrentNode({ type: "playlist", id: playlistId });
      setLibraryWriteStatus(`Moved ${playlist.name} to ${folder.name}`);
      return;
    }

    moveRekordboxPlaylistToFolder(playlistId, folderId)
      .then((playlist) => reloadRekordboxLibrary().then(() => playlist))
      .then((playlist) => {
        setCurrentNode({ type: "playlist", id: playlist.id });
        setLibraryWriteStatus(`Moved ${playlist.name}`);
      })
      .catch((error) => {
        setLibraryWriteStatus(null);
        setLibraryError(error instanceof Error ? error.message : String(error));
        setLibraryStatus("error");
      });
  }, [data.PLAYLISTS, reloadRekordboxLibrary]);

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

  const selectLibraryTrack = useCallback((track: Track) => {
    setSelected(track.id);
    setMultiSelected(new Set([track.id]));
    setPreviewTrack(track);
  }, []);

  const browseLibraryTracks = useCallback((ticks: number) => {
    const tracks = libraryTracksRef.current;
    if (tracks.length === 0 || ticks === 0) return;

    const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === selectedRef.current));
    const nextIndex = clamp(currentIndex + ticks, 0, tracks.length - 1);
    selectLibraryTrack(tracks[nextIndex]);
    setLibraryFocus("tracks");
  }, [selectLibraryTrack]);

  const browseLibraryTree = useCallback((ticks: number) => {
    if (ticks === 0) return;

    const nodes = libraryBrowserNodes(data);
    if (nodes.length === 0) return;

    const currentIndex = Math.max(0, nodes.findIndex((entry) => currentNodesEqual(entry.node, currentNodeRef.current)));
    const nextIndex = clamp(currentIndex + ticks, 0, nodes.length - 1);
    const nextNode = nodes[nextIndex];

    setCurrentNode(nextNode.node);
    setLibraryFocus("tree");
    setControllerStatus(`Library: ${nextNode.label}`);
  }, [data]);

  const moveLibraryBack = useCallback(() => {
    if (libraryFocusRef.current === "tracks") {
      setLibraryFocus("tree");
      setControllerStatus("Library: tree");
      return;
    }

    const current = currentNodeRef.current;
    if (current.type === "playlist") {
      const parent = findPlaylistParentNode(data.PLAYLISTS, current.id);
      setCurrentNode(parent ?? { type: "all" });
      setControllerStatus(parent ? "Library: parent folder" : "Library: root");
      return;
    }

    setCurrentNode({ type: "all" });
    setControllerStatus("Library: root");
  }, [data.PLAYLISTS]);

  const enterLibraryNode = useCallback(() => {
    if (libraryFocusRef.current === "tracks") return;

    const current = currentNodeRef.current;
    if (current.type === "playlist") {
      const playlist = findPlaylist(data.PLAYLISTS, current.id);
      const firstChild = playlist?.children[0];
      if (playlist?.isFolder && firstChild) {
        setCurrentNode({ type: "playlist", id: firstChild.id });
        setControllerStatus(`Library: ${firstChild.name}`);
        return;
      }
    }

    setLibraryFocus("tracks");
    setControllerStatus("Library: tracks");
  }, [data.PLAYLISTS]);

  const handleLibraryBrowse = useCallback((ticks: number, shifted: boolean) => {
    if (shifted) {
      browseLibraryTree(ticks);
      return;
    }

    if (libraryFocusRef.current === "tree") browseLibraryTree(ticks);
    else browseLibraryTracks(ticks);
  }, [browseLibraryTracks, browseLibraryTree]);

  const handleLibraryBrowsePress = useCallback((shifted: boolean) => {
    if (shifted) moveLibraryBack();
    else enterLibraryNode();
  }, [enterLibraryNode, moveLibraryBack]);

  const handleVisibleTracksChange = useCallback((tracks: Track[]) => {
    libraryTracksRef.current = tracks;
  }, []);

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
    setActiveDragPlaylistId(activeId.startsWith("playlist-drag:") ? activeId.slice("playlist-drag:".length) : null);
  }, []);

  const handleDndDragEnd = useCallback((event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    setActiveDragTrackId(null);
    setActiveDragPlaylistId(null);
    if (activeId.startsWith("playlist-drag:")) {
      if (overId.startsWith("playlist-folder:")) {
        movePlaylistToFolder(
          activeId.slice("playlist-drag:".length),
          overId.slice("playlist-folder:".length)
        );
      }
      return;
    }
    if (!activeId.startsWith("track:")) return;
    const trackId = activeId.slice("track:".length);

    if (overId.startsWith("playlist:")) {
      addTracksToPlaylist(overId.slice("playlist:".length), trackId);
      return;
    }

    const deck = deckFromDndDropId(overId) ?? deckFromDndTranslatedRect(event);
    if (!deck) return;

    loadDeckByTrackId(deck, trackId);
  }, [addTracksToPlaylist, loadDeckByTrackId, movePlaylistToFolder]);

  useEffect(() => {
    type PointerDragState =
      | { type: "track"; id: string; startX: number; startY: number }
      | { type: "playlist"; id: string; startX: number; startY: number };

    let dragState: PointerDragState | null = null;

    const startDrag = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const track = target?.closest<HTMLElement>("[data-track-id]");
      if (track?.dataset.trackId) {
        dragState = { type: "track", id: track.dataset.trackId, startX: event.clientX, startY: event.clientY };
        return;
      }

      const playlist = target?.closest<HTMLElement>("[data-playlist-id][data-playlist-folder='false']");
      if (playlist?.dataset.playlistId) {
        dragState = { type: "playlist", id: playlist.dataset.playlistId, startX: event.clientX, startY: event.clientY };
      }
    };

    const finishDrag = (event: MouseEvent | PointerEvent) => {
      const state = dragState;
      dragState = null;
      if (!state) return;
      if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;

      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (state.type === "track") {
        const playlist = target?.closest<HTMLElement>("[data-playlist-id][data-playlist-folder='false']");
        if (playlist?.dataset.playlistId) {
          addTracksToPlaylist(playlist.dataset.playlistId, state.id);
          return;
        }

        const deckElement = target?.closest<HTMLElement>("[data-deck-drop]");
        const deck = deckElement?.dataset.deckDrop;
        if (deck === "A" || deck === "B") {
          loadDeckByTrackId(deck, state.id);
        }
        return;
      }

      const folder = target?.closest<HTMLElement>("[data-playlist-id][data-playlist-folder='true']");
      if (folder?.dataset.playlistId) {
        movePlaylistToFolder(state.id, folder.dataset.playlistId);
      }
    };

    window.addEventListener("pointerdown", startDrag, true);
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("mousedown", startDrag, true);
    window.addEventListener("mouseup", finishDrag, true);
    return () => {
      window.removeEventListener("pointerdown", startDrag, true);
      window.removeEventListener("pointerup", finishDrag, true);
      window.removeEventListener("mousedown", startDrag, true);
      window.removeEventListener("mouseup", finishDrag, true);
    };
  }, [addTracksToPlaylist, loadDeckByTrackId, movePlaylistToFolder]);

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

    pendingSeekPositions.current[deck] = position;
    if (seekSendFrames.current[deck] !== null) return;
    seekSendFrames.current[deck] = window.requestAnimationFrame(() => {
      seekSendFrames.current[deck] = null;
      seekAudioDeck(deck, pendingSeekPositions.current[deck]).catch(reportAudioError);
    });
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

    pendingScrubPositions.current[deck] = position;
    if (scrubSendFrames.current[deck] !== null) return;
    scrubSendFrames.current[deck] = window.requestAnimationFrame(() => {
      scrubSendFrames.current[deck] = null;
      scrubAudioDeckToPosition(deck, pendingScrubPositions.current[deck]).catch(reportAudioError);
    });
  }, [reportAudioError]);

  const endDeckScrub = useCallback((deck: DeckId, resume: boolean) => {
    const pendingFrame = scrubSendFrames.current[deck];
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      scrubSendFrames.current[deck] = null;
    }

    scrubAudioDeckToPosition(deck, deckPositionsRef.current[deck])
      .then(() => endAudioDeckScrub(deck))
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
      if (diffSec < 0.12) return;
      setDeckPosition(follower, targetPosition);
    }, 1_000);

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
    const seekFrames = seekSendFrames.current;
    const scrubFrames = scrubSendFrames.current;
    return () => {
      if (pending.A !== null) window.clearTimeout(pending.A);
      if (pending.B !== null) window.clearTimeout(pending.B);
      if (seekFrames.A !== null) window.cancelAnimationFrame(seekFrames.A);
      if (seekFrames.B !== null) window.cancelAnimationFrame(seekFrames.B);
      if (scrubFrames.A !== null) window.cancelAnimationFrame(scrubFrames.A);
      if (scrubFrames.B !== null) window.cancelAnimationFrame(scrubFrames.B);
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

  const sendControllerFxState = useCallback((state: ControllerFxState, target = state.target) => {
    const activeSlots = state.slots.filter((slot) => slot.enabled);
    const deckAEffects = target === "A" || target === "both" ? activeSlots.map((slot) => audioFxConfigForSlot(slot, deckTracksRef.current.A.bpm)) : [];
    const deckBEffects = target === "B" || target === "both" ? activeSlots.map((slot) => audioFxConfigForSlot(slot, deckTracksRef.current.B.bpm)) : [];
    setAudioDeckFxChain("A", deckAEffects).catch(reportAudioError);
    setAudioDeckFxChain("B", deckBEffects).catch(reportAudioError);
  }, [reportAudioError]);

  const updateControllerFxState = useCallback((update: (state: ControllerFxState) => void, send = true) => {
    const state: ControllerFxState = {
      ...controllerFxRef.current,
      slots: controllerFxRef.current.slots.map((slot) => ({ ...slot }))
    };
    update(state);
    state.focusIndex = wrapIndex(state.focusIndex, state.slots.length);
    controllerFxRef.current = state;
    setControllerFxDebug(cloneControllerFxState(state));
    const focusedSlot = state.slots[state.focusIndex];
    setControllerStatus(`FX ${state.focusIndex + 1}: ${fxKindLabel(focusedSlot.kind)} ${focusedSlot.enabled ? "on" : "off"} · ${fxTargetLabel(state.target)} · ${fxTimingLabel(focusedSlot, controllerFxBpm(state, deckTracksRef.current))} · ${Math.round(focusedSlot.mix * 100)}%`);
    sendControllerFxFeedback(state);
    if (send) sendControllerFxState(state);
  }, [sendControllerFxState]);

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

  const moveDeckByJogTicks = useCallback((deck: DeckId, ticks: number) => {
    if (ticks === 0) return;

    const track = deckTracksRef.current[deck];
    const position = deckPositionsRef.current[deck];
    const nextPosition = clamp(
      position + (ticks * CONTROLLER_JOG_SECONDS_PER_TICK) / Math.max(1, track.totalSec),
      0,
      1
    );

    if (controllerJogActiveRef.current[deck]) {
      scrubDeckPosition(deck, nextPosition);
    } else {
      setDeckPosition(deck, nextPosition);
    }
  }, [scrubDeckPosition, setDeckPosition]);

  const handleControllerAction = useCallback((action: ControllerAction) => {
    const deck = deckIdFromControllerAction(action);

    switch (action.type) {
      case "playPause":
        if (action.pressed) setDeckPlayback(deck, !deckPlayingRef.current[deck]);
        break;
      case "cue":
        if (action.pressed) handleDeckCueAction(deck);
        break;
      case "loadSelected":
        loadDeckByTrackId(deck, selectedRef.current);
        break;
      case "browse":
        handleLibraryBrowse(action.ticks, action.shifted);
        break;
      case "browsePress":
        if (action.pressed) handleLibraryBrowsePress(action.shifted);
        break;
      case "beatSync":
        if (action.pressed) beatSyncDeck(deck);
        break;
      case "tempoRange":
        if (action.pressed) cycleDeckTempoRange(deck);
        break;
      case "tempo": {
        const range = deckTempoRangesRef.current[deck];
        setDeckTempo(deck, Number((action.value * range).toFixed(1)));
        break;
      }
      case "volume":
        setDeckVolume(deck, action.value);
        break;
      case "eq":
        setDeckEq(deck, action.band, action.value);
        break;
      case "filter":
        setDeckFilter(deck, action.value);
        break;
      case "crossfader":
        setMixerCrossfader(action.value * 2 - 1);
        break;
      case "hotCue":
        break;
      case "fxSelect":
        if (action.pressed) {
          updateControllerFxState((state) => {
            const slot = state.slots[state.focusIndex];
            const currentKindIndex = CONTROLLER_FX_KINDS.indexOf(slot.kind);
            const nextKind = CONTROLLER_FX_KINDS[wrapIndex(currentKindIndex + action.direction, CONTROLLER_FX_KINDS.length)];
            state.slots[state.focusIndex] = {
              ...defaultControllerFxSlot(nextKind),
              enabled: slot.enabled,
              mix: slot.mix
            };
          });
        }
        break;
      case "fxBeat":
        if (action.pressed) {
          updateControllerFxState((state) => {
            state.slots[state.focusIndex] = adjustFxBeat(state.slots[state.focusIndex], action.direction);
          });
        }
        break;
      case "fxTarget":
        updateControllerFxState((state) => {
          state.target = controllerFxTarget(action.target);
        });
        break;
      case "fxDepth":
        updateControllerFxState((state) => {
          state.slots[state.focusIndex].mix = clamp(action.value, 0, 1);
        });
        break;
      case "fxToggle":
        if (action.pressed) {
          updateControllerFxState((state) => {
            const slot = state.slots[state.focusIndex];
            slot.enabled = !slot.enabled;
          });
        }
        break;
      case "fxClear":
        if (action.pressed) {
          updateControllerFxState((state) => {
            state.slots.forEach((slot) => {
              slot.enabled = false;
            });
          });
        }
        break;
      case "jogTouch":
        if (action.pressed) {
          controllerJogActiveRef.current[deck] = true;
          controllerJogWasPlayingRef.current[deck] = deckPlayingRef.current[deck];
          startDeckScrub(deck);
        } else {
          controllerJogActiveRef.current[deck] = false;
          endDeckScrub(deck, controllerJogWasPlayingRef.current[deck]);
        }
        break;
      case "jog":
        moveDeckByJogTicks(deck, action.ticks);
        break;
      case "raw":
        break;
    }
  }, [beatSyncDeck, cycleDeckTempoRange, endDeckScrub, handleDeckCueAction, handleLibraryBrowse, handleLibraryBrowsePress, loadDeckByTrackId, moveDeckByJogTicks, setDeckEq, setDeckFilter, setDeckPlayback, setDeckTempo, setDeckVolume, setMixerCrossfader, startDeckScrub, updateControllerFxState]);

  const { clearMidiDebugEvents, controllerStatus, midiDebugEvents, setControllerStatus } = useControllerPolling(handleControllerAction);

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
      onDragCancel={() => {
        setActiveDragTrackId(null);
        setActiveDragPlaylistId(null);
      }}
      onDragEnd={handleDndDragEnd}
      onDragStart={handleDndDragStart}
    >
    <div className="grid h-screen grid-rows-[32px_1fr] bg-bg" data-screen-label={mode === "library" ? "Library" : "Mix"}>
      <TopBar
        mode={mode}
        onSearchClick={openPalette}
        query={paletteQuery || `${statusText(libraryStatus, data.TRACKS.length, libraryError)} · ${controllerStatus}`}
        setMode={setMode}
      />
      {mode === "library" ? (
        <div className="grid min-h-0 grid-cols-[220px_1fr_304px]">
          <Sidebar
            data={data}
            currentNode={currentNode}
            focused={libraryFocus === "tree"}
            setCurrentNode={setCurrentNode}
            onDropToCrate={onDropToCrate}
            onCreatePlaylist={createPlaylist}
            onMovePlaylistToFolder={movePlaylistToFolder}
            playlistDragActive={activeDragPlaylistId !== null}
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
            libraryFocused={libraryFocus === "tracks"}
            multiSelected={multiSelected}
            onPreview={onPreview}
            onVisibleTracksChange={handleVisibleTracksChange}
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
              focused={libraryFocus === "tree"}
              setCurrentNode={setCurrentNode}
              onDropToCrate={onDropToCrate}
              onCreatePlaylist={createPlaylist}
              onMovePlaylistToFolder={movePlaylistToFolder}
              playlistDragActive={activeDragPlaylistId !== null}
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
              libraryFocused={libraryFocus === "tracks"}
              multiSelected={multiSelected}
              onPreview={onPreview}
              onVisibleTracksChange={handleVisibleTracksChange}
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
        <CommandPalette
          query={paletteQuery}
          tracks={data.TRACKS}
          onClose={() => setPaletteOpen(false)}
          onQueryChange={setPaletteQuery}
          onSelectTrack={(track) => {
            setPreviewTrack(track);
            setSelected(track.id);
            setPaletteOpen(false);
          }}
        />
      )}
      {debugOpen && (
        <DebugWindow
          activeTab={debugTab}
          controllerStatus={controllerStatus}
          fxState={controllerFxDebug}
          midiEvents={midiDebugEvents}
          onClearMidi={clearMidiDebugEvents}
          onClose={() => setDebugOpen(false)}
          onSetTab={setDebugTab}
        />
      )}
      <DragOverlay dropAnimation={null}>
        {activeDragTrack && <TrackDragOverlay track={activeDragTrack} />}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
