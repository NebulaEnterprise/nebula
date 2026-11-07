export function fileToDataUrl(file, opts = {}) {
  if (opts.original) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('Choose an image')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
  }
  const maxW = opts.maxW || 512;
  const maxH = opts.maxH || 512;
  const quality = opts.quality || 0.82;
  const maxBytes = opts.maxBytes || 8 * 1024 * 1024;
  const isGif = /image\/gif/i.test(file.type) || /\.gif$/i.test(file.name || '');
  return new Promise((resolve, reject) => {
    if (isGif) {
      if (file.size > maxBytes) {
        reject(new Error('GIF is too large (max ~8MB).'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Could not read GIF'));
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

export function readSmallImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose an image'));
    if (file.size > 300000) return reject(new Error('Keep the image under 300 KB'));
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (typeof url !== 'string' || url.length > 400000) reject(new Error('That image is too large'));
      else resolve(url);
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}
