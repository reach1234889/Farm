import express from 'express';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const redirectMap = new Map(); // user.id => guild.id

const boundUsersFile = 'bound-users.json';
let boundUsers = fs.existsSync(boundUsersFile)
  ? JSON.parse(fs.readFileSync(boundUsersFile))
  : [];

function saveUsers() {
  fs.writeFileSync(boundUsersFile, JSON.stringify(boundUsers, null, 2));
}

const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

bot.on('ready', () => {
  console.log(`[BOT] Logged in as ${bot.user.tag}`);
});

bot.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;

  const args = msg.content.trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // Save user-guild link for OAuth use
  redirectMap.set(msg.author.id, msg.guild.id);

  if (cmd === '!link') {
    const authURL = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join`;
    msg.reply(`ðŸ”— Click to authorize and join: ${authURL}`);
  }

  else if (cmd === '!users') {
    msg.reply(`ðŸ” Bound Users: ${boundUsers.length}`);
  }

  else if (cmd === '!joinall') {
    const guildId = msg.guild.id;
    let count = 0;
    for (const u of boundUsers) {
      const success = await joinUser(u, guildId);
      if (success) count++;
    }
    msg.reply(`âœ… Joined ${count} users to this server.`);
  }

  else if (cmd === '!join') {
    const count = parseInt(args[0]) || 1;
    const guildId = msg.guild.id;
    let joined = 0;
    for (const u of boundUsers) {
      if (joined >= count) break;
      const success = await joinUser(u, guildId);
      if (success) joined++;
    }
    msg.reply(`âœ… Joined ${joined} users.`);
  }

  else if (cmd === '!bound') {
    const lines = boundUsers.map(u => `â€¢ ${u.username} (${u.id})`);
    msg.reply(lines.length ? lines.join('\n') : 'No users bound.');
  }

  else if (cmd === '!unbind') {
    const id = args[0];
    const before = boundUsers.length;
    boundUsers = boundUsers.filter(u => u.id !== id);
    saveUsers();
    msg.reply(before !== boundUsers.length ? `âŒ Unbound ${id}` : `User not found.`);
  }
});

// ðŸŒ€ OAuth2 redirect handler
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('No code provided');

  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.REDIRECT_URI,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const { access_token, token_type } = tokenRes.data;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `${token_type} ${access_token}` },
    });

    const user = userRes.data;

    boundUsers.push({
      id: user.id,
      username: user.username,
      token: access_token,
      type: token_type,
    });
    saveUsers();

    const guildId = redirectMap.get(user.id);
    if (!guildId) {
      res.send('âš ï¸ Could not determine server to join. Please try again from the bot command.');
      return;
    }

    const success = await joinUser({
      id: user.id,
      username: user.username,
      token: access_token,
      type: token_type,
    }, guildId);

    res.send(success ? 'âœ… Joined successfully!' : 'âš ï¸ Bound, but failed to join the server.');
  } catch (e) {
    console.error('[OAuth2] Error:', (e.response && e.response.data) || e.message);
    res.send('âŒ Failed to authorize. Try again.');
  }
});

async function joinUser(user, guildId) {
  if (!guildId) {
    console.warn(`[SKIP] No guild ID for ${user.username}`);
    return false;
  }

  try {
    const res = await axios.put(
      `https://discord.com/api/guilds/${guildId}/members/${user.id}`,
      {
        access_token: user.token,
      },
      {
        headers: {
          Authorization: `Bot ${process.env.BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if ([201, 204].includes(res.status)) {
      if (process.env.AUTO_ROLE_ID) {
        try {
          await axios.put(
            `https://discord.com/api/guilds/${guildId}/members/${user.id}/roles/${process.env.AUTO_ROLE_ID}`,
            {},
            {
              headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` },
            }
          );
        } catch (e) {
          console.warn(`[ROLE FAIL] ${user.username}:`, (e.response && e.response.data && e.response.data.message) || e.message);
        }
      }

      if (process.env.WEBHOOK_URL) {
        axios.post(process.env.WEBHOOK_URL, {
          content: `âœ… **${user.username}** joined [${guildId}] via OAuth2.`,
        }).catch(() => {});
      }

      console.log(`[JOINED] ${user.username}`);
      return true;
    }
  } catch (err) {
    console.log(`[FAIL] ${user.username}:`, (err.response && err.response.data && err.response.data.message) || err.message);
  }

  return false;
}

bot.login(process.env.BOT_TOKEN);
app.listen(port, () => console.log(`ðŸš€ OAuth2 Joiner running at http://localhost:${port}`));
