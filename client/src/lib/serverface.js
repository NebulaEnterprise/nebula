export function serverFace(server) {
  const iconUrl = server?.iconUrl || '';
  const icon = String(server?.icon || '');
  const image = iconUrl || (/^(https?:|data:|blob:)/.test(icon) ? icon : '');
  const mark = image ? '' : (Array.from(icon || server?.name || 'S')[0] || 'S').toUpperCase();
  return { image, mark, color: server?.color || '#7c6af7' };
}

export function memberLine(server) {
  const raw = server?.members ?? server?.memberCount;
  if (raw == null || raw === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return '';
  return n.toLocaleString() + (n === 1 ? ' Member' : ' Members');
}

export function recentServerIds() {
  try {
    const list = JSON.parse(localStorage.getItem('nebula-recent-servers') || '[]');
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export function rememberServer(id) {
  if (!id) return;
  const next = [String(id), ...recentServerIds().filter((row) => row !== String(id))].slice(0, 8);
  localStorage.setItem('nebula-recent-servers', JSON.stringify(next));
}
