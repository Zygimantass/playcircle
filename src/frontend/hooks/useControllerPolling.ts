import { useEffect, useRef, useState } from "react";
import { usesBrowserAudioFixture } from "../api/audio";
import { connectController, disconnectController, listControllers, pollControllerEvents, type ControllerAction } from "../api/controller";
import type { MidiDebugEvent } from "../components/DebugWindow";

const MAX_MIDI_DEBUG_EVENTS = 200;
const CONTROLLER_STARTUP_SCAN_MS = 350;
const CONTROLLER_POLL_MS = 16;

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
    let startupTimeout: number | null = null;

    const recordEvents = (events: Awaited<ReturnType<typeof pollControllerEvents>>) => {
      if (events.length === 0) return;

      const receivedAt = performance.now();
      setMidiDebugEvents((current) => [
        ...events.map((event) => ({
          ...event,
          id: midiDebugEventIdRef.current++,
          receivedAt
        })),
        ...current
      ].slice(0, MAX_MIDI_DEBUG_EVENTS));
    };

    const pollOnce = () => pollControllerEvents().then((events) => {
      recordEvents(events);
      return events;
    });

    const startLivePolling = () => {
      pollInterval = window.setInterval(() => {
        pollOnce()
          .then((events) => {
            events.forEach((event) => handleControllerActionRef.current(event.action));
          })
          .catch((error) => setControllerStatus(error instanceof Error ? error.message : String(error)));
      }, CONTROLLER_POLL_MS);
    };

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
        setControllerStatus(`Reading ${device.name} controls...`);

        const startupActions = new Map<string, ControllerAction>();
        const scanStartedAt = performance.now();
        const scan = () => {
          pollOnce()
            .then((events) => {
              events.forEach((event) => {
                const key = controllerStartupStateKey(event.action);
                if (key) startupActions.set(key, event.action);
              });

              if (cancelled) return;
              if (performance.now() - scanStartedAt < CONTROLLER_STARTUP_SCAN_MS) {
                startupTimeout = window.setTimeout(scan, CONTROLLER_POLL_MS);
                return;
              }

              const actions = [...startupActions.values()].sort(controllerStartupActionOrder);
              actions.forEach((action) => handleControllerActionRef.current(action));
              setControllerStatus(actions.length > 0
                ? `Connected ${device.name} · synced ${actions.length} controls`
                : `Connected ${device.name}`);
              startLivePolling();
            })
            .catch((error) => {
              if (!cancelled) setControllerStatus(error instanceof Error ? error.message : String(error));
            });
        };

        scan();
      })
      .catch((error) => {
        if (!cancelled) setControllerStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (startupTimeout !== null) window.clearTimeout(startupTimeout);
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

function controllerStartupStateKey(action: ControllerAction) {
  switch (action.type) {
    case "tempo":
    case "volume":
    case "filter":
      return `${action.type}:${action.deck}`;
    case "eq":
      return `${action.type}:${action.deck}:${action.band}`;
    case "crossfader":
    case "headphoneMix":
    case "headphoneVolume":
    case "fxDepth":
      return action.type;
    case "fxTarget":
      return action.type;
    default:
      return null;
  }
}

function controllerStartupActionOrder(left: ControllerAction, right: ControllerAction) {
  return controllerStartupPriority(left) - controllerStartupPriority(right);
}

function controllerStartupPriority(action: ControllerAction) {
  switch (action.type) {
    case "crossfader":
      return 0;
    case "volume":
      return 1;
    case "eq":
      return 2;
    case "filter":
      return 3;
    case "tempo":
      return 4;
    case "headphoneMix":
      return 5;
    case "headphoneVolume":
      return 6;
    case "fxTarget":
      return 7;
    case "fxDepth":
      return 8;
    default:
      return 99;
  }
}
