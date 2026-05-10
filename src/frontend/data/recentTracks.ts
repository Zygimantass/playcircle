import type { Track } from "../designTypes";

const RECENT_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function recentAddedCutoff(tracks: Track[]) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const track of tracks) {
    const addedAt = parseAddedDate(track.added);
    if (addedAt > latest) latest = addedAt;
  }

  return Number.isFinite(latest) ? latest - RECENT_WINDOW_DAYS * DAY_MS : Number.POSITIVE_INFINITY;
}

export function isRecentlyAdded(track: Track, cutoff: number) {
  return parseAddedDate(track.added) >= cutoff;
}

function parseAddedDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return Number.NEGATIVE_INFINITY;
  return Date.UTC(year, month - 1, day);
}
