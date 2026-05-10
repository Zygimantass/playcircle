import fs from "node:fs";

const fixturePath = new URL("../public/rekordbox-demo-tracks.json", import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const tracks = Array.isArray(fixture) ? fixture : fixture.tracks;
const track = tracks.find((item) => item.file_path && fs.existsSync(item.file_path));

if (!track) {
  console.error("No existing local audio file found in public/rekordbox-demo-tracks.json");
  process.exit(1);
}

process.stdout.write(track.file_path);
