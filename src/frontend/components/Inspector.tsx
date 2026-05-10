import { memo } from "react";
import type { Track } from "../designTypes";
import { classNames, formatPlays, StarRating, Waveform } from "./common";

export const Inspector = memo(function Inspector({ track }: { track: Track | null }) {
  const data = window.PC_DATA;

  if (!track) {
    return (
      <aside className="flex items-center justify-center border-l border-line bg-surface-1 text-[11px] text-text-3">
        Hover or select a track
      </aside>
    );
  }

  const keyColor = data.CAMELOT_COLORS[track.key] ?? "#cdb46a";

  return (
    <aside className="overflow-y-auto border-l border-line bg-surface-1 px-3.5 py-3.5 [scrollbar-color:var(--color-line-2)_transparent] [scrollbar-width:thin]">
      <div className="mb-0.5 flex flex-col gap-px">
        <div className="text-[14px] font-semibold leading-snug text-text-1">{track.title}</div>
        <div className="text-[12px] text-text-2">{track.artist}</div>
      </div>
      <div className="mb-3.5 text-[11px] text-text-2">{track.album} · {track.year}</div>

      <Section title="WAVEFORM" meta={track.duration}>
        <Waveform track={track} />
        <div className="mt-2 flex flex-wrap gap-1">
          {track.cues.map((cue) => (
            <span key={cue.id} className="inline-flex items-center gap-1 rounded-sm border bg-surface-2 py-px pl-px pr-1.5 text-[10px]" style={{ borderColor: cue.color, color: cue.color }}>
              <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[1px] px-1 font-mono text-[9px] font-semibold text-bg" style={{ background: cue.color }}>{cue.id}</span>
              <span>{cue.label}</span>
              <span className="font-mono text-text-2">{Math.floor(cue.pos / 60)}:{String(Math.floor(cue.pos % 60)).padStart(2, "0")}</span>
            </span>
          ))}
        </div>
      </Section>

      <div className="my-3 grid grid-cols-3 gap-px overflow-hidden rounded border border-line bg-line">
        <Stat label="BPM" value={track.bpm > 0 ? track.bpm.toFixed(1) : "—"} mono />
        <Stat label="KEY" value={track.key} color={keyColor} mono />
        <Stat label="ENERGY" value={`${track.energy}/10`} mono />
        <div className="bg-surface-1 px-2 py-1.5"><div className="mb-0.5 text-[9px] font-semibold tracking-[0.1em] text-text-3">RATING</div><StarRating value={track.rating} size={10} /></div>
        <Stat label="GENRE" value={track.genre} small />
        <Stat label="PLAYS" value={formatPlays(track.plays)} mono />
      </div>

      <Section title="HARMONIC COMPATIBILITY">
        <CamelotWheel track={track} />
        <div className="mt-1.5 flex gap-3 font-mono text-[10px] text-text-2">
          <Legend color="#cdb46a" label="current" />
          <Legend color="#4ea892aa" label="compatible" />
          <Legend color="#1c1f26" label="clash" />
        </div>
      </Section>

      <Section title="TAGS" meta={`${track.fileType} · ${track.fileSize}`}>
        <div className="flex flex-wrap gap-1">
          {track.tags.map((tag) => <span key={tag} className="rounded-sm border bg-surface-2 px-1.5 py-px font-mono text-[10px]" style={{ borderColor: keyColor, color: keyColor }}>{tag}</span>)}
          <span className="rounded-sm border border-dashed border-text-4 px-1.5 py-px font-mono text-[10px] text-text-3">+ tag</span>
        </div>
      </Section>
    </aside>
  );
});

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-2.5 first:border-t-0 first:pt-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-[0.12em] text-text-3">{title}</span>
        {meta && <span className="font-mono text-[10px] text-text-2">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, color, mono, small }: { label: string; value: string; color?: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="bg-surface-1 px-2 py-1.5">
      <div className="mb-0.5 text-[9px] font-semibold tracking-[0.1em] text-text-3">{label}</div>
      <div className={classNames(small ? "text-[11px]" : "text-[13px] font-semibold", mono && "font-mono")} style={{ color }}>{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[1px] border border-transparent" style={{ background: color }} />{label}</span>;
}

function CamelotWheel({ track }: { track: Track }) {
  const data = window.PC_DATA;
  const compat = data.compatibleKeys(track.key);
  const size = 220;
  const center = size / 2;
  const radius = size / 2 - 8;

  return (
    <svg width="100%" height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {data.CAMELOT_ORDER.map((key, index) => {
        const angle = (index / data.CAMELOT_ORDER.length) * Math.PI * 2 - Math.PI / 2;
        const x = center + Math.cos(angle) * radius * 0.78;
        const y = center + Math.sin(angle) * radius * 0.78;
        const isCurrent = key === track.key;
        const isCompat = compat.has(key);
        const fill = isCurrent ? data.CAMELOT_COLORS[key] : isCompat ? `${data.CAMELOT_COLORS[key]}aa` : "#1c1f26";

        return (
          <g key={key}>
            <circle cx={x} cy={y} r={isCurrent ? 13 : 11} fill={fill} stroke={isCurrent ? "#d6d7da" : "#252830"} />
            <text x={x} y={y + 3} textAnchor="middle" fontSize="7" fill={isCurrent || isCompat ? "#0c0d10" : "#5b5e67"} style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>{key}</text>
          </g>
        );
      })}
      <circle cx={center} cy={center} r="42" fill="#0c0d10" stroke="#252830" />
      <text x={center} y={center - 4} fontSize="7" textAnchor="middle" fill="#5b5e67">HARMONIC</text>
      <text x={center} y={center + 8} fontSize="13" textAnchor="middle" fill={data.CAMELOT_COLORS[track.key]} style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>{track.key}</text>
    </svg>
  );
}
