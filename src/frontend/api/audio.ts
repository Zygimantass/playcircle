import { invoke } from "@tauri-apps/api/core";

export type DeckId = "A" | "B";

export function loadAudioDeck(deck: DeckId, path: string) {
  return invoke<void>("load_audio_deck", { deck, path });
}

export function loadAudioWaveform(path: string, bins = 512) {
  return invoke<Array<[number, number]>>("load_audio_waveform", { path, bins });
}

export function playAudioDeck(deck: DeckId) {
  return invoke<void>("play_audio_deck", { deck });
}

export function pauseAudioDeck(deck: DeckId) {
  return invoke<void>("pause_audio_deck", { deck });
}

export function seekAudioDeck(deck: DeckId, position: number) {
  return invoke<void>("seek_audio_deck", { deck, position });
}

export function setAudioDeckVolume(deck: DeckId, volume: number) {
  return invoke<void>("set_audio_deck_volume", { deck, volume });
}

export function setAudioDeckFilter(deck: DeckId, cutoffHz: number) {
  return invoke<void>("set_audio_deck_filter", { deck, cutoffHz });
}

export function setAudioDeckCue(deck: DeckId, enabled: boolean) {
  return invoke<void>("set_audio_deck_cue", { deck, enabled });
}

export function setAudioMasterVolume(volume: number) {
  return invoke<void>("set_audio_master_volume", { volume });
}
