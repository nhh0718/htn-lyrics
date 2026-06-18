import * as cheerio from "cheerio";

const GENIUS_API = "https://api.genius.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * fetch có timeout để không bao giờ treo (tránh webhook serverless chạy quá lâu
 * khiến Telegram gửi lại update -> lỗi "query is too old").
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * Lấy lyric cho 1 bài hát từ Genius (scrape trang web).
 */
export async function getLyrics(song: SongHit): Promise<string> {
  console.log(`[lyrics] bắt đầu: "${song.title}" - ${song.artist} (${song.url})`);
  return fetchFromGenius(song.url);
}

/**
 * Scrape trang Genius. Thử trực tiếp trước; nếu bị chặn (403) thì
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
    const res = await fetchWithTimeout(songUrl, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    console.log(`[Genius direct] status=${res.status}, server=${res.headers.get("server") ?? "?"}, cf-ray=${res.headers.get("cf-ray") ?? "-"}`);
    if (res.ok) return await res.text();
    // Lưu một đoạn body để biết Cloudflare chặn hay lỗi gì.
    const snippet = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
    console.warn(`[Genius direct] body đầu: ${snippet}`);
  } catch (err) {
    console.error("[Genius direct] lỗi mạng:", err);
  }

  // Fallback 1: codetabs proxy
  console.log("[Genius] thử qua codetabs...");
  const proxied1 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(songUrl)}`;
  try {
    const res1 = await fetchWithTimeout(
      proxied1,
      { headers: { "User-Agent": USER_AGENT } },
      25000
    );
    console.log(`[Genius codetabs] status=${res1.status}`);
    if (res1.ok) return await res1.text();
  } catch (err) {
    console.error("[Genius codetabs] lỗi:", err);
  }

  // Fallback 2: ScraperAPI (free tier 5000 req/tháng, vượt Cloudflare ổn định)
  // Đăng ký tại https://www.scraperapi.com/ → lấy API key → thêm vào SCRAPERAPI_KEY
  const scraperKey = process.env.SCRAPERAPI_KEY;
  if (scraperKey) {
    console.log("[Genius] thử qua ScraperAPI...");
    const proxied2 = `https://api.scraperapi.com/?api_key=${scraperKey}&url=${encodeURIComponent(songUrl)}`;
    try {
      const res2 = await fetchWithTimeout(proxied2, {}, 30000);
      console.log(`[Genius ScraperAPI] status=${res2.status}`);
      if (res2.ok) return await res2.text();
    } catch (err) {
      console.error("[Genius ScraperAPI] lỗi:", err);
    }
  } else {
    console.log("[Genius] bỏ qua ScraperAPI (chưa có SCRAPERAPI_KEY)");
  }

  throw new Error(
    "Genius chặn IP datacenter (403) và tất cả proxy đều thất bại.\n" +
    "Cách khả thi nhất: đăng ký ScraperAPI (https://www.scraperapi.com) free tier " +
    "5000 request/tháng, thêm SCRAPERAPI_KEY vào biến môi trường."
  );
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
