import type { Track } from "../designTypes";

const BEATS_PER_BAR = 4;
export const DEFAULT_BEAT_WAVEFORM_BEATS = 16 * BEATS_PER_BAR;
const BEAT_WAVEFORM_SAMPLES = 640;

export function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

export const ui = {
  kbd: "rounded-[3px] border border-line-2 bg-surface-1 px-1.5 py-px font-mono text-[10px] tracking-[0.02em] text-text-2",
  dim: "text-text-3",
  dim2: "text-text-2",
  sectionHead: "flex h-[22px] items-center gap-1 px-3 text-[10px] font-semibold tracking-[0.08em] text-text-3 hover:text-text-2",
  sideItem: "flex h-[22px] items-center gap-1.5 border-l-2 border-transparent py-[3px] pl-6 pr-3 text-left text-[12px] text-text-1 hover:bg-surface-2",
  activeSideItem: "border-l-accent bg-surface-3",
  tableCell: "flex h-[26px] items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-[12px]",
  tableHead: "flex h-6 items-center gap-0.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-3"
};

export function formatPlays(value: number) {
  return value === 0 ? "—" : String(value);
}

export function StarRating({ value, size = 9 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center">
      {Array.from({ length: 5 }, (_, index) => {
        const filled = index < Math.floor(value);
        return (
          <svg key={index} width={size} height={size} viewBox="0 0 10 10" className="mr-px">
            <path
              d="M5 1 L6.2 3.7 L9 4 L7 6 L7.5 9 L5 7.5 L2.5 9 L3 6 L1 4 L3.8 3.7 Z"
              fill={filled ? "#cdb46a" : "#2c2f37"}
            />
          </svg>
        );
      })}
    </span>
  );
}

export function EnergySpark({ track, highlight = false }: { track: Track; highlight?: boolean }) {
  const width = 56;
  const height = 14;
  const color = track.energy >= 8 ? "#c95a72" : track.energy >= 6 ? "#cdb46a" : track.energy >= 4 ? "#4ea892" : "#5b5e67";
  const points = track.energyCurve
    .map((value, index) => {
      const x = (index / Math.max(1, track.energyCurve.length - 1)) * width;
      const y = height - value * (height - 1) - 0.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline points={points} fill="none" stroke={highlight ? "#cdb46a" : color} strokeWidth={highlight ? 1.2 : 1} />
    </svg>
  );
}

export function EnergyBars({ value, color }: { value: number; color: string }) {
  const active = Math.max(1, Math.min(5, Math.round(value / 2)));
  return (
    <span className="flex items-center gap-px">
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className="h-2 w-1 rounded-[1px]"
          style={{ background: index < active ? color : "#2c2f37" }}
        />
      ))}
    </span>
  );
}

export function Waveform({
  track,
  height = 56,
  playhead = 0.32,
  variant = "beat",
  showBeatGrid = false,
  beatWindowBeats = DEFAULT_BEAT_WAVEFORM_BEATS,
  beatWindowSeconds
}: {
  track: Track;
  height?: number | string;
  playhead?: number;
  variant?: "beat" | "overview";
  showBeatGrid?: boolean;
  beatWindowBeats?: number;
  beatWindowSeconds?: number;
}) {
  const width = 280;
  const viewBoxHeight = typeof height === "number" ? height : 100;
  const middle = viewBoxHeight / 2;
  const isOverview = variant === "overview";
  const currentSec = Math.max(0, Math.min(track.totalSec, playhead * track.totalSec));
  const beatGrid = showBeatGrid ? track.beatGrid ?? [] : [];
  const windowRange = isOverview
    ? { startSec: 0, endSec: track.totalSec }
    : beatWaveformWindow(track, beatGrid, currentSec, beatWindowBeats, beatWindowSeconds);
  const windowSpan = Math.max(0.001, windowRange.endSec - windowRange.startSec);
  const playheadX = isOverview ? playhead * width : width / 2;
  const rawDisplaySamples = isOverview
    ? track.waveform.map(([low, high], index) => ({
        low,
        high,
        x: index * (width / track.waveform.length),
        sampleSec: (index / Math.max(1, track.waveform.length - 1)) * track.totalSec
      }))
    : Array.from({ length: BEAT_WAVEFORM_SAMPLES }, (_, index) => {
        const ratio = index / (BEAT_WAVEFORM_SAMPLES - 1);
        const sampleSec = windowRange.startSec + ratio * windowSpan;
        const [low, high] = waveformSample(track, beatGrid, sampleSec);
        return {
          low,
          high,
          x: ratio * width,
          sampleSec
        };
      });
  const displayBars = rawDisplaySamples;
  const scale = isOverview ? 0.82 : 1;
  const waveformBands = displayBars.map(({ low, high, x, sampleSec }) => {
    if (!isOverview && (sampleSec < 0 || sampleSec > track.totalSec)) {
      return {
        x,
        low: 0,
        mid: 0,
        high: 0
      };
    }

    const bass = Math.max(0.04, low);
    const mid = Math.max(0.04, (low + high) / 2);
    const treble = Math.max(0.04, high * (0.65 + deterministicNoise(sampleSec, 17) * 0.1));
    const highAmp = treble * middle * 0.36 * scale;
    const midAmp = Math.max(mid * middle * 0.58 * scale, highAmp * 1.18);
    const lowAmp = Math.max(bass * middle * 0.9 * scale, midAmp * 1.16);

    return {
      x,
      low: Math.min(middle * 0.94, lowAmp),
      mid: Math.min(middle * 0.78, midAmp),
      high: Math.min(middle * 0.52, highAmp)
    };
  });
  const bandColors = {
    low: "#2f7de1",
    mid: "#f08a3c",
    high: "#d8ca72"
  };
  const bandPaths = {
    low: waveformBandPath(waveformBands, (sample) => sample.low, (sample) => sample.mid, middle),
    mid: waveformBandPath(waveformBands, (sample) => sample.mid, (sample) => sample.high, middle),
    high: waveformAreaPath(waveformBands, (sample) => sample.high, middle)
  };

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${viewBoxHeight}`} preserveAspectRatio="none" className="block">
      <rect x="0" y="0" width={width} height={viewBoxHeight} fill={isOverview ? "#090a0d" : "#07080b"} />
      <line x1="0" y1={middle} x2={width} y2={middle} stroke="#252830" strokeWidth={isOverview ? "0.7" : "1"} />
      <path d={bandPaths.low} fill={bandColors.low} opacity={isOverview ? 0.86 : 0.98} />
      <path d={bandPaths.mid} fill={bandColors.mid} opacity={isOverview ? 0.9 : 1} />
      <path d={bandPaths.high} fill={bandColors.high} opacity={isOverview ? 0.92 : 1} />
      {!isOverview && <BeatGridMarkers beatGrid={beatGrid} width={width} height={viewBoxHeight} windowRange={windowRange} windowSpan={windowSpan} />}
      {isOverview && <OverviewBeatMarkers beatGrid={beatGrid} width={width} height={viewBoxHeight} totalSec={track.totalSec} />}
      {track.cues.map((cue) => {
        const x = isOverview
          ? (cue.pos / track.totalSec) * width
          : ((cue.pos - windowRange.startSec) / windowSpan) * width;
        if (x < 0 || x > width) return null;
        return <line key={cue.id} x1={x} y1={2} x2={x} y2={viewBoxHeight - 2} stroke={cue.color} strokeWidth="1" opacity="0.85" />;
      })}
      <line x1={playheadX} y1={0} x2={playheadX} y2={viewBoxHeight} stroke="#ff3b30" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BeatGridMarkers({
  beatGrid,
  width,
  height,
  windowRange,
  windowSpan
}: {
  beatGrid: NonNullable<Track["beatGrid"]>;
  width: number;
  height: number;
  windowRange: { startSec: number; endSec: number };
  windowSpan: number;
}) {
  return (
    <g>
      {beatGrid.map((beat, index) => {
        const x = ((beat.timeSec - windowRange.startSec) / windowSpan) * width;
        if (x < 0 || x > width) return null;

        const bar = beat.beatNumber === 1;

        return (
          <line
            key={`beat-${index}`}
            x1={x}
            y1={0}
            x2={x}
            y2={height}
            stroke={bar ? "#ffffff" : "#8d929c"}
            strokeWidth="1"
            opacity={bar ? "0.96" : "0.38"}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

function OverviewBeatMarkers({
  beatGrid,
  width,
  height,
  totalSec
}: {
  beatGrid: NonNullable<Track["beatGrid"]>;
  width: number;
  height: number;
  totalSec: number;
}) {
  return (
    <g>
      {beatGrid.map((beat, index) => {
        if (beat.beatNumber !== 1) return null;
        const x = (beat.timeSec / totalSec) * width;
        if (x < 0 || x > width) return null;

        return (
          <line
            key={`overview-bar-${index}`}
            x1={x}
            y1={0}
            x2={x}
            y2={height}
            stroke="#ffffff"
            strokeWidth="1"
            opacity="0.46"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

export function waveformClickPosition(
  track: Track,
  playhead: number,
  clickRatio: number,
  variant: "beat" | "overview",
  beatWindowBeats = DEFAULT_BEAT_WAVEFORM_BEATS,
  beatWindowSeconds?: number
) {
  const boundedClick = Math.max(0, Math.min(1, clickRatio));
  if (variant === "overview") return boundedClick;

  const currentSec = Math.max(0, Math.min(track.totalSec, playhead * track.totalSec));
  const windowRange = beatWaveformWindow(track, track.beatGrid ?? [], currentSec, beatWindowBeats, beatWindowSeconds);
  const windowSpan = Math.max(0.001, windowRange.endSec - windowRange.startSec);
  const nextSec = windowRange.startSec + boundedClick * windowSpan;

  return Math.max(0, Math.min(1, nextSec / track.totalSec));
}

function waveformAreaPath<T extends { x: number }>(
  samples: T[],
  amplitude: (sample: T) => number,
  middle: number
) {
  if (samples.length === 0) return "";

  const top = samples.map((sample) => ({ x: sample.x, y: middle - amplitude(sample) }));
  const bottom = [...samples].reverse().map((sample) => ({ x: sample.x, y: middle + amplitude(sample) }));

  return `${linearPath(top)} L ${point(bottom[0])} ${linearPath(bottom).replace(/^M [^L]+/, "")} Z`;
}

function waveformBandPath<T extends { x: number }>(
  samples: T[],
  outerAmplitude: (sample: T) => number,
  innerAmplitude: (sample: T) => number,
  middle: number
) {
  if (samples.length === 0) return "";

  const outerTop = samples.map((sample) => ({ x: sample.x, y: middle - outerAmplitude(sample) }));
  const innerTop = [...samples].reverse().map((sample) => ({ x: sample.x, y: middle - innerAmplitude(sample) }));
  const outerBottom = samples.map((sample) => ({ x: sample.x, y: middle + outerAmplitude(sample) }));
  const innerBottom = [...samples].reverse().map((sample) => ({ x: sample.x, y: middle + innerAmplitude(sample) }));

  return [
    `${linearPath(outerTop)} L ${point(innerTop[0])} ${linearPath(innerTop).replace(/^M [^L]+/, "")} Z`,
    `${linearPath(outerBottom)} L ${point(innerBottom[0])} ${linearPath(innerBottom).replace(/^M [^L]+/, "")} Z`
  ].join(" ");
}

function linearPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 1) return `M ${point(points[0])}`;

  const commands = [`M ${point(points[0])}`];
  for (let index = 1; index < points.length; index += 1) {
    commands.push(`L ${point(points[index])}`);
  }

  return commands.join(" ");
}

function point(point: { x: number; y: number }) {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function beatWaveformWindow(
  track: Track,
  beatGrid: NonNullable<Track["beatGrid"]>,
  currentSec: number,
  beatWindowBeats: number,
  beatWindowSeconds?: number
) {
  const displayBeats = Math.max(1, Math.floor(beatWindowBeats));
  const beatInterval = track.bpm > 0 ? 60 / track.bpm : 0.5;
  let span = beatWindowSeconds !== undefined && Number.isFinite(beatWindowSeconds) && beatWindowSeconds > 0
    ? beatWindowSeconds
    : beatInterval * displayBeats;

  if (beatWindowSeconds === undefined && beatGrid.length >= 2) {
    const nextBeatIndex = beatGrid.findIndex((beat) => beat.timeSec >= currentSec);
    const centerIndex = nextBeatIndex === -1 ? beatGrid.length - 1 : nextBeatIndex;
    const beatsBeforePlayhead = Math.floor(displayBeats / 2);
    const startIndex = Math.max(0, centerIndex - beatsBeforePlayhead);
    const endIndex = Math.min(beatGrid.length - 1, startIndex + displayBeats);
    const adjustedStartIndex = Math.max(0, endIndex - displayBeats);
    const startSec = beatGrid[adjustedStartIndex]?.timeSec;
    const endSec = beatGrid[endIndex]?.timeSec;

    if (startSec !== undefined && endSec !== undefined && endSec > startSec) {
      span = endSec - startSec;
    }
  }

  return { startSec: currentSec - span / 2, endSec: currentSec + span / 2 };
}

function interpolatedWaveformSample(track: Track, sampleSec: number): [number, number] {
  const position = Math.max(0, Math.min(1, sampleSec / track.totalSec)) * (track.waveform.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(track.waveform.length - 1, leftIndex + 1);
  const mix = position - leftIndex;
  const left = track.waveform[leftIndex] ?? [0.1, 0.1];
  const right = track.waveform[rightIndex] ?? left;

  return [
    left[0] + (right[0] - left[0]) * mix,
    left[1] + (right[1] - left[1]) * mix
  ];
}

function texturedWaveformSample(track: Track, beatGrid: NonNullable<Track["beatGrid"]>, sampleSec: number): [number, number] {
  const [sourceLow, sourceHigh] = interpolatedWaveformSample(track, sampleSec);
  const beat = beatPosition(track, beatGrid, sampleSec);
  const sixteenth = beat.phase * 4;
  const sixteenthPhase = sixteenth - Math.floor(sixteenth);
  const beatPulse = pulseDistance(beat.phase, 0, 0.05) * 0.18;
  const sixteenthPulse = pulseDistance(sixteenthPhase, 0, 0.08) * 0.08;
  const offbeatPulse = pulseDistance(beat.phase, 0.5, 0.12) * 0.07;
  const lowTexture = 0.9 + deterministicNoise(sampleSec, 3) * 0.12 + deterministicNoise(sampleSec, 7) * 0.06;
  const highTexture = 0.88 + deterministicNoise(sampleSec, 11) * 0.18 + deterministicNoise(sampleSec, 23) * 0.08;
  const downbeat = beat.beatNumber === 1 ? 1.05 : 1;
  const low = Math.max(0.04, Math.min(1, (sourceLow * 0.72 + beatPulse + offbeatPulse) * lowTexture * downbeat));
  const high = Math.max(0.05, Math.min(1, sourceHigh * highTexture + sixteenthPulse + beatPulse * 0.24));

  return [low, high];
}

function waveformSample(track: Track, beatGrid: NonNullable<Track["beatGrid"]>, sampleSec: number): [number, number] {
  if (track.waveformSource === "audio") return interpolatedWaveformSample(track, sampleSec);

  return texturedWaveformSample(track, beatGrid, sampleSec);
}

function beatPosition(track: Track, beatGrid: NonNullable<Track["beatGrid"]>, sampleSec: number) {
  if (beatGrid.length >= 2) {
    const nextIndex = beatGrid.findIndex((beat) => beat.timeSec > sampleSec);
    const currentIndex = Math.max(0, nextIndex === -1 ? beatGrid.length - 2 : nextIndex - 1);
    const current = beatGrid[currentIndex];
    const next = beatGrid[Math.min(beatGrid.length - 1, currentIndex + 1)];
    const span = Math.max(0.001, next.timeSec - current.timeSec);

    return {
      phase: Math.max(0, Math.min(1, (sampleSec - current.timeSec) / span)),
      beatNumber: current.beatNumber
    };
  }

  const interval = track.bpm > 0 ? 60 / track.bpm : 0.5;
  const absoluteBeat = sampleSec / interval;
  return {
    phase: absoluteBeat - Math.floor(absoluteBeat),
    beatNumber: (Math.floor(absoluteBeat) % 4) + 1
  };
}

function pulseDistance(phase: number, center: number, width: number) {
  const distance = Math.min(Math.abs(phase - center), 1 - Math.abs(phase - center));
  return Math.exp(-(distance * distance) / (2 * width * width));
}

function deterministicNoise(sampleSec: number, seed: number) {
  return Math.sin(sampleSec * (18.7 + seed * 2.31) + seed * 5.17);
}
