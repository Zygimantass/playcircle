import type { CurrentNode, PcData, PlaylistEntry, SortableTrackKey, SortState, Track } from "../designTypes";

export type LibraryBrowserNode = {
  node: CurrentNode;
  label: string;
};

export function findPlaylist(playlists: PlaylistEntry[], id: string): PlaylistEntry | null {
  for (const playlist of playlists) {
    if (playlist.id === id) return playlist;
    const child = findPlaylist(playlist.children, id);
    if (child) return child;
  }
  return null;
}

export function findPlaylistParentNode(playlists: PlaylistEntry[], id: string, parent: CurrentNode | null = null): CurrentNode | null {
  for (const playlist of playlists) {
    if (playlist.id === id) return parent;
    const child = findPlaylistParentNode(playlist.children, id, { type: "playlist", id: playlist.id });
    if (child) return child;
  }
  return null;
}

export function libraryBrowserNodes(data: PcData): LibraryBrowserNode[] {
  return [
    { node: { type: "all" }, label: "All Tracks" },
    { node: { type: "recent" }, label: "Recently Added" },
    { node: { type: "fivestar" }, label: "5-Star" },
    { node: { type: "history" }, label: "History" },
    ...data.CRATES.map((crate) => ({ node: { type: "crate", id: crate.id } as CurrentNode, label: crate.name })),
    ...flattenPlaylistNodes(data.PLAYLISTS),
    ...data.SMART.map((smart) => ({ node: { type: "smart", id: smart.id } as CurrentNode, label: smart.name })),
    ...data.TAGS.map((tag) => ({ node: { type: "tag", id: tag.label } as CurrentNode, label: `#${tag.label}` }))
  ];
}

function flattenPlaylistNodes(playlists: PlaylistEntry[]): LibraryBrowserNode[] {
  return playlists.flatMap((playlist) => [
    { node: { type: "playlist", id: playlist.id } as CurrentNode, label: playlist.name },
    ...flattenPlaylistNodes(playlist.children)
  ]);
}

export function currentNodesEqual(a: CurrentNode, b: CurrentNode) {
  return a.type === b.type && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);
}

export function collectPlaylistTrackIds(playlist: PlaylistEntry): string[] {
  return [
    ...playlist.trackIds,
    ...playlist.children.flatMap((child) => collectPlaylistTrackIds(child))
  ];
}

export function indexPlaylists(playlists: PlaylistEntry[]) {
  const index = new Map<string, PlaylistEntry>();
  const visit = (playlist: PlaylistEntry) => {
    index.set(playlist.id, playlist);
    playlist.children.forEach(visit);
  };
  playlists.forEach(visit);
  return index;
}

export function updatePlaylistEntries(
  playlists: PlaylistEntry[],
  playlistId: string,
  update: (playlist: PlaylistEntry) => PlaylistEntry
): PlaylistEntry[] {
  return playlists.map((playlist) => {
    if (playlist.id === playlistId) return update(playlist);
    if (playlist.children.length === 0) return playlist;
    return {
      ...playlist,
      children: updatePlaylistEntries(playlist.children, playlistId, update)
    };
  });
}

export function playlistContains(playlist: PlaylistEntry, id: string): boolean {
  return playlist.children.some((child) => child.id === id || playlistContains(child, id));
}

export function movePlaylistEntry(playlists: PlaylistEntry[], playlistId: string, folderId: string): PlaylistEntry[] | null {
  const remove = (items: PlaylistEntry[]): { items: PlaylistEntry[]; removed: PlaylistEntry | null } => {
    let removed: PlaylistEntry | null = null;
    const next = items.flatMap((item) => {
      if (item.id === playlistId) {
        removed = item;
        return [];
      }
      if (item.children.length === 0) return [item];
      const childResult = remove(item.children);
      if (childResult.removed) removed = childResult.removed;
      return [{ ...item, children: childResult.items }];
    });
    return { items: next, removed };
  };

  const insert = (items: PlaylistEntry[], playlist: PlaylistEntry): PlaylistEntry[] => {
    return items.map((item) => {
      if (item.id === folderId && item.isFolder) {
        return { ...item, children: [...item.children, playlist] };
      }
      if (item.children.length === 0) return item;
      return { ...item, children: insert(item.children, playlist) };
    });
  };

  const { items, removed } = remove(playlists);
  return removed ? insert(items, removed) : null;
}

export function recalculatePlaylistCounts(playlists: PlaylistEntry[]): PlaylistEntry[] {
  return playlists.map((playlist) => {
    const children = recalculatePlaylistCounts(playlist.children);
    return {
      ...playlist,
      children,
      count: playlist.trackIds.length + children.reduce((total, child) => total + child.count, 0)
    };
  });
}

export function mapTrackIds(ids: Iterable<string>, tracksById: Map<string, Track>) {
  const tracks: Track[] = [];
  for (const id of ids) {
    const track = tracksById.get(id);
    if (track) tracks.push(track);
  }
  return tracks;
}

export function sortTracks(tracks: Track[], sort: SortState) {
  return [...tracks].sort(trackComparator(sort.col, sort.dir));
}

function trackComparator(column: SortableTrackKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;

  return (a: Track, b: Track) => {
    const aValue = a.sortKeys?.[column] ?? (column === "duration" ? a.totalSec : a[column]);
    const bValue = b.sortKeys?.[column] ?? (column === "duration" ? b.totalSec : b[column]);

    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * multiplier;
    }

    if (aValue < bValue) return -1 * multiplier;
    if (aValue > bValue) return 1 * multiplier;
    return 0;
  };
}

export function statusText(status: "loading" | "rekordbox" | "mock" | "error", count: number, error: string | null) {
  if (status === "loading") return "Loading Rekordbox library…";
  if (status === "rekordbox") return `${count.toLocaleString()} tracks loaded from Rekordbox`;
  if (status === "error") return `Rekordbox load failed: ${error ?? "unknown error"}`;
  return "Using mock library";
}
