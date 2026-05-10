import type { DragEndEvent } from "@dnd-kit/core";
import type { DeckId } from "../api/audio";

export function deckFromDndDropId(id: string): DeckId | null {
  if (id.startsWith("deck:A")) return "A";
  if (id.startsWith("deck:B")) return "B";
  return null;
}

export function deckFromDndTranslatedRect(event: DragEndEvent): DeckId | null {
  const translated = event.active.rect.current.translated;
  if (!translated) return null;

  const dock = document.querySelector<HTMLElement>("[data-player-dock-drop-region]");
  if (!dock) return null;

  const bounds = dock.getBoundingClientRect();
  const centerX = translated.left + translated.width / 2;
  const centerY = translated.top + translated.height / 2;
  if (centerX < bounds.left || centerX > bounds.right || centerY < bounds.top || centerY > bounds.bottom) {
    return null;
  }

  const waveformBottom = bounds.top + bounds.height * 0.42;
  if (centerY < waveformBottom) {
    const waveformMid = bounds.top + (waveformBottom - bounds.top) / 2;
    return centerY < waveformMid ? "A" : "B";
  }

  return centerX < bounds.left + bounds.width / 2 ? "A" : "B";
}
