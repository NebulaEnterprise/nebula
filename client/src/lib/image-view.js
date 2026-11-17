export function imageLayout(nw, nh, vw, vh, zoomed, fx, fy) {
  const width = Number(nw) || 0;
  const height = Number(nh) || 0;
  const viewW = Number(vw) || 0;
  const viewH = Number(vh) || 0;
  if (!width || !height || !viewW || !viewH) return null;
  const maxW = Math.max(120, viewW - 48);
  const maxH = Math.max(120, viewH - 48);
  const contain = Math.min(maxW / width, maxH / height, 1);
  const fittedW = width * contain;
  const fittedH = height * contain;
  if (!zoomed) {
    return { w: fittedW, h: fittedH, x: (viewW - fittedW) / 2, y: (viewH - fittedH) / 2 };
  }
  const factor = Math.max(2, width / fittedW);
  const w = fittedW * factor;
  const h = fittedH * factor;
  const x = w <= viewW ? (viewW - w) / 2 : (viewW - w) * clamp(fx);
  const y = h <= viewH ? (viewH - h) / 2 : (viewH - h) * clamp(fy);
  return { w, h, x, y };
}

export function formatSize(width, height, bytes) {
  const dims = width && height ? `${Math.round(width)}×${Math.round(height)}` : '';
  const weight = formatBytes(bytes);
  if (dims && weight) return `${dims} (${weight})`;
  return dims || weight || 'Unknown';
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1) return '';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  const mb = size / (1024 * 1024);
  const shown = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${shown} MB`;
}

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
