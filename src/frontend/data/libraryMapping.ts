import type { RekordboxLibraryDto, RekordboxPlaylistDto, RekordboxTrackDto } from "../api/rekordbox";
import type { PcData, PlaylistEntry, SidebarEntry, TagEntry, Track } from "../designTypes";

const crateColors = ["#c99a3d", "#4ea892", "#8e72c2", "#c95a72", "#5b5e67"];
const fallbackKeys = ["1A", "2A", "4A", "5A", "7A", "8A", "9A", "11A", "12A"];

export function withRekordboxTracks(base: PcData, rekordboxTracks: RekordboxTrackDto[]): PcData {
  return withRekordboxLibrary(base, { tracks: rekordboxTracks, playlists: [] });
}

export function withRekordboxLibrary(base: PcData, rekordboxLibrary: RekordboxLibraryDto): PcData {
  const rekordboxTracks = rekordboxLibrary.tracks;
  const tracks = rekordboxTracks.map(toUiTrack);
  return {
    ...base,
    TRACKS: tracks,
    CRATES: buildGenreCrates(tracks),
    PLAYLISTS: buildPlaylistTree(rekordboxLibrary.playlists),
    SMART: [
      { id: "sm_1", name: "5★ tracks", count: tracks.filter((track) => track.rating === 5).length },
      { id: "sm_2", name: "Unanalyzed", count: tracks.filter((track) => !track.analyzed).length },
      { id: "sm_3", name: "120–126 BPM, A", count: tracks.filter((track) => track.bpm >= 120 && track.bpm <= 126 && track.key.endsWith("A")).length },
      { id: "sm_4", name: "Played < 5x", count: tracks.filter((track) => track.plays < 5).length }
    ],
    TAGS: buildTags(tracks)
  };
}

function buildPlaylistTree(playlists: RekordboxPlaylistDto[]): PlaylistEntry[] {
  const entries = new Map<string, PlaylistEntry>();
  const roots: PlaylistEntry[] = [];

  for (const playlist of playlists) {
    entries.set(playlist.id, {
      id: playlist.id,
      name: playlist.name || "Untitled Playlist",
      count: playlist.track_ids.length,
      trackIds: playlist.track_ids,
      isFolder: playlist.is_folder,
      children: []
    });
  }

  for (const playlist of playlists) {
    const entry = entries.get(playlist.id);
    if (!entry) continue;

    const parent = playlist.parent_id ? entries.get(playlist.parent_id) : null;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }

  for (const root of roots) updatePlaylistCount(root);

  return roots;
}

function updatePlaylistCount(playlist: PlaylistEntry) {
  let count = playlist.trackIds.length;
  for (const child of playlist.children) {
    count += updatePlaylistCount(child);
  }
  playlist.count = count;
  return count;
}

function toUiTrack(track: RekordboxTrackDto, index: number): Track {
  const totalSec = track.length_seconds ?? 0;
  const bpm = track.bpm ?? 0;
  const key = normalizeKey(track.key, index);
  const title = track.title || track.file_name || `Track ${track.id}`;
  const genre = track.genre || "Unknown";
  const tags = [genre.toLowerCase().replace(/\s+/g, "-")];

  if (track.file_type_name) tags.push(track.file_type_name.toLowerCase());
  if (!track.analyzed) tags.push("unanalyzed");

  const uiTrack: Track = {
    id: track.id,
    title,
    artist: track.artist || "Unknown Artist",
    album: track.album || "Unknown Album",
    genre,
    bpm,
    key,
    duration: formatDuration(totalSec),
    totalSec: Math.max(totalSec, 1),
    energy: estimateEnergy(track, index),
    year: track.release_year || yearFromDate(track.date_created) || 0,
    rating: normalizeRating(track.rating),
    tags,
    added: normalizeDate(track.date_created) || "1970-01-01",
    plays: track.play_count ?? 0,
    bitrate: track.bitrate ?? 0,
    fileType: track.file_type_name || `TYPE ${track.file_type ?? "?"}`,
    filePath: track.file_path,
    analysisDataPath: track.analysis_data_path,
    fileSize: formatFileSize(track.file_size),
    waveform: makeWaveform(index * 137 + 7),
    energyCurve: makeEnergyCurve(index * 91 + 13),
    cues: [],
    beatGrid: (track.beat_grid ?? []).map((beat) => ({
      timeSec: beat.time_seconds,
      beatNumber: beat.beat_number,
      bpm: beat.bpm
    })),
    analyzed: track.analyzed
  };
  uiTrack.sortKeys = buildSortKeys(uiTrack);
  return uiTrack;
}

function buildSortKeys(track: Track) {
  return {
    title: textSortKey(track.title),
    artist: textSortKey(track.artist),
    album: textSortKey(track.album),
    genre: textSortKey(track.genre),
    bpm: track.bpm,
    key: textSortKey(track.key),
    duration: track.totalSec,
    energy: track.energy,
    rating: track.rating,
    plays: track.plays,
    added: track.added,
    fileType: textSortKey(track.fileType)
  };
}

function textSortKey(value: string) {
  return value.toLocaleLowerCase();
}

function buildGenreCrates(tracks: Track[]): SidebarEntry[] {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    counts.set(track.genre, (counts.get(track.genre) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count], index) => ({
      id: `genre_${slug(name)}`,
      name,
      count,
      color: crateColors[index % crateColors.length]
    }));
}

function buildTags(tracks: Track[]): TagEntry[] {
  const uniqueTags = new Set(tracks.flatMap((track) => track.tags));
  return [...uniqueTags].slice(0, 12).map((label, index) => ({
    id: `tag_${slug(label)}`,
    label,
    color: crateColors[index % crateColors.length]
  }));
}

function normalizeKey(key: string | null, index: number) {
  if (!key || key.trim() === "") return fallbackKeys[index % fallbackKeys.length];
  return key.trim();
}

function normalizeRating(rating: number | null) {
  if (!rating) return 0;
  return Math.max(0, Math.min(5, rating));
}

function estimateEnergy(track: RekordboxTrackDto, index: number) {
  if (!track.bpm || track.bpm <= 0) return 1 + (index % 3);
  if (track.bpm >= 170) return 9;
  if (track.bpm >= 130) return 8;
  if (track.bpm >= 124) return 7;
  if (track.bpm >= 116) return 6;
  if (track.bpm >= 90) return 5;
  return 3;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "—";
  const mb = bytes / 1_000_000;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function normalizeDate(value: string | null) {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function yearFromDate(value: string | null) {
  const date = normalizeDate(value);
  return date ? Number(date.slice(0, 4)) : null;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unknown";
}

function makeWaveform(seed: number, length = 256): Array<[number, number]> {
  let state = seed;
  const rand = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };

  return Array.from({ length }, (_, index) => {
    const sectionEnergy = 0.35 + 0.55 * Math.abs(Math.sin((index / length) * Math.PI * 2.6));
    const beat = index % 4 === 0 ? 0.12 : 0;
    const high = Math.max(0.05, Math.min(1, sectionEnergy + (rand() - 0.5) * 0.28 + beat));
    const low = Math.max(0.02, high * (0.4 + rand() * 0.4));
    return [low, high];
  });
}

function makeEnergyCurve(seed: number) {
  return makeWaveform(seed, 24).map(([, high]) => high);
}
