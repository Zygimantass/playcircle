import { type DeckFxConfig, type DeckFxKind, type DeckId } from "../api/audio";
import { sendControllerMidi, type ControllerAction } from "../api/controller";

export type ControllerFxTarget = DeckId | "both";
export type ControllerFxSlot = DeckFxConfig;
export type ControllerFxState = {
  target: ControllerFxTarget;
  focusIndex: number;
  slots: ControllerFxSlot[];
};
export type ControllerFxDebugState = ControllerFxState;

export const CONTROLLER_FX_KINDS: DeckFxKind[] = ["echo", "reverb", "crush", "flanger"];

export function createControllerFxState(): ControllerFxState {
  return {
    target: "both",
    focusIndex: 0,
    slots: CONTROLLER_FX_KINDS.map(defaultControllerFxSlot)
  };
}

export function cloneControllerFxState(state: ControllerFxState): ControllerFxState {
  return {
    target: state.target,
    focusIndex: state.focusIndex,
    slots: state.slots.map((slot) => ({ ...slot }))
  };
}

export function defaultControllerFxSlot(kind: DeckFxKind): ControllerFxSlot {
  switch (kind) {
    case "echo":
      return { kind, enabled: false, mix: 0.35, amount: 320, rateHz: 0, feedback: 0.35 };
    case "reverb":
      return { kind, enabled: false, mix: 0.3, amount: 0.55, rateHz: 0, feedback: 0.4 };
    case "crush":
      return { kind, enabled: false, mix: 0.35, amount: 0.45, rateHz: 0.45, feedback: 0 };
    case "flanger":
      return { kind, enabled: false, mix: 0.35, amount: 0.6, rateHz: 0.28, feedback: 0.25 };
  }
}

export function controllerFxTarget(target: "deckA" | "deckB" | "both"): ControllerFxTarget {
  if (target === "deckA") return "A";
  if (target === "deckB") return "B";
  return "both";
}

export function sendControllerFxFeedback(state: ControllerFxState) {
  const focusedSlot = state.slots[state.focusIndex];
  const enabled = focusedSlot.enabled ? 0x7f : 0x00;
  const deckASelected = state.target === "A" || state.target === "both";
  const deckBSelected = state.target === "B" || state.target === "both";
  const messages = [
    [0x94, 0x10, deckASelected ? 0x7f : 0x00],
    [0x95, 0x11, deckBSelected ? 0x7f : 0x00],
    [0x94, 0x47, deckASelected ? enabled : 0x00],
    [0x95, 0x47, deckBSelected ? enabled : 0x00],
    [0x94, 0x43, 0x00],
    [0x95, 0x43, 0x00]
  ];
  messages.forEach((message) => {
    sendControllerMidi(message).catch(() => undefined);
  });
}

export function fxKindLabel(kind: DeckFxKind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function fxTargetLabel(target: ControllerFxTarget) {
  if (target === "both") return "A+B";
  return target;
}

export function fxDeckChainLabel(state: ControllerFxState, deck: DeckId) {
  if (state.target !== deck && state.target !== "both") return "clear";
  const active = state.slots.filter((slot) => slot.enabled);
  if (active.length === 0) return "empty";
  return active.map((slot) => fxKindLabel(slot.kind)).join(" + ");
}

export function formatFxValue(value: number) {
  if (Math.abs(value) >= 10) return value.toFixed(0);
  return value.toFixed(2);
}

export function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function deckIdFromControllerAction(action: ControllerAction): DeckId {
  return "deck" in action && action.deck === "b" ? "B" : "A";
}
