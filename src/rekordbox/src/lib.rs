use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

pub const DEFAULT_REKORDBOX_SQLCIPHER_KEY: &str =
    "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";

#[derive(Debug)]
pub enum RekordboxError {
    Sqlite(rusqlite::Error),
    Io(std::io::Error),
    Validation(String),
}

impl std::fmt::Display for RekordboxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Validation(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for RekordboxError {}

impl From<rusqlite::Error> for RekordboxError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<std::io::Error> for RekordboxError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub type Result<T> = std::result::Result<T, RekordboxError>;

#[derive(Debug)]
pub struct RekordboxDatabase {
    connection: Connection,
    path: PathBuf,
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
        Self::open_with_key_and_flags(
            path,
            key,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
    }

    pub fn open_read_write(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_read_write_with_key(path, DEFAULT_REKORDBOX_SQLCIPHER_KEY)
    }

    pub fn open_read_write_with_key(path: impl AsRef<Path>, key: &str) -> Result<Self> {
        Self::open_with_key_and_flags(
            path,
            key,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
    }

    fn open_with_key_and_flags(
        path: impl AsRef<Path>,
        key: &str,
        flags: OpenFlags,
    ) -> Result<Self> {
        let path = path.as_ref();
        let connection = Connection::open_with_flags(path, flags)?;

        connection.pragma_update(None, "key", key)?;
        // Force a read immediately so wrong keys fail at open time instead of later queries.
        connection.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;

        Ok(Self {
            connection,
            path: path.to_path_buf(),
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

    pub fn create_playlist(
        &mut self,
        parent_id: Option<&str>,
        name: &str,
    ) -> Result<RekordboxPlaylist> {
        let name = name.trim();
        if name.is_empty() {
            return Err(RekordboxError::Validation(
                "playlist name cannot be empty".to_string(),
            ));
        }

        self.backup_database_file()?;
        let parent_id = parent_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("root");

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        if parent_id != "root" {
            let parent_exists: Option<i64> = transaction
                .query_row(
                    r#"
                    SELECT 1
                    FROM djmdPlaylist
                    WHERE ID = ?1
                      AND COALESCE(rb_local_deleted, 0) = 0
                    "#,
                    [parent_id],
                    |row| row.get(0),
                )
                .optional()?;
            if parent_exists.is_none() {
                return Err(RekordboxError::Validation(format!(
                    "playlist parent {parent_id} does not exist"
                )));
            }
        }

        let id = next_numeric_playlist_id(&transaction)?;
        let sequence = next_playlist_sequence(&transaction, parent_id)?;
        let uuid = random_uuid(&transaction)?;
        let rb_local_usn = next_local_usn(&transaction, "djmdPlaylist")?;

        transaction.execute(
            r#"
            INSERT INTO djmdPlaylist (
                ID, Seq, Name, ImagePath, Attribute, ParentID, SmartList, UUID,
                rb_data_status, rb_local_data_status, rb_local_deleted, rb_local_synced,
                usn, rb_local_usn, created_at, updated_at
            )
            VALUES (
                ?1, ?2, ?3, '', 0, ?4, '', ?5,
                0, 1, 0, 0,
                NULL, ?6, strftime('%Y-%m-%d %H:%M:%f +00:00', 'now'), strftime('%Y-%m-%d %H:%M:%f +00:00', 'now')
            )
            "#,
            (&id, sequence, name, parent_id, &uuid, rb_local_usn),
        )?;
        transaction.commit()?;

        self.read_playlist(&id)
    }

    pub fn add_tracks_to_playlist(
        &mut self,
        playlist_id: &str,
        track_ids: &[String],
    ) -> Result<RekordboxPlaylist> {
        if playlist_id.trim().is_empty() {
            return Err(RekordboxError::Validation(
                "playlist id cannot be empty".to_string(),
            ));
        }
        if track_ids.is_empty() {
            return self.read_playlist(playlist_id);
        }

        self.backup_database_file()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        let is_folder: Option<i64> = transaction
            .query_row(
                r#"
                SELECT COALESCE(Attribute, 0)
                FROM djmdPlaylist
                WHERE ID = ?1
                  AND COALESCE(rb_local_deleted, 0) = 0
                "#,
                [playlist_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(attribute) = is_folder else {
            return Err(RekordboxError::Validation(format!(
                "playlist {playlist_id} does not exist"
            )));
        };
        if attribute == 1 {
            return Err(RekordboxError::Validation(
                "cannot add tracks to a playlist folder".to_string(),
            ));
        }

        let mut existing_content_statement = transaction.prepare(
            r#"
            SELECT ContentID
            FROM djmdSongPlaylist
            WHERE PlaylistID = ?1
              AND COALESCE(rb_local_deleted, 0) = 0
            "#,
        )?;
        let existing_rows =
            existing_content_statement.query_map([playlist_id], |row| row.get::<_, String>(0))?;
        let mut existing_track_ids = existing_rows.collect::<std::result::Result<Vec<_>, _>>()?;
        drop(existing_content_statement);

        let mut last_track_no: i64 = transaction.query_row(
            r#"
            SELECT COALESCE(MAX(TrackNo), 0)
            FROM djmdSongPlaylist
            WHERE PlaylistID = ?1
              AND COALESCE(rb_local_deleted, 0) = 0
            "#,
            [playlist_id],
            |row| row.get(0),
        )?;

        for track_id in track_ids {
            if existing_track_ids.iter().any(|id| id == track_id) {
                continue;
            }

            let track_exists: Option<i64> = transaction
                .query_row(
                    r#"
                    SELECT 1
                    FROM djmdContent
                    WHERE ID = ?1
                      AND COALESCE(rb_local_deleted, 0) = 0
                    "#,
                    [track_id],
                    |row| row.get(0),
                )
                .optional()?;
            if track_exists.is_none() {
                return Err(RekordboxError::Validation(format!(
                    "track {track_id} does not exist"
                )));
            }

            last_track_no += 1;
            let id = random_uuid(&transaction)?;
            let uuid = random_uuid(&transaction)?;
            let rb_local_usn = next_local_usn(&transaction, "djmdSongPlaylist")?;
            transaction.execute(
                r#"
                INSERT INTO djmdSongPlaylist (
                    ID, PlaylistID, ContentID, TrackNo, UUID,
                    rb_data_status, rb_local_data_status, rb_local_deleted, rb_local_synced,
                    usn, rb_local_usn, created_at, updated_at
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5,
                    0, 1, 0, 0,
                    NULL, ?6, strftime('%Y-%m-%d %H:%M:%f +00:00', 'now'), strftime('%Y-%m-%d %H:%M:%f +00:00', 'now')
                )
                "#,
                (&id, playlist_id, track_id, last_track_no, &uuid, rb_local_usn),
            )?;
            existing_track_ids.push(track_id.clone());
        }

        transaction.execute(
            "UPDATE djmdPlaylist SET updated_at = strftime('%Y-%m-%d %H:%M:%f +00:00', 'now'), rb_local_data_status = 1 WHERE ID = ?1",
            [playlist_id],
        )?;
        transaction.commit()?;

        self.read_playlist(playlist_id)
    }

    pub fn move_playlist_to_folder(
        &mut self,
        playlist_id: &str,
        folder_id: &str,
    ) -> Result<RekordboxPlaylist> {
        if playlist_id.trim().is_empty() {
            return Err(RekordboxError::Validation(
                "playlist id cannot be empty".to_string(),
            ));
        }
        if folder_id.trim().is_empty() {
            return Err(RekordboxError::Validation(
                "folder id cannot be empty".to_string(),
            ));
        }
        if playlist_id == folder_id {
            return Err(RekordboxError::Validation(
                "cannot move a playlist under itself".to_string(),
            ));
        }

        self.backup_database_file()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        let playlist_exists: Option<i64> = transaction
            .query_row(
                r#"
                SELECT 1
                FROM djmdPlaylist
                WHERE ID = ?1
                  AND COALESCE(rb_local_deleted, 0) = 0
                "#,
                [playlist_id],
                |row| row.get(0),
            )
            .optional()?;
        if playlist_exists.is_none() {
            return Err(RekordboxError::Validation(format!(
                "playlist {playlist_id} does not exist"
            )));
        }

        let folder_attribute: Option<i64> = transaction
            .query_row(
                r#"
                SELECT COALESCE(Attribute, 0)
                FROM djmdPlaylist
                WHERE ID = ?1
                  AND COALESCE(rb_local_deleted, 0) = 0
                "#,
                [folder_id],
                |row| row.get(0),
            )
            .optional()?;
        if folder_attribute != Some(1) {
            return Err(RekordboxError::Validation(format!(
                "playlist {folder_id} is not a folder"
            )));
        }

        if playlist_descendants(&transaction, playlist_id)?
            .iter()
            .any(|id| id == folder_id)
        {
            return Err(RekordboxError::Validation(
                "cannot move a playlist under one of its descendants".to_string(),
            ));
        }

        let sequence = next_playlist_sequence(&transaction, folder_id)?;
        let rb_local_usn = next_local_usn(&transaction, "djmdPlaylist")?;
        transaction.execute(
            r#"
            UPDATE djmdPlaylist
            SET ParentID = ?1,
                Seq = ?2,
                rb_local_data_status = 1,
                rb_local_usn = ?3,
                updated_at = strftime('%Y-%m-%d %H:%M:%f +00:00', 'now')
            WHERE ID = ?4
            "#,
            (folder_id, sequence, rb_local_usn, playlist_id),
        )?;
        transaction.commit()?;

        self.read_playlist(playlist_id)
    }

    fn read_playlist(&self, playlist_id: &str) -> Result<RekordboxPlaylist> {
        self.read_playlists()?
            .into_iter()
            .find(|playlist| playlist.id == playlist_id)
            .ok_or_else(|| {
                RekordboxError::Validation(format!("playlist {playlist_id} does not exist"))
            })
    }

    fn backup_database_file(&self) -> Result<PathBuf> {
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let file_name = self
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("master.db");
        let backup_name = format!("{file_name}.playcircle-backup-{timestamp_ms}.db");
        let backup_path = self.path.with_file_name(backup_name);
        fs::copy(&self.path, &backup_path)?;
        Ok(backup_path)
    }
}

fn next_numeric_playlist_id(connection: &Connection) -> Result<String> {
    let next_id: i64 = connection.query_row(
        r#"
        SELECT COALESCE(MAX(CASE WHEN ID GLOB '[0-9]*' THEN CAST(ID AS INTEGER) ELSE 0 END), 0) + 1
        FROM djmdPlaylist
        "#,
        [],
        |row| row.get(0),
    )?;
    Ok(next_id.to_string())
}

fn next_playlist_sequence(connection: &Connection, parent_id: &str) -> Result<i64> {
    let next_sequence: i64 = connection.query_row(
        r#"
        SELECT COALESCE(MAX(Seq), 0) + 1
        FROM djmdPlaylist
        WHERE COALESCE(ParentID, 'root') = ?1
          AND COALESCE(rb_local_deleted, 0) = 0
        "#,
        [parent_id],
        |row| row.get(0),
    )?;
    Ok(next_sequence)
}

fn next_local_usn(connection: &Connection, table_name: &str) -> Result<i64> {
    let sql = format!("SELECT COALESCE(MAX(rb_local_usn), 0) + 1 FROM {table_name}");
    let next_usn = connection.query_row(&sql, [], |row| row.get(0))?;
    Ok(next_usn)
}

fn playlist_descendants(connection: &Connection, playlist_id: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(
        r#"
        SELECT ID, ParentID
        FROM djmdPlaylist
        WHERE COALESCE(rb_local_deleted, 0) = 0
          AND ParentID IS NOT NULL
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut children_by_parent = HashMap::<String, Vec<String>>::new();
    for row in rows {
        let (id, parent_id) = row?;
        children_by_parent.entry(parent_id).or_default().push(id);
    }

    let mut descendants = Vec::new();
    let mut stack = children_by_parent.remove(playlist_id).unwrap_or_default();
    while let Some(id) = stack.pop() {
        if let Some(children) = children_by_parent.remove(&id) {
            stack.extend(children);
        }
        descendants.push(id);
    }
    Ok(descendants)
}

fn random_uuid(connection: &Connection) -> Result<String> {
    connection
        .query_row(
            r#"
            SELECT lower(hex(randomblob(4))) || '-' ||
                   lower(hex(randomblob(2))) || '-' ||
                   '4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
                   substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
                   lower(hex(randomblob(6)))
            "#,
            [],
            |row| row.get(0),
        )
        .map_err(RekordboxError::from)
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

    fn writable_fixture_copy() -> PathBuf {
        let source = fixture_master_db();
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let target = std::env::temp_dir().join(format!("playcircle-rekordbox-write-{unique}.db"));
        fs::copy(source, &target).expect("copy rekordbox fixture");
        target
    }

    fn remove_fixture_copy_and_backups(path: &Path) {
        let Some(parent) = path.parent() else {
            return;
        };
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            return;
        };
        let backup_prefix = format!("{file_name}.playcircle-backup-");
        let _ = fs::remove_file(path);
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name
                    .to_str()
                    .is_some_and(|value| value.starts_with(&backup_prefix))
                {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
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

        assert!(playlists.len() >= 23);
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

    #[test]
    fn creates_playlist_in_writable_database_copy() {
        let path = writable_fixture_copy();
        let mut db =
            RekordboxDatabase::open_read_write(&path).expect("open writable rekordbox copy");

        let playlist = db
            .create_playlist(None, "Playcircle Test")
            .expect("create playlist");

        assert_eq!(playlist.name, "Playcircle Test");
        assert_eq!(playlist.parent_id, None);
        assert!(!playlist.is_folder);

        drop(db);
        let db = RekordboxDatabase::open(&path).expect("reopen copy readonly");
        let playlists = db.read_playlists().expect("read playlists");
        assert!(playlists
            .iter()
            .any(|item| item.id == playlist.id && item.name == "Playcircle Test"));
        remove_fixture_copy_and_backups(&path);
    }

    #[test]
    fn appends_tracks_to_playlist_in_writable_database_copy() {
        let path = writable_fixture_copy();
        let mut db =
            RekordboxDatabase::open_read_write(&path).expect("open writable rekordbox copy");
        let tracks = db.read_tracks().expect("read tracks");
        let track_ids = tracks
            .iter()
            .take(3)
            .map(|track| track.id.clone())
            .collect::<Vec<_>>();
        let playlist = db
            .create_playlist(None, "Playcircle Add Test")
            .expect("create playlist");

        let playlist = db
            .add_tracks_to_playlist(&playlist.id, &track_ids)
            .expect("add tracks");

        assert_eq!(playlist.track_ids, track_ids);

        let playlist = db
            .add_tracks_to_playlist(&playlist.id, &playlist.track_ids.clone())
            .expect("skip duplicate tracks");
        assert_eq!(playlist.track_ids.len(), 3);
        remove_fixture_copy_and_backups(&path);
    }

    #[test]
    fn moves_playlist_under_folder_in_writable_database_copy() {
        let path = writable_fixture_copy();
        let mut db =
            RekordboxDatabase::open_read_write(&path).expect("open writable rekordbox copy");
        let folder_id = db
            .read_playlists()
            .expect("read playlists")
            .into_iter()
            .find(|playlist| playlist.is_folder)
            .expect("fixture folder")
            .id;
        let playlist = db
            .create_playlist(None, "Playcircle Move Test")
            .expect("create playlist");

        let moved = db
            .move_playlist_to_folder(&playlist.id, &folder_id)
            .expect("move playlist");

        assert_eq!(moved.parent_id.as_deref(), Some(folder_id.as_str()));
        drop(db);
        let db = RekordboxDatabase::open(&path).expect("reopen copy readonly");
        let moved = db
            .read_playlists()
            .expect("read playlists")
            .into_iter()
            .find(|item| item.id == playlist.id)
            .expect("moved playlist");
        assert_eq!(moved.parent_id.as_deref(), Some(folder_id.as_str()));
        remove_fixture_copy_and_backups(&path);
    }
}
