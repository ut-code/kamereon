import { FIG_SCALE, renderSilhouette } from './figure.js';

// ---- 色変換 ----
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

// 重ね塗り回数 n に応じた色。
// 1回目は選んだ色そのまま、上書きするたびに少しずつ暗く・鮮やかになり、塗りムラが陰影（立体感）になる。
const DARKEN_PER_COAT = 0.035;
const SATURATE_PER_COAT = 0.04;
const MAX_EXTRA_COATS = 16;

export function coatColor(hsl, n) {
  const k = Math.min(Math.max(n - 1, 0), MAX_EXTRA_COATS);
  const [h, s, l] = hsl;
  const l2 = l * Math.pow(1 - DARKEN_PER_COAT, k);
  const s2 = s + (1 - s) * (1 - Math.pow(1 - SATURATE_PER_COAT, k));
  return hslToRgb([h, s2, l2]);
}

const MAX_UNDO = 40;

// 人型キャンバスへのペン描画を管理する
export class Painter {
  constructor(canvas, pose, rotation = 0) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setPose(pose, rotation);
  }

  get painted() {
    return this.undoStack.length > 0;
  }

  // ポーズや向きを変えると、キャンバスの大きさも塗りも作り直す
  setPose(pose, rotation = 0) {
    const silCanvas = renderSilhouette(pose, rotation);
    const { width, height } = silCanvas;
    this.canvas.width = width;
    this.canvas.height = height;
    const sil = silCanvas.getContext('2d').getImageData(0, 0, width, height).data;
    const n = width * height;
    this.alpha = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) this.alpha[i] = sil[i * 4 + 3];
    this.rgb = new Uint8ClampedArray(n * 3).fill(255);
    this.coats = new Uint16Array(n);
    this.strokeMark = new Uint8Array(n);
    this.undoStack = [];
    this.redoStack = [];
    this.image = this.ctx.createImageData(width, height);
    this.render();
  }

  render() {
    const d = this.image.data;
    for (let i = 0, n = this.alpha.length; i < n; i++) {
      d[i * 4] = this.rgb[i * 3];
      d[i * 4 + 1] = this.rgb[i * 3 + 1];
      d[i * 4 + 2] = this.rgb[i * 3 + 2];
      d[i * 4 + 3] = this.alpha[i];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  snapshot() {
    return { rgb: this.rgb.slice(), coats: this.coats.slice() };
  }

  restore({ rgb, coats }) {
    this.rgb = rgb;
    this.coats = coats;
    this.render();
  }

  // 新しく塗ると、やり直しの履歴は消える
  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  // 元に戻した操作をやり直す
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  // 1ストロークの中では同じピクセルを何度なぞっても1回分の重ね塗りとして数える
  beginStroke(x, y, { color, size, erase }) {
    this.pushUndo();
    this.strokeMark.fill(0);
    this.brush = { hsl: rgbToHsl(hexToRgb(color)), radius: (size * FIG_SCALE) / 2, erase };
    this.last = [x, y];
    this.stamp(x, y);
    this.render();
  }

  strokeTo(x, y) {
    if (!this.brush) return;
    const [lx, ly] = this.last;
    const dist = Math.hypot(x - lx, y - ly);
    const step = Math.max(1, this.brush.radius / 3);
    for (let t = step; t <= dist; t += step) {
      this.stamp(lx + ((x - lx) * t) / dist, ly + ((y - ly) * t) / dist);
    }
    this.stamp(x, y);
    this.last = [x, y];
    this.render();
  }

  endStroke() {
    this.brush = null;
  }

  // 全体を一度塗る（下地用）
  fillAll(color) {
    this.pushUndo();
    const hsl = rgbToHsl(hexToRgb(color));
    for (let i = 0; i < this.alpha.length; i++) {
      if (this.alpha[i] > 0) this.paintPixel(i, hsl, false);
    }
    this.render();
  }

  stamp(cx, cy) {
    const { radius, hsl, erase } = this.brush;
    const { width, height } = this.canvas;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * width + x;
        if (this.alpha[i] === 0 || this.strokeMark[i]) continue;
        this.strokeMark[i] = 1;
        this.paintPixel(i, hsl, erase);
      }
    }
  }

  paintPixel(i, hsl, erase) {
    if (erase) {
      this.coats[i] = 0;
      this.rgb.fill(255, i * 3, i * 3 + 3);
      return;
    }
    this.coats[i]++;
    const [r, g, b] = coatColor(hsl, this.coats[i]);
    this.rgb[i * 3] = r;
    this.rgb[i * 3 + 1] = g;
    this.rgb[i * 3 + 2] = b;
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}
