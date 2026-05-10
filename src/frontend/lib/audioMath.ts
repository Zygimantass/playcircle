import type { DeckId } from "../api/audio";
import type { Track } from "../designTypes";

export function sampleEnergyCurve(waveform: Array<[number, number]>, count: number) {
  if (waveform.length === 0) return [];

  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0 : index / (count - 1);
    const sampleIndex = Math.min(waveform.length - 1, Math.round(ratio * (waveform.length - 1)));
    return waveform[sampleIndex]?.[1] ?? 0;
  });
}

export function crossfadeGain(deck: DeckId, crossfader: number) {
  const value = Math.max(-1, Math.min(1, crossfader));
  if (deck === "A") return value <= 0 ? 1 : 1 - value;
  return value >= 0 ? 1 : 1 + value;
}

export function playbackRateFromTempo(tempoPercent: number) {
  return Math.max(0.05, 1 + tempoPercent / 100);
}

export function estimatedDeckLevelDb(track: Track, position: number, volume: number, crossfade: number) {
  if (track.waveform.length === 0 || volume <= 0 || crossfade <= 0) return -60;

  const sampleIndex = Math.min(track.waveform.length - 1, Math.max(0, Math.round(position * (track.waveform.length - 1))));
  const peak = (track.waveform[sampleIndex]?.[1] ?? 0) * volume * crossfade;
  if (peak <= 0.000_001) return -60;

  return Math.max(-60, Math.min(6, 20 * Math.log10(peak)));
}

export function smoothMeterDb(currentDb: number, targetDb: number) {
  const current = Number.isFinite(currentDb) ? currentDb : -60;
  const target = Number.isFinite(targetDb) ? targetDb : -60;
  const coefficient = target > current ? 0.55 : 0.18;

  return current + (target - current) * coefficient;
}

export function otherDeck(deck: DeckId): DeckId {
  return deck === "A" ? "B" : "A";
}

export function nextTempoRange(currentRange: number) {
  if (currentRange === 6) return 10;
  if (currentRange === 10) return 16;
  return 6;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function syncedTempoForDeck(
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

export function syncedPositionForDeck(
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
  const masterBeat = beatAt(masterTrack, masterPositionSec);
  const followerSegment = matchingFollowerSegment(followerTrack, followerPositionSec, masterBeat);
  const nextFollowerSec = followerSegment.startSec + masterBeat.phase * followerSegment.spanSec;

  return clamp(nextFollowerSec / followerTrack.totalSec, 0, 1);
}

type BeatSegment = {
  startSec: number;
  spanSec: number;
  beatNumber: number;
  phase: number;
};

function beatAt(track: Track, positionSec: number): BeatSegment {
  const segment = beatSegmentAt(track, positionSec);
  return {
    ...segment,
    phase: clamp((positionSec - segment.startSec) / segment.spanSec, 0, 1)
  };
}

function beatSegmentAt(track: Track, positionSec: number): BeatSegment {
  const beatGrid = track.beatGrid ?? [];
  if (beatGrid.length >= 2) {
    const nextIndex = beatGrid.findIndex((beat) => beat.timeSec > positionSec);
    const currentIndex = Math.max(0, nextIndex === -1 ? beatGrid.length - 2 : nextIndex - 1);
    const current = beatGrid[currentIndex];
    const next = beatGrid[Math.min(beatGrid.length - 1, currentIndex + 1)];
    return {
      startSec: current.timeSec,
      spanSec: Math.max(0.001, next.timeSec - current.timeSec),
      beatNumber: current.beatNumber,
      phase: 0
    };
  }

  const spanSec = track.bpm > 0 ? 60 / track.bpm : 0.5;
  const beatIndex = Math.floor(positionSec / spanSec);
  return {
    startSec: Math.floor(positionSec / spanSec) * spanSec,
    spanSec,
    beatNumber: beatIndex % 4 + 1,
    phase: 0
  };
}

function matchingFollowerSegment(followerTrack: Track, followerPositionSec: number, masterBeat: BeatSegment): BeatSegment {
  const beatGrid = followerTrack.beatGrid ?? [];
  if (beatGrid.length < 2) return beatSegmentAt(followerTrack, followerPositionSec);

  const masterBeatNumber = normalizeBeatNumber(masterBeat.beatNumber);
  let bestSegment: BeatSegment | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < beatGrid.length - 1; index += 1) {
    const current = beatGrid[index];
    if (normalizeBeatNumber(current.beatNumber) !== masterBeatNumber) continue;

    const next = beatGrid[index + 1];
    const candidateStart = current.timeSec;
    const candidateSpan = Math.max(0.001, next.timeSec - current.timeSec);
    const candidateSec = candidateStart + masterBeat.phase * candidateSpan;
    const distance = Math.abs(candidateSec - followerPositionSec);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestSegment = {
        startSec: candidateStart,
        spanSec: candidateSpan,
        beatNumber: current.beatNumber,
        phase: 0
      };
    }
  }

  return bestSegment ?? beatSegmentAt(followerTrack, followerPositionSec);
}

function normalizeBeatNumber(beatNumber: number) {
  return ((Math.max(1, Math.round(beatNumber)) - 1) % 4) + 1;
}
