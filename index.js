require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  ActionRowBuilder,
  ActivityType,
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
  color: 0x008cff,
  banner: 'https://cdn.discordapp.com/attachments/1530275322828951585/1530284660276465804/ChatGPT_Image_Jul_24_2026_07_44_09_PM.png?ex=6a650426&is=6a63b2a6&hm=44cb3be2506f5ffd929a26fdc2cf4d9ff0a5d2ccd2677d755ddb53fab048fadc',
  footer: 'Pixel Boosts • Fast, affordable and trusted',
};

const DATA_FILE = path.join(__dirname, 'data.json');
const DEFAULT_DATA = {
  stock: 0,
  products: [
    { id: '6x-1m', name: '6 Boosts', boosts: 6, months: 1, price: 7.50, description: 'Great for unlocking Level 1 perks.' },
    { id: '14x-1m', name: '14 Boosts', boosts: 14, months: 1, price: 15.00, description: 'Best-value one-month package.' },
    { id: '28x-1m', name: '28 Boosts', boosts: 28, months: 1, price: 28.00, description: 'Ideal for larger servers.' },
    { id: '36x-1m', name: '36 Boosts', boosts: 36, months: 1, price: 35.00, description: 'Maximum one-month package.' },
    { id: '14x-3m', name: '14 Boosts', boosts: 14, months: 3, price: 40.00, description: 'Three months at a reduced bundle price.' },
    { id: '28x-3m', name: '28 Boosts', boosts: 28, months: 3, price: 75.00, description: 'Three-month bulk package.' },
    { id: '36x-3m', name: '36 Boosts', boosts: 36, months: 3, price: 95.00, description: 'Premium three-month package.' },
  ],
  offer: 'No active special offer right now. Check back soon!',
  orderCounter: 0,
  bank: {
    accountName: 'James',
    sortCode: '07-09-76',
    accountNumber: '03545533',
  },
  storeOpen: true,
  discountPercent: 0,
  channels: {},
  roles: {},
  panels: {},
  coupons: {},
  stats: {
    revenue: 0,
    completedOrders: 0,
    boostsDelivered: 0,
    reviews: 0,
    packageSales: {},
    sales: [],
    lastRestockAt: null,
    lastRestockAmount: 0,
  },
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return cloneDefault();
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      ...cloneDefault(),
      ...saved,
      products: Array.isArray(saved.products) && saved.products.length ? saved.products : cloneDefault().products,
      bank: { ...cloneDefault().bank, ...(saved.bank || {}) },
      channels: { ...(saved.channels || {}) },
      roles: { ...(saved.roles || {}) },
      panels: { ...(saved.panels || {}) },
      coupons: { ...(saved.coupons || {}) },
      stats: {
        ...DEFAULT_DATA.stats,
        ...(saved.stats || {}),
        packageSales: { ...((saved.stats || {}).packageSales || {}) },
        sales: Array.isArray((saved.stats || {}).sales) ? saved.stats.sales : [],
      },
    };
  } catch (error) {
    console.error('Could not load data.json:', error);
    return cloneDefault();
  }
}

let data = loadData();
let cloudSaveTimer = null;
let cloudDataMessageId = null;
const CLOUD_CHANNEL_TOPIC = 'PIXEL_BOOSTS_BOT_DATA_DO_NOT_DELETE';

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  if (client?.isReady?.()) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => syncDataToDiscord().catch(error => console.error('Cloud save failed:', error)), 800);
  }
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
    .setFooter({ text: BRAND.footer })
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

function parseMoney(value) {
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function money(value) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
}

function discountedMoney(value) {
  const percent = Number(data.discountPercent) || 0;
  const original = Number(value) || 0;
  return percent > 0 ? original * (1 - percent / 100) : original;
}

function productLines() {
  const products = [...data.products].sort((a, b) => (a.months - b.months) || (a.boosts - b.boosts));
  const groups = new Map();
  for (const product of products) {
    const key = Number(product.months) || 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  return [...groups.entries()].map(([months, items]) => {
    const heading = `**${months} Month${months === 1 ? '' : 's'}**`;
    const lines = items.map(product => {
      const original = Number(product.price) || 0;
      const discounted = discountedMoney(original);
      const price = data.discountPercent ? `~~${money(original)}~~ **${money(discounted)}**` : `**${money(original)}**`;
      return `• **${product.boosts}x Boosts** — ${price}${product.description ? `\n  ${product.description}` : ''}`;
    });
    return `${heading}\n${lines.join('\n')}`;
  }).join('\n\n');
}

function findProduct(productId) {
  return data.products.find(product => product.id === productId);
}

function storeStatusText() {
  return data.storeOpen ? '🟢 **OPEN**' : '🔴 **CLOSED**';
}

function relativeTime(dateString) {
  if (!dateString) return 'Never';
  const unix = Math.floor(new Date(dateString).getTime() / 1000);
  return Number.isFinite(unix) ? `<t:${unix}:R>` : 'Unknown';
}

const CHANNEL_TYPES = [
  ['rules', 'Rules'], ['announcements', 'Announcements'], ['faq', 'FAQ'],
  ['how-it-works', 'How It Works'], ['partners', 'Partners'],
  ['boost-packages', 'Boost Packages'], ['pricing', 'Pricing'], ['stock', 'Instant Stock'],
  ['special-offers', 'Special Offers'], ['create-order', 'Create Order'],
  ['order-status', 'Order Status'], ['payment-methods', 'Payment Methods'],
  ['reviews', 'Reviews'], ['proof', 'Proof'], ['video-vouches', 'Video Vouches'],
  ['completed-orders', 'Completed Orders'], ['status', 'Store Status'],
  ['logs', 'Logs'], ['sales-log', 'Sales Log'], ['ticket-category', 'Ticket Category'],
];

const ROLE_TYPES = [
  ['member', 'Member'], ['customer', 'Customer'], ['support', 'Support'],
  ['staff', 'Staff'], ['stock-alerts', 'Stock Alerts'],
];

const channelChoices = CHANNEL_TYPES.map(([value, name]) => ({ name, value }));
const roleChoices = ROLE_TYPES.map(([value, name]) => ({ name, value }));

const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Send or refresh every configured Pixel Boosts panel').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setchannel').setDescription('Choose where a panel or ticket category is used')
    .addStringOption(o => o.setName('type').setDescription('What this channel is for').setRequired(true).addChoices(...channelChoices))
    .addChannelOption(o => o.setName('channel').setDescription('Channel or category').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setrole').setDescription('Choose a role used by the bot')
    .addStringOption(o => o.setName('type').setDescription('What this role is for').setRequired(true).addChoices(...roleChoices))
    .addRoleOption(o => o.setName('role').setDescription('Role to use').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('setbank').setDescription('Set the bank-transfer details shown by the bot')
    .addStringOption(o => o.setName('account_name').setDescription('Account holder name').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('sort_code').setDescription('UK sort code, e.g. 07-09-76').setRequired(true).setMaxLength(12))
    .addStringOption(o => o.setName('account_number').setDescription('UK account number').setRequired(true).setMaxLength(20))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('config').setDescription('View the current channel, role and bank setup').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('shop').setDescription('View packages, stock and ordering information'),
  new SlashCommandBuilder().setName('buy').setDescription('Open the order panel'),
  new SlashCommandBuilder().setName('bank').setDescription('View the official bank-transfer details'),
  new SlashCommandBuilder().setName('stock').setDescription('View or update boost stock')
    .addSubcommand(s => s.setName('view').setDescription('View current stock'))
    .addSubcommand(s => s.setName('set').setDescription('Set current stock').addIntegerOption(o => o.setName('amount').setDescription('Available boosts').setRequired(true).setMinValue(0))),
  new SlashCommandBuilder().setName('restock').setDescription('Add stock and optionally announce the restock')
    .addIntegerOption(o => o.setName('amount').setDescription('Boosts to add').setRequired(true).setMinValue(1))
    .addBooleanOption(o => o.setName('announce').setDescription('Post in announcements and ping Stock Alerts'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('package').setDescription('View or manage shop packages')
    .addSubcommand(s => s.setName('list').setDescription('View all shop packages'))
    .addSubcommand(s => s.setName('add').setDescription('Add a package')
      .addIntegerOption(o => o.setName('boosts').setDescription('Number of boosts').setRequired(true).setMinValue(1).setMaxValue(500))
      .addIntegerOption(o => o.setName('months').setDescription('Duration in months').setRequired(true).setMinValue(1).setMaxValue(24))
      .addNumberOption(o => o.setName('price').setDescription('Price in GBP, e.g. 15').setRequired(true).setMinValue(0.01))
      .addStringOption(o => o.setName('description').setDescription('Short package description').setMaxLength(150)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit an existing package')
      .addStringOption(o => o.setName('id').setDescription('Package ID from /package list').setRequired(true))
      .addIntegerOption(o => o.setName('boosts').setDescription('New boost amount').setMinValue(1).setMaxValue(500))
      .addIntegerOption(o => o.setName('months').setDescription('New duration').setMinValue(1).setMaxValue(24))
      .addNumberOption(o => o.setName('price').setDescription('New price in GBP').setMinValue(0.01))
      .addStringOption(o => o.setName('description').setDescription('New description').setMaxLength(150)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a package')
      .addStringOption(o => o.setName('id').setDescription('Package ID from /package list').setRequired(true)))
    .addSubcommand(s => s.setName('reset').setDescription('Restore the recommended default packages')),
  new SlashCommandBuilder().setName('discount').setDescription('Manage a store-wide percentage discount')
    .addSubcommand(s => s.setName('view').setDescription('View the active discount'))
    .addSubcommand(s => s.setName('set').setDescription('Set the discount').addIntegerOption(o => o.setName('percent').setDescription('Percentage off').setRequired(true).setMinValue(1).setMaxValue(90)))
    .addSubcommand(s => s.setName('clear').setDescription('Remove the active discount')),
  new SlashCommandBuilder().setName('coupon').setDescription('Create, list, delete or redeem coupon codes')
    .addSubcommand(s => s.setName('create').setDescription('Create a coupon')
      .addStringOption(o => o.setName('code').setDescription('Coupon code').setRequired(true).setMaxLength(24))
      .addIntegerOption(o => o.setName('percent').setDescription('Percentage off').setRequired(true).setMinValue(1).setMaxValue(90))
      .addIntegerOption(o => o.setName('uses').setDescription('Maximum uses; omit for unlimited').setMinValue(1)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a coupon').addStringOption(o => o.setName('code').setDescription('Coupon code').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List active coupons'))
    .addSubcommand(s => s.setName('redeem').setDescription('Check and reserve a coupon for your order').addStringOption(o => o.setName('code').setDescription('Coupon code').setRequired(true))),
  new SlashCommandBuilder().setName('store').setDescription('Open, close or view the shop')
    .addSubcommand(s => s.setName('open').setDescription('Open the shop'))
    .addSubcommand(s => s.setName('close').setDescription('Close the shop'))
    .addSubcommand(s => s.setName('status').setDescription('View shop status')),
  new SlashCommandBuilder().setName('offer').setDescription('Update the special-offer panel')
    .addStringOption(o => o.setName('text').setDescription('Offer text').setRequired(true).setMaxLength(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('dashboard').setDescription('View the owner dashboard').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('stats').setDescription('View detailed shop analytics').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
  new SlashCommandBuilder().setName('review').setDescription('Leave a verified-style customer review')
    .addIntegerOption(o => o.setName('rating').setDescription('Rating out of 5').setRequired(true).setMinValue(1).setMaxValue(5))
    .addStringOption(o => o.setName('comment').setDescription('Your review').setRequired(true).setMaxLength(1000)),
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
    new ButtonBuilder()
      .setCustomId('create_order')
      .setLabel(data.storeOpen ? 'Create an Order' : 'Store Closed')
      .setEmoji(data.storeOpen ? '🛒' : '🔒')
      .setStyle(data.storeOpen ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!data.storeOpen),
  );
  return row;
}

function bankDetailsText() {
  const bank = data.bank || {};
  return [
    '**Payment method: Bank Transfer**',
    '',
    `**Account name**\n\`${bank.accountName || 'Not configured'}\``,
    `**Sort code**\n\`${bank.sortCode || 'Not configured'}\``,
    `**Account number**\n\`${bank.accountNumber || 'Not configured'}\``,
    '',
    'Open an order ticket and wait for staff to confirm your package and final total **before sending payment**.',
    'After paying, send proof of payment inside your private ticket. Do not post bank or payment information publicly.',
  ].join('\n');
}

function bankEmbed() {
  return brandedEmbed('💳 Bank Transfer', bankDetailsText());
}

function statusEmbed() {
  return brandedEmbed('⚡ Pixel Boosts Status', [
    `**Store:** ${storeStatusText()}`,
    `**Available Stock:** ${data.stock} boosts`,
    '**Payments:** Bank transfer',
    `**Active Discount:** ${data.discountPercent ? `${data.discountPercent}% off` : 'None'}`,
    `**Last Restock:** ${relativeTime(data.stats.lastRestockAt)}`,
    '',
    data.storeOpen ? 'Open a private order ticket to get started.' : 'Ordering is temporarily paused. Please check back soon.',
  ].join('\n'));
}

function panelDefinitions() {
  const discountNote = data.discountPercent ? `\n\n🔥 **Current sale: ${data.discountPercent}% off displayed packages.**` : '';
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
      '**How long do boosts last?**\nPackages are available for one or three months, as shown in the shop.',
      '**Do you need my Discord login?**\nNo. We never ask for passwords, tokens, QR codes or cookies.',
      '**When does delivery start?**\nAfter payment is confirmed and stock is available.',
      '**Can prices change?**\nYes, until your final quote is confirmed in the ticket.',
    ].join('\n\n'))],
    ['how-it-works', brandedEmbed('📖 How It Works', [
      '**1. Pick a package**\nCheck the prices and live stock.',
      '**2. Open an order ticket**\nTell staff the amount and duration you need.',
      '**3. Receive confirmation**\nStaff confirms stock and your final total.',
      '**4. Pay by bank transfer**\nUse only the official bank details shown by the bot after staff confirms your total.',
      '**5. Delivery**\nYour order is processed and logged once completed.',
    ].join('\n\n'))],
    ['partners', brandedEmbed('📜 Partnerships', 'To discuss a partnership, open a ticket and include your server size, invite link, audience and what you are offering.')],
    ['boost-packages', brandedEmbed('💎 Boost Packages', `${productLines()}${discountNote}\n\nAll packages are subject to live stock and staff confirmation. Custom quantities can be quoted in a ticket.`), orderButtons()],
    ['pricing', brandedEmbed('💰 Current Pricing', `${productLines()}${discountNote}\n\nYour confirmed ticket quote is final before payment.`), orderButtons()],
    ['stock', brandedEmbed('⚡ Instant Stock', data.stock > 0 ? `**${data.stock} boosts** are currently available.\n\n${data.storeOpen ? 'Open a ticket to reserve stock.' : 'The store is currently closed.'}` : '**Currently out of stock.**\n\nWatch this channel for the next restock.')],
    ['special-offers', brandedEmbed('🎁 Special Offers', data.offer)],
    ['create-order', brandedEmbed('🎫 Create an Order', data.storeOpen ? 'Press **Create an Order** below to open a private ticket. Staff will confirm your package, stock and final price before you pay.' : 'The store is currently **closed**. Ordering will reopen soon.'), orderButtons()],
    ['order-status', brandedEmbed('📦 Order Status', 'Order updates are posted inside each private ticket. Completed orders are logged after delivery.')],
    ['payment-methods', bankEmbed()],
    ['reviews', brandedEmbed('⭐ Customer Reviews', 'Completed an order? Use `/review` to leave an honest rating about your package, delivery and support experience. Never post private payment details.')],
    ['proof', brandedEmbed('📸 Delivery Proof', 'Privacy-safe delivery confirmations may be posted here. Sensitive details must always be hidden.')],
    ['video-vouches', brandedEmbed('🎥 Video Vouches', 'Customers can share genuine video vouches after a completed order.')],
    ['completed-orders', brandedEmbed('🏆 Completed Orders', 'Verified completed orders are logged here by staff using `/complete-order`.')],
    ['status', statusEmbed()],
  ];
}

async function sendOrReplace(key, embed, components = null) {
  const channelId = data.channels[key];
  if (!channelId) return { ok: false, reason: `${key} has not been configured` };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: `${key} channel is invalid` };

  const marker = `Pixel Boosts • Panel: ${key}`;
  const finalEmbed = EmbedBuilder.from(embed).setFooter({ text: marker });
  const payload = { embeds: [finalEmbed], components: components ? [components] : [] };
  let message = null;

  const saved = data.panels[key];
  if (saved?.messageId && saved.channelId === channel.id) {
    message = await channel.messages.fetch(saved.messageId).catch(() => null);
  }
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find(m => m.author.id === client.user.id && m.embeds?.[0]?.footer?.text === marker) || null;
  }

  if (message) await message.edit(payload);
  else message = await channel.send(payload);

  data.panels[key] = { channelId: channel.id, messageId: message.id };
  saveData();
  return { ok: true };
}

async function refreshPanel(key) {
  const panel = panelDefinitions().find(([panelKey]) => panelKey === key);
  if (panel) await sendOrReplace(...panel);
}

async function refreshCommercePanels() {
  for (const key of ['boost-packages', 'pricing', 'stock', 'create-order', 'payment-methods', 'status']) {
    await refreshPanel(key);
  }
}

function salesSince(msAgo) {
  const cutoff = Date.now() - msAgo;
  return data.stats.sales.filter(s => new Date(s.at).getTime() >= cutoff);
}

function salesRevenue(sales) {
  return sales.reduce((sum, sale) => sum + (Number(sale.amountNumeric) || 0), 0);
}

function bestPackage() {
  const entries = Object.entries(data.stats.packageSales || {});
  if (!entries.length) return 'No sales yet';
  entries.sort((a, b) => b[1] - a[1]);
  return `${entries[0][0]} boosts (${entries[0][1]} orders)`;
}

async function postLog(key, embed) {
  const id = data.channels[key];
  if (!id) return;
  const channel = await client.channels.fetch(id).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
}

async function getCloudDataChannel(guild) {
  let channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic === CLOUD_CHANNEL_TOPIC);
  if (channel) return channel;
  channel = await guild.channels.create({
    name: 'pixel-bot-data',
    type: ChannelType.GuildText,
    topic: CLOUD_CHANNEL_TOPIC,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ],
    reason: 'Persistent Pixel Boosts bot configuration',
  });
  return channel;
}

async function loadDataFromDiscord(guild) {
  const channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic === CLOUD_CHANNEL_TOPIC);
  if (!channel) return false;
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const message = messages?.find(m => m.author.id === client.user.id && m.attachments.some(a => a.name === 'pixel-boosts-data.json'));
  const attachment = message?.attachments.find(a => a.name === 'pixel-boosts-data.json');
  if (!attachment) return false;
  const response = await fetch(attachment.url);
  if (!response.ok) return false;
  const remote = await response.json();
  data = {
    ...cloneDefault(),
    ...remote,
    products: Array.isArray(remote.products) && remote.products.length ? remote.products : cloneDefault().products,
    channels: { ...(remote.channels || {}) }, roles: { ...(remote.roles || {}) }, panels: { ...(remote.panels || {}) },
    coupons: { ...(remote.coupons || {}) }, stats: { ...cloneDefault().stats, ...(remote.stats || {}), packageSales: { ...((remote.stats || {}).packageSales || {}) }, sales: Array.isArray((remote.stats || {}).sales) ? remote.stats.sales : [] },
  };
  cloudDataMessageId = message.id;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log('Loaded configuration from Discord cloud storage.');
  return true;
}

async function syncDataToDiscord() {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;
  const channel = await getCloudDataChannel(guild);
  const payload = { content: 'Pixel Boosts persistent configuration. Do not delete this channel or message.', files: [{ attachment: Buffer.from(JSON.stringify(data, null, 2)), name: 'pixel-boosts-data.json' }] };
  let message = cloudDataMessageId ? await channel.messages.fetch(cloudDataMessageId).catch(() => null) : null;
  if (!message) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    message = messages?.find(m => m.author.id === client.user.id && m.attachments.some(a => a.name === 'pixel-boosts-data.json')) || null;
  }
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  cloudDataMessageId = message.id;
}

function normalizeName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function autoDetectConfiguration(guild) {
  const aliases = {
    rules: ['rules'], announcements: ['announcements'], faq: ['faq'], 'how-it-works': ['how-it-works'], partners: ['partners'],
    'boost-packages': ['boost-packages', 'packages'], pricing: ['pricing', 'prices'], stock: ['instant-stock', 'stock'],
    'special-offers': ['special-offers', 'offers'], 'create-order': ['create-order', 'order-here'], 'order-status': ['order-status'],
    'payment-methods': ['payment-methods', 'payments'], reviews: ['reviews'], proof: ['proof'], 'video-vouches': ['video-vouches'],
    'completed-orders': ['completed-orders'], status: ['store-status', 'status'], logs: ['logs'], 'sales-log': ['sales-log'],
  };
  for (const [key, names] of Object.entries(aliases)) {
    if (data.channels[key]) continue;
    const found = guild.channels.cache.find(c => c.isTextBased?.() && names.includes(normalizeName(c.name)));
    if (found) data.channels[key] = found.id;
  }
  if (!data.channels['ticket-category']) {
    const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && ['orders', 'tickets', 'order-tickets'].includes(normalizeName(c.name)));
    if (category) data.channels['ticket-category'] = category.id;
  }
  const roleAliases = { member: ['member'], customer: ['customer', 'verified-buyer'], support: ['support'], staff: ['staff'], 'stock-alerts': ['stock-alerts'] };
  for (const [key, names] of Object.entries(roleAliases)) {
    if (data.roles[key]) continue;
    const role = guild.roles.cache.find(r => names.includes(normalizeName(r.name)));
    if (role) data.roles[key] = role.id;
  }
  saveData();
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    await loadDataFromDiscord(guild).catch(error => console.error('Cloud load failed:', error));
    await autoDetectConfiguration(guild).catch(error => console.error('Auto configuration failed:', error));
    await syncDataToDiscord().catch(error => console.error('Initial cloud save failed:', error));
  }
  await registerCommands().catch(error => console.error('Command registration failed:', error));

  const activities = [
    () => ({ name: 'Delivering Boosts', type: ActivityType.Playing }),
    () => ({ name: '/buy to order', type: ActivityType.Watching }),
    () => ({ name: `${data.stock} boosts in stock`, type: ActivityType.Watching }),
    () => ({ name: data.storeOpen ? 'Store Open' : 'Store Closed', type: ActivityType.Playing }),
    () => ({ name: 'Trusted Service', type: ActivityType.Competing }),
  ];
  let activityIndex = 0;
  const rotate = () => {
    client.user.setActivity(activities[activityIndex % activities.length]());
    activityIndex += 1;
  };
  rotate();
  setInterval(rotate, 15_000);

  setInterval(() => refreshPanel('status').catch(() => {}), 60_000);
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
        if (!data.storeOpen) return interaction.reply({ content: 'The store is currently closed. Please check back soon.', ephemeral: true });
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

        await channel.send({
          content: `${interaction.user}${data.roles.support ? ` <@&${data.roles.support}>` : ''}`,
          embeds: [brandedEmbed(`🛒 Order #${orderNumber}`, [
            'Please send:',
            '• Number of boosts required',
            '• Duration required',
            '• Your server invite',
            '• Coupon code, if you have one',
            '',
            'Wait for staff to confirm your package and final total before paying.',
            '',
            bankDetailsText(),
            '',
            '**Never share your Discord password, token, QR code or cookies.**',
          ].join('\n'))],
          components: [closeRow],
        });
        await postLog('logs', brandedEmbed('🎫 Order Ticket Opened', `**Order:** #${orderNumber}\n**Customer:** ${interaction.user}\n**Channel:** ${channel}`));
        return interaction.editReply(`Your private order ticket is ready: ${channel}`);
      }

      if (interaction.customId === 'close_order') {
        const canClose = isAdmin(interaction) || interaction.channel?.topic?.includes(`Customer: ${interaction.user.id}`);
        if (!canClose) return interaction.reply({ content: 'Only the customer or an administrator can close this ticket.', ephemeral: true });
        await interaction.reply({ content: 'Closing this ticket in 5 seconds…' });
        await postLog('logs', brandedEmbed('🔒 Order Ticket Closed', `**Channel:** ${interaction.channel.name}\n**Closed by:** ${interaction.user}`));
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
      delete data.panels[type];
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

    if (interaction.commandName === 'setbank') {
      if (!await adminOnly(interaction)) return;
      const accountName = interaction.options.getString('account_name').trim();
      const sortCodeRaw = interaction.options.getString('sort_code').replace(/\D/g, '');
      const accountNumber = interaction.options.getString('account_number').replace(/\s/g, '');
      if (sortCodeRaw.length !== 6) {
        return interaction.reply({ content: 'The sort code must contain exactly 6 digits.', ephemeral: true });
      }
      if (!/^\d{8}$/.test(accountNumber)) {
        return interaction.reply({ content: 'The account number must contain exactly 8 digits.', ephemeral: true });
      }
      data.bank = {
        accountName,
        sortCode: `${sortCodeRaw.slice(0, 2)}-${sortCodeRaw.slice(2, 4)}-${sortCodeRaw.slice(4, 6)}`,
        accountNumber,
      };
      saveData();
      await refreshPanel('payment-methods');
      return interaction.reply({ content: 'Bank-transfer details saved and the payment panel was refreshed.', ephemeral: true });
    }

    if (interaction.commandName === 'config') {
      if (!await adminOnly(interaction)) return;
      const channelText = CHANNEL_TYPES.map(([key, name]) => `**${name}:** ${data.channels[key] ? `<#${data.channels[key]}>` : 'Not set'}`).join('\n');
      const roleText = ROLE_TYPES.map(([key, name]) => `**${name}:** ${data.roles[key] ? `<@&${data.roles[key]}>` : 'Not set'}`).join('\n');
      const bankStatus = data.bank?.accountName && data.bank?.sortCode && data.bank?.accountNumber ? 'Configured' : 'Not set';
      const embed = brandedEmbed('⚙️ Pixel Boosts Configuration', `${channelText}\n\n**Roles**\n${roleText}\n\n**Bank transfer:** ${bankStatus}\n**Store:** ${storeStatusText()}`);
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

    if (interaction.commandName === 'bank') {
      return interaction.reply({ embeds: [bankEmbed()], ephemeral: true });
    }

    if (interaction.commandName === 'shop' || interaction.commandName === 'buy') {
      return interaction.reply({
        embeds: [brandedEmbed('🚀 Pixel Boosts Shop', `${productLines()}\n\n**Stock:** ${data.stock} boosts\n**Store:** ${storeStatusText()}\n\n${data.storeOpen ? 'Open a private order before paying so staff can confirm availability.' : 'Ordering is temporarily unavailable.'}`)],
        components: [orderButtons()],
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'stock') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') return interaction.reply({ embeds: [brandedEmbed('⚡ Current Stock', `Available: **${data.stock} boosts**\nStore: ${storeStatusText()}`)], ephemeral: true });
      if (!await adminOnly(interaction)) return;
      data.stock = interaction.options.getInteger('amount');
      saveData();
      await refreshCommercePanels();
      return interaction.reply({ content: `Stock updated to **${data.stock} boosts**.`, ephemeral: true });
    }

    if (interaction.commandName === 'restock') {
      if (!await adminOnly(interaction)) return;
      const amount = interaction.options.getInteger('amount');
      const shouldAnnounce = interaction.options.getBoolean('announce') ?? true;
      data.stock += amount;
      data.stats.lastRestockAt = new Date().toISOString();
      data.stats.lastRestockAmount = amount;
      saveData();
      await refreshCommercePanels();
      if (shouldAnnounce && data.channels.announcements) {
        const channel = await client.channels.fetch(data.channels.announcements).catch(() => null);
        if (channel?.isTextBased()) {
          const ping = data.roles['stock-alerts'] ? `<@&${data.roles['stock-alerts']}>` : '';
          await channel.send({
            content: ping || undefined,
            embeds: [brandedEmbed('⚡ Pixel Boosts Restock', `We just added **${amount} boosts**.\n\n**Current stock:** ${data.stock} boosts\n\nOpen an order while stock is available.`)],
            allowedMentions: { roles: data.roles['stock-alerts'] ? [data.roles['stock-alerts']] : [] },
          });
        }
      }
      return interaction.reply({ content: `Added **${amount} boosts**. New stock: **${data.stock}**.`, ephemeral: true });
    }

    if (interaction.commandName === 'package') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const ids = [...data.products].sort((a, b) => (a.months - b.months) || (a.boosts - b.boosts))
          .map(p => `\`${p.id}\` — **${p.boosts}x boosts / ${p.months} month${p.months === 1 ? '' : 's'}** — ${money(p.price)}`)
          .join('\n');
        return interaction.reply({ embeds: [brandedEmbed('📦 Shop Packages', `${productLines()}\n\n**Package IDs**\n${ids}`)], ephemeral: true });
      }
      if (!await adminOnly(interaction)) return;
      if (sub === 'reset') {
        data.products = cloneDefault().products;
        saveData();
        await refreshCommercePanels();
        return interaction.reply({ content: 'Recommended packages restored.', ephemeral: true });
      }
      const id = interaction.options.getString('id');
      if (sub === 'remove') {
        const before = data.products.length;
        data.products = data.products.filter(p => p.id !== id);
        if (data.products.length === before) return interaction.reply({ content: 'Package ID not found.', ephemeral: true });
        saveData();
        await refreshCommercePanels();
        return interaction.reply({ content: `Removed package \`${id}\`.`, ephemeral: true });
      }
      if (sub === 'add') {
        const boosts = interaction.options.getInteger('boosts');
        const months = interaction.options.getInteger('months');
        const price = interaction.options.getNumber('price');
        const description = interaction.options.getString('description') || '';
        let newId = `${boosts}x-${months}m`;
        let suffix = 2;
        while (findProduct(newId)) newId = `${boosts}x-${months}m-${suffix++}`;
        data.products.push({ id: newId, name: `${boosts} Boosts`, boosts, months, price, description });
        saveData();
        await refreshCommercePanels();
        return interaction.reply({ content: `Added package \`${newId}\` for **${money(price)}**.`, ephemeral: true });
      }
      const product = findProduct(id);
      if (!product) return interaction.reply({ content: 'Package ID not found. Run `/package list`.', ephemeral: true });
      product.boosts = interaction.options.getInteger('boosts') ?? product.boosts;
      product.months = interaction.options.getInteger('months') ?? product.months;
      product.price = interaction.options.getNumber('price') ?? product.price;
      product.description = interaction.options.getString('description') ?? product.description;
      product.name = `${product.boosts} Boosts`;
      saveData();
      await refreshCommercePanels();
      return interaction.reply({ content: `Updated package \`${product.id}\`.`, ephemeral: true });
    }

    if (interaction.commandName === 'discount') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'view') return interaction.reply({ content: data.discountPercent ? `The active discount is **${data.discountPercent}% off**.` : 'There is no active store-wide discount.', ephemeral: true });
      if (!await adminOnly(interaction)) return;
      data.discountPercent = sub === 'clear' ? 0 : interaction.options.getInteger('percent');
      saveData();
      await refreshCommercePanels();
      return interaction.reply({ content: data.discountPercent ? `Store discount set to **${data.discountPercent}% off**.` : 'Store discount cleared.', ephemeral: true });
    }

    if (interaction.commandName === 'coupon') {
      const sub = interaction.options.getSubcommand();
      const code = interaction.options.getString('code')?.trim().toUpperCase();
      if (sub === 'redeem') {
        const coupon = data.coupons[code];
        if (!coupon || coupon.active === false) return interaction.reply({ content: 'That coupon code is invalid or inactive.', ephemeral: true });
        if (coupon.maxUses && coupon.uses >= coupon.maxUses) return interaction.reply({ content: 'That coupon has reached its usage limit.', ephemeral: true });
        return interaction.reply({ content: `Coupon **${code}** is valid for **${coupon.percent}% off**. Send this code in your order ticket so staff can apply it.`, ephemeral: true });
      }
      if (!await adminOnly(interaction)) return;
      if (sub === 'create') {
        const percent = interaction.options.getInteger('percent');
        const maxUses = interaction.options.getInteger('uses');
        data.coupons[code] = { percent, maxUses: maxUses || null, uses: 0, active: true, createdAt: new Date().toISOString() };
        saveData();
        return interaction.reply({ content: `Created coupon **${code}** for **${percent}% off**${maxUses ? ` with ${maxUses} maximum uses` : ''}.`, ephemeral: true });
      }
      if (sub === 'delete') {
        if (!data.coupons[code]) return interaction.reply({ content: 'Coupon not found.', ephemeral: true });
        delete data.coupons[code];
        saveData();
        return interaction.reply({ content: `Deleted coupon **${code}**.`, ephemeral: true });
      }
      const entries = Object.entries(data.coupons);
      const text = entries.length ? entries.map(([name, c]) => `**${name}** — ${c.percent}% off • ${c.uses}/${c.maxUses || '∞'} uses`).join('\n') : 'No coupons have been created.';
      return interaction.reply({ embeds: [brandedEmbed('🎟️ Coupon Codes', text)], ephemeral: true });
    }

    if (interaction.commandName === 'store') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'status') return interaction.reply({ embeds: [statusEmbed()], ephemeral: true });
      if (!await adminOnly(interaction)) return;
      data.storeOpen = sub === 'open';
      saveData();
      await refreshCommercePanels();
      return interaction.reply({ content: `The store is now **${data.storeOpen ? 'OPEN' : 'CLOSED'}**.`, ephemeral: true });
    }

    if (interaction.commandName === 'offer') {
      if (!await adminOnly(interaction)) return;
      data.offer = interaction.options.getString('text');
      saveData();
      await refreshPanel('special-offers');
      return interaction.reply({ content: 'Special offer updated.', ephemeral: true });
    }

    if (interaction.commandName === 'dashboard') {
      if (!await adminOnly(interaction)) return;
      return interaction.reply({ embeds: [brandedEmbed('📊 Pixel Boosts Dashboard', [
        `**Store:** ${storeStatusText()}`,
        `**Stock:** ${data.stock} boosts`,
        `**Orders Completed:** ${data.stats.completedOrders}`,
        `**Revenue Recorded:** ${money(data.stats.revenue)}`,
        `**Boosts Delivered:** ${data.stats.boostsDelivered}`,
        `**Reviews:** ${data.stats.reviews}`,
        `**Best Package:** ${bestPackage()}`,
        `**Current Discount:** ${data.discountPercent ? `${data.discountPercent}%` : 'None'}`,
      ].join('\n'))], ephemeral: true });
    }

    if (interaction.commandName === 'stats') {
      if (!await adminOnly(interaction)) return;
      const today = salesSince(24 * 60 * 60 * 1000);
      const month = salesSince(30 * 24 * 60 * 60 * 1000);
      return interaction.reply({ embeds: [brandedEmbed('📈 Pixel Boosts Analytics', [
        `**Revenue Today:** ${money(salesRevenue(today))}`,
        `**Revenue Last 30 Days:** ${money(salesRevenue(month))}`,
        `**Orders Today:** ${today.length}`,
        `**Orders Last 30 Days:** ${month.length}`,
        `**All-Time Revenue:** ${money(data.stats.revenue)}`,
        `**All-Time Orders:** ${data.stats.completedOrders}`,
        `**Best-Selling Package:** ${bestPackage()}`,
        `**Stock Remaining:** ${data.stock} boosts`,
        `**Last Restock:** ${relativeTime(data.stats.lastRestockAt)}`,
      ].join('\n'))], ephemeral: true });
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
      const amountNumeric = parseMoney(amount);
      data.stats.revenue += amountNumeric;
      data.stats.completedOrders += 1;
      data.stats.boostsDelivered += boosts;
      data.stats.packageSales[String(boosts)] = (data.stats.packageSales[String(boosts)] || 0) + 1;
      data.stats.sales.push({ at: new Date().toISOString(), amountNumeric, boosts, customerId: customer.id, orderId });
      if (data.stats.sales.length > 2000) data.stats.sales = data.stats.sales.slice(-2000);
      saveData();
      await refreshCommercePanels();
      await postLog('sales-log', brandedEmbed('💸 Sale Recorded', `**Order:** #${orderId}\n**Customer:** ${customer}\n**Revenue:** ${amount}\n**Boosts:** ${boosts}`));
      return interaction.reply({ content: 'Completed order logged, analytics updated and customer role processed.', ephemeral: true });
    }

    if (interaction.commandName === 'review') {
      const targetId = data.channels.reviews;
      const target = targetId ? await client.channels.fetch(targetId).catch(() => null) : null;
      if (!target?.isTextBased()) return interaction.reply({ content: 'The reviews channel has not been configured yet.', ephemeral: true });
      const member = interaction.member;
      if (data.roles.customer && !member.roles.cache.has(data.roles.customer) && !isAdmin(interaction)) {
        return interaction.reply({ content: 'Only customers with the Customer role can leave a review.', ephemeral: true });
      }
      const rating = interaction.options.getInteger('rating');
      const comment = interaction.options.getString('comment');
      await target.send({ embeds: [brandedEmbed(`${'⭐'.repeat(rating)} Customer Review`, `**Customer:** ${interaction.user}\n**Rating:** ${rating}/5\n\n${comment}`)] });
      data.stats.reviews += 1;
      saveData();
      return interaction.reply({ content: 'Thank you — your review has been posted.', ephemeral: true });
    }

    if (interaction.commandName === 'close-ticket') {
      const canClose = isAdmin(interaction) || interaction.channel?.topic?.includes(`Customer: ${interaction.user.id}`);
      if (!canClose || !interaction.channel?.topic?.startsWith('Pixel Boosts order')) return interaction.reply({ content: 'Use this inside your order ticket.', ephemeral: true });
      await interaction.reply('Closing this ticket in 5 seconds…');
      await postLog('logs', brandedEmbed('🔒 Order Ticket Closed', `**Channel:** ${interaction.channel.name}\n**Closed by:** ${interaction.user}`));
      setTimeout(() => interaction.channel.delete('Pixel Boosts ticket closed').catch(() => {}), 5000);
    }

    if (interaction.commandName === 'help') {
      return interaction.reply({ embeds: [brandedEmbed('🤖 Pixel Boosts Bot Help', [
        '**Customer commands**',
        '`/shop` or `/buy` — View packages and open an order',
        '`/bank` — View the official bank-transfer details',
        '`/stock view` — Check availability',
        '`/package list` — View packages and prices',
        '`/coupon redeem` — Check a coupon code',
        '`/review` — Leave a customer review',
        '`/close-ticket` — Close your order ticket',
        '',
        '**Administrator setup**',
        '`/setchannel` • `/setrole` • `/setbank` • `/config` • `/setup`',
        '',
        '**Store management**',
        '`/store` • `/restock` • `/stock set` • `/package`',
        '`/discount` • `/coupon` • `/offer`',
        '`/announce` • `/embed` • `/complete-order`',
        '`/dashboard` • `/stats`',
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
app.get('/health', (_, res) => res.json({ ok: true, bot: client.user?.tag || 'starting', storeOpen: data.storeOpen, stock: data.stock }));
app.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(`Web server listening on port ${process.env.PORT || 10000}`));

client.login(process.env.DISCORD_TOKEN);
