use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

pub const DEFAULT_REKORDBOX_SQLCIPHER_KEY: &str =
    "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";

#[derive(Debug)]
pub enum RekordboxError {
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for RekordboxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for RekordboxError {}

impl From<rusqlite::Error> for RekordboxError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

pub type Result<T> = std::result::Result<T, RekordboxError>;

#[derive(Debug)]
pub struct RekordboxDatabase {
    connection: Connection,
    analysis_roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RekordboxLibrary {
    pub tracks: Vec<RekordboxTrack>,
    pub playlists: Vec<RekordboxPlaylist>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RekordboxTrack {
    pub id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub key: Option<String>,
    pub color: Option<String>,
    pub bpm: Option<f64>,
    pub length_seconds: Option<i64>,
    pub track_number: Option<i64>,
    pub bitrate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub sample_rate: Option<i64>,
    pub comments: Option<String>,
    pub file_type: Option<i64>,
    pub file_type_name: Option<String>,
    pub rating: Option<i64>,
    pub release_year: Option<i64>,
    pub play_count: Option<i64>,
    pub file_name: Option<String>,
    pub folder_path: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
    pub analysis_data_path: Option<String>,
    pub beat_grid: Vec<RekordboxBeat>,
    pub analyzed: bool,
    pub date_created: Option<String>,
    pub updated_at: Option<String>,
    pub uuid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RekordboxBeat {
    pub time_seconds: f64,
    pub beat_number: i64,
    pub bpm: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RekordboxPlaylist {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sequence: Option<i64>,
    pub attribute: Option<i64>,
    pub is_folder: bool,
    pub track_ids: Vec<String>,
    pub uuid: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl RekordboxDatabase {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_key(path, DEFAULT_REKORDBOX_SQLCIPHER_KEY)
    }

    pub fn open_with_key(path: impl AsRef<Path>, key: &str) -> Result<Self> {
        let path = path.as_ref();
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        connection.pragma_update(None, "key", key)?;
        // Force a read immediately so wrong keys fail at open time instead of later queries.
        connection.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;

        Ok(Self {
            connection,
            analysis_roots: analysis_roots(path),
        })
    }

    pub fn read_tracks(&self) -> Result<Vec<RekordboxTrack>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT
                c.ID,
                c.Title,
                ar.Name AS artist,
                al.Name AS album,
                g.Name AS genre,
                k.ScaleName AS key_name,
                color.Commnt AS color_name,
                c.BPM,
                c.Length,
                c.TrackNo,
                c.BitRate,
                c.BitDepth,
                c.SampleRate,
                c.Commnt,
                c.FileType,
                c.Rating,
                c.ReleaseYear,
                c.DJPlayCount,
                c.FileNameL,
                c.FolderPath,
                c.FileSize,
                c.AnalysisDataPath,
                c.Analysed,
                c.DateCreated,
                c.updated_at,
                c.UUID
            FROM djmdContent c
            LEFT JOIN djmdArtist ar ON ar.ID = c.ArtistID
            LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
            LEFT JOIN djmdGenre g ON g.ID = c.GenreID
            LEFT JOIN djmdKey k ON k.ID = c.KeyID
            LEFT JOIN djmdColor color ON color.ID = c.ColorID
            WHERE COALESCE(c.rb_local_deleted, 0) = 0
            ORDER BY c.ID
            "#,
        )?;

        let rows = statement.query_map([], |row| {
            let bpm_raw: Option<i64> = row.get(7)?;
            let file_type: Option<i64> = row.get(14)?;
            let file_name: Option<String> = empty_to_none(row.get(18)?);
            let folder_path: Option<String> = empty_to_none(row.get(19)?);

            let analysis_data_path = empty_to_none(row.get(21)?);

            Ok(RekordboxTrack {
                id: row.get(0)?,
                title: empty_to_none(row.get(1)?),
                artist: empty_to_none(row.get(2)?),
                album: empty_to_none(row.get(3)?),
                genre: empty_to_none(row.get(4)?),
                key: empty_to_none(row.get(5)?),
                color: empty_to_none(row.get(6)?),
                bpm: bpm_raw.map(|value| value as f64 / 100.0),
                length_seconds: row.get(8)?,
                track_number: row.get(9)?,
                bitrate: row.get(10)?,
                bit_depth: row.get(11)?,
                sample_rate: row.get(12)?,
                comments: empty_to_none(row.get(13)?),
                file_type,
                file_type_name: file_type.and_then(file_type_name).map(str::to_string),
                rating: row.get(15)?,
                release_year: row.get(16)?,
                play_count: row.get(17)?,
                file_path: normalize_file_path(folder_path.as_deref(), file_name.as_deref()),
                file_name,
                folder_path,
                file_size: row.get(20)?,
                analysis_data_path,
                beat_grid: Vec::new(),
                analyzed: row.get::<_, Option<i64>>(22)?.unwrap_or(0) != 0,
                date_created: empty_to_none(row.get(23)?),
                updated_at: empty_to_none(row.get(24)?),
                uuid: empty_to_none(row.get(25)?),
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(RekordboxError::from)
    }

    pub fn read_library(&self) -> Result<RekordboxLibrary> {
        Ok(RekordboxLibrary {
            tracks: self.read_tracks()?,
            playlists: self.read_playlists()?,
        })
    }

    pub fn read_beat_grid(&self, analysis_data_path: &str) -> Vec<RekordboxBeat> {
        self.resolve_analysis_path(analysis_data_path)
            .map(|path| parse_beat_grid_file(&path))
            .unwrap_or_default()
    }

    fn resolve_analysis_path(&self, analysis_data_path: &str) -> Option<PathBuf> {
        let direct = PathBuf::from(analysis_data_path);
        if direct.is_file() {
            return Some(direct);
        }

        let relative = analysis_data_path.trim_start_matches('/');
        self.analysis_roots
            .iter()
            .map(|root| root.join(relative))
            .find(|path| path.is_file())
    }

    pub fn read_playlists(&self) -> Result<Vec<RekordboxPlaylist>> {
        let mut track_ids_by_playlist = HashMap::<String, Vec<(i64, String)>>::new();
        let mut membership_statement = self.connection.prepare(
            r#"
            SELECT PlaylistID, ContentID, COALESCE(TrackNo, 0)
            FROM djmdSongPlaylist
            WHERE COALESCE(rb_local_deleted, 0) = 0
              AND PlaylistID IS NOT NULL
              AND ContentID IS NOT NULL
            ORDER BY PlaylistID, COALESCE(TrackNo, 0), ID
            "#,
        )?;

        let memberships = membership_statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        for membership in memberships {
            let (playlist_id, content_id, track_no) = membership?;
            track_ids_by_playlist
                .entry(playlist_id)
                .or_default()
                .push((track_no, content_id));
        }

        let mut statement = self.connection.prepare(
            r#"
            SELECT ID, Name, ParentID, Seq, Attribute, UUID, created_at, updated_at
            FROM djmdPlaylist
            WHERE COALESCE(rb_local_deleted, 0) = 0
            ORDER BY
                CASE WHEN ParentID = 'root' OR ParentID IS NULL THEN 0 ELSE 1 END,
                COALESCE(ParentID, ''),
                COALESCE(Seq, 0),
                Name
            "#,
        )?;

        let rows = statement.query_map([], |row| {
            let id: String = row.get(0)?;
            let attribute: Option<i64> = row.get(4)?;
            let mut track_ids = track_ids_by_playlist.remove(&id).unwrap_or_default();
            track_ids.sort_by_key(|(track_no, _)| *track_no);

            Ok(RekordboxPlaylist {
                id,
                name: empty_to_none(row.get(1)?).unwrap_or_else(|| "Untitled Playlist".to_string()),
                parent_id: normalize_parent_id(empty_to_none(row.get(2)?)),
                sequence: row.get(3)?,
                attribute,
                is_folder: attribute.unwrap_or(0) == 1,
                track_ids: track_ids
                    .into_iter()
                    .map(|(_, content_id)| content_id)
                    .collect(),
                uuid: empty_to_none(row.get(5)?),
                created_at: empty_to_none(row.get(6)?),
                updated_at: empty_to_none(row.get(7)?),
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(RekordboxError::from)
    }
}

fn analysis_roots(master_db_path: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(parent) = master_db_path.parent() {
        roots.push(parent.join("share"));
    }

    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Library/Pioneer/rekordbox/share"));
    }

    roots
}

fn parse_beat_grid_file(path: &Path) -> Vec<RekordboxBeat> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };

    parse_beat_grid(&bytes)
}

fn parse_beat_grid(bytes: &[u8]) -> Vec<RekordboxBeat> {
    let Some(offset) = find_tag(bytes, b"PQTZ") else {
        return Vec::new();
    };

    if offset + 24 > bytes.len() {
        return Vec::new();
    }

    let tag_len = read_u32_be(bytes, offset + 8).unwrap_or(0) as usize;
    let beat_count = read_u32_be(bytes, offset + 20).unwrap_or(0) as usize;
    let tag_end = offset.saturating_add(tag_len).min(bytes.len());
    let entry_start = offset + 24;
    let max_entries = tag_end.saturating_sub(entry_start) / 8;
    let entry_count = beat_count.min(max_entries);

    (0..entry_count)
        .filter_map(|index| {
            let entry = entry_start + index * 8;
            let beat_number = read_u16_be(bytes, entry)? as i64;
            let bpm_raw = read_u16_be(bytes, entry + 2)?;
            let time_ms = read_u32_be(bytes, entry + 4)?;

            Some(RekordboxBeat {
                time_seconds: time_ms as f64 / 1000.0,
                beat_number,
                bpm: (bpm_raw > 0).then_some(bpm_raw as f64 / 100.0),
            })
        })
        .collect()
}

fn find_tag(bytes: &[u8], tag: &[u8; 4]) -> Option<usize> {
    bytes.windows(4).position(|window| window == tag)
}

fn read_u16_be(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32_be(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    })
}

fn normalize_file_path(folder_path: Option<&str>, file_name: Option<&str>) -> Option<String> {
    match (folder_path, file_name) {
        (Some(path), Some(file_name)) if !path.ends_with(file_name) => Some(
            PathBuf::from(path)
                .join(file_name)
                .to_string_lossy()
                .into_owned(),
        ),
        (Some(path), _) => Some(path.to_string()),
        (None, Some(file_name)) => Some(file_name.to_string()),
        (None, None) => None,
    }
}

fn normalize_parent_id(parent_id: Option<String>) -> Option<String> {
    parent_id.and_then(|parent_id| {
        if parent_id == "root" {
            None
        } else {
            Some(parent_id)
        }
    })
}

fn file_type_name(file_type: i64) -> Option<&'static str> {
    match file_type {
        1 => Some("MP3"),
        4 => Some("WAV"),
        5 => Some("AIFF"),
        11 => Some("WAV"),
        12 => Some("FLAC"),
        25 => Some("M4A"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_master_db() -> PathBuf {
        std::env::var_os("PLAYCIRCLE_REKORDBOX_DEMO_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../playcircle-rekordbox-demo")
            })
            .join("master.db")
    }

    #[test]
    fn opens_encrypted_rekordbox_master_database() {
        let db = RekordboxDatabase::open(fixture_master_db()).expect("open encrypted rekordbox db");
        let tracks = db.read_tracks().expect("read tracks");

        assert_eq!(tracks.len(), 1974);
    }

    #[test]
    fn parses_track_details_with_reference_tables() {
        let db = RekordboxDatabase::open(fixture_master_db()).expect("open encrypted rekordbox db");
        let tracks = db.read_tracks().expect("read tracks");
        let demo_track = tracks
            .iter()
            .find(|track| track.title.as_deref() == Some("Demo Track 1"))
            .expect("Demo Track 1 fixture row");

        assert_eq!(demo_track.artist.as_deref(), Some("Loopmasters"));
        assert_eq!(demo_track.bpm, Some(128.0));
        assert_eq!(demo_track.length_seconds, Some(172));
        assert_eq!(demo_track.file_type_name.as_deref(), Some("MP3"));
        assert_eq!(demo_track.file_name.as_deref(), Some("Demo Track 1.mp3"));
        assert_eq!(demo_track.analyzed, true);
        assert!(demo_track
            .file_path
            .as_deref()
            .unwrap_or_default()
            .ends_with("Demo Track 1.mp3"));
    }

    #[test]
    fn parses_rekordbox_analysis_beat_grid() {
        let db = RekordboxDatabase::open(fixture_master_db()).expect("open encrypted rekordbox db");
        let tracks = db.read_tracks().expect("read tracks");
        let analysis_path = tracks
            .iter()
            .find_map(|track| track.analysis_data_path.as_deref())
            .expect("track with analysis path");
        let beat_grid = db.read_beat_grid(analysis_path);
        let first = &beat_grid[0];
        let second = &beat_grid[1];

        assert!(beat_grid.len() > 8);
        assert!(first.time_seconds >= 0.0);
        assert!(second.time_seconds > first.time_seconds);
        assert!(first.bpm.unwrap_or_default() > 0.0);
    }

    #[test]
    fn parses_playlist_tree_and_membership() {
        let db = RekordboxDatabase::open(fixture_master_db()).expect("open encrypted rekordbox db");
        let playlists = db.read_playlists().expect("read playlists");
        let folder = playlists
            .iter()
            .find(|playlist| playlist.name == "hq")
            .expect("hq folder");
        let child = playlists
            .iter()
            .find(|playlist| playlist.name == "indie dance hq")
            .expect("indie dance hq playlist");

        assert_eq!(playlists.len(), 23);
        assert!(folder.is_folder);
        assert_eq!(folder.parent_id, None);
        assert_eq!(child.parent_id.as_deref(), Some(folder.id.as_str()));
        assert_eq!(child.track_ids.len(), 85);
    }

    #[test]
    fn wrong_key_fails_before_reading_tracks() {
        let result = RekordboxDatabase::open_with_key(fixture_master_db(), "wrong");

        assert!(result.is_err());
    }
}
