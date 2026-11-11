const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://nebulaenterprise.github.io/nebula/';
const DEFAULT_CONFIGS = [
  'https://raw.githubusercontent.com/NebulaEnterprise/nebula/main/desktop/site.json',
  'https://cdn.jsdelivr.net/gh/NebulaEnterprise/nebula@main/desktop/site.json',
];

function httpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url;
  } catch (_) {
    return null;
  }
}

function siteUrl(value) {
  const url = httpsUrl(value);
  if (!url) return '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function serverUrl(value) {
  const url = httpsUrl(value);
  if (!url) return '';
  return url.toString().replace(/\/$/, '');
}

function configUrl(value) {
  const url = httpsUrl(value);
  if (!url) return '';
  const host = url.hostname;
  if (host !== 'raw.githubusercontent.com' && host !== 'cdn.jsdelivr.net' && host !== 'github.com') return '';
  return url.toString();
}

function applyConfig(data) {
  if (!data || typeof data !== 'object') return null;
  const url = siteUrl(data.url);
  if (!url) return null;
  return {
    url,
    server: serverUrl(data.server),
    config: configUrl(data.config),
  };
}

function pageUrl(link) {
  const base = siteUrl(link && link.url) || DEFAULT_URL;
  const server = serverUrl(link && link.server);
  if (!server) return base;
  const url = new URL(base);
  url.searchParams.set('backend', server);
  return url.toString();
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Nebula',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(file) {
  try {
    return applyConfig(JSON.parse(fs.readFileSync(file, 'utf8'))) || { url: '', server: '', config: '' };
  } catch (_) {
    return { url: '', server: '', config: '' };
  }
}

function writeCache(file, link) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ url: link.url, server: link.server, config: link.config }));
  } catch (_) {}
}

async function resolveLink(userData) {
  const file = path.join(userData, 'link.json');
  const cached = readCache(file);
  const seeds = [];
  if (cached.config) seeds.push(cached.config);
  for (const item of DEFAULT_CONFIGS) {
    if (!seeds.includes(item)) seeds.push(item);
  }

  let found = null;
  const seen = new Set();
  for (let i = 0; i < seeds.length && seen.size < 6; i++) {
    const current = seeds[i];
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const data = applyConfig(await fetchJson(current));
    if (!data) continue;
    found = {
      url: data.url,
      server: data.server,
      config: data.config || current,
    };
    if (data.config && data.config !== current && !seen.has(data.config) && !seeds.includes(data.config)) {
      seeds.push(data.config);
      continue;
    }
    break;
  }

  const link = found || {
    url: cached.url || DEFAULT_URL,
    server: found ? '' : cached.server,
    config: cached.config || DEFAULT_CONFIGS[0],
  };
  if (found) writeCache(file, link);
  return link;
}

module.exports = { resolveLink, pageUrl, applyConfig, DEFAULT_URL };
