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

const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const BRAND = {
  name: 'Pixel Boosts',
  color: Number.parseInt((process.env.EMBED_COLOR || 'FF2D9B').replace('#', ''), 16),
  banner: process.env.BANNER_URL || 'https://cdn.discordapp.com/attachments/1530275322828951585/1530277037024084178/bannerpixel.png',
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
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return structuredClone(DEFAULT_DATA);
    return { ...structuredClone(DEFAULT_DATA), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
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
    .setFooter({ text: 'Pixel Boosts • Fast, clear and trusted service' })
    .setTimestamp();
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.guild?.ownerId === interaction.user.id;
}

function adminOnly(interaction) {
  if (isAdmin(interaction)) return true;
  interaction.reply({ content: 'You need Administrator permission to use this command.', ephemeral: true }).catch(() => {});
  return false;
}

function channelMention(id) {
  return id ? `<#${id}>` : 'the relevant channel';
}

async function sendOrReplace(channelId, key, payload) {
  if (!channelId) return { ok: false, reason: `Missing ${key} channel ID` };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: `${key} channel was not found or is not text-based` };

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const old = recent?.find(message => message.author.id === client.user.id && message.embeds?.[0]?.footer?.text?.includes(`Panel: ${key}`));
  const panelEmbed = EmbedBuilder.from(payload.embeds[0]).setFooter({ text: `Pixel Boosts • Panel: ${key}` });
  const finalPayload = { ...payload, embeds: [panelEmbed] };
  if (old) await old.edit(finalPayload);
  else await channel.send(finalPayload);
  return { ok: true };
}

function priceLines() {
  return Object.entries(data.prices)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([boosts, price]) => `**${boosts} Boosts** — ${price} / month`)
    .join('\n');
}

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Send or refresh all Pixel Boosts server panels').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('shop').setDescription('View packages, stock and ordering information'),
  new SlashCommandBuilder().setName('stock').setDescription('View or update boost stock')
    .addSubcommand(s => s.setName('view').setDescription('View current stock'))
    .addSubcommand(s => s.setName('set').setDescription('Set current stock').addIntegerOption(o => o.setName('amount').setDescription('Available boosts').setRequired(true).setMinValue(0))),
  new SlashCommandBuilder().setName('price').setDescription('View or update package prices')
    .addSubcommand(s => s.setName('view').setDescription('View all prices'))
    .addSubcommand(s => s.setName('set').setDescription('Set a package price')
      .addIntegerOption(o => o.setName('boosts').setDescription('Number of boosts').setRequired(true).setMinValue(1).setMaxValue(100))
      .addStringOption(o => o.setName('price').setDescription('Example: £8.99').setRequired(true).setMaxLength(30))),
  new SlashCommandBuilder().setName('offer').setDescription('Update the special offer panel')
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
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log(`Registered ${commands.length} guild commands.`);
}

function panels() {
  const orderButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('create_order').setLabel('Create an Order').setEmoji('🛒').setStyle(ButtonStyle.Primary),
  );

  return [
    ['RULES_CHANNEL_ID', 'rules', { embeds: [brandedEmbed('📜 Pixel Boosts Rules', [
      '1. Treat customers and staff with respect.',
      '2. Do not spam, advertise, scam, or impersonate staff.',
      '3. Payments and order details must stay inside your private ticket.',
      '4. Never send passwords, Discord tokens, QR logins, cookies, or account access.',
      '5. Boosts are only supplied from legitimate Discord purchases.',
      '6. Prices, stock and delivery estimates may change before payment.',
      '7. Chargebacks or fraudulent claims may result in removal from the server.',
      '',
      'By ordering, you confirm that you understand the package duration and terms shown in your ticket.',
    ].join('\n'))] }],
    ['ANNOUNCEMENTS_CHANNEL_ID', 'announcements', { embeds: [brandedEmbed('📢 Announcements', 'Official Pixel Boosts updates, restocks, package changes and important notices will be posted here. Enable notifications so you do not miss a restock.')] }],
    ['FAQ_CHANNEL_ID', 'faq', { embeds: [brandedEmbed('❓ Frequently Asked Questions', [
      '**How do I order?**\nPress the order button in the order channel and wait for staff.',
      '**How long do boosts last?**\nEach listing states its duration. The default packages are monthly.',
      '**Is account access required?**\nNo. We will never ask for your password, token, QR login or cookies.',
      '**When will delivery begin?**\nAfter payment is confirmed and stock is available.',
      '**Can prices change?**\nYes, until staff confirms your quote inside the ticket.',
      '**Can I leave a review?**\nYes. After completion, post an honest review in the reviews channel.',
    ].join('\n\n'))] }],
    ['HOW_IT_WORKS_CHANNEL_ID', 'how-it-works', { embeds: [brandedEmbed('📖 How It Works', [
      '**1. Choose a package**\nCheck prices and current stock.',
      '**2. Open an order**\nUse the button in the create-order channel.',
      '**3. Receive a quote**\nStaff confirms stock, duration, price and estimated delivery.',
      '**4. Pay securely**\nUse the payment details supplied in your private ticket.',
      '**5. Delivery and confirmation**\nStaff completes the order and records it in completed orders.',
      '',
      'We never need access to your Discord account.',
    ].join('\n\n'))] }],
    ['PARTNERS_CHANNEL_ID', 'partners', { embeds: [brandedEmbed('📜 Partnerships', 'Interested in partnering with Pixel Boosts? Open an order/support ticket and include your server size, invite link, audience, and what you are offering. Partnerships are reviewed individually; mass-DM advertising is not allowed.')] }],
    ['BOOST_PACKAGES_CHANNEL_ID', 'boost-packages', { embeds: [brandedEmbed('💎 Boost Packages', `${priceLines()}\n\nAll packages are subject to live stock and confirmation in your private ticket. Custom quantities can be quoted by staff.`)], components: [orderButton] }],
    ['PRICING_CHANNEL_ID', 'pricing', { embeds: [brandedEmbed('💰 Current Pricing', `${priceLines()}\n\n**Important:** Prices shown are starting prices and may change with Discord costs, duration, quantity or availability. Your ticket quote is final before payment.`)], components: [orderButton] }],
    ['STOCK_CHANNEL_ID', 'stock', { embeds: [brandedEmbed('⚡ Instant Stock', data.stock > 0 ? `**${data.stock} boosts** are currently marked available.\n\nOpen an order ticket to reserve stock. Stock is not held until staff confirms your order.` : '**Currently out of stock.**\n\nWatch this channel for the next restock.')] }],
    ['SPECIAL_OFFERS_CHANNEL_ID', 'special-offers', { embeds: [brandedEmbed('🎁 Special Offers', data.offer)] }],
    ['CREATE_ORDER_CHANNEL_ID', 'create-order', { embeds: [brandedEmbed('🎫 Create an Order', 'Press the button below to open a private order ticket. Tell us your required number of boosts, duration and server invite. Do not post payment information publicly.')], components: [orderButton] }],
    ['ORDER_STATUS_CHANNEL_ID', 'order-status', { embeds: [brandedEmbed('📦 Order Status', 'Order updates are provided inside each private ticket. Public completed-order confirmations may appear in the completed-orders channel after delivery.')] }],
    ['PAYMENT_METHODS_CHANNEL_ID', 'payment-methods', { embeds: [brandedEmbed('💳 Payment Methods', [
      '**Bank Transfer**\nDetails are provided privately by staff after your order is confirmed.',
      '**PayPal Goods & Services**\nUse the PayPal details supplied in your private ticket. Include only the reference staff gives you.',
      '',
      'Never send money to an account posted by another member. Verify the staff role before paying.',
    ].join('\n\n'))] }],
    ['REVIEWS_CHANNEL_ID', 'reviews', { embeds: [brandedEmbed('⭐ Customer Reviews', 'Completed an order? Leave an honest review including the package, delivery experience and staff member who helped you. Do not post private payment details.')] }],
    ['PROOF_CHANNEL_ID', 'proof', { embeds: [brandedEmbed('📸 Delivery Proof', 'Staff may post privacy-safe delivery confirmations here. Customer names, payment details and sensitive information must be hidden unless the customer has clearly agreed to share them.')] }],
    ['VIDEO_VOUCHES_CHANNEL_ID', 'video-vouches', { embeds: [brandedEmbed('🎥 Video Vouches', 'Customers may share genuine video vouches here after a completed order. Fake, purchased or misleading vouches are not accepted.')] }],
    ['COMPLETED_ORDERS_CHANNEL_ID', 'completed-orders', { embeds: [brandedEmbed('🏆 Completed Orders', 'Verified completed orders will be logged here by staff using `/complete-order`.')] }],
  ];
}

async function refreshPanel(key) {
  const panel = panels().find(([, panelKey]) => panelKey === key);
  if (!panel) return;
  const [envKey, panelKey, payload] = panel;
  await sendOrReplace(process.env[envKey], panelKey, payload);
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('Pixel Boosts orders');
  await registerCommands().catch(error => console.error('Command registration failed:', error));
});

client.on('guildMemberAdd', async member => {
  if (!process.env.MEMBER_ROLE_ID) return;
  const role = member.guild.roles.cache.get(process.env.MEMBER_ROLE_ID);
  if (role) await member.roles.add(role).catch(() => {});
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'create_order') {
        await interaction.deferReply({ ephemeral: true });
        const existing = interaction.guild.channels.cache.find(c => c.name === `order-${interaction.user.id}`);
        if (existing) return interaction.editReply(`You already have an open order: ${existing}`);

        data.orderCounter += 1;
        saveData();
        const orderNumber = String(data.orderCounter).padStart(4, '0');
        const permissionOverwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
        ];
        for (const roleId of [process.env.SUPPORT_ROLE_ID, process.env.STAFF_ROLE_ID].filter(Boolean)) {
          permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        }

        const channel = await interaction.guild.channels.create({
          name: `order-${interaction.user.id}`,
          type: ChannelType.GuildText,
          parent: process.env.TICKET_CATEGORY_ID || undefined,
          topic: `Pixel Boosts order #${orderNumber} | Customer: ${interaction.user.id}`,
          permissionOverwrites,
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_order').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
        );
        await channel.send({
          content: `${interaction.user}${process.env.SUPPORT_ROLE_ID ? ` <@&${process.env.SUPPORT_ROLE_ID}>` : ''}`,
          embeds: [brandedEmbed(`🛒 Order #${orderNumber}`, [
            'Thanks for choosing Pixel Boosts. Please send:',
            '• Number of boosts required',
            '• Duration required',
            '• Your server invite',
            '• Preferred payment method',
            '',
            'Wait for staff to confirm stock and the final quote before paying.',
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

    if (interaction.commandName === 'setup') {
      if (!adminOnly(interaction)) return;
      await interaction.deferReply({ ephemeral: true });
      const results = [];
      for (const [envKey, key, payload] of panels()) {
        results.push(await sendOrReplace(process.env[envKey], key, payload));
      }
      const successful = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok).map(r => `• ${r.reason}`);
      return interaction.editReply(`Refreshed **${successful}** panels.${failed.length ? `\n\nNot sent:\n${failed.join('\n')}` : ''}`);
    }

    if (interaction.commandName === 'shop') {
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_order').setLabel('Create an Order').setEmoji('🛒').setStyle(ButtonStyle.Primary));
      return interaction.reply({ embeds: [brandedEmbed('🚀 Pixel Boosts Shop', `${priceLines()}\n\n**Stock:** ${data.stock} boosts\n\nPress below to open a private order.`)], components: [row], ephemeral: true });
    }

    if (interaction.commandName === 'stock') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') return interaction.reply({ embeds: [brandedEmbed('⚡ Current Stock', `Available: **${data.stock} boosts**`)], ephemeral: true });
      if (!adminOnly(interaction)) return;
      data.stock = interaction.options.getInteger('amount');
      saveData();
      await refreshPanel('stock');
      return interaction.reply({ content: `Stock updated to **${data.stock} boosts** and the stock panel was refreshed.`, ephemeral: true });
    }

    if (interaction.commandName === 'price') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') return interaction.reply({ embeds: [brandedEmbed('💰 Current Prices', priceLines())], ephemeral: true });
      if (!adminOnly(interaction)) return;
      const boosts = String(interaction.options.getInteger('boosts'));
      const price = interaction.options.getString('price').trim();
      data.prices[boosts] = price;
      saveData();
      await refreshPanel('pricing');
      await refreshPanel('boost-packages');
      return interaction.reply({ content: `Updated **${boosts} boosts** to **${price}**.`, ephemeral: true });
    }

    if (interaction.commandName === 'offer') {
      if (!adminOnly(interaction)) return;
      data.offer = interaction.options.getString('text');
      saveData();
      await refreshPanel('special-offers');
      return interaction.reply({ content: 'Special offer updated.', ephemeral: true });
    }

    if (interaction.commandName === 'announce' || interaction.commandName === 'embed') {
      if (!adminOnly(interaction)) return;
      const channel = interaction.options.getChannel('channel');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString(interaction.commandName === 'announce' ? 'message' : 'description');
      const ping = interaction.commandName === 'announce' && interaction.options.getBoolean('ping');
      await channel.send({ content: ping ? '@everyone' : undefined, embeds: [brandedEmbed(title, description)], allowedMentions: { parse: ping ? ['everyone'] : [] } });
      return interaction.reply({ content: `Sent to ${channel}.`, ephemeral: true });
    }

    if (interaction.commandName === 'complete-order') {
      if (!adminOnly(interaction)) return;
      const customer = interaction.options.getUser('customer');
      const boosts = interaction.options.getInteger('boosts');
      const amount = interaction.options.getString('amount');
      const duration = interaction.options.getString('duration');
      const target = await client.channels.fetch(process.env.COMPLETED_ORDERS_CHANNEL_ID).catch(() => null);
      if (!target?.isTextBased()) return interaction.reply({ content: 'COMPLETED_ORDERS_CHANNEL_ID is missing or invalid.', ephemeral: true });
      const orderId = String(++data.orderCounter).padStart(4, '0');
      saveData();
      await target.send({ embeds: [brandedEmbed(`🏆 Order #${orderId} Completed`, `**Customer:** ${customer}\n**Package:** ${boosts} boosts\n**Duration:** ${duration}\n**Amount:** ${amount}\n**Completed by:** ${interaction.user}`)] });
      if (process.env.CUSTOMER_ROLE_ID) {
        const member = await interaction.guild.members.fetch(customer.id).catch(() => null);
        const role = interaction.guild.roles.cache.get(process.env.CUSTOMER_ROLE_ID);
        if (member && role) await member.roles.add(role).catch(() => {});
      }
      if (data.stock >= boosts) {
        data.stock -= boosts;
        saveData();
        await refreshPanel('stock');
      }
      return interaction.reply({ content: 'Completed order logged and customer role processed.', ephemeral: true });
    }

    if (interaction.commandName === 'close-ticket') {
      const canClose = isAdmin(interaction) || interaction.channel?.topic?.includes(`Customer: ${interaction.user.id}`);
      if (!canClose || !interaction.channel?.name?.startsWith('order-')) return interaction.reply({ content: 'Use this inside your order ticket.', ephemeral: true });
      await interaction.reply('Closing this ticket in 5 seconds…');
      setTimeout(() => interaction.channel.delete('Pixel Boosts ticket closed').catch(() => {}), 5000);
    }

    if (interaction.commandName === 'help') {
      const description = [
        '**Customer commands**',
        '`/shop` — View packages, stock and open an order',
        '`/stock view` — Check current availability',
        '`/price view` — View package prices',
        '`/close-ticket` — Close your order ticket',
        '',
        '**Administrator commands**',
        '`/setup` — Send or refresh every server panel',
        '`/stock set` — Update live stock',
        '`/price set` — Update a package price',
        '`/offer` — Update the special offer',
        '`/announce` — Send a branded announcement',
        '`/embed` — Send a custom branded embed',
        '`/complete-order` — Log delivery and assign Customer role',
      ].join('\n');
      return interaction.reply({ embeds: [brandedEmbed('🤖 Pixel Boosts Bot Help', description)], ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const message = { content: 'Something went wrong while processing that action.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
    else await interaction.reply(message).catch(() => {});
  }
});

const app = express();
app.get('/', (_, res) => res.status(200).send('Pixel Boosts bot is online.'));
app.get('/health', (_, res) => res.json({ ok: true, bot: client.user?.tag || 'starting' }));
app.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(`Web server listening on port ${process.env.PORT || 10000}`));

client.login(process.env.DISCORD_TOKEN);
