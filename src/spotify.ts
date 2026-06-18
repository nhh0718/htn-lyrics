const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";

export function getSpotifyRedirectUri(): string {
  const base =
    process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "";
  return `${base.replace(/\/$/, "")}/spotify/callback`;
}

export function generateSpotifyAuthUrl(state: string): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) throw new Error("Thiếu SPOTIFY_CLIENT_ID");

  const redirectUri = getSpotifyRedirectUri();
  const scopes = ["user-read-currently-playing", "user-read-playback-state"].join(
    " "
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeSpotifyCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const redirectUri = getSpotifyRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Spotify token exchange failed: ${res.status} ${err}`);
  }

  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

export async function refreshSpotifyToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Spotify refresh failed: ${res.status} ${err}`);
  }

  return (await res.json()) as { access_token: string; expires_in: number };
}

export async function getCurrentlyPlaying(
  accessToken: string
): Promise<{
  isPlaying: boolean;
  trackName: string;
  artistName: string;
  albumName: string;
  imageUrl?: string;
  trackUrl?: string;
} | null> {
  const res = await fetch(`${SPOTIFY_API_URL}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204) return null; // nothing playing
  if (!res.ok) {
    const body = await res.text();
    console.error(`[Spotify API] currently-playing error ${res.status}: ${body.slice(0, 500)}`);
    throw new Error(`Spotify API error: ${res.status} — ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;

  return {
    isPlaying: data.is_playing,
    trackName: data.item?.name || "Unknown",
    artistName:
      data.item?.artists?.map((a: any) => a.name).join(", ") || "Unknown",
    albumName: data.item?.album?.name || "",
    imageUrl: data.item?.album?.images?.[0]?.url,
    trackUrl: data.item?.external_urls?.spotify,
  };
}
