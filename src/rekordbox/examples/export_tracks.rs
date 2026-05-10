use std::path::PathBuf;

use playcircle_rekordbox::RekordboxDatabase;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../playcircle-rekordbox-demo/master.db")
        });
    let db = RekordboxDatabase::open(db_path)?;
    let tracks = db.read_library()?;

    serde_json::to_writer(std::io::stdout(), &tracks)?;
    Ok(())
}
