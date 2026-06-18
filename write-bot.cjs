const fs = require('fs');

const botTs = `import { Bot, InlineKeyboard, type Context } from "grammy";
import { conversations, createConversation, type Conversation } from "@grammyjs/conversations";
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

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("🎵 Tìm lời bài hát", "menu:lyric")
    .row()
    .text("🎧 Kết nối Spotify", "menu:spotify")
    .row()
    .text("▶️ Bạn bè đang phát gì", "menu:np")
    .row()
    .text("❓ Trợ giúp", "menu:help");
}

function backButton(keyboard: InlineKeyboard) {
  return keyboard.text("🔙 Quay lại menu", "menu:main").row();
}

async function lyricSearch(conversation: Conversation<Context>, ctx: Context) {
  const prompt = await ctx.reply(
    "🎵 <b>Tìm lời bài hát</b>\n\nNhập tên bài hát bạn muốn tìm:",
    {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: "Nhập tên bài hát…" },
    }
  );

  const response = await conversation.waitFor(":text");
  const query = response.msg.text.trim();

  try {
    await conversation.external(() =>
      ctx.api.deleteMessage(ctx.chat!.id, prompt.message_id)
    );
  } catch {
    /* ignore */
  }

  if (!query) {
    await ctx.reply("⚠️ Tên bài hát không hợp lệ.", {
      reply_markup: backButton(new InlineKeyboard()),
    });
    return;
  }

  const searching = await ctx.reply(
    \`🔎 Đang tìm "<b>\${escapeHtml(query)}</b>"…\`,
    { parse_mode: "HTML" }
  );

  let hits: { id: number; title: string; artist: string }[];
  try {
    hits = await conversation.external(() => searchSongs(query));
  } catch (err) {
    await ctx.api.editMessageText(
      searching.chat.id,
      searching.message_id,
      \`⚠️ Lỗi khi tìm kiếm: \${escapeHtml(String((err as Error).message))}\`,
      { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
    );
    return;
  }

  if (hits.length === 0) {
    await ctx.api.editMessageText(
      searching.chat.id,
      searching.message_id,
      \`Không tìm thấy kết quả nào cho "<b>\${escapeHtml(query)}</b>".\`,
      { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const hit of hits) {
    const label = truncate(\`\${hit.title} — \${hit.artist}\`, 60);
    keyboard.text(label, \`lyric:\${hit.id}\`).row();
  }
  backButton(keyboard);

  await ctx.api.editMessageText(
    searching.chat.id,
    searching.message_id,
    \`🎵 Tìm thấy <b>\${hits.length}</b> kết quả cho "<b>\${escapeHtml(query)}</b>".\nChọn bài bạn muốn xem lời:\`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.use(conversations());
  bot.use(createConversation(lyricSearch));

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 <b>Chào mừng đến với Lyrics Bot!</b>\n\n" +
        "🎵 Tìm lời bài hát trên Genius\n" +
        "🎧 Chia sẻ nhạc đang phát từ Spotify\n\n" +
        "Chọn chức năng bên dưới hoặc gõ <code>/menu</code> để mở lại menu:",
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
    );
  });

  bot.command("help", async (ctx) => {
    const keyboard = backButton(new InlineKeyboard());
    await ctx.reply(
      "<b>📖 Hướng dẫn sử dụng</b>\n\n" +
        "<b>/lyric &lt;tên bài&gt;</b> — Tìm lời bài hát trên Genius\n" +
        "<b>/spotify</b> — Kết nối Spotify (gửi riêng tư)\n" +
        "<b>/nowplaying</b> — Xem bạn bè đang phát gì (gửi riêng tư)\n" +
        "<b>/menu</b> — Mở menu tương tác\n\n" +
        "<i>Các luồng nhạy cảm (Spotify) tự động gửi riêng tư để tránh làm phiền nhóm.</i>",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply(
      "<b>🎼 Menu chính</b>\n\nChọn chức năng bạn muốn dùng:",
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
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

    const searching = await ctx.reply(
      \`🔎 Đang tìm "<b>\${escapeHtml(query)}</b>"…\`,
      { parse_mode: "HTML" }
    );

    try {
      const hits = await searchSongs(query);
      if (hits.length === 0) {
        await ctx.api.editMessageText(
          searching.chat.id,
          searching.message_id,
          \`Không tìm thấy kết quả nào cho "<b>\${escapeHtml(query)}</b>".\`,
          { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const hit of hits) {
        const label = truncate(\`\${hit.title} — \${hit.artist}\`, 60);
        keyboard.text(label, \`lyric:\${hit.id}\`).row();
      }
      backButton(keyboard);

      await ctx.api.editMessageText(
        searching.chat.id,
        searching.message_id,
        \`🎵 Tìm thấy <b>\${hits.length}</b> kết quả cho "<b>\${escapeHtml(query)}</b>".\nChọn bài bạn muốn xem lời:\`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } catch (err) {
      await ctx.api.editMessageText(
        searching.chat.id,
        searching.message_id,
        \`⚠️ Lỗi khi tìm kiếm: \${escapeHtml(String((err as Error).message))}\`,
        { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
      );
    }
  });

  bot.command("spotify", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    if (!userId) return;

    const existing = getSpotifyAuth(chatId, userId);

    if (existing) {
      const name = existing.first_name || existing.username || \`User \${userId}\`;
      const keyboard = new InlineKeyboard()
        .text("🔓 Ngắt kết nối Spotify", \`spotify:logout:\${chatId}:\${userId}\`)
        .row()
        .text("🔙 Quay lại menu", "menu:main");

      await ctx.reply(
        \`✅ <b>Bạn đã kết nối Spotify</b>\n\n👤 \${escapeHtml(name)}\n\n\` +
          "Nhấn nút bên dưới nếu muốn ngắt kết nối:",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const state = \`\${chatId}:\${userId}:\${Math.random().toString(36).slice(2)}\`;
    try {
      const url = generateSpotifyAuthUrl(state);
      const keyboard = new InlineKeyboard().url("🔗 Kết nối Spotify", url);

      await ctx.api.sendMessage(
        userId,
        "👋 <b>Kết nối Spotify</b>\n\nNhấn nút bên dưới để xác thực. Sau khi hoàn tất, bạn bè có thể xem bạn đang phát gì! 🎧",
        { parse_mode: "HTML", reply_markup: keyboard }
      );

      if (ctx.chat.type !== "private") {
        await ctx.reply(
          "✅ Đã gửi link kết nối Spotify qua tin nhắn riêng tư!",
          { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
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
        await ctx.reply(\`⚠️ \${escapeHtml(msg)}\`, { parse_mode: "HTML" });
      }
    }
  });

  bot.command("nowplaying", async (ctx) => {
    const chatId = ctx.chat.id;
    const users = getSpotifyAuthsByChat(chatId);

    if (!users || users.length === 0) {
      const keyboard = backButton(new InlineKeyboard());
      await ctx.reply(
        "Chưa có ai kết nối Spotify ở đây.\nGõ <code>/spotify</code> để kết nối! 🎧",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const auth of users) {
      const label = truncate(
        auth.first_name || auth.username || \`User \${auth.user_id}\`,
        60
      );
      keyboard.text(\`🎵 \${label}\`, \`np:\${chatId}:\${auth.user_id}\`).row();
    }
    backButton(keyboard);

    await ctx.reply(
      "🎧 Chọn bạn bè để xem đang phát gì trên Spotify:",
      { reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^lyric:(\\d+)$/, async (ctx) => {
    const songId = Number(ctx.match[1]);
    try {
      await ctx.answerCallbackQuery({ text: "Đang lấy lời bài hát…" });
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
      const header = \`🎵 <b>\${escapeHtml(song.title)}</b>\n👤 \${escapeHtml(song.artist)}\n🔗 <a href="\${song.url}">Genius</a>\n\n\`;

      const chunks = splitMessage(header, lyrics);
      for (const chunk of chunks) {
        await ctx.reply(chunk, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      }

      await ctx.reply(
        "🔙 Quay lại menu?",
        { reply_markup: new InlineKeyboard().text("🔙 Menu", "menu:main") }
      );
    } catch (err) {
      console.error("[callback] lỗi khi lấy lyric:", err);
      await ctx.reply(
        \`⚠️ Không lấy được lời bài hát: \${escapeHtml(String((err as Error).message))}\`,
        { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
      );
    }
  });

  bot.callbackQuery(/^np:(-?\\d+):(\\d+)$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);

    try {
      await ctx.answerCallbackQuery({ text: "Đang kiểm tra…" });
    } catch {
      /* ignore */
    }

    const auth = getSpotifyAuth(chatId, userId);
    if (!auth) {
      await ctx.reply(
        "Người dùng này chưa kết nối Spotify hoặc đã ngắt kết nối.",
        { reply_markup: backButton(new InlineKeyboard()) }
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
          \`🎵 <b>\${escapeHtml(auth.first_name || auth.username || "Bạn bè")}</b> hiện không phát nhạc nào trên Spotify.\`,
          { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
        );
        return;
      }

      const status = playing.isPlaying ? "▶️ Đang phát" : "⏸️ Tạm dừng";
      const text = [
        \`🎵 <b>\${escapeHtml(auth.first_name || auth.username || "Bạn bè")}</b>\`,
        status,
        \`\n🎵 <b>\${escapeHtml(playing.trackName)}</b>\`,
        \`👤 \${escapeHtml(playing.artistName)}\`,
        playing.albumName ? \`💿 \${escapeHtml(playing.albumName)}\` : "",
        playing.trackUrl
          ? \`🔗 <a href="\${playing.trackUrl}">Mở trên Spotify</a>\`
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

      await ctx.reply(
        "🔙 Quay lại danh sách?",
        {
          reply_markup: new InlineKeyboard()
            .text("🔙 Quay lại", \`npback:\${chatId}\`)
            .text("🏠 Menu", "menu:main")
            .row(),
        }
      );
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
        is403 ? hint403 : \`⚠️ Không lấy được thông tin: \${escapeHtml(msg)}\`,
        { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
      );
    }
  });

  bot.callbackQuery(/^npback:(-?\\d+)$/, async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang quay lại…" });
    } catch {
      /* ignore */
    }
    const chatId = Number(ctx.match[1]);
    const users = getSpotifyAuthsByChat(chatId);

    if (!users || users.length === 0) {
      await ctx.reply(
        "Chưa có ai kết nối Spotify ở đây.",
        { reply_markup: backButton(new InlineKeyboard()) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const auth of users) {
      const label = truncate(
        auth.first_name || auth.username || \`User \${auth.user_id}\`,
        60
      );
      keyboard.text(\`🎵 \${label}\`, \`np:\${chatId}:\${auth.user_id}\`).row();
    }
    backButton(keyboard);

    await ctx.reply(
      "🎧 Chọn bạn bè để xem đang phát gì trên Spotify:",
      { reply_markup: keyboard }
    );
  });

  bot.callbackQuery("menu:main", async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
    } catch {
      /* ignore */
    }
    await ctx.reply(
      "<b>🎼 Menu chính</b>\n\nChọn chức năng bạn muốn dùng:",
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
    );
  });

  bot.callbackQuery("menu:lyric", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Nhập tên bài hát…" });
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("lyricSearch");
  });

  bot.callbackQuery("menu:spotify", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang mở kết nối Spotify…" });
    } catch {
      /* ignore */
    }

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const existing = getSpotifyAuth(chatId, userId);
    if (existing) {
      const name = existing.first_name || existing.username || \`User \${userId}\`;
      const keyboard = new InlineKeyboard()
        .text("🔓 Ngắt kết nối", \`spotify:logout:\${chatId}:\${userId}\`)
        .row()
        .text("🔙 Quay lại menu", "menu:main");
      await ctx.reply(
        \`✅ <b>Đã kết nối Spotify</b>\n\n👤 \${escapeHtml(name)}\n\n\` +
          "Nhấn nút bên dưới nếu muốn ngắt kết nối:",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const state = \`\${chatId}:\${userId}:\${Math.random().toString(36).slice(2)}\`;
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
          { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
        );
      } else {
        await ctx.reply(
          \`⚠️ \${escapeHtml(msg)}\`,
          { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
        );
      }
    }
  });

  bot.callbackQuery("menu:np", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang mở danh sách…" });
    } catch {
      /* ignore */
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const users = getSpotifyAuthsByChat(chatId);
    if (!users || users.length === 0) {
      const keyboard = backButton(new InlineKeyboard());
      await ctx.reply(
        "Chưa có ai kết nối Spotify ở đây.\nGõ <code>/spotify</code> để kết nối! 🎧",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const auth of users) {
      const label = truncate(
        auth.first_name || auth.username || \`User \${auth.user_id}\`,
        60
      );
      keyboard.text(\`🎵 \${label}\`, \`np:\${chatId}:\${auth.user_id}\`).row();
    }
    backButton(keyboard);

    await ctx.reply(
      "🎧 Chọn bạn bè để xem đang phát gì trên Spotify:",
      { reply_markup: keyboard }
    );
  });

  bot.callbackQuery("menu:help", async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang mở trợ giúp…" });
    } catch {
      /* ignore */
    }
    const keyboard = backButton(new InlineKeyboard());
    await ctx.reply(
      "<b>📖 Hướng dẫn sử dụng</b>\n\n" +
        "<b>/lyric &lt;tên bài&gt;</b> — Tìm lời bài hát trên Genius\n" +
        "<b>/spotify</b> — Kết nối Spotify (gửi riêng tư)\n" +
        "<b>/nowplaying</b> — Xem bạn bè đang phát gì (gửi riêng tư)\n" +
        "<b>/menu</b> — Mở menu tương tác\n\n" +
        "<i>Các luồng nhạy cảm (Spotify) tự động gửi riêng tư để tránh làm phiền nhóm.</i>",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^spotify:logout:(-?\\d+):(\\d+)$/, async (ctx) => {
    try {
      await ctx.answerCallbackQuery({ text: "Đang ngắt kết nối…" });
    } catch {
      /* ignore */
    }

    const chatId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);

    if (deleteSpotifyAuth(chatId, userId)) {
      const keyboard = backButton(new InlineKeyboard());
      await ctx.reply(
        "✅ Đã <b>ngắt kết nối</b> Spotify.",
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } else {
      await ctx.reply(
        "⚠️ Không tìm thấy kết nối Spotify để ngắt.",
        { parse_mode: "HTML", reply_markup: backButton(new InlineKeyboard()) }
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

function formatLine(line: string): string {
  const escaped = escapeHtml(line);
  if (/^\\[.*\\]$/.test(line.trim())) {
    return \`<b><i>\${escaped}</i></b>\`;
  }
  return escaped;
}

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
`;

fs.writeFileSync('g:/lyrics_bot/src/bot.ts', botTs, 'utf8');
console.log('done');
