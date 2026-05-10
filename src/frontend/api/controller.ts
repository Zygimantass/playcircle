import { invoke } from "@tauri-apps/api/core";

export type ControllerKind = "pioneerDdjFlx4" | "genericMidi";
export type ControllerDeck = "a" | "b";
export type EqBand = "high" | "mid" | "low";

export type ControllerDevice = {
  id: string;
  name: string;
  kind: ControllerKind;
  connected: boolean;
};

export type MidiMessage = {
  timestampUs: number;
  status: number;
  data1: number;
  data2: number;
  bytes: number[];
};

export type ControllerAction =
  | { type: "raw" }
  | { type: "playPause"; deck: ControllerDeck; pressed: boolean }
  | { type: "cue"; deck: ControllerDeck; pressed: boolean }
  | { type: "loadSelected"; deck: ControllerDeck }
  | { type: "tempo"; deck: ControllerDeck; value: number }
  | { type: "volume"; deck: ControllerDeck; value: number }
  | { type: "crossfader"; value: number }
  | { type: "eq"; deck: ControllerDeck; band: EqBand; value: number }
  | { type: "filter"; deck: ControllerDeck; value: number }
  | { type: "hotCue"; deck: ControllerDeck; index: number; pressed: boolean }
  | { type: "jog"; deck: ControllerDeck; ticks: number };

export type ControllerEvent = {
  deviceId: string;
  deviceName: string;
  action: ControllerAction;
  raw: MidiMessage;
};

export function listControllers() {
  return invoke<ControllerDevice[]>("list_controllers");
}

export function connectController(id: string) {
  return invoke<ControllerDevice>("connect_controller", { id });
}

export function disconnectController() {
  return invoke<void>("disconnect_controller");
}

export function pollControllerEvents() {
  return invoke<ControllerEvent[]>("poll_controller_events");
}
