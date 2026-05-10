import { useDraggable, useDroppable } from "@dnd-kit/core";
import { memo, useMemo, useState } from "react";
import { isRecentlyAdded, recentAddedCutoff } from "../data/recentTracks";
import type { CurrentNode, PcData, PlaylistEntry } from "../designTypes";
import { classNames, ui } from "./common";

type SidebarProps = {
  data: PcData;
  currentNode: CurrentNode;
  setCurrentNode: (node: CurrentNode) => void;
  onDropToCrate: (crateId: string, trackId: string) => void;
  onCreatePlaylist: (name: string) => void;
  onMovePlaylistToFolder: (playlistId: string, folderId: string) => void;
  playlistDragActive: boolean;
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
  onMovePlaylistToFolder,
  playlistDragActive,
  depth = 0
}: {
  playlist: PlaylistEntry;
  currentNode: CurrentNode;
  setCurrentNode: (node: CurrentNode) => void;
  onMovePlaylistToFolder: (playlistId: string, folderId: string) => void;
  playlistDragActive: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const { isOver: isTrackOver, setNodeRef: setTrackDropRef } = useDroppable({
    id: `playlist:${playlist.id}`,
    disabled: playlistDragActive || playlist.isFolder
  });
  const { isOver: isPlaylistOver, setNodeRef: setFolderDropRef } = useDroppable({
    id: `playlist-folder:${playlist.id}`,
    disabled: !playlistDragActive || !playlist.isFolder
  });
  const { attributes, isDragging, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: `playlist-drag:${playlist.id}`,
    disabled: playlist.isFolder
  });
  const hasChildren = playlist.children.length > 0;

  return (
    <div>
      <button
        ref={(node) => {
          setTrackDropRef(node);
          setFolderDropRef(node);
          setDragRef(node);
        }}
        className={classNames(
          ui.sideItem,
          "w-full",
          currentNode.type === "playlist" && currentNode.id === playlist.id && ui.activeSideItem,
          isTrackOver && !playlist.isFolder && "border-l-accent bg-accent/15 outline outline-1 -outline-offset-1 outline-accent-dim",
          isPlaylistOver && playlist.isFolder && "border-l-accent bg-accent/15 outline outline-1 -outline-offset-1 outline-accent-dim"
        )}
        data-playlist-id={playlist.id}
        data-playlist-folder={playlist.isFolder ? "true" : "false"}
        data-testid="playlist-row"
        style={{
          paddingLeft: `${18 + depth * 12}px`,
          opacity: isDragging ? 0.7 : undefined,
          transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
          zIndex: isDragging ? 30 : undefined
        }}
        {...attributes}
        {...listeners}
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
          {playlist.isFolder ? <FolderGlyph /> : "≡"}
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
              onMovePlaylistToFolder={onMovePlaylistToFolder}
              playlistDragActive={playlistDragActive}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const Sidebar = memo(function Sidebar({ data, currentNode, setCurrentNode, onDropToCrate, onCreatePlaylist, onMovePlaylistToFolder, playlistDragActive, dragHoverCrate, setDragHoverCrate }: SidebarProps) {
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const { recentCount, fiveStarCount } = useMemo(() => {
    let recentCount = 0;
    let fiveStarCount = 0;
    const recentCutoff = recentAddedCutoff(data.TRACKS);
    for (const track of data.TRACKS) {
      if (isRecentlyAdded(track, recentCutoff)) recentCount += 1;
      if (track.rating === 5) fiveStarCount += 1;
    }
    return { recentCount, fiveStarCount };
  }, [data.TRACKS]);

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
        {creatingPlaylist ? (
          <form
            className="mb-1 flex h-7 items-center gap-1 px-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = playlistName.trim();
              if (!name) return;
              onCreatePlaylist(name);
              setPlaylistName("");
              setCreatingPlaylist(false);
            }}
          >
            <input
              autoFocus
              aria-label="Playlist name"
              className="min-w-0 flex-1 rounded-[3px] border border-line-2 bg-surface-2 px-1.5 py-1 text-[12px] text-text-1 outline-none focus:border-accent"
              value={playlistName}
              onChange={(event) => setPlaylistName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPlaylistName("");
                  setCreatingPlaylist(false);
                }
              }}
            />
            <button className="rounded-[3px] border border-line-2 px-1.5 py-1 text-[11px] text-text-2 hover:text-text-1" type="submit">
              Add
            </button>
          </form>
        ) : (
          <button
            className={classNames(ui.sideItem, "mb-1 w-full pl-[18px] text-text-2 hover:text-text-1")}
            data-testid="new-playlist-button"
            type="button"
            onClick={() => setCreatingPlaylist(true)}
          >
            <span className="grid size-3 shrink-0 place-items-center text-[11px] leading-none text-accent">+</span>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">New playlist</span>
          </button>
        )}
        {data.PLAYLISTS.map((playlist) => (
          <PlaylistTreeItem
            key={playlist.id}
            playlist={playlist}
            currentNode={currentNode}
            setCurrentNode={setCurrentNode}
            onMovePlaylistToFolder={onMovePlaylistToFolder}
            playlistDragActive={playlistDragActive}
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

function FolderGlyph() {
  return (
    <svg className="size-3 shrink-0 text-text-3" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.8 4.2c0-.8.5-1.2 1.3-1.2h3l1.3 1.4h5.5c.8 0 1.3.5 1.3 1.2v6.2c0 .8-.5 1.2-1.3 1.2H3.1c-.8 0-1.3-.5-1.3-1.2V4.2Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
