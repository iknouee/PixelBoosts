require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

for (const key of ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID']) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const BRAND = {
  name: 'Pixel Boosts',
  color: 0xff2d9b,
  banner: 'https://cdn.discordapp.com/attachments/1530275322828951585/1530277037024084178/bannerpixel.png?ex=6a64fd0c&is=6a63ab8c&hm=d9aaef317d28584923626aeeb0e0cd8a0e0b3b7f4b254a64fb0aeead18a981ef',
};

const DATA_FILE = path.join(__dirname, 'data.json');
const DEFAULT_DATA = {
  stock: 0,
  prices: {
    '2': '£8.99',
    '4': '£16.99',
    '6': '£24.99',
    '8': '£32.99',
    '14': '£54.99',
  },
  offer: 'No active special offer right now. Check back soon!',
  orderCounter: 0,
  stripeUrl: '',
  channels: {},
  roles: {},
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return structuredClone(DEFAULT_DATA);
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      ...structuredClone(DEFAULT_DATA),
      ...saved,
      prices: { ...DEFAULT_DATA.prices, ...(saved.prices || {}) },
      channels: { ...(saved.channels || {}) },
      roles: { ...(saved.roles || {}) },
    };
  } catch (error) {
    console.error('Could not load data.json:', error);
    return structuredClone(DEFAULT_DATA);
  }
}

let data = loadData();
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

function brandedEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor({ name: BRAND.name })
    .setTitle(title)
    .setDescription(description)
    .setImage(BRAND.banner)
    .setFooter({ text: 'Pixel Boosts • Fast, affordable and trusted' })
    .setTimestamp();
}

function isAdmin(interaction) {
  return interaction.guild?.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function adminOnly(interaction) {
  if (isAdmin(interaction)) return true;
  await interaction.reply({ content: 'You need Administrator permission to use this command.', ephemeral: true }).catch(() => {});
  return false;
}

function priceLines() {
  return Object.entries(data.prices)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([boosts, price]) => `**${boosts} Boosts** — ${price} / month`)
    .join('\n');
}

const CHANNEL_TYPES = [
  ['rules', 'Rules'], ['announcements', 'Announcements'], ['faq', 'FAQ'],
  ['how-it-works', 'How It Works'], ['partners', 'Partners'],
  ['boost-packages', 'Boost Packages'], ['pricing', 'Pricing'], ['stock', 'Instant Stock'],
  ['special-offers', 'Special Offers'], ['create-order', 'Create Order'],
  ['order-status', 'Order Status'], ['payment-methods', 'Payment Methods'],
  ['reviews', 'Reviews'], ['proof', 'Proof'], ['video-vouches', 'Video Vouches'],
  ['completed-orders', 'Completed Orders'], ['logs', 'Logs'], ['sales-log', 'Sales Log'],
  ['ticket-category', 'Ticket Category'],
];

const ROLE_TYPES = [
  ['member', 'Member'], ['customer', 'Customer'], ['support', 'Support'], ['staff', 'Staff'],
];

const channelChoices = CHANNEL_TYPES.map(([value, name]) => ({ name, value }));
const roleChoices = ROLE_TYPES.map(([value, name]) => ({ name, value }));

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Send or refresh every configured Pixel Boosts panel').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setchannel').setDescription('Choose where a server panel or ticket category is used')
    .addStringOption(o => o.setName('type').setDescription('What this channel is for').setRequired(true).addChoices(...channelChoices))
    .addChannelOption(o => o.setName('channel').setDescription('Channel or category').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setrole').setDescription('Choose a role used by the bot')
    .addStringOption(o => o.setName('type').setDescription('What this role is for').setRequired(true).addChoices(...roleChoices))
    .addRoleOption(o => o.setName('role').setDescription('Role to use').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setstripe').setDescription('Set the Stripe payment-link URL')
    .addStringOption(o => o.setName('url').setDescription('Example: https://buy.stripe.com/...').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('config').setDescription('View the current bot channel, role and Stripe setup').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('shop').setDescription('View packages, stock and ordering information'),
  new SlashCommandBuilder().setName('buy').setDescription('Open the order panel and Stripe checkout'),
  new SlashCommandBuilder().setName('stock').setDescription('View or update boost stock')
    .addSubcommand(s => s.setName('view').setDescription('View current stock'))
    .addSubcommand(s => s.setName('set').setDescription('Set current stock').addIntegerOption(o => o.setName('amount').setDescription('Available boosts').setRequired(true).setMinValue(0))),
  new SlashCommandBuilder().setName('price').setDescription('View or update package prices')
    .addSubcommand(s => s.setName('view').setDescription('View all prices'))
    .addSubcommand(s => s.setName('set').setDescription('Set a package price')
      .addIntegerOption(o => o.setName('boosts').setDescription('Number of boosts').setRequired(true).setMinValue(1).setMaxValue(100))
      .addStringOption(o => o.setName('price').setDescription('Example: £8.99').setRequired(true).setMaxLength(30))),
  new SlashCommandBuilder().setName('offer').setDescription('Update the special-offer panel')
    .addStringOption(o => o.setName('text').setDescription('Offer text').setRequired(true).setMaxLength(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('announce').setDescription('Send a branded announcement')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName('title').setDescription('Announcement title').setRequired(true).setMaxLength(256))
    .addStringOption(o => o.setName('message').setDescription('Announcement message').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('ping').setDescription('Ping @everyone'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('embed').setDescription('Send a custom Pixel Boosts embed')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(256))
    .addStringOption(o => o.setName('description').setDescription('Embed description').setRequired(true).setMaxLength(4000))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('complete-order').setDescription('Record a completed customer order')
    .addUserOption(o => o.setName('customer').setDescription('Customer').setRequired(true))
    .addIntegerOption(o => o.setName('boosts').setDescription('Boosts delivered').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('amount').setDescription('Amount paid, e.g. £16.99').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Example: 1 month').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('close-ticket').setDescription('Close the current order ticket'),
  new SlashCommandBuilder().setName('help').setDescription('Show Pixel Boosts bot commands'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log(`Registered ${commands.length} guild commands.`);
}

function orderButtons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('create_order').setLabel('Create an Order').setEmoji('🛒').setStyle(ButtonStyle.Primary),
  );
  if (data.stripeUrl) {
    row.addComponents(new ButtonBuilder().setLabel('Pay with Stripe').setEmoji('💳').setStyle(ButtonStyle.Link).setURL(data.stripeUrl));
  }
  return row;
}

function panelDefinitions() {
  return [
    ['rules', brandedEmbed('📜 Pixel Boosts Rules', [
      '1. Treat customers and staff with respect.',
      '2. Do not spam, advertise, scam or impersonate staff.',
      '3. Keep order and payment details inside your private ticket.',
      '4. Never send passwords, Discord tokens, QR codes, cookies or account access.',
      '5. Prices and stock may change until staff confirms your order.',
      '6. Fraudulent disputes or chargebacks may result in removal from the server.',
      '',
      'By ordering, you agree to the package duration and final quote confirmed in your ticket.',
    ].join('\n'))],
    ['announcements', brandedEmbed('📢 Announcements', 'Official Pixel Boosts updates, restocks, package changes and important notices are posted here.')],
    ['faq', brandedEmbed('❓ Frequently Asked Questions', [
      '**How do I order?**\nOpen a private ticket through the create-order panel.',
      '**How long do boosts last?**\nThe standard packages are monthly unless your ticket says otherwise.',
      '**Do you need my Discord login?**\nNo. We never ask for passwords, tokens, QR codes or cookies.',
      '**When does delivery start?**\nAfter payment is confirmed and stock is available.',
      '**Can prices change?**\nYes, until your final quote is confirmed in the ticket.',
    ].join('\n\n'))],
    ['how-it-works', brandedEmbed('📖 How It Works', [
      '**1. Pick a package**\nCheck the prices and live stock.',
      '**2. Open an order ticket**\nTell staff the amount and duration you need.',
      '**3. Receive confirmation**\nStaff confirms stock and your final total.',
      '**4. Pay securely with Stripe**\nUse the official Stripe link only.',
      '**5. Delivery**\nYour order is processed and logged once completed.',
    ].join('\n\n'))],
    ['partners', brandedEmbed('📜 Partnerships', 'To discuss a partnership, open a ticket and include your server size, invite link, audience and what you are offering.')],
    ['boost-packages', brandedEmbed('💎 Boost Packages', `${priceLines()}\n\nAll packages are subject to live stock and staff confirmation. Custom quantities can be quoted in a ticket.`), orderButtons()],
    ['pricing', brandedEmbed('💰 Current Pricing', `${priceLines()}\n\nYour confirmed ticket quote is final before payment.`), orderButtons()],
    ['stock', brandedEmbed('⚡ Instant Stock', data.stock > 0 ? `**${data.stock} boosts** are currently available.\n\nOpen a ticket to reserve stock.` : '**Currently out of stock.**\n\nWatch this channel for the next restock.')],
    ['special-offers', brandedEmbed('🎁 Special Offers', data.offer)],
    ['create-order', brandedEmbed('🎫 Create an Order', 'Press **Create an Order** below to open a private ticket. Staff will confirm your package, stock and final price before you pay.'), orderButtons()],
    ['order-status', brandedEmbed('📦 Order Status', 'Order updates are posted inside each private ticket. Completed orders are logged after delivery.')],
    ['payment-methods', brandedEmbed('💳 Secure Payments', data.stripeUrl ? 'Payments are accepted securely through **Stripe Checkout**.\n\nOnly use the official button below or the link supplied by verified staff in your private ticket.' : 'Stripe is the only supported payment method. The owner has not configured the Stripe payment link yet.'), data.stripeUrl ? orderButtons() : null],
    ['reviews', brandedEmbed('⭐ Customer Reviews', 'Completed an order? Leave an honest review about your package, delivery and support experience. Never post private payment details.')],
    ['proof', brandedEmbed('📸 Delivery Proof', 'Privacy-safe delivery confirmations may be posted here. Sensitive details must always be hidden.')],
    ['video-vouches', brandedEmbed('🎥 Video Vouches', 'Customers can share genuine video vouches after a completed order.')],
    ['completed-orders', brandedEmbed('🏆 Completed Orders', 'Verified completed orders are logged here by staff using `/complete-order`.')],
  ];
}

async function sendOrReplace(key, embed, components = null) {
  const channelId = data.channels[key];
  if (!channelId) return { ok: false, reason: `${key} has not been configured` };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: `${key} channel is invalid` };

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const marker = `Pixel Boosts • Panel: ${key}`;
  const old = recent?.find(m => m.author.id === client.user.id && m.embeds?.[0]?.footer?.text === marker);
  const finalEmbed = EmbedBuilder.from(embed).setFooter({ text: marker });
  const payload = { embeds: [finalEmbed], components: components ? [components] : [] };
  if (old) await old.edit(payload);
  else await channel.send(payload);
  return { ok: true };
}

async function refreshPanel(key) {
  const panel = panelDefinitions().find(([panelKey]) => panelKey === key);
  if (panel) await sendOrReplace(...panel);
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('Pixel Boosts orders');
  await registerCommands().catch(error => console.error('Command registration failed:', error));
});

client.on('guildMemberAdd', async member => {
  const roleId = data.roles.member;
  if (!roleId) return;
  const role = member.guild.roles.cache.get(roleId);
  if (role) await member.roles.add(role).catch(() => {});
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'create_order') {
        await interaction.deferReply({ ephemeral: true });
        const existing = interaction.guild.channels.cache.find(c => c.topic?.includes(`Customer: ${interaction.user.id}`));
        if (existing) return interaction.editReply(`You already have an open order: ${existing}`);

        data.orderCounter += 1;
        saveData();
        const orderNumber = String(data.orderCounter).padStart(4, '0');
        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
        ];
        for (const roleId of [data.roles.support, data.roles.staff].filter(Boolean)) {
          overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        }

        const parent = data.channels['ticket-category'];
        const channel = await interaction.guild.channels.create({
          name: `order-${orderNumber}`,
          type: ChannelType.GuildText,
          parent: parent || undefined,
          topic: `Pixel Boosts order #${orderNumber} | Customer: ${interaction.user.id}`,
          permissionOverwrites: overwrites,
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_order').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
        );
        if (data.stripeUrl) closeRow.addComponents(new ButtonBuilder().setLabel('Pay with Stripe').setEmoji('💳').setStyle(ButtonStyle.Link).setURL(data.stripeUrl));

        await channel.send({
          content: `${interaction.user}${data.roles.support ? ` <@&${data.roles.support}>` : ''}`,
          embeds: [brandedEmbed(`🛒 Order #${orderNumber}`, [
            'Please send:',
            '• Number of boosts required',
            '• Duration required',
            '• Your server invite',
            '',
            'Wait for staff to confirm your package and final total before paying.',
            '**Never share your Discord password, token, QR code or cookies.**',
          ].join('\n'))],
          components: [closeRow],
        });
        return interaction.editReply(`Your private order ticket is ready: ${channel}`);
      }

      if (interaction.customId === 'close_order') {
        const canClose = isAdmin(interaction) || interaction.channel?.topic?.includes(`Customer: ${interaction.user.id}`);
        if (!canClose) return interaction.reply({ content: 'Only the customer or an administrator can close this ticket.', ephemeral: true });
        await interaction.reply({ content: 'Closing this ticket in 5 seconds…' });
        setTimeout(() => interaction.channel.delete('Pixel Boosts ticket closed').catch(() => {}), 5000);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setchannel') {
      if (!await adminOnly(interaction)) return;
      const type = interaction.options.getString('type');
      const channel = interaction.options.getChannel('channel');
      if (type === 'ticket-category' && channel.type !== ChannelType.GuildCategory) {
        return interaction.reply({ content: 'For Ticket Category, choose an actual category.', ephemeral: true });
      }
      if (type !== 'ticket-category' && !channel.isTextBased()) {
        return interaction.reply({ content: 'Choose a text or announcement channel for this panel.', ephemeral: true });
      }
      data.channels[type] = channel.id;
      saveData();
      return interaction.reply({ content: `Set **${type}** to ${channel}.`, ephemeral: true });
    }

    if (interaction.commandName === 'setrole') {
      if (!await adminOnly(interaction)) return;
      const type = interaction.options.getString('type');
      const role = interaction.options.getRole('role');
      data.roles[type] = role.id;
      saveData();
      return interaction.reply({ content: `Set **${type}** role to ${role}.`, ephemeral: true });
    }

    if (interaction.commandName === 'setstripe') {
      if (!await adminOnly(interaction)) return;
      const url = interaction.options.getString('url').trim();
      if (!/^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//i.test(url)) {
        return interaction.reply({ content: 'Please provide a valid Stripe Checkout or Stripe Payment Link URL.', ephemeral: true });
      }
      data.stripeUrl = url;
      saveData();
      await refreshPanel('payment-methods');
      await refreshPanel('create-order');
      await refreshPanel('pricing');
      await refreshPanel('boost-packages');
      return interaction.reply({ content: 'Stripe payment link saved and relevant panels refreshed.', ephemeral: true });
    }

    if (interaction.commandName === 'config') {
      if (!await adminOnly(interaction)) return;
      const channelText = CHANNEL_TYPES.map(([key, name]) => `**${name}:** ${data.channels[key] ? `<#${data.channels[key]}>` : 'Not set'}`).join('\n');
      const roleText = ROLE_TYPES.map(([key, name]) => `**${name}:** ${data.roles[key] ? `<@&${data.roles[key]}>` : 'Not set'}`).join('\n');
      const embed = brandedEmbed('⚙️ Pixel Boosts Configuration', `${channelText}\n\n**Roles**\n${roleText}\n\n**Stripe:** ${data.stripeUrl ? 'Configured' : 'Not set'}`);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'setup') {
      if (!await adminOnly(interaction)) return;
      await interaction.deferReply({ ephemeral: true });
      const results = [];
      for (const panel of panelDefinitions()) results.push(await sendOrReplace(...panel));
      const ok = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok).map(r => `• ${r.reason}`);
      return interaction.editReply(`Refreshed **${ok}** panels.${failed.length ? `\n\nNot sent:\n${failed.join('\n')}` : ''}`);
    }

    if (interaction.commandName === 'shop' || interaction.commandName === 'buy') {
      return interaction.reply({
        embeds: [brandedEmbed('🚀 Pixel Boosts Shop', `${priceLines()}\n\n**Stock:** ${data.stock} boosts\n\nOpen a private order before paying so staff can confirm availability.`)],
        components: [orderButtons()],
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'stock') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') return interaction.reply({ embeds: [brandedEmbed('⚡ Current Stock', `Available: **${data.stock} boosts**`)], ephemeral: true });
      if (!await adminOnly(interaction)) return;
      data.stock = interaction.options.getInteger('amount');
      saveData();
      await refreshPanel('stock');
      return interaction.reply({ content: `Stock updated to **${data.stock} boosts**.`, ephemeral: true });
    }

    if (interaction.commandName === 'price') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') return interaction.reply({ embeds: [brandedEmbed('💰 Current Prices', priceLines())], ephemeral: true });
      if (!await adminOnly(interaction)) return;
      const boosts = String(interaction.options.getInteger('boosts'));
      const price = interaction.options.getString('price').trim();
      data.prices[boosts] = price;
      saveData();
      await refreshPanel('pricing');
      await refreshPanel('boost-packages');
      return interaction.reply({ content: `Updated **${boosts} boosts** to **${price}**.`, ephemeral: true });
    }

    if (interaction.commandName === 'offer') {
      if (!await adminOnly(interaction)) return;
      data.offer = interaction.options.getString('text');
      saveData();
      await refreshPanel('special-offers');
      return interaction.reply({ content: 'Special offer updated.', ephemeral: true });
    }

    if (interaction.commandName === 'announce' || interaction.commandName === 'embed') {
      if (!await adminOnly(interaction)) return;
      const channel = interaction.options.getChannel('channel');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString(interaction.commandName === 'announce' ? 'message' : 'description');
      const ping = interaction.commandName === 'announce' && interaction.options.getBoolean('ping');
      await channel.send({ content: ping ? '@everyone' : undefined, embeds: [brandedEmbed(title, description)], allowedMentions: { parse: ping ? ['everyone'] : [] } });
      return interaction.reply({ content: `Sent to ${channel}.`, ephemeral: true });
    }

    if (interaction.commandName === 'complete-order') {
      if (!await adminOnly(interaction)) return;
      const targetId = data.channels['completed-orders'];
      const target = targetId ? await client.channels.fetch(targetId).catch(() => null) : null;
      if (!target?.isTextBased()) return interaction.reply({ content: 'Set the completed-orders channel first with `/setchannel`.', ephemeral: true });
      const customer = interaction.options.getUser('customer');
      const boosts = interaction.options.getInteger('boosts');
      const amount = interaction.options.getString('amount');
      const duration = interaction.options.getString('duration');
      const orderId = String(++data.orderCounter).padStart(4, '0');
      await target.send({ embeds: [brandedEmbed(`🏆 Order #${orderId} Completed`, `**Customer:** ${customer}\n**Package:** ${boosts} boosts\n**Duration:** ${duration}\n**Amount:** ${amount}\n**Completed by:** ${interaction.user}`)] });
      const member = await interaction.guild.members.fetch(customer.id).catch(() => null);
      const role = data.roles.customer ? interaction.guild.roles.cache.get(data.roles.customer) : null;
      if (member && role) await member.roles.add(role).catch(() => {});
      if (data.stock >= boosts) data.stock -= boosts;
      saveData();
      await refreshPanel('stock');
      return interaction.reply({ content: 'Completed order logged and customer role processed.', ephemeral: true });
    }

    if (interaction.commandName === 'close-ticket') {
      const canClose = isAdmin(interaction) || interaction.channel?.topic?.includes(`Customer: ${interaction.user.id}`);
      if (!canClose || !interaction.channel?.topic?.startsWith('Pixel Boosts order')) return interaction.reply({ content: 'Use this inside your order ticket.', ephemeral: true });
      await interaction.reply('Closing this ticket in 5 seconds…');
      setTimeout(() => interaction.channel.delete('Pixel Boosts ticket closed').catch(() => {}), 5000);
    }

    if (interaction.commandName === 'help') {
      return interaction.reply({ embeds: [brandedEmbed('🤖 Pixel Boosts Bot Help', [
        '**Customer commands**',
        '`/shop` or `/buy` — View packages and open an order',
        '`/stock view` — Check current availability',
        '`/price view` — View current prices',
        '`/close-ticket` — Close your order ticket',
        '',
        '**Administrator setup**',
        '`/setchannel` — Assign every panel channel',
        '`/setrole` — Assign Member, Customer, Staff and Support roles',
        '`/setstripe` — Save your Stripe Payment Link',
        '`/config` — View current configuration',
        '`/setup` — Send or refresh all configured panels',
        '',
        '**Store management**',
        '`/stock set` • `/price set` • `/offer`',
        '`/announce` • `/embed` • `/complete-order`',
      ].join('\n'))], ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = { content: 'Something went wrong while processing that action.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

const app = express();
app.get('/', (_, res) => res.status(200).send('Pixel Boosts bot is online.'));
app.get('/health', (_, res) => res.json({ ok: true, bot: client.user?.tag || 'starting' }));
app.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(`Web server listening on port ${process.env.PORT || 10000}`));

client.login(process.env.DISCORD_TOKEN);
