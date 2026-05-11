import type { ControllerEvent } from "../api/controller";
import type { ControllerFxDebugState } from "../lib/controllerFx";
import { formatFxValue, fxDeckChainLabel, fxKindLabel, fxTargetLabel, fxTimingLabel } from "../lib/controllerFx";
import { classNames } from "./common";

export type DebugTab = "midi";
export type MidiDebugEvent = ControllerEvent & {
  id: number;
  receivedAt: number;
};

type DebugWindowProps = {
  activeTab: DebugTab;
  controllerStatus: string;
  fxState: ControllerFxDebugState;
  midiEvents: MidiDebugEvent[];
  onClearMidi: () => void;
  onClose: () => void;
  onSetTab: (tab: DebugTab) => void;
};

export function DebugWindow({
  activeTab,
  controllerStatus,
  fxState,
  midiEvents,
  onClearMidi,
  onClose,
  onSetTab
}: DebugWindowProps) {
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-8">
      <section className="grid h-[min(680px,calc(100vh-64px))] w-[min(1040px,calc(100vw-64px))] grid-rows-[36px_1fr] overflow-hidden rounded-md border border-line-2 bg-[#0b0c10] shadow-[0_24px_100px_rgba(0,0,0,0.65)]">
        <header className="drag-region grid grid-cols-[1fr_auto] items-center border-b border-line bg-surface-1 px-3">
          <div className="no-drag flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-text-1">Debug</span>
            <button
              className={classNames("rounded-sm px-2 py-1 text-[11px]", activeTab === "midi" ? "bg-surface-3 text-text-1" : "text-text-3 hover:bg-surface-2 hover:text-text-1")}
              onClick={() => onSetTab("midi")}
              type="button"
            >
              MIDI events
            </button>
          </div>
          <button className="no-drag rounded-sm px-2 py-1 text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1" onClick={onClose} type="button">
            Close
          </button>
        </header>
        {activeTab === "midi" && (
          <div className="grid min-h-0 grid-rows-[34px_auto_1fr]">
            <div className="flex items-center justify-between border-b border-line px-3 font-mono text-[10px] text-text-3">
              <span>{controllerStatus} · {midiEvents.length} buffered</span>
              <button className="rounded-sm border border-line bg-surface-2 px-2 py-1 text-text-2 hover:bg-surface-3 hover:text-text-1" onClick={onClearMidi} type="button">
                Clear
              </button>
            </div>
            <div className="grid gap-2 border-b border-line bg-surface-1/50 p-3 font-mono text-[10px] text-text-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-text-1">FX target: {fxTargetLabel(fxState.target)}</span>
                <span>Focused slot: {fxState.focusIndex + 1}</span>
                <span>Deck A chain: {fxDeckChainLabel(fxState, "A")}</span>
                <span>Deck B chain: {fxDeckChainLabel(fxState, "B")}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {fxState.slots.map((slot, index) => (
                  <div
                    key={`${slot.kind}-${index}`}
                    className={classNames(
                      "rounded-sm border px-2 py-1.5",
                      index === fxState.focusIndex ? "border-accent bg-accent/10 text-text-1" : "border-line bg-surface-2"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>Slot {index + 1}</span>
                      <span className={slot.enabled ? "text-green-300" : "text-text-3"}>{slot.enabled ? "ON" : "OFF"}</span>
                    </div>
                    <div className="mt-1 text-text-1">{fxKindLabel(slot.kind)}</div>
                    <div className="mt-1 text-text-3">timing {fxTimingLabel(slot)}</div>
                    <div className="mt-1 text-text-3">mix {Math.round(slot.mix * 100)}%</div>
                    <div className="text-text-3">amount {formatFxValue(slot.amount)}</div>
                    <div className="text-text-3">rate {formatFxValue(slot.rateHz)}</div>
                    <div className="text-text-3">feedback {formatFxValue(slot.feedback)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-h-0 overflow-auto">
              <table className="w-full table-fixed border-collapse font-mono text-[10px]">
                <thead className="sticky top-0 bg-[#0b0c10] text-left text-text-3">
                  <tr className="border-b border-line">
                    <th className="w-[86px] px-3 py-2 font-medium">Received</th>
                    <th className="w-[120px] px-3 py-2 font-medium">Device</th>
                    <th className="w-[112px] px-3 py-2 font-medium">Bytes</th>
                    <th className="w-[168px] px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {midiEvents.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-text-3" colSpan={5}>
                        Waiting for MIDI input
                      </td>
                    </tr>
                  ) : (
                    midiEvents.map((event) => (
                      <tr key={event.id} className="border-b border-line/70 text-text-2 hover:bg-surface-1">
                        <td className="px-3 py-1.5 text-text-3">{event.receivedAt.toFixed(1)}ms</td>
                        <td className="truncate px-3 py-1.5">{event.deviceName}</td>
                        <td className="px-3 py-1.5 text-accent">{formatMidiBytes(event.raw.bytes)}</td>
                        <td className="px-3 py-1.5 text-text-1">{formatControllerActionName(event.action)}</td>
                        <td className="truncate px-3 py-1.5">{formatControllerActionPayload(event.action)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function formatMidiBytes(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function formatControllerActionName(action: ControllerEvent["action"]) {
  switch (action.type) {
    case "playPause":
      return `Deck ${deckLabel(action.deck)} play`;
    case "cue":
      return `Deck ${deckLabel(action.deck)} cue`;
    case "headphoneCue":
      return `Deck ${deckLabel(action.deck)} headphone cue`;
    case "loadSelected":
      return `Deck ${deckLabel(action.deck)} load`;
    case "browse":
      return action.shifted ? "Library browse shift" : "Library browse";
    case "browsePress":
      return action.shifted ? "Library back" : "Library enter";
    case "tempo":
      return `Deck ${deckLabel(action.deck)} tempo`;
    case "volume":
      return `Deck ${deckLabel(action.deck)} volume`;
    case "eq":
      return `Deck ${deckLabel(action.deck)} ${action.band}`;
    case "filter":
      return `Deck ${deckLabel(action.deck)} filter`;
    case "hotCue":
      return `Deck ${deckLabel(action.deck)} hot cue ${action.index}`;
    case "fxSelect":
      return "FX select";
    case "fxBeat":
      return "FX beat";
    case "fxTarget":
      return "FX target";
    case "fxDepth":
      return "FX depth";
    case "fxToggle":
      return "FX toggle";
    case "fxClear":
      return "FX clear";
    case "jogTouch":
      return `Deck ${deckLabel(action.deck)} jog touch`;
    case "jog":
      return `Deck ${deckLabel(action.deck)} jog`;
    case "crossfader":
      return "Crossfader";
    case "headphoneMix":
      return "Headphone mix";
    case "headphoneVolume":
      return "Headphone volume";
    case "raw":
      return "Raw";
  }
}

function formatControllerActionPayload(action: ControllerEvent["action"]) {
  switch (action.type) {
    case "playPause":
    case "cue":
    case "hotCue":
    case "jogTouch":
    case "fxToggle":
    case "fxClear":
      return action.pressed ? "pressed" : "released";
    case "headphoneCue":
      return action.enabled ? "on" : "off";
    case "fxSelect":
    case "fxBeat":
      return `${action.direction > 0 ? "+" : ""}${action.direction}${action.pressed ? " pressed" : " released"}`;
    case "tempo":
    case "volume":
    case "filter":
    case "crossfader":
    case "headphoneMix":
    case "headphoneVolume":
    case "fxDepth":
      return action.value.toFixed(4);
    case "fxTarget":
      return action.target;
    case "eq":
      return `${action.band} ${action.value.toFixed(4)}`;
    case "jog":
      return `${action.ticks} ticks`;
    case "browse":
      return `${action.ticks} ticks`;
    case "browsePress":
      return action.pressed ? "pressed" : "released";
    case "loadSelected":
      return "selected track";
    case "raw":
      return "";
  }
}

function deckLabel(deck: "a" | "b") {
  return deck.toUpperCase();
}
