import { memo } from "react";
import { classNames, ui } from "./common";

type TopBarProps = {
  mode: "library" | "mix";
  onSearchClick: () => void;
  onSettingsClick: () => void;
  query: string;
  setMode: (mode: "library" | "mix") => void;
};

const modes: Array<{ id: "library" | "mix"; label: string }> = [
  { id: "library", label: "Library" },
  { id: "mix", label: "Mix" }
];

export const TopBar = memo(function TopBar({ mode, onSearchClick, onSettingsClick, query, setMode }: TopBarProps) {
  return (
    <div className="drag-region grid h-8 grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-gradient-to-b from-[#131418] to-surface-1 px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2 py-1">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="6" stroke="#cdb46a" strokeWidth="1" fill="none" />
            <circle cx="7" cy="7" r="2" fill="#cdb46a" />
            <circle cx="7" cy="7" r="0.6" fill="#0c0d10" />
          </svg>
          <span className="text-[12px] font-semibold tracking-[0.04em] text-text-1">playcircle</span>
        </div>
        <div className="no-drag flex gap-px">
          {modes.map((item) => (
            <button
              key={item.id}
              className={classNames(
                "rounded px-2.5 py-1 text-[11px] font-medium text-text-2 hover:bg-surface-2 hover:text-text-1",
                mode === item.id && "bg-surface-3 text-text-1"
              )}
              onClick={() => setMode(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <button
          className="no-drag inline-flex min-w-[380px] items-center gap-2 rounded-[5px] border border-line-2 bg-surface-2 py-1 pl-2.5 pr-1.5 text-left text-[11px] text-text-3 hover:border-[#2c2f37] hover:bg-surface-3"
          onClick={onSearchClick}
        >
          <span>⌕</span>
          <span>{query || "Search library, jump to crate, run command…"}</span>
          <span className={classNames(ui.kbd, "ml-auto")}>⌘K</span>
        </button>
      </div>

      <div className="flex justify-end">
        <button
          className="no-drag rounded px-2 py-1 font-mono text-[11px] text-text-3 hover:bg-surface-2 hover:text-text-1"
          onClick={onSettingsClick}
          type="button"
        >
          Settings <span className={ui.kbd}>⌃⇧`</span>
        </button>
      </div>
    </div>
  );
});
