import type { AudioOutputDevice, AudioOutputRouting, DeckId } from "../api/audio";
import { classNames, ui } from "./common";

type SettingsPanelProps = {
  audioOutputs: AudioOutputDevice[];
  audioStatus: string;
  controllerStatus: string;
  deckCueEnabled: Record<DeckId, boolean>;
  headphoneMix: number;
  headphoneVolume: number;
  outputRouting: AudioOutputRouting;
  loadingAudioOutputs: boolean;
  masterVolume: number;
  onClose: () => void;
  onRefreshAudioOutputs: () => void;
  onSelectMasterOutput: (id: string | null) => void;
  onSelectAudioOutput: (id: string) => void;
  onSetDeckCue: (deck: DeckId, enabled: boolean) => void;
  onSetHeadphoneMix: (value: number) => void;
  onSetHeadphoneVolume: (value: number) => void;
  onSetMasterVolume: (value: number) => void;
  onSetOutputRouting: (routing: AudioOutputRouting) => void;
};

export function SettingsPanel({
  audioOutputs,
  audioStatus,
  controllerStatus,
  deckCueEnabled,
  headphoneMix,
  headphoneVolume,
  outputRouting,
  loadingAudioOutputs,
  masterVolume,
  onClose,
  onRefreshAudioOutputs,
  onSelectMasterOutput,
  onSelectAudioOutput,
  onSetDeckCue,
  onSetHeadphoneMix,
  onSetHeadphoneVolume,
  onSetMasterVolume,
  onSetOutputRouting
}: SettingsPanelProps) {
  const selectedOutput = audioOutputs.find((output) => output.selected) ?? audioOutputs[0] ?? null;
  const channelPairs = selectedOutput
    ? Array.from({ length: Math.max(1, Math.floor(selectedOutput.channels / 2)) }, (_, index) => index * 2)
    : [0];

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-8" onClick={onClose}>
      <section
        className="grid h-[min(620px,calc(100vh-64px))] w-[min(720px,calc(100vw-48px))] grid-rows-[36px_1fr] overflow-hidden rounded-md border border-line-2 bg-[#0b0c10] shadow-[0_24px_100px_rgba(0,0,0,0.65)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drag-region grid grid-cols-[1fr_auto] items-center border-b border-line bg-surface-1 px-3">
          <div className="no-drag flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-text-1">Settings</span>
            <span className={ui.kbd}>⌃⇧`</span>
          </div>
          <button className="no-drag rounded-sm px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <div className="min-h-0 overflow-auto p-4">
          <section className="grid gap-3 border-b border-line pb-4">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-[12px] font-semibold text-text-1">Audio Output</h2>
              <button className="rounded-sm border border-line bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-2 hover:bg-surface-3 hover:text-text-1" onClick={onRefreshAudioOutputs} type="button">
                {loadingAudioOutputs ? "Scanning..." : "Refresh"}
              </button>
            </div>
            <div className="grid gap-2">
              {audioOutputs.length === 0 ? (
                <div className="rounded-sm border border-line bg-surface-2 px-3 py-4 text-center text-[12px] text-text-3">No output devices found</div>
              ) : (
                audioOutputs.map((output) => (
                  <button
                    key={output.id}
                    className={classNames(
                      "grid grid-cols-[1fr_auto] items-center gap-3 rounded-sm border px-3 py-2 text-left",
                      output.selected ? "border-accent bg-accent/10" : "border-line bg-surface-2 hover:bg-surface-3"
                    )}
                    onClick={() => onSelectAudioOutput(output.id)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-text-1">{output.name}</span>
                      <span className="block font-mono text-[10px] text-text-3">{output.channels}ch · {output.sampleRate} Hz</span>
                    </span>
                    <span className={classNames("rounded-sm border px-2 py-1 font-mono text-[10px]", output.cueSupported ? "border-good/40 text-good" : "border-line-2 text-text-3")}>
                      {output.cueSupported ? "multi-channel" : "stereo"}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="font-mono text-[10px] text-text-3">
              Active: {selectedOutput ? `${selectedOutput.name} (${selectedOutput.channels}ch)` : "none"} · {audioStatus}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <RoutingSelect
                label="Master"
                pairs={channelPairs}
                value={validRoutingStart(outputRouting.masterStart, channelPairs)}
                onChange={(masterStart) => onSetOutputRouting({ ...outputRouting, masterStart })}
              />
              <RoutingSelect
                label="Phones"
                pairs={channelPairs}
                value={validRoutingStart(outputRouting.headphoneStart, channelPairs)}
                onChange={(headphoneStart) => onSetOutputRouting({ ...outputRouting, headphoneStart })}
              />
            </div>
            {outputRouting.masterStart === outputRouting.headphoneStart && (
              <div className="rounded-sm border border-line bg-surface-2 px-3 py-2 font-mono text-[10px] text-text-3">
                Master and phones are summed on the same output pair.
              </div>
            )}
            <label className="grid gap-1 font-mono text-[10px] text-text-2">
              <span>Mirror master to</span>
              <select
                className="rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-text-1 outline-none focus:border-accent"
                onChange={(event) => onSelectMasterOutput(event.currentTarget.value === "off" ? null : event.currentTarget.value)}
                value={audioOutputs.find((output) => output.masterSelected)?.id ?? "off"}
              >
                <option value="off">Off</option>
                {audioOutputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.name} ({output.channels}ch)
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="grid gap-3 border-b border-line py-4">
            <h2 className="m-0 text-[12px] font-semibold text-text-1">Monitoring</h2>
            <SettingsSlider label="Master" value={masterVolume} onChange={onSetMasterVolume} />
            <SettingsSlider label="Phones" value={headphoneVolume} onChange={onSetHeadphoneVolume} />
            <SettingsSlider label="Cue / Master" value={headphoneMix} leftLabel="Cue" rightLabel="Master" onChange={onSetHeadphoneMix} />
            <div className="grid grid-cols-2 gap-2">
              {(["A", "B"] as DeckId[]).map((deck) => (
                <button
                  key={deck}
                  className={classNames(
                    "rounded-sm border px-3 py-2 font-mono text-[11px]",
                    deckCueEnabled[deck] ? "border-accent bg-accent/15 text-accent" : "border-line bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1"
                  )}
                  onClick={() => onSetDeckCue(deck, !deckCueEnabled[deck])}
                  type="button"
                >
                  Deck {deck} CUE
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-2 pt-4">
            <h2 className="m-0 text-[12px] font-semibold text-text-1">Controller</h2>
            <div className="rounded-sm border border-line bg-surface-2 px-3 py-2 font-mono text-[10px] text-text-2">{controllerStatus}</div>
          </section>
        </div>
      </section>
    </div>
  );
}

function RoutingSelect({
  label,
  pairs,
  value,
  onChange
}: {
  label: string;
  pairs: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 font-mono text-[10px] text-text-2">
      <span>{label} pair</span>
      <select
        className="rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-text-1 outline-none focus:border-accent"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        value={value}
      >
        {pairs.map((start) => (
          <option key={start} value={start}>
            Channels {start + 1}/{start + 2}
          </option>
        ))}
      </select>
    </label>
  );
}

function validRoutingStart(start: number, pairs: number[]) {
  return pairs.includes(start) ? start : pairs[0] ?? 0;
}

function SettingsSlider({
  label,
  leftLabel,
  rightLabel,
  value,
  onChange
}: {
  label: string;
  leftLabel?: string;
  rightLabel?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[92px_minmax(0,1fr)_44px] items-center gap-3 font-mono text-[10px] text-text-2">
      <span>{label}</span>
      <span className="grid gap-1">
        <input className="accent-[var(--color-accent)]" max="1" min="0" onChange={(event) => onChange(Number(event.currentTarget.value))} step="0.01" type="range" value={value} />
        {(leftLabel || rightLabel) && (
          <span className="flex justify-between text-[9px] text-text-3">
            <span>{leftLabel}</span>
            <span>{rightLabel}</span>
          </span>
        )}
      </span>
      <span className="text-right text-text-1">{Math.round(value * 100)}</span>
    </label>
  );
}
