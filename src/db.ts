import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DATABASE_URL || "./data/spotify.db";

// Đảm bảo thư mục tồn tại
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS spotify_auth (
    chat_id   INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    username  TEXT,
    first_name TEXT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL,
    connected_at  INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, user_id)
  );
`);

export type SpotifyAuthRow = {
  chat_id: number;
  user_id: number;
  username: string | null;
  first_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

// ── Helpers ──
export function saveSpotifyAuth(row: SpotifyAuthRow): void {
  const stmt = db.prepare(`
    INSERT INTO spotify_auth
      (chat_id, user_id, username, first_name, access_token, refresh_token, expires_at)
    VALUES
      (@chat_id, @user_id, @username, @first_name, @access_token, @refresh_token, @expires_at)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      connected_at = unixepoch()
  `);
  stmt.run(row);
}

export function getSpotifyAuth(
  chatId: number,
  userId: number
): SpotifyAuthRow | undefined {
  const stmt = db.prepare(
    `SELECT * FROM spotify_auth WHERE chat_id = ? AND user_id = ?`
  );
  return stmt.get(chatId, userId) as SpotifyAuthRow | undefined;
}

export function getSpotifyAuthsByChat(
  chatId: number
): SpotifyAuthRow[] {
  const stmt = db.prepare(
    `SELECT * FROM spotify_auth WHERE chat_id = ? ORDER BY first_name, username`
  );
  return stmt.all(chatId) as SpotifyAuthRow[];
}

export function deleteSpotifyAuth(chatId: number, userId: number): boolean {
  const stmt = db.prepare(
    `DELETE FROM spotify_auth WHERE chat_id = ? AND user_id = ?`
  );
  const info = stmt.run(chatId, userId);
  return info.changes > 0;
}

export function isSpotifyConnected(
  chatId: number,
  userId: number
): boolean {
  const row = getSpotifyAuth(chatId, userId);
  if (!row) return false;
  // Coi như hết hạn nếu expires_at < now + 60s buffer
  return row.expires_at > Date.now() / 1000 + 60;
}
