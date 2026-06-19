import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Schema ──
await pool.query(`
  CREATE TABLE IF NOT EXISTS spotify_auth (
    chat_id       BIGINT NOT NULL,
    user_id       BIGINT NOT NULL,
    username      TEXT,
    first_name    TEXT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    BIGINT NOT NULL,
    connected_at  BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT),
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
export async function saveSpotifyAuth(row: SpotifyAuthRow): Promise<void> {
  await pool.query(
    `
    INSERT INTO spotify_auth
      (chat_id, user_id, username, first_name, access_token, refresh_token, expires_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (chat_id, user_id) DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      connected_at = EXTRACT(EPOCH FROM NOW())::BIGINT
    `,
    [
      row.chat_id,
      row.user_id,
      row.username,
      row.first_name,
      row.access_token,
      row.refresh_token,
      row.expires_at,
    ]
  );
}

export async function getSpotifyAuth(
  chatId: number,
  userId: number
): Promise<SpotifyAuthRow | undefined> {
  const result = await pool.query(
    `SELECT * FROM spotify_auth WHERE chat_id = $1 AND user_id = $2`,
    [chatId, userId]
  );
  return (result.rows[0] as SpotifyAuthRow) || undefined;
}

export async function getSpotifyAuthsByChat(
  chatId: number
): Promise<SpotifyAuthRow[]> {
  const result = await pool.query(
    `SELECT * FROM spotify_auth WHERE chat_id = $1 ORDER BY first_name, username`,
    [chatId]
  );
  return result.rows as SpotifyAuthRow[];
}

export async function deleteSpotifyAuth(
  chatId: number,
  userId: number
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM spotify_auth WHERE chat_id = $1 AND user_id = $2`,
    [chatId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function isSpotifyConnected(
  chatId: number,
  userId: number
): Promise<boolean> {
  const row = await getSpotifyAuth(chatId, userId);
  if (!row) return false;
  // Coi như hết hạn nếu expires_at < now + 60s buffer
  return row.expires_at > Date.now() / 1000 + 60;
}
