import { memo, useState } from "react";
import type { CurrentNode, PcData, PlaylistEntry } from "../designTypes";
import { classNames, ui } from "./common";

type SidebarProps = {
  data: PcData;
  currentNode: CurrentNode;
  setCurrentNode: (node: CurrentNode) => void;
  onDropToCrate: (crateId: string, trackId: string) => void;
  dragHoverCrate: string | null;
  setDragHoverCrate: (crateId: string | null) => void;
};

function SidebarSection({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="py-1">
      <button className={classNames(ui.sectionHead, "w-full")} onClick={() => setOpen((value) => !value)}>
        <svg className={classNames("shrink-0 transition-transform", open && "rotate-90")} width="8" height="8" viewBox="0 0 8 8">
          <path d="M2 1 L5 4 L2 7" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="flex-1 text-left">{title}</span>
        {count != null && <span className="font-mono text-[10px] font-normal text-text-4">{count}</span>}
      </button>
      {open && <div className="py-px">{children}</div>}
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  count,
  active,
  color,
  onClick,
  onDrop,
  dragOver
}: {
  icon?: string;
  label: string;
  count?: number;
  active?: boolean;
  color?: string;
  onClick: () => void;
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void;
  dragOver?: boolean;
}) {
  return (
    <button
      className={classNames(ui.sideItem, "w-full", active && ui.activeSideItem, dragOver && "border-l-accent bg-accent/15 outline outline-1 -outline-offset-1 outline-accent-dim")}
      onClick={onClick}
      onDragOver={(event) => {
        if (onDrop) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={onDrop}
    >
      {color && <span className="size-2 shrink-0 rounded-sm" style={{ background: color }} />}
      {icon && <span className="w-3 text-center text-[11px] text-text-3">{icon}</span>}
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{label}</span>
      {count != null && <span className="font-mono text-[10px] text-text-3">{count}</span>}
    </button>
  );
}

function PlaylistTreeItem({
  playlist,
  currentNode,
  setCurrentNode,
  depth = 0
}: {
  playlist: PlaylistEntry;
  currentNode: CurrentNode;
  setCurrentNode: (node: CurrentNode) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = playlist.children.length > 0;

  return (
    <div>
      <button
        className={classNames(ui.sideItem, "w-full", currentNode.type === "playlist" && currentNode.id === playlist.id && ui.activeSideItem)}
        style={{ paddingLeft: `${18 + depth * 12}px` }}
        onClick={() => setCurrentNode({ type: "playlist", id: playlist.id })}
      >
        <span
          className={classNames("grid size-3 place-items-center text-[9px] text-text-3", hasChildren && "hover:text-text-1")}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          {hasChildren ? (open ? "▾" : "▸") : playlist.isFolder ? "·" : "≡"}
        </span>
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{playlist.name}</span>
        <span className="font-mono text-[10px] text-text-3">{playlist.count}</span>
      </button>
      {open && hasChildren && (
        <div>
          {playlist.children.map((child) => (
            <PlaylistTreeItem
              key={child.id}
              playlist={child}
              currentNode={currentNode}
              setCurrentNode={setCurrentNode}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const Sidebar = memo(function Sidebar({ data, currentNode, setCurrentNode, onDropToCrate, dragHoverCrate, setDragHoverCrate }: SidebarProps) {
  const recentCount = data.TRACKS.filter((track) => track.added.startsWith("2025")).length;
  const fiveStarCount = data.TRACKS.filter((track) => track.rating === 5).length;

  return (
    <aside className="overflow-y-auto bg-surface-1 py-1.5 pb-3 [scrollbar-color:var(--color-line-2)_transparent] [scrollbar-width:thin]">
      <SidebarSection title="LIBRARY">
        <SidebarItem icon="◐" label="All Tracks" count={data.TRACKS.length} active={currentNode.type === "all"} onClick={() => setCurrentNode({ type: "all" })} />
        <SidebarItem icon="✦" label="Recently Added" count={recentCount} active={currentNode.type === "recent"} onClick={() => setCurrentNode({ type: "recent" })} />
        <SidebarItem icon="★" label="5-Star" count={fiveStarCount} active={currentNode.type === "fivestar"} onClick={() => setCurrentNode({ type: "fivestar" })} />
        <SidebarItem icon="↻" label="History" count={142} active={currentNode.type === "history"} onClick={() => setCurrentNode({ type: "history" })} />
      </SidebarSection>

      <SidebarSection title="CRATES" count={data.CRATES.length}>
        {data.CRATES.map((crate) => (
          <SidebarItem
            key={crate.id}
            color={crate.color}
            label={crate.name}
            count={crate.count}
            active={currentNode.type === "crate" && currentNode.id === crate.id}
            dragOver={dragHoverCrate === crate.id}
            onClick={() => setCurrentNode({ type: "crate", id: crate.id })}
            onDrop={(event) => {
              event.preventDefault();
              setDragHoverCrate(null);
              const id = event.dataTransfer.getData("text/track-id");
              if (id) onDropToCrate(crate.id, id);
            }}
          />
        ))}
      </SidebarSection>

      <SidebarSection title="PLAYLISTS" count={data.PLAYLISTS.length}>
        {data.PLAYLISTS.map((playlist) => (
          <PlaylistTreeItem
            key={playlist.id}
            playlist={playlist}
            currentNode={currentNode}
            setCurrentNode={setCurrentNode}
          />
        ))}
      </SidebarSection>

      <SidebarSection title="SMART LISTS" count={data.SMART.length}>
        {data.SMART.map((smart) => (
          <SidebarItem key={smart.id} icon="◇" label={smart.name} count={smart.count} active={currentNode.type === "smart" && currentNode.id === smart.id} onClick={() => setCurrentNode({ type: "smart", id: smart.id })} />
        ))}
      </SidebarSection>

      <SidebarSection title="TAGS" count={data.TAGS.length} defaultOpen={false}>
        {data.TAGS.map((tag) => (
          <SidebarItem key={tag.id} color={tag.color} label={tag.label} active={currentNode.type === "tag" && currentNode.id === tag.label} onClick={() => setCurrentNode({ type: "tag", id: tag.label })} />
        ))}
      </SidebarSection>
    </aside>
  );
});
