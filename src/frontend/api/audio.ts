import { invoke } from "@tauri-apps/api/core";

export type DeckId = "A" | "B";
export type DeckFxKind = "echo" | "reverb" | "crush" | "flanger" | "spiral" | "delay" | "trans" | "phaser" | "roll" | "slipRoll";
export type DeckFxConfig = {
  kind: DeckFxKind;
  enabled: boolean;
  mix: number;
  amount: number;
  rateHz: number;
  feedback: number;
};

export type AudioBeatGridMarker = {
  timeSeconds: number;
  beatNumber: number;
};
export type AudioWaveform = {
  waveform: Array<[number, number]>;
  durationSeconds: number;
};

export type AudioOutputDevice = {
  id: string;
  name: string;
  channels: number;
  sampleRate: number;
  cueSupported: boolean;
  selected: boolean;
  masterSelected: boolean;
};

export type AudioOutputRouting = {
  masterStart: number;
  headphoneStart: number;
};

const fixtureState: Record<DeckId, { position: number; tempoPercent: number }> = {
  A: { position: 0, tempoPercent: 0 },
  B: { position: 0, tempoPercent: 0 }
};

export function loadAudioDeck(deck: DeckId, path: string) {
  if (usesBrowserAudioFixture()) {
    fixtureState[deck].position = 0;
    return Promise.resolve();
  }

  return invoke<void>("load_audio_deck", { deck, path });
}

export function loadAudioWaveform(path: string, bins = 512) {
  if (usesBrowserAudioFixture()) return Promise.resolve<AudioWaveform>({ waveform: [], durationSeconds: 0 });

  return invoke<AudioWaveform>("load_audio_waveform", { path, bins });
}

export function listAudioOutputs() {
  if (usesBrowserAudioFixture()) {
    return Promise.resolve<AudioOutputDevice[]>([
      {
        id: "fixture",
        name: "Browser fixture output",
        channels: 2,
        sampleRate: 44_100,
        cueSupported: false,
        selected: true,
        masterSelected: false
      }
    ]);
  }

  return invoke<AudioOutputDevice[]>("list_audio_outputs");
}

export function setAudioOutputDevice(id: string) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_output_device", { id });
}

export function setAudioMasterOutputDevice(id: string | null) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_master_output_device", { id });
}

export function playAudioDeck(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("play_audio_deck", { deck });
}

export function pauseAudioDeck(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("pause_audio_deck", { deck });
}

export function seekAudioDeck(deck: DeckId, position: number) {
  if (usesBrowserAudioFixture()) {
    fixtureState[deck].position = Math.max(0, Math.min(1, position));
    return Promise.resolve();
  }

  return invoke<void>("seek_audio_deck", { deck, position });
}

export function startAudioDeckScrub(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("start_audio_deck_scrub", { deck });
}

export function scrubAudioDeckToPosition(deck: DeckId, position: number) {
  if (usesBrowserAudioFixture()) {
    fixtureState[deck].position = Math.max(0, Math.min(1, position));
    return Promise.resolve();
  }

  return invoke<void>("scrub_audio_deck_to_position", { deck, position });
}

export function endAudioDeckScrub(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("end_audio_deck_scrub", { deck });
}

export function audioDeckPosition(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve(fixtureState[deck].position);

  return invoke<number>("audio_deck_position", { deck });
}

export function audioDeckError(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve<string | null>(null);

  return invoke<string | null>("audio_deck_error", { deck });
}

export function audioDeckLevelDb(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve(-60);

  return invoke<number>("audio_deck_level_db", { deck });
}

export function setAudioDeckVolume(deck: DeckId, volume: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_volume", { deck, volume });
}

export function setAudioDeckTempo(deck: DeckId, tempoPercent: number) {
  if (usesBrowserAudioFixture()) {
    fixtureState[deck].tempoPercent = tempoPercent;
    return Promise.resolve();
  }

  return invoke<void>("set_audio_deck_tempo", { deck, tempoPercent });
}

export function setAudioDeckBeatSync({
  follower,
  master,
  enabled,
  followerBpm,
  masterBpm,
  masterPlaybackRate,
  followerBeatGrid,
  masterBeatGrid
}: {
  follower: DeckId;
  master: DeckId;
  enabled: boolean;
  followerBpm: number;
  masterBpm: number;
  masterPlaybackRate: number;
  followerBeatGrid: AudioBeatGridMarker[];
  masterBeatGrid: AudioBeatGridMarker[];
}) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_beat_sync", {
    follower,
    master,
    enabled,
    followerBpm,
    masterBpm,
    masterPlaybackRate,
    followerBeatGrid,
    masterBeatGrid
  });
}

export function setAudioDeckFilter(deck: DeckId, cutoffHz: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_filter", { deck, cutoffHz });
}

export function setAudioDeckFilterAmount(deck: DeckId, amount: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_filter_amount", { deck, amount });
}

export function setAudioDeckEq(deck: DeckId, high: number, mid: number, low: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_eq", { deck, high, mid, low });
}

export function setAudioDeckCue(deck: DeckId, enabled: boolean) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_cue", { deck, enabled });
}

export function setAudioDeckFxChain(deck: DeckId, effects: DeckFxConfig[]) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_deck_fx_chain", { deck, effects });
}

export function clearAudioDeckFx(deck: DeckId) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("clear_audio_deck_fx", { deck });
}

export function setAudioMasterVolume(volume: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_master_volume", { volume });
}

export function setAudioHeadphoneVolume(volume: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_headphone_volume", { volume });
}

export function setAudioHeadphoneMix(mix: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_headphone_mix", { mix });
}

export function setAudioOutputRouting(masterStart: number, headphoneStart: number) {
  if (usesBrowserAudioFixture()) return Promise.resolve();

  return invoke<void>("set_audio_output_routing", { masterStart, headphoneStart });
}

export function usesBrowserAudioFixture() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fixture") === "rekordbox";
}
