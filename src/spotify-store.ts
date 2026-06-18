export type SpotifyAuth = {
  userId: number;
  username?: string;
  firstName?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // timestamp ms
};

const store = new Map<number, Map<number, SpotifyAuth>>();

export function getSpotifyUsers(
  chatId: number
): Map<number, SpotifyAuth> | undefined {
  return store.get(chatId);
}

export function getSpotifyUser(
  chatId: number,
  userId: number
): SpotifyAuth | undefined {
  return store.get(chatId)?.get(userId);
}

export function setSpotifyUser(chatId: number, auth: SpotifyAuth): void {
  if (!store.has(chatId)) {
    store.set(chatId, new Map());
  }
  store.get(chatId)!.set(auth.userId, auth);
}

export function removeSpotifyUser(chatId: number, userId: number): boolean {
  return store.get(chatId)?.delete(userId) ?? false;
}
