// 白い人型（カメレオン）のシルエット定義
const POSE_W = 72; // ポーズ座標系の大きさ
const POSE_H = 160;
const FIG_RATIO = 0.8; // ポーズ座標 → 表示サイズ (CSS px) の倍率
export const FIG_SCALE = 2; // 内部解像度の倍率（細かく塗れるように）
export const ROTATE_STEP = 15; // 回転の刻み (度)

// 回転後の人型を囲む矩形の表示サイズ (CSS px)
export function figureSize(rotation = 0) {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const w = POSE_W * FIG_RATIO, h = POSE_H * FIG_RATIO;
  // 浮動小数の誤差で 1px 増えないように丸めてから切り上げる
  return {
    w: Math.ceil(Math.round((w * cos + h * sin) * 1000) / 1000),
    h: Math.ceil(Math.round((w * sin + h * cos) * 1000) / 1000),
  };
}

// limbs: [x1, y1, x2, y2, 太さ] の丸い棒
export const POSES = {
  stand: {
    label: '直立',
    head: { cx: 36, cy: 15, r: 12 },
    torso: { x: 22, y: 28, w: 28, h: 56, r: 10 },
    limbs: [
      [36, 22, 36, 32, 9],
      [19, 34, 12, 88, 10],
      [53, 34, 60, 88, 10],
      [30, 80, 28, 152, 12],
      [42, 80, 44, 152, 12],
    ],
  },
  banzai: {
    label: 'バンザイ',
    head: { cx: 36, cy: 27, r: 11 },
    torso: { x: 23, y: 39, w: 26, h: 52, r: 10 },
    limbs: [
      [36, 33, 36, 42, 9],
      [26, 45, 11, 7, 10],
      [46, 45, 61, 7, 10],
      [30, 86, 28, 153, 12],
      [42, 86, 44, 153, 12],
    ],
  },
  spread: {
    label: '大の字',
    head: { cx: 36, cy: 15, r: 12 },
    torso: { x: 23, y: 28, w: 26, h: 54, r: 10 },
    limbs: [
      [36, 22, 36, 32, 9],
      [26, 36, 7, 72, 10],
      [46, 36, 65, 72, 10],
      [31, 78, 15, 152, 12],
      [41, 78, 57, 152, 12],
    ],
  },
  crouch: {
    label: 'しゃがむ',
    head: { cx: 34, cy: 75, r: 12 },
    torso: { x: 18, y: 86, w: 32, h: 44, r: 12 },
    limbs: [
      [34, 82, 34, 92, 9],
      [22, 94, 40, 122, 10],
      [46, 94, 58, 124, 10],
      [26, 124, 50, 112, 13],
      [50, 112, 54, 153, 12],
      [26, 128, 22, 153, 12],
    ],
  },
};

// シルエットを描いた canvas を返す（白で塗りつぶし、アンチエイリアスあり）
export function renderSilhouette(poseKey, rotation = 0) {
  const pose = POSES[poseKey] ?? POSES.stand;
  const { w, h } = figureSize(rotation);
  const canvas = document.createElement('canvas');
  canvas.width = w * FIG_SCALE;
  canvas.height = h * FIG_SCALE;
  const ctx = canvas.getContext('2d');
  // 矩形の中心を軸に回転させて描く
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(FIG_SCALE * FIG_RATIO, FIG_SCALE * FIG_RATIO);
  ctx.translate(-POSE_W / 2, -POSE_H / 2);
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';

  const { head, torso, limbs } = pose;
  ctx.beginPath();
  ctx.arc(head.cx, head.cy, head.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(torso.x, torso.y, torso.w, torso.h, torso.r);
  ctx.fill();

  for (const [x1, y1, x2, y2, t] of limbs) {
    ctx.lineWidth = t;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  return canvas;
}
