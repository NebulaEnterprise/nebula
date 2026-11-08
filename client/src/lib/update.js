function runningBuild() {
  const files = [];
  for (const node of document.querySelectorAll('script[src],link[rel="stylesheet"]')) {
    const url = node.getAttribute('src') || node.getAttribute('href') || '';
    const match = url.match(/assets\/(index-[A-Za-z0-9_-]+\.(?:js|css))/);
    if (match) files.push(match[1]);
  }
  return files.sort().join('|');
}

function publishedBuild(html) {
  return [...html.matchAll(/assets\/(index-[A-Za-z0-9_-]+\.(?:js|css))/g)].map((match) => match[1]).sort().join('|');
}

function reloadFresh() {
  const note = document.createElement('div');
  note.textContent = 'Updating Nebula…';
  note.setAttribute('role', 'status');
  note.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:80;padding:10px 14px;border-radius:10px;background:#111214;color:#fff;border:1px solid #2b2d31;font:600 14px Outfit,sans-serif';
  document.body.appendChild(note);
  const next = new URL('index.html', document.baseURI);
  next.searchParams.set('_nebula', String(Date.now()));
  setTimeout(() => location.replace(next.href), 200);
}

export function watchForUpdates() {
  const current = runningBuild();
  const dirty = new URL(location.href);
  if (dirty.searchParams.has('_nebula')) {
    dirty.searchParams.delete('_nebula');
    const search = dirty.searchParams.toString();
    history.replaceState(null, '', dirty.pathname + (search ? '?' + search : '') + dirty.hash);
  }
  if (!current) return;

  let checking = false;
  let reloading = false;
  const check = async () => {
    if (checking || reloading) return;
    checking = true;
    try {
      const url = new URL('index.html', document.baseURI);
      url.searchParams.set('_check', String(Date.now()));
      const res = await fetch(url.href, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const next = publishedBuild(await res.text());
      if (!next || next === current) return;
      reloading = true;
      reloadFresh();
    } catch (_) {
      /* keep the page up when the check cannot reach GitHub */
    } finally {
      checking = false;
    }
  };

  setInterval(check, 30000);
}
