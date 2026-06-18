import { Bot, InlineKeyboard } from "grammy";
import { searchSongs, getSong, getLyrics } from "./genius.js";
import {
  generateSpotifyAuthUrl,
  getCurrentlyPlaying,
  refreshSpotifyToken,
} from "./spotify.js";
import { getSpotifyUser, getSpotifyUsers, setSpotifyUser } from "./spotify-store.js";

const TELEGRAM_MAX = 4096;

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Chào bạn!\n\n<b>Lệnh có sẵn:</b>\n" +
        "• <code>/lyric &lt;tên bài&gt;</code> — tìm lời bài hát trên Genius\n" +
        "• <code>/spotify</code> — kết nối tài khoản Spotify\n" +
        "• <code>/nowplaying</code> — xem bạn bè đang phát gì 🎧\n\n" +
        "Ví dụ: <code>/lyric shape of you</code>",
      { parse_mode: "HTML" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "<b>Hướng dẫn sử dụng:</b>\n\n" +
        "<code>/lyric &lt;tên bài&gt;</code> — Tìm lời bài hát trên Genius\n" +
        "<code>/spotify</code> — Kết nối Spotify để bạn bè xem bạn đang nghe gì\n" +
        "<code>/nowplaying</code> — Xem bạn bè trong nhóm đang phát gì trên Spotify\n\n" +
        "Bot cũng hoạt động trong nhóm chat. Hãy thêm bot vào nhóm và dùng lệnh!",
      { parse_mode: "HTML" }
    );
  });

  bot.command("lyric", async (ctx) => {
    const query = ctx.match?.trim();
    if (!query) {
      await ctx.reply(
        "Vui lòng nhập tên bài hát. Ví dụ: <code>/lyric let it be</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const searching = await ctx.reply(`🔎 Đang tìm "<b>${escapeHtml(query)}</b>"...`, {
      parse_mode: "HTML",
    });

    try {
      const hits = await searchSongs(query);
      if (hits.length === 0) {
        await ctx.api.editMessageText(
          searching.chat.id,
          searching.message_id,
          `Không tìm thấy kết quả nào cho "<b>${escapeHtml(query)}</b>".`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const hit of hits) {
        const label = truncate(`${hit.title} — ${hit.artist}`, 60);
        keyboard.text(label, `lyric:${hit.id}`).row();
      }

      await ctx.api.editMessageText(
        searching.chat.id,
        searching.message_id,
        `🎵 Tìm thấy <b>${hits.length}</b> kết quả cho "<b>${escapeHtml(query)}</b>".\nChọn bài bạn muốn xem lời:`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } catch (err) {
      await ctx.api.editMessageText(
        searching.chat.id,
        searching.message_id,
        `⚠️ Lỗi khi tìm kiếm: ${escapeHtml(String((err as Error).message))}`,
        { parse_mode: "HTML" }
      );
    }
  });

  bot.command("spotify", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    if (!userId) return;

    const state = `${chatId}:${userId}:${Math.random().toString(36).slice(2)}`;
    try {
      const url = generateSpotifyAuthUrl(state);
      const keyboard = new InlineKeyboard().url("🔗 Kết nối Spotify", url);
      await ctx.reply(
        "Nhấn nút bên dưới để xác thực Spotify. Sau khi hoàn tất, bạn bè trong nhóm có thể xem bạn đang phát gì! 🎧",
        { reply_markup: keyboard }
      );
    } catch (err) {
      await ctx.reply(
        `⚠️ ${escapeHtml(String((err as Error).message))}`,
        { parse_mode: "HTML" }
      );
    }
  });

  bot.command("nowplaying", async (ctx) => {
    const chatId = ctx.chat.id;
    const users = getSpotifyUsers(chatId);

    if (!users || users.size === 0) {
      await ctx.reply(
        "Chưa có ai kết nối Spotify ở đây.\nGõ <code>/spotify</code> để kết nối! 🎧",
        { parse_mode: "HTML" }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const [uid, auth] of users) {
      const label = truncate(
        auth.firstName || auth.username || `User ${uid}`,
        60
      );
      keyboard.text(`🎵 ${label}`, `np:${chatId}:${uid}`).row();
    }

    await ctx.reply("Chọn bạn bè để xem đang phát gì trên Spotify:", {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^lyric:(\d+)$/, async (ctx) => {
    const songId = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery({ text: "Đang lấy lời bài hát..." });
    } catch {
      /* ignore */
    }

    try {
      const song = await getSong(songId);
      if (!song) {
        await ctx.reply("Không lấy được thông tin bài hát.");
        return;
      }

      const lyrics = await getLyrics(song);
      const header = `🎵 <b>${escapeHtml(song.title)}</b>\n👤 ${escapeHtml(song.artist)}\n🔗 <a href="${song.url}">Genius</a>\n\n`;

      const chunks = splitMessage(header, lyrics);
      for (const chunk of chunks) {
        await ctx.reply(chunk, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      }
    } catch (err) {
      console.error("[callback] lỗi khi lấy lyric:", err);
      await ctx.reply(
        `⚠️ Không lấy được lời bài hát: ${escapeHtml(String((err as Error).message))}`,
        { parse_mode: "HTML" }
      );
    }
  });

  bot.callbackQuery(/^np:(-?\d+):(\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);

    try {
      await ctx.answerCallbackQuery({ text: "Đang kiểm tra..." });
    } catch {
      /* ignore */
    }

    const auth = getSpotifyUser(chatId, userId);
    if (!auth) {
      await ctx.reply(
        "Người dùng này chưa kết nối Spotify hoặc đã ngắt kết nối."
      );
      return;
    }

    try {
      let token = auth.accessToken;
      if (Date.now() >= auth.expiresAt - 60_000) {
        const refreshed = await refreshSpotifyToken(auth.refreshToken);
        token = refreshed.access_token;
        auth.accessToken = token;
        auth.expiresAt = Date.now() + refreshed.expires_in * 1000;
        setSpotifyUser(chatId, auth);
      }

      const playing = await getCurrentlyPlaying(token);
      if (!playing) {
        await ctx.reply(
          `🎵 <b>${escapeHtml(auth.firstName || auth.username || "Bạn bè")}</b> hiện không phát nhạc nào trên Spotify.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const status = playing.isPlaying ? "▶️ Đang phát" : "⏸️ Tạm dừng";
      const text = [
        status,
        `🎵 <b>${escapeHtml(playing.trackName)}</b>`,
        `👤 ${escapeHtml(playing.artistName)}`,
        playing.albumName ? `💿 ${escapeHtml(playing.albumName)}` : "",
        playing.trackUrl
          ? `🔗 <a href="${playing.trackUrl}">Mở trên Spotify</a>`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      if (playing.imageUrl) {
        await ctx.replyWithPhoto(playing.imageUrl, {
          caption: text,
          parse_mode: "HTML",
        });
      } else {
        await ctx.reply(text, { parse_mode: "HTML" });
      }
    } catch (err) {
      console.error("[nowplaying] lỗi:", err);
      await ctx.reply(
        `⚠️ Không lấy được thông tin: ${escapeHtml(String((err as Error).message))}`,
        { parse_mode: "HTML" }
      );
    }
  });

  return bot;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * Định dạng từng dòng lyric: escape HTML, làm đậm + nghiêng tiêu đề đoạn [..].
 */
function formatLine(line: string): string {
  const escaped = escapeHtml(line);
  if (/^\[.*\]$/.test(line.trim())) {
    return `<b><i>${escaped}</i></b>`;
  }
  return escaped;
}

/**
 * Chia lyric thành nhiều tin nhắn dưới giới hạn 4096 ký tự của Telegram.
 * Header (tên bài, nghệ sĩ) chỉ gắn vào tin nhắn đầu tiên.
 */
function splitMessage(header: string, lyrics: string): string[] {
  const lines = lyrics.split("\n").map(formatLine);
  const body = lines.join("\n");
  const first = header + body;
  if (first.length <= TELEGRAM_MAX) return [first];

  const chunks: string[] = [];
  let current = header;

  for (const line of lines) {
    if ((current + line + "\n").length > TELEGRAM_MAX) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) chunks.push(current.trimEnd());
  return chunks;
}
