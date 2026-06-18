import { Bot, InlineKeyboard } from "grammy";
import { searchSongs, getSong, fetchLyrics } from "./genius.js";

const TELEGRAM_MAX = 4096;

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Chào bạn!\n\nGõ <code>/lyric &lt;tên bài hát&gt;</code> để tìm lời bài hát trên Genius.\n\nVí dụ: <code>/lyric shape of you</code>",
      { parse_mode: "HTML" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Cách dùng:\n<code>/lyric &lt;tên bài hát&gt;</code>\n\nBot sẽ tìm trên Genius và hiển thị danh sách để bạn chọn.",
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

  bot.callbackQuery(/^lyric:(\d+)$/, async (ctx) => {
    const songId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: "Đang lấy lời bài hát..." });

    try {
      const song = await getSong(songId);
      if (!song) {
        await ctx.reply("Không lấy được thông tin bài hát.");
        return;
      }

      const lyrics = await fetchLyrics(song.url);
      const header = `🎵 <b>${escapeHtml(song.title)}</b>\n👤 ${escapeHtml(song.artist)}\n🔗 <a href="${song.url}">Genius</a>\n\n`;

      const chunks = splitMessage(header, lyrics);
      for (const chunk of chunks) {
        await ctx.reply(chunk, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      }
    } catch (err) {
      await ctx.reply(
        `⚠️ Không lấy được lời bài hát: ${escapeHtml(String((err as Error).message))}`,
        { parse_mode: "HTML" }
      );
    }
  });

  return bot;
}

function escapeHtml(text: string): string {
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
