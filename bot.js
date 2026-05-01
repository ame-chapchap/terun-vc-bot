require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const cron = require('node-cron');

const TOKEN = process.env.DISCORD_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const CHANNEL_GREETING = process.env.CHANNEL_GREETING;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ===== メッセージ定義 =====
const TERUN_GREETINGS = [
  'わーい来てくれた〜！今日もよろしくね 🫧',
  'あ、来た来た〜！今日もよろしくね 🫧',
  'いらっしゃい〜！今日も来てくれてありがとう 🌱',
  'おかえり〜！さあ、がんばるぞ！🔥',
  '待ってたよ〜！今日も一緒にがんばろうね！✨',
  'やっほ〜！今日も一緒にがんばろうね！📣',
  'きた〜！！今日もよろしくね 🫧',
  'わーい！今日もよろしくね〜 🌸',
  '来てくれてうれしい〜！今日もがんばろ 💪',
  'やった、来てくれた！今日もよろしく〜 ☀️',
];

const TERUN_JOIN_MESSAGES = [
  'おはよう〜！もう来てたの！？早起きだね ☀️',
  'わあ、もう来てるんだ！今日もよろしくね 🌱',
  'みんないたんだ〜！今日もがんばろうね 🫧',
  'もう集まってたんだね！てるんも来たよ〜 📣',
];

const TERUN_LEAVE_MESSAGES = [
  '22時だよ〜！今日もおつかれさまでした 🌱 ゆっくり休んでね💤',
  '22時になっちゃった〜！今日もよくがんばったね ☀️ またね！',
  'てるんはここで失礼するのです 🫧 今日もありがとう、またね〜！',
  'またね〜！今日も一緒にいれてよかったよ 📣 おやすみなさい！',
  '無理しないでね🫧 おやすみなさい💤',
];

const lastUsed = new Map();
const lastGreeted = new Map(); // userId → timestamp

function rand(arr, key = 'default') {
  const last = lastUsed.get(key);
  const candidates = arr.length > 1 ? arr.filter(v => v !== last) : arr;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  lastUsed.set(key, chosen);
  return chosen;
}

function isActiveHours() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
  return h >= 6 && h < 22;
}

// ===== VC参加 =====
async function joinVC() {
  if (!VOICE_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
    if (!channel?.isVoiceBased()) return;
    if (getVoiceConnection(channel.guildId)) return;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
      }
    });

    console.log('✅ てるん：VC接続開始');

    if (CHANNEL_GREETING) {
      await new Promise(r => setTimeout(r, 3000));
      const vc = await client.channels.fetch(VOICE_CHANNEL_ID);
      const others = vc.members.filter(m => !m.user.bot).size;
      if (others > 0) {
        const ch = await client.channels.fetch(CHANNEL_GREETING);
        if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xFFD700).setDescription(rand(TERUN_JOIN_MESSAGES)).setTimestamp()] });
      }
    }
  } catch (e) {
    console.error('VC参加エラー:', e);
  }
}

// ===== VC退出 =====
async function leaveVC() {
  if (!VOICE_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
    if (!channel) return;

    if (CHANNEL_GREETING) {
      const others = channel.members.filter(m => !m.user.bot).size;
      if (others > 0) {
        const ch = await client.channels.fetch(CHANNEL_GREETING);
        if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0x87CEEB).setDescription(rand(TERUN_LEAVE_MESSAGES)).setTimestamp()] });
      }
    }

    const connection = getVoiceConnection(channel.guildId);
    if (connection) {
      connection.destroy();
      console.log('✅ てるん：VC退出');
    }
  } catch (e) { console.error('VC退出エラー:', e); }
}

// ===== 入室挨拶 =====
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!VOICE_CHANNEL_ID || !CHANNEL_GREETING) return;
  if (!isActiveHours()) return;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  if (newState.channelId === VOICE_CHANNEL_ID && oldState.channelId !== VOICE_CHANNEL_ID) {
    const now = Date.now();
    const last = lastGreeted.get(member.id);
    if (last && now - last < 60 * 60 * 1000) return;
    lastGreeted.set(member.id, now);

    try {
      const ch = await client.channels.fetch(CHANNEL_GREETING);
      if (!ch) return;

      await ch.send({ embeds: [new EmbedBuilder().setColor(0xFF69B4).setDescription(`<@${member.id}> ${rand(TERUN_GREETINGS)}`).setTimestamp()] });

      // 2秒後に重複削除（Railway複数インスタンス対策）
      setTimeout(async () => {
        try {
          const recent = await ch.messages.fetch({ limit: 10 });
          const dupes = [...recent.values()].filter(m =>
            m.author.id === client.user.id &&
            m.embeds[0]?.description?.includes(`<@${member.id}>`) &&
            Date.now() - m.createdTimestamp < 15000
          ).sort((a, b) => a.id < b.id ? -1 : 1);
          for (const dup of dupes.slice(1)) await dup.delete().catch(() => {});
        } catch (e) { console.error('重複削除エラー:', e); }
      }, 2000);
    } catch (e) { console.error('挨拶送信エラー:', e); }
  }
});

// ===== メンション・返信に💖🫧 =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const mentionsBot = message.mentions.users.has(client.user.id);
  const repliesToBot = message.reference?.messageId
    ? await message.channel.messages.fetch(message.reference.messageId)
        .then(m => m.author.id === client.user.id)
        .catch(() => false)
    : false;

  if (mentionsBot || repliesToBot) {
    try {
      await message.react('💖');
      await message.react('🫧');
    } catch (e) { console.error('リアクションエラー:', e); }
  }
});

// ===== スケジュール：6:00参加 / 22:00退出（JST）=====
cron.schedule('0 6 * * *', () => { joinVC(); }, { timezone: 'Asia/Tokyo' });
cron.schedule('0 22 * * *', () => { leaveVC(); }, { timezone: 'Asia/Tokyo' });

// ===== 起動 =====
client.once('ready', async () => {
  console.log(`✅ ログイン: ${client.user.tag}`);
  client.user.setActivity('VC常駐中 🫧');
  if (isActiveHours()) {
    joinVC().catch(e => console.error('起動時VC参加エラー:', e));
  }
});

client.login(TOKEN);
