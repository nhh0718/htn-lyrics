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
 * Scrape lyric từ trang bài hát Genius.
 * Genius không cung cấp lyric qua API nên phải parse HTML.
 */
export async function fetchLyrics(songUrl: string): Promise<string> {
  const res = await fetch(songUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    throw new Error(`Không tải được trang lyric: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Genius render lyric trong các div[data-lyrics-container="true"].
  const containers = $('[data-lyrics-container="true"]');

  if (containers.length === 0) {
    // Fallback: layout cũ
    const legacy = $(".lyrics").text().trim();
    if (legacy) return cleanLyrics(legacy);
    throw new Error("Không tìm thấy nội dung lyric trên trang.");
  }

  let lyrics = "";
  containers.each((_, el) => {
    // Thay <br> bằng xuống dòng để giữ format.
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
