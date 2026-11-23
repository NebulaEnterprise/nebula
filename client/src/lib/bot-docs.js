// Nebula Bot API 1.1.0. Field notes match server.js and sdk/nebula.js.

export const toc = [
  { kind: 'link', id: 'dev-overview', text: 'Overview' },
  { kind: 'link', id: 'dev-auth', text: 'Authentication' },
  { kind: 'link', id: 'dev-start', text: 'Quick start' },
  { kind: 'label', text: 'Reference' },
  { kind: 'link', id: 'dev-objects', text: 'Objects' },
  { kind: 'link', id: 'dev-sdk', text: 'JavaScript SDK' },
  { kind: 'label', text: 'Bot HTTP API' },
  { kind: 'link', id: 'ep-version', text: 'GET /version' },
  { kind: 'link', id: 'ep-me', text: 'GET /me' },
  { kind: 'link', id: 'ep-me-patch', text: 'PATCH /me' },
  { kind: 'link', id: 'ep-avatar', text: 'PUT /me/avatar' },
  { kind: 'link', id: 'ep-commands-get', text: 'GET /commands' },
  { kind: 'link', id: 'ep-commands-put', text: 'PUT /commands' },
  { kind: 'link', id: 'ep-events', text: 'GET /events' },
  { kind: 'link', id: 'ep-servers', text: 'GET /servers' },
  { kind: 'link', id: 'ep-channels', text: 'GET server channels' },
  { kind: 'link', id: 'ep-channel', text: 'GET /channels/:id' },
  { kind: 'link', id: 'ep-history', text: 'GET messages' },
  { kind: 'link', id: 'ep-send', text: 'POST messages' },
  { kind: 'link', id: 'ep-server', text: 'GET /servers/:id' },
  { kind: 'link', id: 'ep-members', text: 'Members' },
  { kind: 'link', id: 'ep-roles', text: 'Roles' },
  { kind: 'link', id: 'ep-mod', text: 'Kick, ban, timeout' },
  { kind: 'link', id: 'ep-voice', text: 'Voice' },
  { kind: 'link', id: 'ep-make-channel', text: 'Create a channel' },
  { kind: 'link', id: 'ep-threads', text: 'Threads' },
  { kind: 'link', id: 'ep-react', text: 'Reactions' },
  { kind: 'link', id: 'ep-hooks', text: 'Webhooks' },
  { kind: 'label', text: 'More' },
  { kind: 'link', id: 'dev-account', text: 'Account API' },
  { kind: 'link', id: 'dev-events', text: 'Events' },
  { kind: 'link', id: 'dev-examples', text: 'Examples' },
  { kind: 'link', id: 'dev-limits', text: 'Errors and limits' },
];

export const botObject = [
  ['id', 'string', 'Bot account id.'],
  ['username', 'string', 'Unique login name. Generated from the display name. Bots cannot sign in with it.'],
  ['display_name', 'string', 'Name shown in chat. Same value as displayName.'],
  ['displayName', 'string', 'Same as display_name. The SDK reads this.'],
  ['bio', 'string', 'Up to 300 characters. Blank when unset.'],
  ['avatar_url', 'string', 'Picture URL, or an empty string.'],
  ['bot', 'true', 'Always true on this object.'],
  ['owner_id', 'string', 'Account that created the bot.'],
  ['name', 'string', 'Same as the display name stored on the bot record.'],
];

export const channelObject = [
  ['id', 'string', 'Channel id. Use this in send and in the messages routes.'],
  ['name', 'string', 'Channel name without the #.'],
  ['type', 'string', 'text or voice. Voice channels reject new messages.'],
  ['server_id', 'string', 'Server that owns the channel.'],
  ['topic', 'string', 'Channel topic. Empty when unset.'],
  ['category_id', 'string or null', 'Category id, or null.'],
  ['private', 'boolean', 'Hidden from people without an overwrite.'],
  ['read_only', 'boolean', 'Text channels that reject new messages unless the sender can manage channels.'],
  ['slowmode', 'number', 'Seconds between messages. 0 means off. Maximum 21600.'],
  ['stage', 'boolean', 'Voice channels where listeners join muted.'],
];

export const historyMessage = [
  ['id', 'string', 'Message id.'],
  ['channel_id', 'string', 'Channel the message is in.'],
  ['author_id', 'string', 'Account id. A webhook author id starts with wh:.'],
  ['author', 'string', 'Display name, or an empty string.'],
  ['content', 'string', 'Text. Empty when the message is sealed.'],
  ['created_at', 'string', 'ISO time.'],
  ['bot', 'boolean', 'True for a bot or a webhook message.'],
];

export const sentMessage = [
  ['id', 'string', 'New message id.'],
  ['channel_id', 'string', 'Channel it was posted in.'],
  ['content', 'string', 'Text that was stored, after the 2000 character cut.'],
  ['embeds', 'Embed[]', 'Cards that were stored. color is a number.'],
];

export const embedObject = [
  ['title', 'string', 'Up to 256 characters. Optional.'],
  ['description', 'string', 'Up to 2000 characters. Optional.'],
  ['url', 'string', 'Optional http or https link, up to 500 characters. Other schemes are dropped.'],
  ['color', 'string or number', 'Send #rrggbb or a number such as 12615932. The stored value is a number. 0 means no custom bar.'],
  ['fields', 'array', 'Up to 6. Each field needs name and value. inline sits them in a row.'],
  ['footer', 'object or string', 'Send { text }. The stored value is that text, up to 200 characters.'],
];

export const commandObject = [
  ['name', 'string', '1 to 32 characters: a-z, 0-9, hyphen, underscore. Stored lowercase.'],
  ['description', 'string', 'Up to 100 characters. Shown to you. The chat box does not autocomplete it.'],
];

export const eventEnvelope = [
  ['id', 'number', 'Increases by 1 for each event on this server process. Send it back as after.'],
  ['type', 'string', 'message, message_update, message_delete, member_join, member_leave, reaction_add, reaction_remove, server_add, server_remove, or test.'],
  ['data', 'object', 'Payload for that type. Listed under Events.'],
  ['created_at', 'string', 'ISO time on the server.'],
];

export const sdkRows = [
  ['new Bot(token, opts)', 'token is the nb_ string. Empty reads NEBULA_BOT_TOKEN. The default API is https://scowling-anthill-civil.ngrok-free.dev/api/bot/v1. opts.api replaces that. opts.log set to false hides the online line. NEBULA_API_URL and NEBULA_API also replace the base URL.'],
  ['bot.command(name, description, fn)', 'Registers /name and !name. A second call with the same name replaces the first. fn receives the message. Returns the bot.'],
  ['bot.on(event, fn)', 'Adds a listener. Events: message, message_update, message_delete, member_join, member_leave, reaction_add, reaction_remove, server_add, server_remove, test, ready, error. Returns the bot.'],
  ['bot.send(channelId, text, opts)', 'POST /channels/:id/messages. opts.replyTo becomes reply_to. opts.embeds is copied through. Returns the message object.'],
  ['bot.server(id) / bot.members(id, after?) / bot.member(id, userId)', 'One server, a page of members, or one member with roles and nickname.'],
  ['bot.roles / bot.createRole / bot.addRole / bot.removeRole / bot.deleteRole', 'List, create, give, take, and delete roles. Needs Manage Roles. permissions is a number or { view_channel, send_messages, manage_channels, manage_roles, create_invite, manage_server, administrator }.'],
  ['bot.kick / bot.ban / bot.unban / bot.bans / bot.timeout', 'Needs Manage Server. timeout minutes 0 clears it. 40320 minutes is 28 days.'],
  ['bot.setNickname(server, user, nick)', 'Needs Manage Server. An empty nick clears it.'],
  ['bot.channels / bot.channel / bot.createChannel / bot.editChannel / bot.deleteChannel', 'Channels the bot can see. Creating and editing needs Manage Channels. createChannel(server, name, { type, private, readOnly, slowmode, categoryId, stage }).'],
  ['bot.createCategory / bot.deleteCategory', 'Manage Channels. Deleting a category leaves its channels in place.'],
  ['bot.messages / bot.message / bot.edit / bot.delete / bot.bulkDelete', 'Read, edit the bot’s own message, delete (its own, or anyone’s with Manage Channels), or delete up to 100 ids.'],
  ['bot.pin / bot.unpin / bot.react / bot.unreact / bot.reactions', 'Pin needs Manage Channels. react takes a unicode emoji.'],
  ['bot.threads / bot.createThread', 'List threads, or start one with { content }. content is the first message.'],
  ['bot.voice(serverId)', 'Who is in voice: [{ channel_id, user_ids }].'],
  ['bot.invites(serverId)', 'Invite codes the bot is allowed to see.'],
  ['bot.user(id)', 'Public profile of someone who shares a server with the bot.'],
  ['bot.webhooks / bot.createWebhook / bot.deleteWebhook', 'Needs Manage Channels. createWebhook returns the secret url once.'],
  ['bot.setProfile({ displayName, bio })', 'PATCH /me. Omitted fields stay as they are. Returns the bot object and stores it on bot.me.'],
  ['bot.setAvatar(file)', 'PUT /me/avatar. file is a path string or raw bytes. Returns the bot object.'],
  ['bot.servers()', 'GET /servers. Returns the servers array, not the wrapper object.'],
  ['bot.api(method, path, body)', 'Calls any bot route. path starts with /me or /channels. A JSON object is sent as JSON. A Buffer or Uint8Array is sent as raw bytes. Throws Error with .status and .code when the response is not OK.'],
  ['bot.start()', 'Requires a token that starts with nb_. Loads /me, replaces /commands with the commands you registered, emits ready, then polls /events. The poll uses after and wait=25.'],
  ['bot.stop()', 'Stops the loop after the current poll returns.'],
  ['msg.reply(text, opts)', 'Added to message events. Posts in that channel and sets reply_to to the message id. opts.embeds is allowed.'],
  ['msg.say(text, opts)', 'Posts in that channel without quoting.'],
  ['msg.args', 'Text after the command name, or an empty string.'],
  ['msg.argv', 'args split on spaces. Empty when args is empty.'],
];

export function botEndpoints(base) {
  return [
    {
      id: 'ep-version',
      method: 'GET',
      path: base + '/version',
      auth: 'No token.',
      summary: 'Reports the API version. Also sets the response header X-Nebula-API-Version to 1.1.0. Every other bot route sets that header too.',
      response: `{
  "api": "1.1.0",
  "sdk": { "js": "1.1.0" }
}`,
    },
    {
      id: 'ep-me',
      method: 'GET',
      path: base + '/me',
      auth: 'Authorization: Bot <token>',
      summary: 'The signed-in bot. A successful call also marks the bot online for 50 seconds, same as every other authenticated bot route.',
      response: `{
  "id": "bot-id",
  "username": "welcome",
  "display_name": "Welcome",
  "displayName": "Welcome",
  "bio": "",
  "avatar_url": "",
  "bot": true,
  "owner_id": "owner-id",
  "name": "Welcome"
}`,
      errors: [['401', 'unauthorized', 'Missing bot token, or the token does not match a bot.']],
    },
    {
      id: 'ep-me-patch',
      method: 'PATCH',
      path: base + '/me',
      auth: 'Authorization: Bot <token>',
      summary: 'Changes the display name, the bio, or both. Send only the fields you want to change. display_name and displayName are the same field.',
      body: `{
  "display_name": "Welcome",
  "bio": "Greets new members."
}`,
      params: [
        ['display_name', 'string', '1 to 32 characters after trimming. An empty name is rejected.'],
        ['bio', 'string', 'Trimmed and cut to 300 characters. Send "" to clear it.'],
      ],
      response: 'The same bot object as GET /me.',
      errors: [['400', 'invalid_request', 'Display name required.']],
    },
    {
      id: 'ep-avatar',
      method: 'PUT',
      path: base + '/me/avatar',
      auth: 'Authorization: Bot <token>',
      summary: 'Replaces the picture. The body is the raw file, not JSON. PNG, JPG, GIF, or WebP. The server reads the file bytes, not the Content-Type.',
      params: [
        ['body', 'bytes', 'Up to 8 MB.'],
      ],
      response: '{ "ok": true, ...bot }',
      errors: [
        ['400', 'invalid_request', 'Use a PNG, JPG, GIF, or WebP.'],
        ['413', 'too_large', 'Pictures can be up to 8 MB.'],
        ['502', 'unavailable', 'The picture could not be stored.'],
      ],
    },
    {
      id: 'ep-commands-get',
      method: 'GET',
      path: base + '/commands',
      auth: 'Authorization: Bot <token>',
      summary: 'Commands saved for this bot. bot.start() replaces this list with the commands registered in code.',
      response: `{
  "commands": [
    { "name": "ping", "description": "Is the bot alive?" }
  ]
}`,
    },
    {
      id: 'ep-commands-put',
      method: 'PUT',
      path: base + '/commands',
      auth: 'Authorization: Bot <token>',
      summary: 'Replaces the whole command list. Names are matched when a message starts with /name or !name. There is no slash-command menu. Up to 100 commands.',
      body: `{
  "commands": [
    { "name": "ping", "description": "Is the bot alive?" },
    { "name": "setwelcome", "description": "Welcome new people in this channel" }
  ]
}`,
      response: '{ "commands": [ ... ] } with names lowercased.',
      errors: [
        ['400', 'invalid_request', 'More than 100 commands, a bad name, or two commands with the same name.'],
      ],
    },
    {
      id: 'ep-events',
      method: 'GET',
      path: base + '/events?after=0&wait=25',
      auth: 'Authorization: Bot <token>',
      summary: 'Events newer than after. With wait, the request stays open until an event arrives or the wait ends. wait is seconds, from 0 to 25. Each response has at most 100 events. Pass the returned last back as after. The library does this for you.',
      params: [
        ['after', 'query number', 'Return events whose id is greater than this. Default 0.'],
        ['wait', 'query number', 'Hold the request for up to this many seconds when nothing is waiting. Default 0. Maximum 25.'],
      ],
      response: `{
  "events": [
    {
      "id": 12,
      "type": "message",
      "data": { "object": "message", "content": "/ping" },
      "created_at": "2026-11-20T05:00:00.000Z"
    }
  ],
  "last": 12
}`,
    },
    {
      id: 'ep-servers',
      method: 'GET',
      path: base + '/servers',
      auth: 'Authorization: Bot <token>',
      summary: 'Servers this bot has been added to.',
      response: `{
  "servers": [
    { "id": "server-id", "name": "Nebula Official", "member_count": 5 }
  ]
}`,
    },
    {
      id: 'ep-channels',
      method: 'GET',
      path: base + '/servers/:id/channels?type=text',
      auth: 'Authorization: Bot <token>',
      summary: 'Channels in that server which this bot is allowed to see. type is optional. text or voice keeps only that kind.',
      params: [
        ['id', 'path', 'Server id.'],
        ['type', 'query', 'Optional. text or voice.'],
      ],
      response: `{
  "channels": [
    { "id": "channel-id", "name": "welcome", "type": "text", "server_id": "server-id" }
  ]
}`,
      errors: [['404', 'not_found', 'The bot is not in that server.']],
    },
    {
      id: 'ep-channel',
      method: 'GET',
      path: base + '/channels/:id',
      auth: 'Authorization: Bot <token>',
      summary: 'One channel, when the bot can see it.',
      response: `{
  "id": "channel-id",
  "name": "welcome",
  "type": "text",
  "server_id": "server-id"
}`,
      errors: [['404', 'not_found', 'No such channel, or the bot cannot see it.']],
    },
    {
      id: 'ep-history',
      method: 'GET',
      path: base + '/channels/:id/messages?limit=50',
      auth: 'Authorization: Bot <token>',
      summary: 'The newest messages in a channel the bot can see, oldest of that page first. limit defaults to 50 and cannot be higher than 100. Sealed messages come back with an empty content. This route does not include embeds.',
      params: [['limit', 'query number', '1 to 100. Default 50.']],
      response: `{
  "messages": [
    {
      "id": "message-id",
      "channel_id": "channel-id",
      "author_id": "user-id",
      "author": "Nova",
      "content": "hello",
      "created_at": "2026-11-20T05:00:00.000Z",
      "bot": false
    }
  ]
}`,
      errors: [['404', 'not_found', 'No such channel, or the bot cannot see it.']],
    },
    {
      id: 'ep-send',
      method: 'POST',
      path: base + '/channels/:id/messages',
      auth: 'Authorization: Bot <token>',
      summary: 'Posts as the bot. content, embeds, or both. An empty content with no usable embed is rejected. The message shows a BOT tag. The bot does not receive its own post as a message event.',
      body: `{
  "content": "",
  "reply_to": "message-id",
  "embeds": [
    {
      "title": "Welcome to Nebula Official",
      "description": "Welcome @nova. You are member 5.",
      "url": "https://nebulaapp.space",
      "color": "#c084fc"
    }
  ]
}`,
      params: [
        ['content', 'string', 'Optional. Cut to 2000 characters.'],
        ['reply_to', 'string', 'Optional message id in this same channel. Unknown ids are ignored.'],
        ['embeds', 'array', 'Optional. At most 4. A card with no title, description, or url is dropped.'],
      ],
      response: `{
  "ok": true,
  "message": {
    "id": "message-id",
    "channel_id": "channel-id",
    "content": "",
    "embeds": [
      {
        "title": "Welcome to Nebula Official",
        "description": "Welcome @nova. You are member 5.",
        "url": "https://nebulaapp.space",
        "color": 12615932
      }
    ]
  }
}`,
      errors: [
        ['400', 'invalid_request', 'Add a message. Nothing was left after empty text and empty cards.'],
        ['403', 'missing_permission', 'The bot cannot see the channel, cannot send there, or the channel is read-only.'],
        ['404', 'not_found', 'Unknown channel, or the channel is voice.'],
        ['429', 'rate_limited', '30 messages a minute for this bot, or the channel slowmode has not elapsed.'],
      ],
    },
    {
      id: 'ep-server',
      method: 'GET',
      path: base + '/servers/:id',
      auth: 'Authorization: Bot <token>',
      summary: 'One server the bot is in: id, name, member_count, icon. GET /servers/:id/counts returns member_count only.',
      errors: [['404', 'not_found', 'The bot is not in that server.']],
    },
    {
      id: 'ep-members',
      method: 'GET',
      path: base + '/servers/:id/members',
      auth: 'Authorization: Bot <token>',
      summary: 'Members sorted by id, 100 a page, up to 200 with limit. Pass the last id as after. GET /servers/:id/members/:uid is one member. PATCH that path with { nickname } needs Manage Server.',
    },
    {
      id: 'ep-roles',
      method: 'GET',
      path: base + '/servers/:id/roles',
      auth: 'Authorization: Bot <token>',
      summary: 'Roles, highest first. POST creates one. PATCH /roles/:rid edits name, color, or permissions. DELETE removes it. PUT /members/:uid/roles/:rid gives a role. DELETE that path takes it away. Creating, editing, and assigning need Manage Roles.',
    },
    {
      id: 'ep-mod',
      method: 'POST',
      path: base + '/servers/:id/kick',
      auth: 'Authorization: Bot <token>',
      summary: 'Body { user_id }. Also POST /bans with { user_id, reason }, GET /bans, DELETE /bans/:uid, and POST /timeouts with { user_id, minutes }. All need Manage Server. Owners cannot be kicked or banned.',
    },
    {
      id: 'ep-voice',
      method: 'GET',
      path: base + '/servers/:id/voice',
      auth: 'Authorization: Bot <token>',
      summary: 'Who is in voice right now: { voice: [{ channel_id, user_ids }] } for channels the bot can see.',
    },
    {
      id: 'ep-make-channel',
      method: 'POST',
      path: base + '/servers/:id/channels',
      auth: 'Authorization: Bot <token>',
      summary: 'Creates a channel. Body { name, type: "text" or "voice", topic, category_id, private, read_only, slowmode, stage }. PATCH /channels/:id edits those fields. DELETE /channels/:id removes it. POST /servers/:id/categories { name } and DELETE /servers/:id/categories/:cid. Needs Manage Channels.',
    },
    {
      id: 'ep-threads',
      method: 'GET',
      path: base + '/channels/:id/threads',
      auth: 'Authorization: Bot <token>',
      summary: 'Threads in a text channel. POST { name, content, private } starts one. content is the first message and is required.',
    },
    {
      id: 'ep-react',
      method: 'PUT',
      path: base + '/channels/:id/messages/:mid/reactions/:emoji',
      auth: 'Authorization: Bot <token>',
      summary: 'Adds the bot’s reaction. DELETE the same path removes it. GET /channels/:id/messages/:mid/reactions lists them. GET, PATCH, and DELETE /channels/:id/messages/:mid read, edit, or delete one message. POST /messages/bulk-delete takes { ids } up to 100. PUT and DELETE .../pin pin or unpin. Editing is only the bot’s own message. Deleting someone else’s, bulk delete, and pins need Manage Channels.',
    },
    {
      id: 'ep-hooks',
      method: 'GET',
      path: base + '/channels/:id/webhooks',
      auth: 'Authorization: Bot <token>',
      summary: 'Webhooks in a channel, without their tokens. POST { name } creates one and returns the secret url once. DELETE /webhooks/:id removes one the bot made, or any in a channel it can manage. Needs Manage Channels. Posting still uses POST /api/webhooks/:id/:token on the account host, not this bot prefix.',
    },
    {
      id: 'ep-user',
      method: 'GET',
      path: base + '/users/:id',
      auth: 'Authorization: Bot <token>',
      summary: 'Public profile of someone who shares a server with the bot: id, username, display_name, bot, avatar_url.',
      errors: [['404', 'not_found', 'No such user, or the bot does not share a server with them.']],
    },
  ];
}

export function accountEndpoints(origin) {
  const root = origin + '/api';
  return [
    {
      id: 'ac-list',
      method: 'GET',
      path: root + '/me/bots',
      auth: 'Authorization: Bearer <session>',
      summary: 'Bots owned by the signed-in account. The token itself is not included. tokenTail is the last 6 characters, so you can tell which token is current.',
      response: `{
  "ok": true,
  "limit": 2,
  "bots": [
    {
      "id": "bot-id",
      "name": "Welcome",
      "username": "welcome",
      "displayName": "Welcome",
      "bio": "",
      "avatarUrl": "",
      "tokenTail": "ubKDMs",
      "createdAt": "2026-11-20T05:00:00.000Z",
      "servers": [{ "id": "server-id", "name": "Nebula Official" }],
      "commands": [{ "name": "ping", "description": "Is the bot alive?" }]
    }
  ]
}`,
    },
    {
      id: 'ac-create',
      method: 'POST',
      path: root + '/me/bots',
      auth: 'Authorization: Bearer <session>',
      summary: 'Creates a bot and returns the token once. The token starts with nb_ and is 46 characters after that prefix. Store it. A later read of the bot does not include it.',
      body: '{ "name": "Welcome" }',
      params: [['name', 'string', '2 to 32 characters.']],
      response: '{ "ok": true, "bot": { ..., "token": "nb_..." } }',
      errors: [
        ['400', '', 'Name is shorter than 2 characters, or this account already has 2 bots.'],
      ],
    },
    {
      id: 'ac-patch',
      method: 'PATCH',
      path: root + '/me/bots/:id',
      auth: 'Authorization: Bearer <session>',
      summary: 'Edits a bot you own. This is what Settings uses. name and displayName both set the display name. avatarUrl must be an uploaded Nebula path or an http(s) URL.',
      body: `{
  "displayName": "Welcome",
  "bio": "Greets new members.",
  "avatarUrl": "/uploads/picture.png"
}`,
    },
    {
      id: 'ac-token',
      method: 'POST',
      path: root + '/me/bots/:id/token',
      auth: 'Authorization: Bearer <session>',
      summary: 'Makes a new token and returns it once. The previous token stops working immediately.',
      response: '{ "ok": true, "bot": { ..., "token": "nb_..." } }',
    },
    {
      id: 'ac-test',
      method: 'POST',
      path: root + '/me/bots/:id/test',
      auth: 'Authorization: Bearer <session>',
      summary: 'Queues a test event for a running bot. The event data is { object, bot, by, at, hello } and hello is the string nebula.',
      response: '{ "ok": true }',
    },
    {
      id: 'ac-delete',
      method: 'DELETE',
      path: root + '/me/bots/:id',
      auth: 'Authorization: Bearer <session>',
      summary: 'Deletes the bot, removes it from every server, and kills the token.',
      response: '{ "ok": true }',
    },
    {
      id: 'ac-add',
      method: 'POST',
      path: root + '/me/bots/:id/servers',
      auth: 'Authorization: Bearer <session>',
      summary: 'Adds your bot to a server where you are the owner or you have Manage Server. The bot receives server_add.',
      body: '{ "serverId": "server-id" }',
      errors: [
        ['400', '', 'That bot is already in this server, or the server already has 25 bots.'],
        ['403', '', 'You need Manage Server there.'],
        ['404', '', 'Unknown server, or the bot is not yours.'],
      ],
    },
    {
      id: 'ac-remove',
      method: 'DELETE',
      path: root + '/me/bots/:id/servers/:serverId',
      auth: 'Authorization: Bearer <session>',
      summary: 'Removes your bot from that server. The bot receives server_remove.',
    },
    {
      id: 'ac-server-list',
      method: 'GET',
      path: root + '/servers/:id/bots',
      auth: 'Authorization: Bearer <session>',
      summary: 'Bots in a server you manage, plus mine, the bots your account owns.',
      response: '{ "ok": true, "bots": [ ... ], "mine": [ ... ] }',
    },
    {
      id: 'ac-server-add',
      method: 'POST',
      path: root + '/servers/:id/bots',
      auth: 'Authorization: Bearer <session>',
      summary: 'Same add as above, from the server side. Body is { "botId": "bot-id" }. The bot must be yours.',
    },
    {
      id: 'ac-server-remove',
      method: 'DELETE',
      path: root + '/servers/:id/bots/:botId',
      auth: 'Authorization: Bearer <session>',
      summary: 'Removes that bot from the server. You need Manage Server. The bot does not have to be yours.',
    },
  ];
}

export const events = [
  {
    type: 'message',
    text: 'A person posted in a channel the bot can see. Bot posts and webhook posts are skipped. Sealed messages are skipped. The library then runs a matching command.',
    fields: [
      ['object', 'string', 'message'],
      ['id', 'string', 'Message id. reply() quotes this id.'],
      ['channel_id', 'string', 'Where to answer.'],
      ['channel_name', 'string', 'Channel name.'],
      ['server_id', 'string', 'Server id.'],
      ['author_id', 'string', 'Who sent it.'],
      ['author', 'string', 'Their display name.'],
      ['content', 'string', 'The full line.'],
      ['created_at', 'string', 'ISO time.'],
      ['mentioned', 'boolean', 'True when the content contains <@botId> for this bot.'],
      ['author_bot', 'false', 'Always false. Bot authors are not delivered.'],
      ['command', 'string', 'Present when the line is /name or !name and name is one of this bot’s commands.'],
      ['args', 'string', 'Everything after the command name, trimmed. Absent when it is not a command.'],
    ],
  },
  {
    type: 'message_update',
    text: 'Someone edited a message the bot can see. The bot’s own edits and webhook edits are not sent.',
    fields: [
      ['object', 'string', 'message'],
      ['id', 'string', 'Message id.'],
      ['channel_id', 'string', 'Channel id.'],
      ['server_id', 'string', 'Server id.'],
      ['author_id', 'string', 'Who edited it.'],
      ['content', 'string', 'The text after the edit. Empty when the message is sealed.'],
    ],
  },
  {
    type: 'message_delete',
    text: 'A message the bot could see was deleted. The text is not included.',
    fields: [
      ['object', 'string', 'message'],
      ['id', 'string', 'Deleted message id.'],
      ['channel_id', 'string', 'Channel id.'],
      ['server_id', 'string', 'Server id.'],
      ['author_id', 'string', 'Who wrote it.'],
    ],
  },
  {
    type: 'member_join',
    text: 'A person joined a server the bot is in. Other bots joining do not fire this. The joining bot does not receive it for itself.',
    fields: [
      ['object', 'string', 'member'],
      ['server_id', 'string', 'Server they joined.'],
      ['server_name', 'string', 'That server’s name.'],
      ['user_id', 'string', 'Their account id.'],
      ['username', 'string', 'Their username, without @.'],
      ['display_name', 'string', 'Name shown in the member list.'],
      ['member_count', 'number', 'Members after they joined, including bots.'],
    ],
  },
  {
    type: 'member_leave',
    text: 'A person left a server the bot is in, or was kicked or banned. The leaving bot does not receive this for itself. A kicked or banned bot gets server_remove instead.',
    fields: [
      ['object', 'string', 'member'],
      ['server_id', 'string', 'Server they left.'],
      ['server_name', 'string', 'That server’s name.'],
      ['user_id', 'string', 'Their account id.'],
      ['username', 'string', 'Their username.'],
      ['display_name', 'string', 'Name shown in the member list.'],
      ['member_count', 'number', 'Members after they left.'],
    ],
  },
  {
    type: 'reaction_add',
    text: 'Someone reacted in a channel the bot can see. reaction_remove is the same object when they take it off.',
    fields: [
      ['object', 'string', 'reaction'],
      ['message_id', 'string', 'Message they reacted to.'],
      ['channel_id', 'string', 'Channel id.'],
      ['server_id', 'string', 'Server id.'],
      ['user_id', 'string', 'Who reacted.'],
      ['username', 'string', 'Their username.'],
      ['emoji', 'string', 'The emoji.'],
      ['added', 'boolean', 'True on reaction_add, false on reaction_remove.'],
    ],
  },
  {
    type: 'server_add',
    text: 'This bot was added to a server.',
    fields: [
      ['object', 'string', 'server'],
      ['server_id', 'string', 'Server id.'],
      ['name', 'string', 'Server name. This event uses name, not server_name.'],
      ['member_count', 'number', 'Members at the time it was added.'],
    ],
  },
  {
    type: 'server_remove',
    text: 'This bot was removed from a server.',
    fields: [
      ['object', 'string', 'server'],
      ['server_id', 'string', 'Server id.'],
      ['name', 'string', 'Server name.'],
    ],
  },
  {
    type: 'test',
    text: 'Sent by Settings → Developer → Send test event, or POST /api/me/bots/:id/test.',
    fields: [
      ['object', 'string', 'test'],
      ['bot', 'string', 'This bot’s id.'],
      ['by', 'string', 'Account id that pressed the button.'],
      ['at', 'string', 'ISO time.'],
      ['hello', 'string', 'The word nebula.'],
    ],
  },
];

export const starter = `import { Bot } from './nebula.js';

const bot = new Bot('nb_PASTE_YOUR_TOKEN');

bot.command('ping', 'Is the bot alive?', (msg) => msg.reply('pong'));

bot.on('message', (msg) => {
  if (msg.mentioned) msg.reply('hey');
});

bot.on('ready', (me) => console.log('online as', me.username));
bot.on('error', (err) => console.error(err.status, err.code, err.message));

bot.start();`;

export const embedSample = `await bot.send(channelId, 'Scoreboard', {
  embeds: [
    {
      title: 'Match result',
      description: 'Blue won 3-1.',
      url: 'https://nebulaapp.space',
      color: '#7c5cff',
    },
  ],
});`;

export const welcome = `import { Bot } from './nebula.js';

const bot = new Bot('nb_PASTE_YOUR_TOKEN');
const rooms = new Map();

async function welcomeChannel(serverId) {
  if (rooms.has(serverId)) return rooms.get(serverId);
  const data = await bot.api('GET', '/servers/' + encodeURIComponent(serverId) + '/channels?type=text');
  const list = data.channels || [];
  const named = list.find((ch) => /^(welcome|general|lobby)$/i.test(ch.name));
  const channel = named || list[0];
  if (!channel) return '';
  rooms.set(serverId, channel.id);
  return channel.id;
}

bot.command('setwelcome', 'Welcome new people in this channel', async (msg) => {
  rooms.set(msg.server_id, msg.channel_id);
  await msg.reply('I will welcome new people in this channel.');
});

bot.on('member_join', async (ev) => {
  if (!ev.server_id || ev.user_id === (bot.me && bot.me.id)) return;
  const channelId = await welcomeChannel(ev.server_id);
  if (!channelId) return;
  const name = ev.username ? '@' + ev.username : (ev.display_name || 'someone new');
  const count = ev.member_count ? ' You are member ' + ev.member_count + '.' : '';
  await bot.send(channelId, '', {
    embeds: [{
      title: 'Welcome to ' + (ev.server_name || 'the server'),
      description: 'Welcome ' + name + '.' + count,
      color: '#c084fc',
    }],
  });
});

bot.on('ready', (me) => console.log('welcome bot online as', me.username));
bot.on('error', (err) => console.error(err));
bot.start();`;

export function curlSample(base) {
  return `curl -X POST '${base}/channels/CHANNEL_ID/messages' \\
  -H 'Authorization: Bot nb_PASTE_YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "content": "",
    "embeds": [{
      "title": "Welcome to Nebula Official",
      "description": "Welcome @nova. You are member 5.",
      "color": "#c084fc"
    }]
  }'`;
}
