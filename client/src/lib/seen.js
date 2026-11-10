export function presenceDot(user, now = Date.now()) {
  if (!user) return 'offline';
  const until = Number(user.onlineUntil) || 0;
  const live = user.status === 'online' || user.status === 'idle' || user.status === 'dnd';
  if (live && (!until || until > now)) return user.status === 'online' ? 'online' : user.status;
  return 'offline';
}

export function seenPhrase(user, now = Date.now()) {
  if (!user) return '';
  const dot = presenceDot(user, now);
  if (dot === 'online') return 'online';
  if (dot === 'idle') return 'idle';
  if (dot === 'dnd') return 'do not disturb';
  if (user.seen === 'recent') return 'last seen recently';
  if (user.seen === 'week') return 'last seen within a week';
  if (user.seen === 'month') return 'last seen within a month';
  if (user.seen === 'long') return 'last seen a long time ago';
  const at = Number(user.lastSeen) || 0;
  if (!at) return user.seen === 'exact' ? 'offline' : 'last seen a long time ago';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return 'offline';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return 'last seen today at ' + time;
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'last seen yesterday at ' + time;
  return 'last seen ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
}
