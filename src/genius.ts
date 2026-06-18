import * as cheerio from "cheerio";

const GENIUS_API = "https://api.genius.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface SongHit {
  id: number;
  title: string;
  artist: string;
  fullTitle: string;
  url: string;
}

function getToken(): string {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) throw new Error("Thiếu biến môi trường GENIUS_ACCESS_TOKEN");
  return token;
}

/**
 * Tìm bài hát trên Genius qua API chính thức /search.
 * Trả về tối đa `limit` kết quả.
 */
export async function searchSongs(query: string, limit = 6): Promise<SongHit[]> {
  const res = await fetch(
    `${GENIUS_API}/search?q=${encodeURIComponent(query)}`,
    {
      headers: { Authorization: `Bearer ${getToken()}` },
    }
  );

  if (!res.ok) {
    throw new Error(`Genius search lỗi: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    response?: { hits?: Array<{ result: any }> };
  };

  const hits = data.response?.hits ?? [];
  return hits
    .filter((h) => h.result?.id && h.result?.url)
    .slice(0, limit)
    .map((h) => ({
      id: h.result.id,
      title: h.result.title,
      artist: h.result.primary_artist?.name ?? "Unknown",
      fullTitle: h.result.full_title,
      url: h.result.url,
    }));
}

/**
 * Lấy thông tin 1 bài hát theo id (để có URL chính xác từ callback).
 */
export async function getSong(id: number): Promise<SongHit | null> {
  const res = await fetch(`${GENIUS_API}/songs/${id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { response?: { song?: any } };
  const song = data.response?.song;
  if (!song) return null;

  return {
    id: song.id,
    title: song.title,
    artist: song.primary_artist?.name ?? "Unknown",
    fullTitle: song.full_title,
    url: song.url,
  };
}

/**
 * Header giả lập trình duyệt thật để Genius không trả 403 (hay gặp khi gọi
 * từ IP datacenter như Vercel/AWS).
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://genius.com/",
};

export interface LyricsResult {
  text: string;
  source: "LRCLIB" | "Genius";
}

/**
 * Lấy lyric cho 1 bài hát theo nhiều nguồn (chống việc Genius chặn IP serverless):
 *  1. LRCLIB — API miễn phí, không chặn IP, ổn định nhất cho serverless.
 *  2. Genius scrape — fallback (có thể bị 403 trên Vercel).
 */
export async function getLyrics(song: SongHit): Promise<LyricsResult> {
  const fromLrclib = await fetchFromLrclib(song.title, song.artist);
  if (fromLrclib) return { text: fromLrclib, source: "LRCLIB" };

  const fromGenius = await fetchFromGenius(song.url);
  return { text: fromGenius, source: "Genius" };
}

/**
 * Nguồn 1: LRCLIB (https://lrclib.net) — trả lyric thường (plain).
 * Không cần API key. Trả null nếu không tìm thấy.
 */
async function fetchFromLrclib(
  title: string,
  artist: string
): Promise<string | null> {
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(
      `${title} ${artist}`
    )}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "lyrics-bot (https://github.com/nhh0718/htn-lyrics)",
      },
    });
    if (!res.ok) return null;

    const items = (await res.json()) as Array<{
      plainLyrics?: string | null;
      syncedLyrics?: string | null;
    }>;

    const hit = items.find((i) => i.plainLyrics && i.plainLyrics.trim());
    if (!hit?.plainLyrics) return null;
    return cleanLyrics(hit.plainLyrics);
  } catch {
    return null;
  }
}

/**
 * Nguồn 2: Scrape trang Genius. Thử trực tiếp trước; nếu bị chặn (403) thì
 * thử lại qua proxy public (allorigins) để fetch từ IP không bị chặn.
 */
async function fetchFromGenius(songUrl: string): Promise<string> {
  const html = await fetchGeniusHtml(songUrl);
  const $ = cheerio.load(html);

  const containers = $('[data-lyrics-container="true"]');

  if (containers.length === 0) {
    const legacy = $(".lyrics").text().trim();
    if (legacy) return cleanLyrics(legacy);
    throw new Error("Không tìm thấy nội dung lyric trên trang.");
  }

  let lyrics = "";
  containers.each((_, el) => {
    const part = $(el)
      .html()
      ?.replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|p)>/gi, "\n");
    if (part) {
      lyrics += cheerio.load(part).text();
    }
  });

  return cleanLyrics(lyrics);
}

/**
 * Tải HTML trang Genius: thử trực tiếp, nếu 403/429/lỗi thì thử qua proxy.
 */
async function fetchGeniusHtml(songUrl: string): Promise<string> {
  try {
    const res = await fetch(songUrl, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    if (res.ok) return await res.text();
  } catch {
    // bỏ qua, chuyển sang proxy
  }

  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(
    songUrl
  )}`;
  const res = await fetch(proxied, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Không tải được trang lyric: ${res.status}`);
  }
  return await res.text();
}

/**
 * Dọn dẹp lyric thô từ Genius:
 *  - Bỏ phần header rác ("N ContributorsTên bài Lyrics", danh sách Translations...).
 *  - Bỏ quảng cáo chèn giữa bài ("You might also like", "Get tickets...").
 *  - Bỏ đuôi "...Embed" / "...123Embed".
 *  - Chuẩn hóa khoảng trắng và thêm dòng trống trước mỗi đoạn [Verse]/[Chorus]...
 */
function cleanLyrics(text: string): string {
  let t = text.replace(/\r/g, "");

  // 1) Cắt bỏ phần mở đầu của Genius cho tới "... Lyrics" (gồm "N Contributors",
  //    "Translations", danh sách ngôn ngữ...). Chỉ cắt nếu nằm ở đầu trang.
  const lyricsHeader = t.match(/Lyrics(?:\s|$)/);
  if (lyricsHeader && lyricsHeader.index !== undefined && lyricsHeader.index < 400) {
    t = t.slice(lyricsHeader.index + lyricsHeader[0].length);
  }

  // 2) Bỏ quảng cáo Genius chèn vào nội dung.
  t = t
    .replace(/You might also like/gi, "\n")
    .replace(/^.*Get tickets as low as.*$/gim, "")
    .replace(/^See .+ LiveGet tickets.*$/gim, "");

  // 3) Bỏ đuôi "Embed" và số lượt xem dính kèm ở cuối bài.
  t = t.replace(/\d*Embed\s*$/i, "");

  // 4) Chuẩn hóa từng dòng + thêm dòng trống trước mỗi tiêu đề đoạn [..].
  const lines = t
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""));

  const out: string[] = [];
  for (const line of lines) {
    if (/^\[.*\]$/.test(line) && out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
    out.push(line);
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
