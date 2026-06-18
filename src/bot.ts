import { Bot, InlineKeyboard } from "grammy";
import { searchSongs, getSong, getLyrics } from "./genius.js";
import {
  generateSpotifyAuthUrl,
  getCurrentlyPlaying,
  refreshSpotifyToken,
} from "./spotify.js";
import {
  getSpotifyAuth,
  getSpotifyAuthsByChat,
  saveSpotifyAuth,
  deleteSpotifyAuth,
} from "./db.js";

const TELEGRAM_MAX = 4096;

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("🎵 Tìm lời bài hát", "menu:lyric")
      .row()
      .text("🎧 Kết nối Spotify", "menu:spotify")
      .row()
      .text("▶️ Bạn bè đang phát gì", "menu:np")
      .row()
      .text("❓ Trợ giúp", "menu:help");

    await ctx.reply(
      "👋 <b>Chào mừng đến với Lyrics Bot!</b>\n\n" +
        "🎵 Tìm lời bài hát trên Genius\n" +
        "🎧 Chia sẻ nhạc đang phát từ Spotify\n\n" +
        "Chọn chức năng bên dưới hoặc gõ <code>/menu</code> để mở lại menu:",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "<b>📖 Hướng dẫn sử dụng</b>\n\n" +
        "<b>/lyric &lt;tên bài&gt;</b> — Tìm lời bài hát trên Genius\n" +
        "<b>/spotify</b> — Kết nối Spotify (gửi riêng tư)\n" +
        "<b>/nowplaying</b> — Xem bạn bè đang phát gì (gửi riêng tư)\n" +
        "<b>/menu</b> — Mở menu tương tác\n\n" +
        "<i>Bot cũng hoạt động trong nhóm chat. Các luồng nhạy cảm (Spotify) sẽ tự động gửi riêng tư để tránh làm phiền nhóm.</i>",
      { parse_mode: "HTML" }
    );
  });

  bot.command("menu", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("🎵 Tìm lời bài hát", "menu:lyric")
      .row()
      .text("🎧 Kết nối Spotify", "menu:spotify")
      .row()
      .text("▶️ Bạn bè đang phát gì", "menu:np")
      .row()
      .text("❓ Trợ giúp", "menu:help");

    await ctx.reply(
      "<b>🎼 Menu chính</b>\n\nChọn chức năng bạn muốn dùng:",
      { parse_mode: "HTML", reply_markup: keyboard }
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

    const existing = getSpotifyAuth(chatId, userId);

    if (existing) {
      // Đã kết nối → hiển thị trạng thái + cho phép logout
      const name =
        existing.first_name || existing.username || `User ${userId}`;
      const keyboard = new InlineKeyboard().text(
        "🔓 Ngắt kết nối Spotify",
        `spotify:logout:${chatId}:${userId}`
      );

      await ctx.reply(
        `✅ <b>Bạn đã kết nối Spotify</b>\n\n👤 ${escapeHtml(name)}\n\n` +
          "Nhấn nút bên dưới nếu muốn ngắt kết nối:",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    // Chưa kết nối → gửi link OAuth
    const state = `${chatId}:${userId}:${Math.random().toString(36).slice(2)}`;
    try {
      const url = generateSpotifyAuthUrl(state);
      const keyboard = new InlineKeyboard().url("🔗 Kết nối Spotify", url);

      // Luôn gửi riêng tư để tránh làm phiền nhóm
      await ctx.api.sendMessage(
        userId,
        "👋 <b>Kết nối Spotify</b>\n\nNhấn nút bên dưới để xác thực. Sau khi hoàn tất, bạn bè có thể xem bạn đang phát gì! 🎧",
        { parse_mode: "HTML", reply_markup: keyboard }
      );

      // Nếu lệnh gọi trong nhóm, thông báo nhẹ trong nhóm
      if (ctx.chat.type !== "private") {
        await ctx.reply(
          "✅ Đã gửi link kết nối Spotify qua tin nhắn riêng tư!",
          { parse_mode: "HTML" }
        );
      }
    } catch (err) {
      const msg = String((err as Error).message);
      if (msg.includes("bot can't initiate conversation")) {
        await ctx.reply(
          "⚠️ Tôi chưa thể nhắn riêng cho bạn. Hãy mở chat riêng với bot và gõ <code>/start</code>, sau đó thử lại <code>/spotify</code>.",
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(`⚠️ ${escapeHtml(msg)}`, { parse_mode: "HTML" });
      }
    }
  });

  bot.command("nowplaying", async (ctx) => {
    const chatId = ctx.chat.id;
    const users = getSpotifyAuthsByChat(chatId);

    if (!users || users.length === 0) {
      await ctx.reply(
        "Chưa có ai kết nối Spotify ở đây.\nGõ <code>/spotify</code> để kết nối! 🎧",
        { parse_mode: "HTML" }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const auth of users) {
      const label = truncate(
        auth.first_name || auth.username || `User ${auth.user_id}`,
        60
      );
      keyboard.text(`🎵 ${label}`, `np:${chatId}:${auth.user_id}`).row();
    }

    await ctx.reply("🎧 Chọn bạn bè để xem đang phát gì trên Spotify:", {
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

    const auth = getSpotifyAuth(chatId, userId);
    if (!auth) {
      await ctx.reply(
        "Người dùng này chưa kết nối Spotify hoặc đã ngắt kết nối."
      );
      return;
    }

    try {
      let token = auth.access_token;
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec >= auth.expires_at - 60) {
        const refreshed = await refreshSpotifyToken(auth.refresh_token);
        token = refreshed.access_token;
        auth.access_token = token;
        auth.expires_at = nowSec + refreshed.expires_in;
        saveSpotifyAuth(auth);
      }

      const playing = await getCurrentlyPlaying(token);
      if (!playing) {
        await ctx.reply(
          `🎵 <b>${escapeHtml(auth.first_name || auth.username || "Bạn bè")}</b> hiện không phát nhạc nào trên Spotify.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const status = playing.isPlaying ? "▶️ Đang phát" : "⏸️ Tạm dừng";
      const text = [
        `🎵 <b>${escapeHtml(auth.first_name || auth.username || "Bạn bè")}</b>`,
        status,
        `\n🎵 <b>${escapeHtml(playing.trackName)}</b>`,
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
      const msg = String((err as Error).message);
      console.error("[nowplaying] lỗi:", err);

      const hint403 =
        "⚠️ <b>Spotify chặn truy cập (403)</b>\n\n" +
        "Tài khoản này chưa được thêm vào <b>User Management</b> của Spotify App.\n\n" +
        "<b>Cách sửa:</b>\n" +
        "1. Chủ app vào https://developer.spotify.com/dashboard\n" +
        "2. Chọn app → Settings → User Management\n" +
        "3. Thêm email Spotify của người bị lỗi vào danh sách\n" +
        "4. Người đó nhận email → Accept invitation\n" +
        "5. Thử lại <code>/nowplaying</code>";

      const is403 = msg.includes("403");
      await ctx.reply(
        is403 ? hint403 : `⚠️ Không lấy được thông tin: ${escapeHtml(msg)}`,
        { parse_mode: "HTML" }
      );
    }
  });

  /* ── Menu callbacks ── */
  bot.callbackQuery("menu:lyric", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Gõ /lyric <tên bài> để tìm" });
    } catch {
      /* ignore */
    }
    await ctx.reply(
      "🎵 <b>Tìm lời bài hát</b>\n\nGõ <code>/lyric &lt;tên bài hát&gt;</code> để tìm.\nVí dụ: <code>/lyric shape of you</code>",
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery("menu:spotify", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang mở kết nối Spotify..." });
    } catch {
      /* ignore */
    }

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const existing = getSpotifyAuth(chatId, userId);
    if (existing) {
      const name =
        existing.first_name || existing.username || `User ${userId}`;
      const keyboard = new InlineKeyboard().text(
        "🔓 Ngắt kết nối",
        `spotify:logout:${chatId}:${userId}`
      );
      await ctx.reply(
        `✅ <b>Đã kết nối Spotify</b>\n\n👤 ${escapeHtml(name)}\n\n` +
          "Nhấn nút bên dưới nếu muốn ngắt kết nối:",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const state = `${chatId}:${userId}:${Math.random().toString(36).slice(2)}`;
    try {
      const url = generateSpotifyAuthUrl(state);
      const keyboard = new InlineKeyboard().url("🔗 Kết nối Spotify", url);
      await ctx.api.sendMessage(
        userId,
        "👋 <b>Kết nối Spotify</b>\n\nNhấn nút bên dưới để xác thực. Sau khi hoàn tất, bạn bè có thể xem bạn đang phát gì! 🎧",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } catch (err) {
      const msg = String((err as Error).message);
      if (msg.includes("bot can't initiate conversation")) {
        await ctx.reply(
          "⚠️ Hãy mở chat riêng với bot và gõ <code>/start</code> trước, sau đó quay lại đây.",
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(`⚠️ ${escapeHtml(msg)}`, { parse_mode: "HTML" });
      }
    }
  });

  bot.callbackQuery("menu:np", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang mở danh sách..." });
    } catch {
      /* ignore */
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const users = getSpotifyAuthsByChat(chatId);
    if (!users || users.length === 0) {
      await ctx.reply(
        "Chưa có ai kết nối Spotify ở đây.\nGõ <code>/spotify</code> để kết nối! 🎧",
        { parse_mode: "HTML" }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const auth of users) {
      const label = truncate(
        auth.first_name || auth.username || `User ${auth.user_id}`,
        60
      );
      keyboard.text(`🎵 ${label}`, `np:${chatId}:${auth.user_id}`).row();
    }

    await ctx.reply("🎧 Chọn bạn bè để xem đang phát gì trên Spotify:", {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("menu:help", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang mở trợ giúp..." });
    } catch {
      /* ignore */
    }
    await ctx.reply(
      "<b>📖 Hướng dẫn sử dụng</b>\n\n" +
        "<b>/lyric &lt;tên bài&gt;</b> — Tìm lời bài hát trên Genius\n" +
        "<b>/spotify</b> — Kết nối Spotify (gửi riêng tư)\n" +
        "<b>/nowplaying</b> — Xem bạn bè đang phát gì (gửi riêng tư)\n" +
        "<b>/menu</b> — Mở menu tương tác\n\n" +
        "<i>Các luồng nhạy cảm (Spotify) tự động gửi riêng tư để tránh làm phiền nhóm.</i>",
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^spotify:logout:(-?\d+):(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang ngắt kết nối..." });
    } catch {
      /* ignore */
    }

    const chatId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);

    if (deleteSpotifyAuth(chatId, userId)) {
      await ctx.reply(
        "✅ Đã <b>ngắt kết nối</b> Spotify.",
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(
        "⚠️ Không tìm thấy kết nối Spotify để ngắt.",
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
