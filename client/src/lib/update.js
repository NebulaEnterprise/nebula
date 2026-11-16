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
  /* Leave the open page alone. A new version loads the next time Nebula is opened. */
}
