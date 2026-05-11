import { type DeckFxConfig, type DeckFxKind, type DeckId } from "../api/audio";
import { sendControllerMidi, type ControllerAction } from "../api/controller";

export type ControllerFxTarget = DeckId | "both";
export type ControllerFxSlot = DeckFxConfig & {
  beatFraction: number;
};
export type ControllerFxState = {
  target: ControllerFxTarget;
  focusIndex: number;
  slots: ControllerFxSlot[];
};
export type ControllerFxDebugState = ControllerFxState;

export const CONTROLLER_FX_KINDS: DeckFxKind[] = ["echo", "reverb", "crush", "flanger", "spiral", "delay", "trans", "phaser", "roll", "slipRoll"];
export const CONTROLLER_FX_BEATS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16];
const CONTROLLER_REVERB_AMOUNTS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1];
const FALLBACK_FX_BPM = 120;

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
      return { kind, enabled: false, mix: 0.35, amount: beatFractionToMs(1 / 2, FALLBACK_FX_BPM), rateHz: 0.45, feedback: 0.38, beatFraction: 1 / 2 };
    case "reverb":
      return { kind, enabled: false, mix: 0.32, amount: 0.5, rateHz: 0.35, feedback: 0.42, beatFraction: 1 / 2 };
    case "crush":
      return { kind, enabled: false, mix: 0.35, amount: 0.45, rateHz: 0.45, feedback: 0, beatFraction: 1 / 2 };
    case "flanger":
      return { kind, enabled: false, mix: 0.35, amount: 0.6, rateHz: beatFractionToHz(1 / 2, FALLBACK_FX_BPM), feedback: 0.25, beatFraction: 1 / 2 };
    case "spiral":
      return { kind, enabled: false, mix: 0.34, amount: beatFractionToMs(1 / 2, FALLBACK_FX_BPM), rateHz: 0.35, feedback: 0.45, beatFraction: 1 / 2 };
    case "delay":
      return { kind, enabled: false, mix: 0.35, amount: beatFractionToMs(1 / 2, FALLBACK_FX_BPM), rateHz: 0.25, feedback: 0.18, beatFraction: 1 / 2 };
    case "trans":
      return { kind, enabled: false, mix: 1, amount: 0.5, rateHz: beatFractionToHz(1 / 4, FALLBACK_FX_BPM), feedback: 0, beatFraction: 1 / 4 };
    case "phaser":
      return { kind, enabled: false, mix: 0.45, amount: 0.7, rateHz: beatFractionToHz(1, FALLBACK_FX_BPM), feedback: 0.35, beatFraction: 1 };
    case "roll":
      return { kind, enabled: false, mix: 1, amount: beatFractionToMs(1 / 2, FALLBACK_FX_BPM), rateHz: 0, feedback: 0, beatFraction: 1 / 2 };
    case "slipRoll":
      return { kind, enabled: false, mix: 1, amount: beatFractionToMs(1 / 2, FALLBACK_FX_BPM), rateHz: 0, feedback: 0, beatFraction: 1 / 2 };
    default:
      return { kind, enabled: false, mix: 0.35, amount: beatFractionToMs(1 / 2, FALLBACK_FX_BPM), rateHz: 0.45, feedback: 0.38, beatFraction: 1 / 2 };
  }
}

export function adjustFxBeat(slot: ControllerFxSlot, direction: number): ControllerFxSlot {
  if (slot.kind === "reverb") {
    const currentIndex = nearestIndex(CONTROLLER_REVERB_AMOUNTS, slot.amount);
    return {
      ...slot,
      amount: CONTROLLER_REVERB_AMOUNTS[wrapIndex(currentIndex + direction, CONTROLLER_REVERB_AMOUNTS.length)]
    };
  }

  const currentIndex = nearestIndex(CONTROLLER_FX_BEATS, slot.beatFraction);
  const beatFraction = CONTROLLER_FX_BEATS[wrapIndex(currentIndex + direction, CONTROLLER_FX_BEATS.length)];
  if (slot.kind === "flanger" || slot.kind === "trans" || slot.kind === "phaser") {
    return { ...slot, beatFraction, rateHz: beatFractionToHz(beatFraction, FALLBACK_FX_BPM) };
  }
  return { ...slot, beatFraction, amount: beatFractionToMs(beatFraction, FALLBACK_FX_BPM) };
}

export function audioFxConfigForSlot(slot: ControllerFxSlot, bpm: number): DeckFxConfig {
  if (slot.kind === "echo" || slot.kind === "spiral" || slot.kind === "delay" || slot.kind === "roll" || slot.kind === "slipRoll") {
    const { beatFraction: _beatFraction, ...config } = slot;
    return { ...config, amount: beatFractionToMs(slot.beatFraction, bpm) };
  }
  if (slot.kind === "flanger" || slot.kind === "trans" || slot.kind === "phaser") {
    const { beatFraction: _beatFraction, ...config } = slot;
    return { ...config, rateHz: beatFractionToHz(slot.beatFraction, bpm) };
  }
  const { beatFraction: _beatFraction, ...config } = slot;
  return { ...config };
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

export function fxTimingLabel(slot: ControllerFxSlot, bpm?: number) {
  if (slot.kind === "echo" || slot.kind === "spiral" || slot.kind === "delay" || slot.kind === "roll" || slot.kind === "slipRoll") {
    const ms = beatFractionToMs(slot.beatFraction, bpm ?? FALLBACK_FX_BPM);
    return `${beatFractionLabel(slot.beatFraction)} (${Math.round(ms)}ms)`;
  }
  if (slot.kind === "flanger" || slot.kind === "trans" || slot.kind === "phaser") {
    return `${beatFractionLabel(slot.beatFraction)} (${beatFractionToHz(slot.beatFraction, bpm ?? FALLBACK_FX_BPM).toFixed(2)}Hz)`;
  }
  if (slot.kind === "reverb") return `${Math.round(slot.amount * 100)}%`;
  return "";
}

export function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function beatFractionToMs(beatFraction: number, bpm: number) {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : FALLBACK_FX_BPM;
  return Math.max(1, Math.min(4000, (60_000 / safeBpm) * beatFraction));
}

function beatFractionToHz(beatFraction: number, bpm: number) {
  const ms = beatFractionToMs(beatFraction, bpm);
  return 1_000 / Math.max(10, ms);
}

function beatFractionLabel(value: number) {
  if (value === 3 / 4) return "3/4";
  if (value >= 1) return `${value}/1`;
  return `1/${Math.round(1 / value)}`;
}

function nearestIndex(values: number[], value: number) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  values.forEach((candidate, index) => {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function deckIdFromControllerAction(action: ControllerAction): DeckId {
  return "deck" in action && action.deck === "b" ? "B" : "A";
}
