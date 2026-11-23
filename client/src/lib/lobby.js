export const LOBBY_COPY = {
  top: {
    title: 'Top of the page',
    badge: 'Always first',
    blurb: 'The tagline and buttons under the server name.',
  },
  about: {
    title: 'About',
    blurb: 'A few lines on what the server is about.',
    empty: "What's this server about? Who's it for, what goes on here?",
  },
  channels: {
    title: 'Main channels',
    blurb: 'The channels you want people to open first.',
    empty: 'Pick up to 6, in the order you tap them. None picked: the busiest ones show.',
  },
  live: {
    title: 'Live now',
    blurb: 'Voice channels with people in them right now.',
    empty: 'Nobody is in voice right now. Shows up as soon as someone is.',
  },
  giveaways: {
    title: 'Giveaways',
    blurb: 'Giveaways from the Giveaways bot while they run.',
    empty: 'Shows up while a giveaway from the Giveaways bot runs.',
  },
  feed: {
    title: 'Feed',
    blurb: 'Posts from outside apps: YouTube uploads, stream alerts, patch notes.',
    empty: 'No posts yet. Make a feed below and paste its URL into your app.',
  },
  faq: {
    title: 'FAQ',
    blurb: 'The questions newcomers always ask.',
    empty: 'Add a question.',
  },
  leaderboard: {
    title: 'Leaderboard',
    blurb: 'Top 10 from the Levels bot.',
    empty: 'Turn on the Levels bot (Server settings, Bots) to rank who yaps the most.',
  },
  roles: {
    title: 'Pick your roles',
    blurb: 'Lets people pick roles from your onboarding questions.',
    empty: 'Set up Onboarding questions in Server settings to let people pick roles here.',
  },
  rules: {
    title: 'Rules',
    blurb: 'A link to your rules channel.',
    empty: 'Pick a rules channel in Server settings, Overview.',
  },
  staff: {
    title: 'Who runs it',
    blurb: 'The owner and the people with mod powers.',
  },
  links: {
    title: 'Links',
    blurb: 'Your site, socials and store, from Server Profile.',
    empty: 'Add links in Server settings, Overview.',
  },
};

const SIDE = new Set(['leaderboard', 'roles', 'rules', 'staff', 'links']);

export function defaultSections() {
  return Object.keys(LOBBY_COPY).map((id) => ({
    id,
    on: true,
    place: SIDE.has(id) ? 'side' : 'main',
  }));
}

export function lobbyFrom(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const known = new Set(Object.keys(LOBBY_COPY));
  const sections = [];
  const seen = new Set();
  for (const row of Array.isArray(src.sections) ? src.sections : []) {
    if (!known.has(row?.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    sections.push({
      id: row.id,
      on: row.id === 'top' ? true : row.on !== false,
      place: row.id === 'top' ? 'main' : (row.place === 'side' ? 'side' : 'main'),
    });
  }
  for (const row of defaultSections()) {
    if (!seen.has(row.id)) sections.push(row);
  }
  const top = sections.find((row) => row.id === 'top');
  return {
    tagline: src.tagline || '',
    buttons: (Array.isArray(src.buttons) ? src.buttons : []).slice(0, 4).map((button) => ({
      label: button.label || '',
      kind: button.kind === 'channel' ? 'channel' : 'url',
      url: button.url || '',
      channelId: button.channelId || '',
    })),
    channelIds: (Array.isArray(src.channelIds) ? src.channelIds : []).slice(0, 6),
    faqs: (Array.isArray(src.faqs) ? src.faqs : []).slice(0, 10).map((item) => ({ q: item.q || '', a: item.a || '' })),
    boards: (Array.isArray(src.boards) && src.boards.length ? src.boards : ['week']).filter((id) => ['levels', 'week', 'invites'].includes(id)),
    showBots: !!src.showBots,
    hiddenIds: Array.isArray(src.hiddenIds) ? src.hiddenIds : [],
    feedName: src.feedName || '',
    feedId: src.feedId || '',
    feedToken: src.feedToken || '',
    posts: Array.isArray(src.posts) ? src.posts : [],
    sections: [top, ...sections.filter((row) => row.id !== 'top')].filter(Boolean),
  };
}
