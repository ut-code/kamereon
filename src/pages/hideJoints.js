import { FIG_SCALE, POSES, figureSize } from "../figure.js";
import { Painter } from "../painter.js";

export const SPLASH_SIZE_MULTIPLIER = 4;

export const BODY_TYPES = {
  slim: { label: "細め", widthScale: 18 / 28, limbScale: 0.8 },
  standard: { label: "標準", widthScale: 1, limbScale: 1 },
  round: { label: "太め", widthScale: 48 / 28, limbScale: 1.4 },
};
const normalizeBody = (body) => Object.hasOwn(BODY_TYPES, body) ? body : "standard";
const ARM_LENGTH_SCALE = 0.85;
const LEG_LENGTH_SCALE = 0.72;

function bodyHead(poseKey) {
  const { head } = POSES[poseKey] ?? POSES.stand;
  return { ...head, rx: head.r * 1.1, ry: head.r * 1.22 };
}

function bodyTorso(poseKey, body) {
  const { torso } = POSES[poseKey] ?? POSES.stand;
  const scale = BODY_TYPES[normalizeBody(body)].widthScale;
  const width = torso.w * scale;
  const topShift = poseKey === "stand" || poseKey === "spread" ? 1 : -2;
  return { ...torso, x: torso.x + (torso.w - width) / 2, w: width,
    y: torso.y + topShift, h: torso.h - topShift };
}

const smoothStep = (t) => t * t * (3 - 2 * t);

// 首・肩・お腹・腰を、一つの輪郭として描く。塗りの移し替えにも同じ幅を使う。
function torsoHalfWidth(torso, y) {
  const t = Math.max(0, Math.min(1, (y - torso.y) / torso.h));
  // 太ももにつながる幅を胸から腰まで保ち、お腹をくびれさせない。
  const half = Math.max(torso.w / 2, Math.min(torso.w / 2 * 1.15, 14.5));
  if (t >= 0.88) return half * Math.sqrt(Math.max(0, 1 - ((t - 0.88) / 0.12) ** 2));
  if (t < 0.18) {
    const neck = Math.min(4.5, half * 0.55);
    return neck + (half - neck) * smoothStep(t / 0.18);
  }
  return half;
}

function torsoInset(torso, y) {
  return torso.w / 2 - torsoHalfWidth(torso, y);
}

// 一筆の間は同じ形を使い、絵の具のまとまりと小さなしぶきを重ねる。
function createSplashStamp() {
  const angle = Math.random() * Math.PI * 2;
  const marks = [{ x: 0, y: 0, radius: 0.63 + Math.random() * 0.04 }];
  for (let i = 0; i < 8; i++) {
    const direction = angle + i * Math.PI / 4 + (Math.random() - 0.5) * 0.3;
    const reach = 0.52 + Math.random() * 0.08;
    marks.push({
      x: Math.cos(direction) * reach,
      y: Math.sin(direction) * reach,
      radius: 0.16 + Math.random() * 0.07,
    });
  }
  for (let i = 0; i < 5; i++) {
    const direction = angle + (i + 0.5) * Math.PI * 2 / 5 + (Math.random() - 0.5) * 0.4;
    const reach = 0.88 + Math.random() * 0.05;
    marks.push({
      x: Math.cos(direction) * reach,
      y: Math.sin(direction) * reach,
      radius: 0.025 + Math.random() * 0.04,
    });
  }
  return marks;
}

// 関節の座標は figure.js の 72 × 160 と同じ。画面上では 0.8 倍。
const RATIO = 0.8;
const CENTER = { x: 36, y: 80 };
const copyJoints = (joints) => joints.map((limb) => ({
  ...limb,
  ...(limb.limits ? { limits: { ...limb.limits } } : {}),
  root: { ...limb.root },
  bend: { ...limb.bend },
  end: { ...limb.end },
}));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const angleBetween = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const limitAngle = (angle, min, max) => {
  const center = (min + max) / 2;
  return center + clamp(wrapAngle(angle - center), min - center, max - center);
};

// 肩は体の外側を通って真上まで上げられるように、上向き側だけ広げる。
function allowRaisedArms(limits, index) {
  if (index >= 2) return limits;
  const center = (limits.rootMin + limits.rootMax) / 2;
  const reference = index === 0 ? Math.PI : 0;
  const shift = Math.round((reference - center) / (Math.PI * 2)) * Math.PI * 2;
  return { ...limits,
    rootMin: index === 1 ? Math.min(limits.rootMin + shift, -Math.PI / 2) : limits.rootMin + shift,
    rootMax: index === 0 ? Math.max(limits.rootMax + shift, Math.PI * 1.5) : limits.rootMax + shift };
}

// 可動域の基準は初期ポーズで固定し、操作を繰り返しても広がらないようにする。
function jointLimits(limb, index) {
  const rootAngle = angleBetween(limb.root, limb.bend);
  const bendAngle = wrapAngle(angleBetween(limb.bend, limb.end) - rootAngle);
  const side = Math.abs(bendAngle) > 0.0001 ? Math.sign(bendAngle) : index % 2 ? 1 : -1;
  const rootRange = (index < 2 ? 80 : 45) * Math.PI / 180;
  const bendRange = (index < 2 ? 145 : 125) * Math.PI / 180;
  return allowRaisedArms({ rootMin: rootAngle - rootRange, rootMax: rootAngle + rootRange,
    bendMin: side < 0 ? -bendRange : 0, bendMax: side > 0 ? bendRange : 0 }, index);
}

// 付け根と曲げた向きは保ち、関節の前後を同じ比率で短くする。
function shortenLimb(limb, scale) {
  const towardRoot = (point) => ({
    x: limb.root.x + (point.x - limb.root.x) * scale,
    y: limb.root.y + (point.y - limb.root.y) * scale,
  });
  return { ...limb, bend: towardRoot(limb.bend), end: towardRoot(limb.end) };
}

export function createJoints(poseKey, body = "standard") {
  const { limbs, torso } = POSES[poseKey] ?? POSES.stand;
  const outline = bodyTorso(poseKey, body);
  const { widthScale, limbScale } = BODY_TYPES[normalizeBody(body)];
  const center = torso.x + torso.w / 2;
  const legs = poseKey === "crouch"
    ? [limbs.slice(3, 5), [limbs[5]]]
    : [[limbs[3]], [limbs[4]]];
  const labels = ["左腕", "右腕", "左脚", "右脚"];
  return [[limbs[1]], [limbs[2]], ...legs].map((bones, index) => {
    const [x, y, x2, y2, thickness] = bones[0];
    const last = bones[bones.length - 1];
    const width = limbScale * (index < 2 ? 1.3 : 1.25);
    const scaledX = center + (x - center) * widthScale;
    // 肩は首から少し下げ、脚は腰の内側から始める。
    const shiftY = index < 2
      ? (poseKey === "stand" || poseKey === "spread" ? 4 + thickness * (width - 1) / 2 : 0)
      : (poseKey === "crouch" ? 0 : -3);
    const inset = torsoInset(outline, clamp(y + shiftY, outline.y, outline.y + outline.h));
    const overlap = thickness * width * (index < 2 ? -0.12 : 0.1);
    // 太い腕の付け根を胴の内側へ埋め、肩から一続きの輪郭にする。
    let rootX = clamp(scaledX, outline.x + inset - overlap,
      outline.x + outline.w - inset + overlap);
    if (index >= 2 && poseKey !== "crouch") {
      const side = index === 2 ? -1 : 1;
      // 細めの体型でも、太くした両脚の間に自然な股下を残す。
      rootX = center + side * Math.max(Math.abs(rootX - center), thickness * width * 0.48);
    }
    const shift = rootX - x;
    const limb = {
      label: labels[index],
      root: { x: x + shift, y: y + shiftY },
      bend: bones.length === 2
        ? { x: x2 + shift, y: y2 + shiftY }
        : { x: (x + x2) / 2 + shift, y: (y + y2) / 2 + shiftY },
      end: { x: last[2] + shift, y: last[3] + shiftY },
      thickness: thickness * width,
      lowerThickness: last[4] * width,
    };
    return { ...shortenLimb(limb, index < 2 ? ARM_LENGTH_SCALE : LEG_LENGTH_SCALE),
      limits: jointLimits(limb, index) };
  });
}

export function moveJoint(joints, index, handle, target) {
  const next = copyJoints(joints);
  const limb = next[index];
  if (!limb || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return next;
  const { root, bend, end } = limb;
  const upper = distance(root, bend), lower = distance(bend, end);
  if (!upper || !lower) return next;
  const limits = allowRaisedArms(limb.limits ?? jointLimits(limb, index), index);
  limb.limits = limits;
  const rootAngle = angleBetween(root, bend);
  const bendAngle = limitAngle(angleBetween(bend, end) - rootAngle, limits.bendMin, limits.bendMax);
  const positions = (angle, flex) => {
    const bend = { x: root.x + Math.cos(angle) * upper, y: root.y + Math.sin(angle) * upper };
    return { bend, end: { x: bend.x + Math.cos(angle + flex) * lower,
      y: bend.y + Math.sin(angle + flex) * lower } };
  };
  if (handle === "bend") {
    if (distance(root, target) < 0.0001) return next;
    const angle = limitAngle(angleBetween(root, target), limits.rootMin, limits.rootMax);
    Object.assign(limb, positions(angle, bendAngle));
  } else if (handle === "end") {
    const reach = distance(root, target);
    const direction = angleBetween(root, reach < 0.0001 ? end : target);
    const side = limits.bendMin < 0 ? -1 : 1;
    const flex = clamp(side * Math.acos(clamp((reach ** 2 - upper ** 2 - lower ** 2)
      / (2 * upper * lower), -1, 1)), limits.bendMin, limits.bendMax);
    const aim = (flex) => direction - Math.atan2(lower * Math.sin(flex), upper + lower * Math.cos(flex));
    const candidates = [positions(limitAngle(aim(flex), limits.rootMin, limits.rootMax), flex)];
    // 届かない場所では、肩・股またはひじ・ひざの限界上で最も近い姿勢を選ぶ。
    for (const angle of [limits.rootMin, limits.rootMax]) {
      const elbow = positions(angle, 0).bend;
      const flex = distance(elbow, target) < 0.0001 ? bendAngle
        : limitAngle(angleBetween(elbow, target) - angle, limits.bendMin, limits.bendMax);
      candidates.push(positions(angle, flex));
    }
    for (const flex of [limits.bendMin, limits.bendMax]) {
      candidates.push(positions(limitAngle(aim(flex), limits.rootMin, limits.rootMax), flex));
    }
    const closest = candidates.reduce((best, candidate) => {
      const difference = distance(candidate.end, target) - distance(best.end, target);
      return difference < -0.0000001 || (Math.abs(difference) <= 0.0000001
        && distance(candidate.bend, bend) < distance(best.bend, bend)) ? candidate : best;
    });
    Object.assign(limb, closest);
  }
  return next;
}

export function toFigurePoint(point, rotation, bounds) {
  const rad = rotation * Math.PI / 180;
  const x = (point.x - CENTER.x) * RATIO;
  const y = (point.y - CENTER.y) * RATIO;
  return {
    x: x * Math.cos(rad) - y * Math.sin(rad) - bounds.x,
    y: x * Math.sin(rad) + y * Math.cos(rad) - bounds.y,
  };
}

export function fromFigurePoint(point, rotation, bounds) {
  const rad = rotation * Math.PI / 180;
  const x = point.x + bounds.x, y = point.y + bounds.y;
  return {
    x: (x * Math.cos(rad) + y * Math.sin(rad)) / RATIO + CENTER.x,
    y: (-x * Math.sin(rad) + y * Math.cos(rad)) / RATIO + CENTER.y,
  };
}

const segments = (limb) => [
  { start: limb.root, end: limb.bend, thickness: limb.thickness, profile: "upper" },
  { start: limb.bend, end: limb.end, thickness: limb.thickness, profile: "lower" },
];

// 関節の前後で半径をそろえ、伸ばした手足を一本の円柱として描く。
function boneRadius(bone) {
  return bone.thickness / 2;
}

function fillBone(ctx, bone) {
  const dx = bone.end.x - bone.start.x, dy = bone.end.y - bone.start.y;
  const length = Math.hypot(dx, dy);
  const nx = -dy / length, ny = dx / length;
  ctx.beginPath();
  for (const side of [1, -1]) {
    for (let step = 0; step <= 24; step++) {
      const t = side === 1 ? step / 24 : 1 - step / 24;
      const radius = boneRadius(bone);
      const x = bone.start.x + dx * t + nx * radius * side;
      const y = bone.start.y + dy * t + ny * radius * side;
      if (side === 1 && step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
  for (const point of [bone.start, bone.end]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, boneRadius(bone), 0, Math.PI * 2);
    ctx.fill();
  }
}

// 円柱と端の丸みを、描画・陰影・塗りの追従で同じ領域として扱う。
function boneSample(bone, x, y, tolerance = 0) {
  const dx = bone.end.x - bone.start.x, dy = bone.end.y - bone.start.y;
  const length2 = dx * dx + dy * dy;
  const px = x - bone.start.x, py = y - bone.start.y;
  const t = (px * dx + py * dy) / Math.max(0.001, length2);
  const near = clamp(t, 0, 1);
  const distance2 = (px - near * dx) ** 2 + (py - near * dy) ** 2;
  let result = { t, distance2, cap: t < 0 ? 0 : t > 1 ? 1 : null,
    depth2: (boneRadius(bone) + tolerance) ** 2 - distance2 };
  for (const cap of [0, 1]) {
    const capDistance2 = (px - cap * dx) ** 2 + (py - cap * dy) ** 2;
    const depth2 = (boneRadius(bone) + tolerance) ** 2 - capDistance2;
    if (depth2 > result.depth2) result = { t, distance2: capDistance2, cap, depth2 };
  }
  return result;
}

// 腕の付け根の丸みまで首から肩をつなぎ、根元だけが盛り上がる凹みをなくす。
function shoulderBridge(poseKey, body, limb, side) {
  const torso = bodyTorso(poseKey, body);
  const center = torso.x + torso.w / 2;
  const radius = limb.thickness / 2;
  const head = bodyHead(poseKey);
  const top = poseKey === "stand" || poseKey === "spread"
    ? Math.min(limb.root.y - radius - 0.5, head.cy + head.ry + 0.8) : torso.y;
  return { center, top, neck: center + side * torsoHalfWidth(torso, torso.y),
    x: limb.root.x, y: limb.root.y - radius, rootY: limb.root.y,
    controlX: limb.root.x - side * radius * 0.6 };
}

function shoulderEdge(bridge, y) {
  if (y < bridge.top || y > bridge.rootY) return null;
  if (y >= bridge.y) return bridge.x;
  const t = 1 - Math.sqrt(Math.max(0, 1 - (y - bridge.top) / Math.max(0.001, bridge.y - bridge.top)));
  return (1 - t) ** 2 * bridge.neck + 2 * (1 - t) * t * bridge.controlX + t * t * bridge.x;
}

// 肩・股の近くは胴と四肢の高さを滑らかに混ぜ、接合線のような陰影をなくす。
function joinSurface(depth2, limbDepth2, bone, x, y) {
  const maximum = Math.max(depth2, limbDepth2);
  if (bone.profile !== "upper" || depth2 <= 0 || limbDepth2 <= 0) return maximum;
  const reach = bone.thickness * 2.5;
  const weight = 1 - smoothStep(clamp(Math.hypot(x - bone.start.x, y - bone.start.y) / reach, 0, 1));
  return maximum + (Math.hypot(depth2, limbDepth2) - maximum) * weight;
}

function jointSoftness(joints, x, y) {
  let weight = 0;
  for (const limb of joints) {
    const t = Math.hypot(x - limb.root.x, y - limb.root.y) / (limb.thickness * 1.8);
    weight = Math.max(weight, 1 - smoothStep(clamp((t - 0.35) / 0.65, 0, 1)));
  }
  return weight;
}

// 形に沿った高さから陰影を作る。塗りの RGB には混ぜず、形が変わった時だけ計算する。
function figureLighting({ canvas, alpha, pose, body, joints, bounds, rotation }) {
  const { width, height } = canvas;
  const surface = new Float32Array(alpha.length);
  const softness = new Float32Array(alpha.length);
  const { limbs } = POSES[pose];
  const head = bodyHead(pose);
  const torso = bodyTorso(pose, body);
  const torsoCenter = torso.x + torso.w / 2;
  const shoulders = joints.slice(0, 2).map((limb, index) => shoulderBridge(pose, body, limb, index ? 1 : -1));
  const torsoDepth = Math.min(torso.w * 0.45, torso.h * 0.28);
  const [nx1, ny1, nx2, ny2, neckWidth] = limbs[0];
  const bones = [
    { start: { x: nx1, y: ny1 }, end: { x: nx2, y: ny2 }, thickness: neckWidth },
    ...joints.flatMap(segments),
  ].map((bone) => ({
    ...bone,
    x: bone.start.x, y: bone.start.y, dx: bone.end.x - bone.start.x, dy: bone.end.y - bone.start.y,
    length2: (bone.end.x - bone.start.x) ** 2 + (bone.end.y - bone.start.y) ** 2,
  }));
  const rad = rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const scale = RATIO * FIG_SCALE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!alpha[i]) continue;
      const wx = (x + 0.5) / FIG_SCALE + bounds.x;
      const wy = (y + 0.5) / FIG_SCALE + bounds.y;
      const px = (wx * cos + wy * sin) / RATIO + CENTER.x;
      const py = (-wx * sin + wy * cos) / RATIO + CENTER.y;
      let depth2 = 0;
      if (py > torso.y && py < torso.y + torso.h) {
        const halfWidth = torso.w / 2 - torsoInset(torso, py);
        const across = (px - torsoCenter) / Math.max(0.001, halfWidth);
        const cap = Math.max(0, 1 - Math.min(py - torso.y, torso.y + torso.h - py) / 10);
        depth2 = Math.max(depth2, torsoDepth ** 2 * Math.max(0, 1 - across ** 2) * (1 - cap ** 2));
      }
      if (pose === "banzai") {
        const limb = joints[px < head.cx ? 0 : 1];
        if (py >= head.cy && py <= limb.root.y) {
          const t = (py - head.cy) / (limb.root.y - head.cy);
          const halfWidth = head.r * (1 - t) + Math.abs(limb.root.x - head.cx) * t;
          const across = (px - head.cx) / halfWidth;
          depth2 = Math.max(depth2, 25 * Math.max(0, 1 - across ** 2));
        }
      }
      for (const bridge of shoulders) {
        const edge = shoulderEdge(bridge, py);
        if (edge !== null) {
          const span = Math.abs(edge - bridge.center);
          depth2 = Math.max(depth2, 25 * Math.max(0, 1 - ((px - bridge.center) / span) ** 2));
        }
      }
      for (const bone of bones) {
        depth2 = joinSurface(depth2, boneSample(bone, px, py).depth2, bone, px, py);
      }
      const headDistance = ((px - head.cx) / head.rx) ** 2 + ((py - head.cy) / head.ry) ** 2;
      depth2 = Math.max(depth2, head.rx ** 2 * Math.max(0, 1 - headDistance));
      surface[i] = Math.sqrt(Math.max(0, depth2)) * scale;
      softness[i] = headDistance > 1.08 ? jointSoftness(joints, px, py) : 0;
    }
  }
  return surfaceLighting(surface, alpha, width, height, softness);
}

function surfaceLighting(surface, alpha, width, height, softness) {
  // 付け根だけを広めにならす。外形・絵の具・頭の立体感は変えない。
  let softened = surface;
  const kernel = [1, 4, 6, 4, 1];
  for (let pass = 0; pass < 2; pass++) {
    const across = new Float32Array(alpha.length);
    const down = new Float32Array(alpha.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      for (let k = -2; k <= 2; k++) {
        const xx = x + k * 2;
        if (xx >= 0 && xx < width) across[y * width + x] += softened[y * width + xx] * kernel[k + 2] / 16;
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      for (let k = -2; k <= 2; k++) {
        const yy = y + k * 2;
        if (yy >= 0 && yy < height) down[y * width + x] += across[yy * width + x] * kernel[k + 2] / 16;
      }
    }
    softened = down;
  }
  surface = surface.map((height, i) => height + (softened[i] - height) * softness[i]);
  // 接合部の段差をならし、ひじ・ひざにも連続した丸みを持たせる。
  const horizontal = new Float32Array(alpha.length);
  const smooth = new Float32Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      horizontal[i] = ((x ? surface[i - 1] : 0) + surface[i] * 2
        + (x + 1 < width ? surface[i + 1] : 0)) / 4;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      smooth[i] = ((y ? horizontal[i - width] : 0) + horizontal[i] * 2
        + (y + 1 < height ? horizontal[i + width] : 0)) / 4;
    }
  }
  const shade = new Float32Array(alpha.length);
  const shine = new Float32Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!alpha[i]) continue;
      const dx = ((x ? smooth[i - 1] : 0) - (x + 1 < width ? smooth[i + 1] : 0)) / 2;
      const dy = ((y ? smooth[i - width] : 0) - (y + 1 < height ? smooth[i + width] : 0)) / 2;
      const length = Math.hypot(dx, dy, 1);
      // 光源は画面の左上。回転させても明るい側は光源に向く。
      const diffuse = Math.max(0, (-0.432 * dx - 0.576 * dy + 0.694) / length);
      const specular = Math.max(0, (-0.235 * dx - 0.313 * dy + 0.920) / length);
      shade[i] = 0.64 + 0.36 * diffuse;
      shine[i] = 0.20 * specular ** 24;
    }
  }
  return { shade, shine };
}

export function getFigureBounds(poseKey, rotation = 0, joints = null, body = "standard") {
  const { w, h } = figureSize(rotation);
  const base = { x: -w / 2, y: -h / 2, w, h };
  if (!joints) {
    if (normalizeBody(body) === "standard") return base;
    joints = createJoints(poseKey, body);
  }
  let left = base.x, top = base.y, right = base.x + w, bottom = base.y + h;
  for (const limb of joints) {
    for (const segment of segments(limb)) {
      const radius = segment.thickness / 2 * RATIO;
      for (const point of [segment.start, segment.end]) {
        const p = toFigurePoint(point, rotation, { x: 0, y: 0 });
        left = Math.min(left, p.x - radius);
        top = Math.min(top, p.y - radius);
        right = Math.max(right, p.x + radius);
        bottom = Math.max(bottom, p.y + radius);
      }
    }
  }
  // 元の canvas の画素位置を保ったまま、はみ出した側だけ広げる。
  const x = base.x + Math.floor(left - base.x + 1e-8);
  const y = base.y + Math.floor(top - base.y + 1e-8);
  return { x, y, w: Math.ceil(right - x - 1e-8), h: Math.ceil(bottom - y - 1e-8) };
}

function silhouette(poseKey, rotation, joints, bounds, body) {
  const canvas = document.createElement("canvas");
  canvas.width = bounds.w * FIG_SCALE;
  canvas.height = bounds.h * FIG_SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(FIG_SCALE, FIG_SCALE);
  ctx.translate(-bounds.x, -bounds.y);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(RATIO, RATIO);
  ctx.translate(-CENTER.x, -CENTER.y);
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  ctx.lineCap = ctx.lineJoin = "round";
  const { limbs } = POSES[poseKey] ?? POSES.stand;
  const head = bodyHead(poseKey);
  const torso = bodyTorso(poseKey, body);
  ctx.beginPath();
  ctx.ellipse(head.cx, head.cy, head.rx, head.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  const torsoCenter = torso.x + torso.w / 2;
  for (const side of [-1, 1]) {
    for (let step = 0; step <= 64; step++) {
      const t = side === -1 ? step / 64 : 1 - step / 64;
      const y = torso.y + torso.h * t;
      const x = torsoCenter + side * torsoHalfWidth(torso, y);
      if (side === -1 && step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
  joints.slice(0, 2).forEach((limb, index) => {
    const bridge = shoulderBridge(poseKey, body, limb, index ? 1 : -1);
    ctx.beginPath();
    ctx.moveTo(bridge.neck, bridge.top);
    ctx.quadraticCurveTo(bridge.controlX, bridge.y, bridge.x, bridge.y);
    ctx.lineTo(bridge.x, bridge.rootY);
    ctx.lineTo(bridge.center, bridge.rootY);
    ctx.lineTo(bridge.center, bridge.top);
    ctx.closePath();
    ctx.fill();
  });
  // バンザイの首から肩をつなぐ。関節を動かしても胴の輪郭は変えない。
  if (poseKey === "banzai") {
    joints.slice(0, 2).forEach((limb, index) => {
      const side = index === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(head.cx, head.cy);
      ctx.lineTo(head.cx + side * head.r, head.cy);
      ctx.lineTo(limb.root.x, limb.root.y);
      ctx.lineTo(head.cx, limb.root.y);
      ctx.closePath();
      ctx.fill();
    });
  }
  const [x1, y1, x2, y2, thickness] = limbs[0];
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  for (const limb of joints) {
    for (const bone of segments(limb)) fillBone(ctx, bone);
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

// 座標を動かした手足から元の骨へ戻し、塗りの色と重ね塗り回数を持ち運ぶ。
function segmentMap(next, previous) {
  const dx = next.end.x - next.start.x, dy = next.end.y - next.start.y;
  const length = Math.hypot(dx, dy);
  const oldDx = previous.end.x - previous.start.x, oldDy = previous.end.y - previous.start.y;
  const oldLength = Math.hypot(oldDx, oldDy);
  return { ...next, dx, dy, length, old: previous, oldDx, oldDy, oldLength };
}

export class JointPainter extends Painter {
  constructor(canvas, pose, rotation = 0, body = "standard") {
    super(canvas, pose, rotation);
    if (normalizeBody(body) !== "standard") this.setPose(pose, rotation, body);
  }

  get painted() {
    return this.coats.some((count) => count > 0);
  }

  render() {
    
    /*return super.render();*/

    if (!this.lighting) return super.render();
    const { shade, shine } = this.lighting;
    const pixels = this.image.data;
    for (let i = 0; i < this.alpha.length; i++) {
      for (let channel = 0; channel < 3; channel++) {
        const base = this.rgb[i * 3 + channel] * shade[i];
        pixels[i * 4 + channel] = base + (255 - base) * shine[i];
      }
      pixels[i * 4 + 3] = this.alpha[i];
    }
    this.ctx.putImageData(this.image, 0, 0);
    
  }

  beginStroke(x, y, { splash = false, ...options }) {
    this.splash = splash && !options.erase;
    this.splashMarks = this.splash ? createSplashStamp() : null;
    super.beginStroke(x, y, {
      ...options,
      size: options.size * (this.splash ? SPLASH_SIZE_MULTIPLIER : 1),
    });
  }

  stamp(cx, cy) {
    if (!this.splash || this.brush.erase) return super.stamp(cx, cy);
    const { radius, hsl } = this.brush;
    const { width, height } = this.canvas;
    for (const mark of this.splashMarks) {
      const centerX = cx + mark.x * radius, centerY = cy + mark.y * radius;
      const markRadius = mark.radius * radius;
      const radius2 = markRadius * markRadius;
      const x0 = Math.max(0, Math.floor(centerX - markRadius));
      const x1 = Math.min(width - 1, Math.ceil(centerX + markRadius));
      const y0 = Math.max(0, Math.floor(centerY - markRadius));
      const y1 = Math.min(height - 1, Math.ceil(centerY + markRadius));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - centerX, dy = y + 0.5 - centerY;
          if (dx * dx + dy * dy > radius2) continue;
          const i = y * width + x;
          if (!this.alpha[i] || this.strokeMark[i]) continue;
          this.strokeMark[i] = 1;
          this.paintPixel(i, hsl, false);
        }
      }
    }
  }

  setPose(pose, rotation = 0, body = this.body ?? "standard") {
    const nextBody = normalizeBody(body);
    this.lighting = null;
    super.setPose(pose, rotation);
    this.pose = POSES[pose] ? pose : "stand";
    this.rotation = rotation;
    this.body = "standard";
    this.joints = createJoints(this.pose);
    this.bounds = getFigureBounds(this.pose, rotation);
    this.brush = null;
    const source = this.snapshot();
    this.body = nextBody;
    this.setJoints(createJoints(this.pose, nextBody), source);
  }

  setBody(nextBody) {
    if (!Object.hasOwn(BODY_TYPES, nextBody) || nextBody === this.body) return false;
    const source = this.snapshot();
    const previous = createJoints(this.pose, this.body);
    const next = createJoints(this.pose, nextBody);
    const thicknessScale = BODY_TYPES[nextBody].limbScale / BODY_TYPES[this.body].limbScale;
    const joints = copyJoints(this.joints);
    joints.forEach((limb, index) => {
      const shiftX = next[index].root.x - previous[index].root.x;
      const shiftY = next[index].root.y - previous[index].root.y;
      for (const point of [limb.root, limb.bend, limb.end]) {
        point.x += shiftX;
        point.y += shiftY;
      }
      limb.thickness *= thicknessScale;
      if (limb.lowerThickness !== undefined) limb.lowerThickness *= thicknessScale;
    });
    this.pushUndo();
    this.body = nextBody;
    this.setJoints(joints, source);
    return true;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      alpha: this.alpha.slice(),
      width: this.canvas.width,
      height: this.canvas.height,
      pose: this.pose,
      rotation: this.rotation,
      body: this.body,
      joints: copyJoints(this.joints),
      bounds: { ...this.bounds },
    };
  }

  restore(snapshot) {
    this.canvas.width = snapshot.width;
    this.canvas.height = snapshot.height;
    this.pose = snapshot.pose;
    this.rotation = snapshot.rotation;
    this.body = normalizeBody(snapshot.body);
    this.joints = copyJoints(snapshot.joints);
    this.bounds = { ...snapshot.bounds };
    this.alpha = snapshot.alpha.slice();
    this.rgb = snapshot.rgb.slice();
    this.coats = snapshot.coats.slice();
    this.strokeMark = new Uint8Array(this.alpha.length);
    this.image = this.ctx.createImageData(snapshot.width, snapshot.height);
    this.brush = null;
    this.lighting = figureLighting(this);
    this.render();
  }

  setJoints(nextJoints, source = this.snapshot()) {
    const bounds = getFigureBounds(this.pose, this.rotation, nextJoints, this.body);
    const width = bounds.w * FIG_SCALE, height = bounds.h * FIG_SCALE;
    const mask = silhouette(this.pose, this.rotation, nextJoints, bounds, this.body);
    const alpha = new Uint8ClampedArray(width * height);
    const rgb = new Uint8ClampedArray(width * height * 3).fill(255);
    const coats = new Uint16Array(width * height);
    const maps = nextJoints.map((limb, index) => segments(limb).map((segment, bone) =>
      segmentMap(segment, segments(source.joints[index])[bone]),
    ));
    const rad = this.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const oldRad = source.rotation * Math.PI / 180;
    const oldCos = Math.cos(oldRad), oldSin = Math.sin(oldRad);
    const torso = bodyTorso(this.pose, this.body);
    const oldTorso = bodyTorso(source.pose, source.body);
    const shoulders = nextJoints.slice(0, 2).map((limb, index) => shoulderBridge(this.pose, this.body, limb, index ? 1 : -1));
    const oldShoulders = source.joints.slice(0, 2).map((limb, index) => shoulderBridge(source.pose, source.body, limb, index ? 1 : -1));
    const head = bodyHead(this.pose);
    const oldHead = bodyHead(source.pose);
    const oldPose = POSES[source.pose];
    const poseChanged = this.pose !== source.pose;
    const [neckX1, neckY1, neckX2, neckY2, neckThickness] = POSES[this.pose].limbs[0];
    const neckDx = neckX2 - neckX1, neckDy = neckY2 - neckY1;
    const neckLength2 = neckDx * neckDx + neckDy * neckDy;
    const [oldNeckX1, oldNeckY1, oldNeckX2, oldNeckY2, oldNeckThickness] = oldPose.limbs[0];
    const neckMap = segmentMap(
      { start: { x: neckX1, y: neckY1 }, end: { x: neckX2, y: neckY2 }, thickness: neckThickness },
      { start: { x: oldNeckX1, y: oldNeckY1 }, end: { x: oldNeckX2, y: oldNeckY2 }, thickness: oldNeckThickness },
    );
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        alpha[i] = mask[i * 4 + 3];
        if (!alpha[i]) continue;
        const wx = (x + 0.5) / FIG_SCALE + bounds.x;
        const wy = (y + 0.5) / FIG_SCALE + bounds.y;
        const px = (wx * cos + wy * sin) / RATIO + CENTER.x;
        const py = (-wx * sin + wy * cos) / RATIO + CENTER.y;
        let oldX = px, oldY = py;
        const inHead = ((px - head.cx) / head.rx) ** 2 + ((py - head.cy) / head.ry) ** 2 <= 1;
        const neckT = clamp(((px - neckX1) * neckDx + (py - neckY1) * neckDy) / neckLength2, 0, 1);
        const inNeck = (px - neckX1 - neckT * neckDx) ** 2
          + (py - neckY1 - neckT * neckDy) ** 2 <= (neckThickness / 2) ** 2;
        if (poseChanged) {
          // 移動中の仮のポーズには、元の頭・胴・首それぞれの塗りを写す。
          oldX = oldHead.cx + (px - head.cx) * oldHead.rx / head.rx;
          oldY = oldHead.cy + (py - head.cy) * oldHead.ry / head.ry;
          if (!inHead && py >= torso.y && py <= torso.y + torso.h
            && Math.abs(px - torso.x - torso.w / 2) <= torsoHalfWidth(torso, py)) {
            oldY = oldTorso.y + (py - torso.y) / torso.h * oldTorso.h;
            const inset = torsoInset(torso, py), oldInset = torsoInset(oldTorso, oldY);
            oldX = oldTorso.x + oldInset + (px - torso.x - inset)
              * (oldTorso.w - oldInset * 2) / Math.max(0.001, torso.w - inset * 2);
          }
          const dx = px - neckX1, dy = py - neckY1;
          const t = (dx * neckDx + dy * neckDy) / neckLength2;
          if (!inHead && (dx - clamp(t, 0, 1) * neckDx) ** 2
            + (dy - clamp(t, 0, 1) * neckDy) ** 2 <= (neckThickness / 2 + 0.625) ** 2) {
            const scale = oldNeckThickness / neckThickness;
            const across = (-dx * neckDy + dy * neckDx) / neckMap.length * scale;
            const oldT = t < 0 ? t * neckMap.length / neckMap.oldLength * scale
              : t > 1 ? 1 + (t - 1) * neckMap.length / neckMap.oldLength * scale : t;
            oldX = oldNeckX1 + oldT * neckMap.oldDx - across * neckMap.oldDy / neckMap.oldLength;
            oldY = oldNeckY1 + oldT * neckMap.oldDy + across * neckMap.oldDx / neckMap.oldLength;
          }
        }
        if (!inHead && !inNeck && (poseChanged || torso.w !== oldTorso.w)) {
          const index = px < torso.x + torso.w / 2 ? 0 : 1;
          const bridge = shoulders[index], oldBridge = oldShoulders[index];
          const edge = shoulderEdge(bridge, py);
          if (edge !== null && Math.abs(px - bridge.center) <= Math.abs(edge - bridge.center)) {
            oldY = oldBridge.top + (py - bridge.top) / (bridge.rootY - bridge.top) * (oldBridge.rootY - oldBridge.top);
            const oldEdge = shoulderEdge(oldBridge, oldY);
            oldX = oldBridge.center + (px - bridge.center) * (oldEdge - oldBridge.center) / (edge - bridge.center);
          }
        }
        if (this.pose === "banzai" && source.pose === "banzai" && !inHead && !inNeck) {
          const index = px < head.cx ? 0 : 1;
          const limb = nextJoints[index], oldLimb = source.joints[index];
          if (py >= head.cy && py <= limb.root.y) {
            const side = index === 0 ? -1 : 1;
            const t = (py - head.cy) / (limb.root.y - head.cy);
            const edge = head.cx + side * head.r * (1 - t) + (limb.root.x - head.cx) * t;
            if ((px - head.cx) * side <= (edge - head.cx) * side) {
              const oldEdge = head.cx + side * head.r * (1 - t) + (oldLimb.root.x - head.cx) * t;
              oldX = head.cx + (px - head.cx) * (oldEdge - head.cx) / (edge - head.cx);
            }
          }
        }
        if (!poseChanged && !inHead && torso.w !== oldTorso.w
          && Math.abs(px - torso.x - torso.w / 2) <= torsoHalfWidth(torso, py)
          && py >= torso.y && py <= torso.y + torso.h) {
          // 胴だけを横に伸縮。頭と、胴より手前に描く首の塗りは動かさない。
          if (!inNeck) {
            // 輪郭の行ごとの幅で写し、細めにした肩や腰にも塗りを引き継ぐ。
            const inset = torsoInset(torso, py), oldInset = torsoInset(oldTorso, py);
            oldX = oldTorso.x + oldInset + (px - torso.x - inset)
              * (oldTorso.w - oldInset * 2) / Math.max(0.001, torso.w - inset * 2);
          }
        }
        // 描画順の手前から調べる。胴体などは同じポーズ座標から取得する。
        for (let limb = maps.length - 1; limb >= 0; limb--) {
          let nearest = null;
          for (const bone of maps[limb]) {
            const hit = boneSample(bone, px, py, 0.625);
            if (hit.depth2 >= 0 && (!nearest || hit.distance2 < nearest.distance2)) {
              nearest = { bone, ...hit, across: (-(px - bone.start.x) * bone.dy
                + (py - bone.start.y) * bone.dx) / bone.length };
            }
          }
          if (nearest) {
            const { bone, t, across, cap } = nearest;
            const thicknessScale = bone.old.thickness / bone.thickness;
            let oldT = t;
            // 丸い端の余白も太さに合わせ、太めへ変更しても白い縁を残さない。
            if (thicknessScale !== 1 || poseChanged) {
              if (cap !== null) oldT = cap + (t - cap) * bone.length / bone.oldLength * thicknessScale;
            }
            const oldAcross = across * thicknessScale;
            oldX = bone.old.start.x + oldT * bone.oldDx - oldAcross * bone.oldDy / bone.oldLength;
            oldY = bone.old.start.y + oldT * bone.oldDy + oldAcross * bone.oldDx / bone.oldLength;
            break;
          }
        }
        const dx = (oldX - CENTER.x) * RATIO, dy = (oldY - CENTER.y) * RATIO;
        const sx = Math.round((dx * oldCos - dy * oldSin - source.bounds.x) * FIG_SCALE - 0.5);
        const sy = Math.round((dx * oldSin + dy * oldCos - source.bounds.y) * FIG_SCALE - 0.5);
        let sample = -1, bestDistance = Infinity;
        // アンチエイリアス境界の丸め誤差だけを近傍の有効な画素で補う。
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const xx = sx + ox, yy = sy + oy;
            if (xx < 0 || yy < 0 || xx >= source.width || yy >= source.height) continue;
            const j = yy * source.width + xx;
            const distance2 = ox * ox + oy * oy;
            if (source.alpha[j] && distance2 < bestDistance) {
              sample = j;
              bestDistance = distance2;
            }
          }
        }
        if (sample >= 0) {
          rgb[i * 3] = source.rgb[sample * 3];
          rgb[i * 3 + 1] = source.rgb[sample * 3 + 1];
          rgb[i * 3 + 2] = source.rgb[sample * 3 + 2];
          coats[i] = source.coats[sample];
        }
      }
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.joints = copyJoints(nextJoints);
    this.bounds = bounds;
    this.alpha = alpha;
    this.rgb = rgb;
    this.coats = coats;
    this.strokeMark = new Uint8Array(alpha.length);
    this.image = this.ctx.createImageData(width, height);
    this.brush = null;
    this.lighting = figureLighting(this);
    this.render();
  }
}

// 背中のつまみから、前へ落ちる肩と丸い腰へ続く移動中専用の輪郭。
const HANGING_GRIP = { x: 56, y: 18 };
const HANGING_HEAD = { cx: 26, cy: 43, rx: 17, ry: 19, angle: 0.35 };
const HANGING_TORSO = [
  [18, 56, 0], [22, 55, 2.5], [35, 48, 10], [49, 49, 15],
  [65, 56, 15], [82, 63, 13], [89, 64, 10], [96, 64, 0],
];

function hangingSection(y, body) {
  const scale = BODY_TYPES[normalizeBody(body)].widthScale;
  const row = clamp(y, HANGING_TORSO[0][0], HANGING_TORSO.at(-1)[0]);
  for (let i = 1; i < HANGING_TORSO.length; i++) {
    const [end, x2, w2] = HANGING_TORSO[i];
    const [start, x1, w1] = HANGING_TORSO[i - 1];
    if (row <= end) {
      const before = HANGING_TORSO[Math.max(0, i - 2)];
      const after = HANGING_TORSO[Math.min(HANGING_TORSO.length - 1, i + 1)];
      const t = (row - start) / (end - start);
      // 各区間の傾きもつなぎ、背中や腹に段々の陰影が出ないようにする。
      const curve = (a, b, axis) => {
        const m1 = (b - before[axis]) / (end - before[0]) * (end - start);
        const m2 = (after[axis] - a) / (after[0] - start) * (end - start);
        return (2 * t ** 3 - 3 * t ** 2 + 1) * a + (t ** 3 - 2 * t ** 2 + t) * m1
          + (-2 * t ** 3 + 3 * t ** 2) * b + (t ** 3 - t ** 2) * m2;
      };
      return { center: curve(x1, x2, 1), half: Math.max(0, curve(w1, w2, 2)) * scale };
    }
  }
}

// 元のポーズ・塗り・履歴には触らず、移動表示にだけ前傾した人型を描く。
export function createHangingPreview(painter, { animated = false } = {}) {
  const source = painter.snapshot();
  // 各ポーズの塗りを一度同じ部位配置に揃え、移動中の頭・胴・四肢へ写す。
  const original = new JointPainter(document.createElement("canvas"), "stand", 0, source.body);
  original.setJoints(original.joints, source);
  const oldHead = bodyHead("stand"), oldTorso = bodyTorso("stand", source.body);
  const bodyScale = BODY_TYPES[source.body].widthScale;
  const armSpread = 2.5 * BODY_TYPES[source.body].limbScale;
  const hipSpread = 7 * bodyScale;
  const points = [
    [[41 - 3 * (bodyScale - 1), 53], [34 - armSpread, 109]],
    [[53 + 3 * (bodyScale - 1), 56], [50 + armSpread, 116]],
    [[64 - hipSpread, 83], [69 - hipSpread, 151]],
    [[64 + hipSpread, 83], [80 + hipSpread, 145]],
  ];
  const joints = original.joints.map((limb, index) => {
    const [root, end] = points[index].map(([x, y]) => ({ x, y }));
    // 移動中だけひじ・ひざを一直線に伸ばし、肩・股から手足全体を振る。
    const hangingLimb = { ...limb, root, end,
      bend: { x: (root.x + end.x) / 2, y: (root.y + end.y) / 2 } };
    return shortenLimb(hangingLimb, index < 2 ? ARM_LENGTH_SCALE : LEG_LENGTH_SCALE);
  });
  const maps = joints.map((limb, index) => segments(limb).map((bone, part) =>
    segmentMap(bone, segments(original.joints[index])[part])));
  const head = HANGING_HEAD;
  const cos = Math.cos(head.angle), sin = Math.sin(head.angle);
  const extentX = Math.hypot(head.rx * cos, head.ry * sin);
  const extentY = Math.hypot(head.rx * sin, head.ry * cos);
  let left = head.cx - extentX, right = head.cx + extentX;
  let top = Math.min(HANGING_GRIP.y, head.cy - extentY), bottom = head.cy + extentY;
  for (let y = 18; y <= 96; y++) {
    const row = hangingSection(y, source.body);
    left = Math.min(left, row.center - row.half);
    right = Math.max(right, row.center + row.half);
    bottom = Math.max(bottom, y);
  }
  for (const bone of maps.flat()) {
    for (const point of [bone.start, bone.end]) {
      left = Math.min(left, point.x - bone.thickness / 2);
      right = Math.max(right, point.x + bone.thickness / 2);
      top = Math.min(top, point.y - bone.thickness / 2);
      bottom = Math.max(bottom, point.y + bone.thickness / 2);
    }
  }
  // 肩・股を支点に手足を大きく素早く振る。振れ幅の分もページ端の判定に含める。
  const motion = joints.map((limb, index) => ({
    angle: [20, 18, 14, 16][index],
    duration: [240, 270, 310, 340][index],
    delay: [0, -135, -95, -255][index],
  }));
  const padding = animated ? 2 + Math.ceil(Math.max(...joints.map((limb, index) =>
    Math.max(distance(limb.root, limb.bend), distance(limb.root, limb.end))
      * 2 * Math.sin(motion[index].angle * Math.PI / 360) * RATIO))) : 2;
  const x = Math.floor((left - CENTER.x) * RATIO) - padding;
  const y = Math.floor((top - CENTER.y) * RATIO) - padding;
  const bounds = { x, y,
    w: Math.ceil((right - CENTER.x) * RATIO) + padding - x,
    h: Math.ceil((bottom - CENTER.y) * RATIO) + padding - y };
  const renderLayer = (includeBody, maps, sharedLighting = null) => {
    const canvas = document.createElement("canvas");
    canvas.width = bounds.w * FIG_SCALE;
    canvas.height = bounds.h * FIG_SCALE;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(FIG_SCALE, FIG_SCALE);
    ctx.translate(-bounds.x, -bounds.y);
    ctx.scale(RATIO, RATIO);
    ctx.translate(-CENTER.x, -CENTER.y);
    ctx.fillStyle = "#fff";
    if (includeBody) {
      ctx.beginPath();
      for (const side of [-1, 1]) {
        for (let step = 0; step <= 156; step++) {
          const rowY = 18 + (side === -1 ? step : 156 - step) / 2;
          const row = hangingSection(rowY, source.body);
          if (side === -1 && !step) ctx.moveTo(row.center, rowY);
          else ctx.lineTo(row.center + side * row.half, rowY);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(head.cx, head.cy, head.rx, head.ry, head.angle, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const bone of maps.flat()) fillBone(ctx, bone);
    ctx.restore();

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
    const paint = new Uint8ClampedArray(alpha.length * 3).fill(255);
    const surface = sharedLighting ? null : new Float32Array(alpha.length);
    const softness = sharedLighting ? null : new Float32Array(alpha.length);
    const scale = RATIO * FIG_SCALE;
    for (let py = 0; py < canvas.height; py++) {
      const wy = ((py + 0.5) / FIG_SCALE + bounds.y) / RATIO + CENTER.y;
      const row = hangingSection(wy, source.body);
      const torsoY = oldTorso.y + clamp((wy - 35) / 61, 0, 0.99) * oldTorso.h;
      const torsoWidth = torsoHalfWidth(oldTorso, torsoY);
      for (let px = 0; px < canvas.width; px++) {
        const i = py * canvas.width + px;
        alpha[i] = image.data[i * 4 + 3];
        if (!alpha[i]) continue;
        const wx = ((px + 0.5) / FIG_SCALE + bounds.x) / RATIO + CENTER.x;
        const across = clamp((wx - row.center) / Math.max(0.01, row.half), -0.98, 0.98);
        let oldY = torsoY;
        let oldX = oldTorso.x + oldTorso.w / 2 + across * torsoWidth;
        if (wy < 35) {
          oldX = 36 + across * 3.5;
          oldY = 26 + clamp((wy - 18) / 17, 0, 1) * 5;
        }
        let depth2 = includeBody && wy >= 18 && wy <= 96
          ? Math.max(0, row.half ** 2 - (wx - row.center) ** 2) * 0.64 : 0;
        const hx = (wx - head.cx) * cos + (wy - head.cy) * sin;
        const hy = -(wx - head.cx) * sin + (wy - head.cy) * cos;
        const headDistance = (hx / head.rx) ** 2 + (hy / head.ry) ** 2;
        if (includeBody && headDistance <= 1.08) {
          oldX = oldHead.cx + hx / head.rx * oldHead.rx;
          oldY = oldHead.cy + hy / head.ry * oldHead.ry;
        }
        // 手足は元と同じ前後関係で重ね、塗りも対応する骨へ戻して取得する。
        for (let limb = 0; limb < maps.length; limb++) {
          let nearest = null;
          for (const bone of maps[limb]) {
            const hit = boneSample(bone, wx, wy, 0.625);
            if (!sharedLighting) depth2 = joinSurface(depth2, boneSample(bone, wx, wy).depth2, bone, wx, wy);
            if (hit.depth2 >= 0 && (!nearest || hit.distance2 < nearest.distance2)) nearest = { bone, ...hit };
          }
          if (nearest) {
            const { bone, t, cap } = nearest;
            const ratio = bone.old.thickness / bone.thickness;
            const oldT = cap === null ? t : cap + (t - cap) * bone.length / bone.oldLength * ratio;
            const side = (-(wx - bone.start.x) * bone.dy + (wy - bone.start.y) * bone.dx) / bone.length * ratio;
            oldX = bone.old.start.x + oldT * bone.oldDx - side * bone.oldDy / bone.oldLength;
            oldY = bone.old.start.y + oldT * bone.oldDy + side * bone.oldDx / bone.oldLength;
          }
        }
        const at = toFigurePoint({ x: oldX, y: oldY }, 0, original.bounds);
        const sx = Math.round(at.x * FIG_SCALE - 0.5), sy = Math.round(at.y * FIG_SCALE - 0.5);
        let sample = sy * original.canvas.width + sx;
        if (sx < 0 || sy < 0 || sx >= original.canvas.width || sy >= original.canvas.height || !original.alpha[sample]) {
          sample = -1;
          let closest = Infinity;
          for (let radius = 1; radius <= 6 && closest > radius * radius; radius++) {
            for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
              if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
              const xx = sx + ox, yy = sy + oy;
              if (xx < 0 || yy < 0 || xx >= original.canvas.width || yy >= original.canvas.height) continue;
              const index = yy * original.canvas.width + xx;
              const delta = ox * ox + oy * oy;
              if (original.alpha[index] && delta < closest) { sample = index; closest = delta; }
            }
          }
        }
        if (sample >= 0) {
          for (let channel = 0; channel < 3; channel++) paint[i * 3 + channel] = original.rgb[sample * 3 + channel];
        }
        if (!sharedLighting) {
          if (includeBody) depth2 = Math.max(depth2, head.rx ** 2 * Math.max(0, 1 - headDistance));
          surface[i] = Math.sqrt(Math.max(0, depth2)) * scale;
          softness[i] = headDistance > 1.08 ? jointSoftness(joints, wx, wy) : 0;
        }
      }
    }
    const lighting = sharedLighting ?? surfaceLighting(surface, alpha, canvas.width, canvas.height, softness);
    const { shade, shine } = lighting;
    for (let i = 0; i < alpha.length; i++) {
      for (let channel = 0; channel < 3; channel++) {
        const base = paint[i * 3 + channel] * shade[i];
        image.data[i * 4 + channel] = base + (255 - base) * shine[i];
      }
    }
    ctx.putImageData(image, 0, 0);
    return { canvas, lighting };
  };
  const grip = toFigurePoint(HANGING_GRIP, 0, bounds);
  const combined = renderLayer(true, maps);
  if (!animated) return { canvas: combined.canvas, bounds, grip };

  // 全身で作った陰影を共有し、胴の切り口や手足の根元に別々の縁を描かない。
  // 塗りと透明部分は各レイヤーに残し、ドラッグ中の動きはCSSに任せる。
  const layers = [
    ...maps.map((bones, index) => ({
      canvas: renderLayer(false, [bones], combined.lighting).canvas,
      origin: toFigurePoint(joints[index].root, 0, bounds),
      ...motion[index],
    })),
    // 付け根を胴の下に重ねて、動かしても肩・股が別の部品に見えないようにする。
    { canvas: renderLayer(true, [], combined.lighting).canvas },
  ];
  const canvas = document.createElement("canvas");
  canvas.width = bounds.w * FIG_SCALE;
  canvas.height = bounds.h * FIG_SCALE;
  const ctx = canvas.getContext("2d");
  for (const layer of layers) ctx.drawImage(layer.canvas, 0, 0);
  return { canvas, bounds, grip, layers };
}
