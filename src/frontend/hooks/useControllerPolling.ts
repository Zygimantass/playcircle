import { useEffect, useRef, useState } from "react";
import { usesBrowserAudioFixture } from "../api/audio";
import { connectController, disconnectController, listControllers, pollControllerEvents, type ControllerAction } from "../api/controller";
import type { MidiDebugEvent } from "../components/DebugWindow";

const MAX_MIDI_DEBUG_EVENTS = 200;

export function useControllerPolling(handleControllerAction: (action: ControllerAction) => void) {
  const handleControllerActionRef = useRef(handleControllerAction);
  const midiDebugEventIdRef = useRef(0);
  const [controllerStatus, setControllerStatus] = useState("Controller idle");
  const [midiDebugEvents, setMidiDebugEvents] = useState<MidiDebugEvent[]>([]);

  useEffect(() => {
    handleControllerActionRef.current = handleControllerAction;
  }, [handleControllerAction]);

  useEffect(() => {
    if (usesBrowserAudioFixture()) return undefined;

    let cancelled = false;
    let pollInterval: number | null = null;

    listControllers()
      .then((devices) => {
        if (cancelled) return null;
        const target = devices.find((device) => device.kind === "pioneerDdjFlx4");
        if (!target) {
          setControllerStatus("No DDJ-FLX4");
          return null;
        }

        setControllerStatus(`Connecting ${target.name}...`);
        return connectController(target.id);
      })
      .then((device) => {
        if (cancelled || !device) return;
        setControllerStatus(`Connected ${device.name}`);
        pollInterval = window.setInterval(() => {
          pollControllerEvents()
            .then((events) => {
              if (events.length > 0) {
                const receivedAt = performance.now();
                setMidiDebugEvents((current) => [
                  ...events.map((event) => ({
                    ...event,
                    id: midiDebugEventIdRef.current++,
                    receivedAt
                  })),
                  ...current
                ].slice(0, MAX_MIDI_DEBUG_EVENTS));
              }
              events.forEach((event) => handleControllerActionRef.current(event.action));
            })
            .catch((error) => setControllerStatus(error instanceof Error ? error.message : String(error)));
        }, 16);
      })
      .catch((error) => {
        if (!cancelled) setControllerStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (pollInterval !== null) window.clearInterval(pollInterval);
      disconnectController().catch(() => undefined);
    };
  }, []);

  return {
    controllerStatus,
    clearMidiDebugEvents: () => setMidiDebugEvents([]),
    midiDebugEvents,
    setControllerStatus
  };
}
