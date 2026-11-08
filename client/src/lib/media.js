import { shrinkGif } from './image.js';

export function fileKind(file) {
  const name = file?.name || '';
  const type = file?.type || '';
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(name)) return 'video';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name)) return 'image';
  return 'file';
}

function renamed(name, ext) {
  const base = String(name || 'image').replace(/\.[a-z0-9]{1,8}$/i, '') || 'image';
  return base.slice(0, 70) + '.' + ext;
}

function scaleStill(file, maxEdge, quality) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || img.width || 1;
      const h0 = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, maxEdge / Math.max(w0, h0));
      URL.revokeObjectURL(url);
      if (scale === 1 && file.size < 450 * 1024 && /jpe?g|webp/i.test(file.type || file.name || '')) {
        resolve(file);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob && blob.size < file.size) resolve(blob);
        else if (scale < 1) {
          canvas.toBlob((jpg) => resolve(jpg && jpg.size < file.size ? jpg : file), 'image/jpeg', quality);
        } else resolve(file);
      }, 'image/webp', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function videoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(blob || null);
    };
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const draw = () => {
      const w0 = video.videoWidth || 0;
      const h0 = video.videoHeight || 0;
      if (!w0 || !h0) return finish(null);
      const scale = Math.min(1, 640 / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.72);
    };
    video.onloadeddata = () => {
      const duration = Number(video.duration) || 0;
      const target = duration ? Math.min(0.25, duration / 2) : 0;
      if (target > 0) {
        const onSeek = () => {
          video.removeEventListener('seeked', onSeek);
          draw();
        };
        video.addEventListener('seeked', onSeek);
        try { video.currentTime = target; } catch (_) { draw(); }
      } else draw();
    };
    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 2500);
  });
}

export async function packUpload(file) {
  const kind = fileKind(file);
  if (kind === 'image') {
    const gif = /image\/gif/i.test(file.type) || /\.gif$/i.test(file.name || '');
    if (gif) {
      const shrunk = await shrinkGif(file, { max: 480, frames: 24 });
      const body = shrunk instanceof Blob ? shrunk : file;
      return { body, name: renamed(file.name, 'gif'), type: 'image/gif', kind };
    }
    const scaled = await scaleStill(file, 1280, 0.8);
    let ext = 'jpg';
    if (scaled === file) ext = ((file.name || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1] || 'jpg';
    else if (/webp/i.test(scaled.type || '')) ext = 'webp';
    else if (/png/i.test(scaled.type || '')) ext = 'png';
    return { body: scaled, name: renamed(file.name, ext.toLowerCase()), type: scaled.type || file.type || 'image/jpeg', kind };
  }
  if (kind === 'video') {
    const poster = await videoPoster(file);
    return { body: file, name: file.name || 'video.mp4', type: file.type || 'video/mp4', kind, poster, posterName: 'preview.jpg' };
  }
  return { body: file, name: file.name || 'file', type: file.type || 'application/octet-stream', kind };
}
