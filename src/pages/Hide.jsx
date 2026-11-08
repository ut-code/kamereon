import { useEffect, useRef, useState } from "react";
import SiteStage from "../components/SiteStage.jsx";
import Icon from "../components/Icon.jsx";
import { POSES, ROTATE_STEP } from "../figure.js";
import { hexToRgb } from "../painter.js";
import {
  BODY_TYPES, JointPainter, createJoints, createHangingPreview, moveJoint, getFigureBounds,
  toFigurePoint, fromFigurePoint,
} from "./hideJoints.js";
import { api } from "../api.js";
import { addMyId } from "../myChameleons.js";
import { Check, FigureIcon, Modal, Range, Sticker, Tab, Timer, tiltStyle } from "../components/ui.jsx";
import "./Hide.css";

const TOOLS = [
  {
    key: "move",
    label: "移動",
    hint: "ドラッグで移動（矢印キーで1pxずつ）",
  },
  {
    key: "pen",
    label: "塗る",
    hint: "クリックやドラッグでパシャッと塗れます。矢印キーで位置も調整できます",
  },
  { key: "eraser", label: "消しゴム", hint: "白に戻します" },
  { key: "joints", label: "ポーズ・角度", hint: "関節をドラッグで調整し、全体の角度も変更" },
];

// 手足の可動域を収めつつ、カメレオンと周囲の背景に寄った表示にする。
const JOINT_VIEW_SIZE = 160;
const HIDE_TIME_LIMIT_SEC = 5 * 60;
const formatTime = (seconds) => {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const figureBounds = (f) => getFigureBounds(f.pose, f.rotation, f.joints, f.body);
const jointLabel = (index, handle) =>
  handle === "bend" ? (index < 2 ? "ひじ" : "ひざ") : (index < 2 ? "手首" : "足首");

function BodyPreview({ body }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const painter = new JointPainter(canvas, "stand", 0, body);
    painter.fillAll("#2A1650");
  }, [body]);

  return <canvas ref={canvasRef} className="hide-body-preview" aria-hidden="true" />;
}

const COLOR_SWATCHES = [
  ["白", "#ffffff"], ["黒", "#20252b"], ["赤", "#df6270"], ["黄", "#e8c45a"],
  ["緑", "#57a76c"], ["水色", "#76b8ab"], ["青", "#5a8ed8"], ["紫", "#a085c9"],
];

const PALETTE_COLORS = [
  ...Array.from({ length: 24 }, (_, index) => {
    const channel = Math.round(255 - index * 255 / 23).toString(16).padStart(2, "0");
    return `#${channel.repeat(3)}`;
  }),
  ...[
    { s: 0.2, v: 1 }, { s: 0.4, v: 1 }, { s: 0.6, v: 1 },
    { s: 0.8, v: 1 }, { s: 1, v: 1 }, { s: 1, v: 0.8 },
    { s: 1, v: 0.6 }, { s: 1, v: 0.4 }, { s: 1, v: 0.25 }, { s: 1, v: 0.12 },
  ].flatMap((tone) => Array.from({ length: 24 }, (_, index) =>
    hsvToColor({ h: index * 15, ...tone }))),
];

function colorToHsv(color) {
  const [r, g, b] = hexToRgb(color).map((value) => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 0 : max === r ? (g - b) / delta
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

function hsvToColor({ h, s, v }) {
  const channel = (offset) => {
    const k = (offset + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16).padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

function InlineColorPicker({ color, onChange, children }) {
  const [mode, setMode] = useState("free");
  const [hsv, setHsv] = useState(() => colorToHsv(color));
  const [hexDraft, setHexDraft] = useState(color);
  const emittedColor = useRef(color);

  useEffect(() => {
    setHexDraft(color);
    if (color === emittedColor.current) return;
    const next = colorToHsv(color);
    // 灰色・黒を選んでも、次に鮮やかさや明るさを上げるための色相を覚えておく。
    setHsv((previous) => ({
      h: next.s ? next.h : previous.h,
      s: next.v ? next.s : previous.s,
      v: next.v,
    }));
    emittedColor.current = color;
  }, [color]);

  const update = (next) => {
    const value = hsvToColor(next);
    emittedColor.current = value;
    setHsv(next);
    setHexDraft(value);
    onChange(value);
  };
  const pickAt = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    update({ ...hsv,
      s: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      v: 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    });
  };
  const release = (e) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const commitHex = () => {
    const match = hexDraft.trim().match(/^#?([\da-f]{6}|[\da-f]{3})$/i);
    if (!match) { setHexDraft(color); return; }
    const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
    const value = `#${hex.toLowerCase()}`;
    setHexDraft(value);
    onChange(value);
  };

  return (
    <section className="hide-color-picker" aria-label="色を選ぶ">
      <div className="hide-color-picker-header">
        <h3>色を選ぶ</h3>
        <div className="hide-color-mode-switch" role="group" aria-label="色の選び方">
          <Tab pressed={mode === "free"} color="accent" onClick={() => setMode("free")}>自由に選ぶ</Tab>
          <Tab pressed={mode === "palette"} color="accent" onClick={() => setMode("palette")}>パレットから選ぶ</Tab>
        </div>
      </div>
      <div className="hide-color-mode-panels">
      <div className={`hide-color-picker-body hide-color-mode-panel${mode === "free" ? "" : " is-inactive"}`}
        aria-hidden={mode !== "free"}>
        <div
          className="hide-color-spectrum"
          role="group"
          tabIndex={0}
          aria-label={`鮮やかさ ${Math.round(hsv.s * 100)}%、明るさ ${Math.round(hsv.v * 100)}%。左右キーで鮮やかさ、上下キーで明るさを調整`}
          style={{ "--picker-hue": hsv.h }}
          onPointerDown={(e) => {
            if (e.button !== 0 || e.isPrimary === false) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            pickAt(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onKeyDown={(e) => {
            const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0],
              ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
            if (!direction) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 0.1 : 0.01;
            update({ ...hsv, s: Math.max(0, Math.min(1, hsv.s + direction[0] * step)),
              v: Math.max(0, Math.min(1, hsv.v + direction[1] * step)) });
          }}
        >
          <span className="hide-color-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
        <div className="hide-color-settings">
          <label className="hide-color-hex">
            <span className="hide-color-preview" style={{ background: color }} aria-hidden="true" />
            <span>色コード</span>
            <input
              type="text"
              className="b-input"
              aria-label="色コード"
              value={hexDraft}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                const value = e.target.value;
                setHexDraft(value);
                if (/^#?[\da-f]{6}$/i.test(value)) onChange(`#${value.replace(/^#/, "").toLowerCase()}`);
              }}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitHex(); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setHexDraft(color); }
              }}
            />
          </label>
          <label className="hide-color-hue">
            <span>色相</span>
            <input type="range" min="0" max="360" value={hsv.h}
              onChange={(e) => update({ ...hsv, h: Number(e.target.value) })} />
          </label>
          <div className="hide-color-swatches" role="group" aria-label="基本の色">
            {COLOR_SWATCHES.map(([name, value]) => (
              <button key={value} type="button" aria-label={name}
                aria-pressed={color.toLowerCase() === value} title={`${name} ${value}`}
                style={{ background: value }} onClick={() => onChange(value)} />
            ))}
          </div>
        </div>
      </div>
      <div className={`hide-color-palette hide-color-mode-panel${mode === "palette" ? "" : " is-inactive"}`}
        aria-hidden={mode !== "palette"}>
        <p className="hide-color-selection">
          <span className="hide-color-preview" style={{ background: color }} aria-hidden="true" />
          選択中 <span>{color}</span>
        </p>
        <div className="hide-color-swatches hide-color-presets" role="group" aria-label="パレットの色">
          {PALETTE_COLORS.map((value) => (
            <button key={value} type="button" aria-label={value}
              aria-pressed={color.toLowerCase() === value} title={value}
              style={{ background: value }} onClick={() => onChange(value)} />
          ))}
        </div>
      </div>
      </div>
      <div className="hide-color-actions">{children}</div>
    </section>
  );
}

const AUTO_SCROLL_EDGE = 24; // 見えている範囲の上端・下端からこの距離（画面上の px）に入ったら自動スクロール
const MAX_DECOYS = 3;
const AUTO_SCROLL_MAX = 20; // 1フレームあたりの最大スクロール量 (px)
const SHAKE_DISTANCE = 36; // 画面上の px。小さな手ぶれや表示倍率に左右されない。
const SHAKE_TURN_WINDOW = 700;
const SHAKE_TURNS_TO_CALM = 4;
const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

const MAIN = "main";
const figLabel = (f, figs) =>
  f.decoy ? `デコイ${figs.filter((g) => g.decoy).indexOf(f) + 1}` : "本体";

// 一方向への移動は数えず、十分な幅で素早く折り返した回数を数える。
function trackShake(shake, point) {
  for (const axis of ["X", "Y"]) {
    const motion = shake[axis];
    const value = point[`client${axis}`];
    const delta = value - motion.extreme;
    if (!motion.direction) {
      if (Math.abs(delta) >= SHAKE_DISTANCE) {
        motion.direction = Math.sign(delta);
        motion.extreme = value;
        motion.at = point.timeStamp;
      }
    } else if (delta * motion.direction > 0) {
      motion.extreme = value;
    } else if (delta * motion.direction <= -SHAKE_DISTANCE) {
      motion.turns = point.timeStamp - motion.at <= SHAKE_TURN_WINDOW ? motion.turns + 1 : 0;
      motion.direction *= -1;
      motion.extreme = value;
      motion.at = point.timeStamp;
      if (motion.turns >= SHAKE_TURNS_TO_CALM) return true;
    }
  }
  return false;
}

export default function Hide({ siteId }) {
  const stageRef = useRef(null);
  const timerRef = useRef(null);
  const canvasRefs = useRef({});
  const painters = useRef({});
  const dragRef = useRef(null);
  const nextKey = useRef(1);
  const paintDialogRef = useRef(null);
  const paintDialogDragRef = useRef(null);
  const paintDialogPositionRef = useRef(null);
  const paintCanvasRef = useRef(null);
  const paintSurfaceRef = useRef(null);
  const paintBackgroundRef = useRef(null);
  const colorPickerRef = useRef(null);
  const jointEditorRef = useRef(null);
  const activeRef = useRef(null);
  const syncPaintLayoutRef = useRef(null);
  const nextSplash = useRef(1);
  const deadlineRef = useRef(0);
  const saveLockRef = useRef(false);
  const initialBody = useRef(new URLSearchParams(window.location.hash.split("?")[1]).get("body"));

  // 本体とデコイ。{ key, decoy, x, y, body, pose, rotation, joints }
  const [figs, setFigs] = useState([]);
  const [activeKey, setActiveKey] = useState(MAIN);
  const [tool, setTool] = useState("move");
  const [color, setColor] = useState("#9aa8b8");
  const [size, setSize] = useState(6);
  const [splashes, setSplashes] = useState([]);
  const [carried, setCarried] = useState(null);
  const [outline, setOutline] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showPaint, setShowPaint] = useState(false);
  const [paintBackgroundReady, setPaintBackgroundReady] = useState(false);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [timeUp, setTimeUp] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const active = figs.find((f) => f.key === activeKey);
  const decoyCount = figs.filter((f) => f.decoy).length;
  activeRef.current = active;
  const paintSize = active ? figureBounds(active) : getFigureBounds("stand", 0);
  const editingJoints = tool === "joints";
  const remaining = deadline ? Math.max(0, (deadline - (savedAt ?? now)) / 1000) : HIDE_TIME_LIMIT_SEC;
  const editingLocked = timeUp || saving || Boolean(savedId);
  // 表示更新や背景タブのタイマーが遅れても、締切後の編集を受け付けない。
  const canEdit = () => deadlineRef.current > 0 && !saveLockRef.current
    && Date.now() < deadlineRef.current;

  useEffect(() => {
    if (!deadline || savedId || timeUp) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 250);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline, savedId, timeUp]);

  // 拡大表示だけを別 canvas に写し、塗りと履歴は元の Painter に保持する。
  const syncPaintCanvas = () => {
    const source = canvasRefs.current[activeKey];
    const preview = paintCanvasRef.current;
    if (!source || !preview) return;
    if (preview.width !== source.width) preview.width = source.width;
    if (preview.height !== source.height) preview.height = source.height;
    const ctx = preview.getContext("2d");
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.drawImage(source, 0, 0);
  };

  const editPaint = (action, ...args) => {
    if (!canEdit()) return;
    const painter = painters.current[activeKey];
    if (!painter || !active) return;
    onPointerUp();
    setSplashes([]);
    const before = figureBounds(active);
    painter[action](...args);
    if (action === "undo" || action === "redo") {
      updateFig(activeKey, {
        pose: painter.pose,
        rotation: painter.rotation,
        body: painter.body,
        joints: painter.joints,
        ...clampPos({
          x: active.x + painter.bounds.x - before.x,
          y: active.y + painter.bounds.y - before.y,
        }, painter.bounds),
      });
    }
    syncPaintCanvas();
  };

  const resetColor = () => {
    if (!active || !canEdit()) return;
    onPointerUp();
    setSplashes([]);
    const painter = painters.current[active.key];
    if (!painter?.painted) return;
    painter.pushUndo();
    // 白を重ね塗りせず、塗り回数も消して初期の白に戻す。
    painter.rgb.fill(255);
    painter.coats.fill(0);
    painter.strokeMark.fill(0);
    painter.render();
    syncPaintCanvas();
  };

  const selectTool = (nextTool) => {
    if (!canEdit()) return;
    if (nextTool !== "move" && !active) return;
    onPointerUp();
    setSplashes([]);
    setTool(nextTool);
    if (nextTool !== "move") {
      setPaintBackgroundReady(false);
      setShowPaint(true);
    }
  };

  const closePaint = () => {
    if (colorPickerRef.current) {
      colorPickerRef.current.abort();
      return;
    }
    endPaintDialogDrag();
    onPointerUp();
    setSplashes([]);
    paintDialogRef.current?.close();
    setShowPaint(false);
    setTool("move");
  };

  const paintDialogTop = (x, width, top) => {
    const timer = timerRef.current?.getBoundingClientRect();
    // タイマーと横位置が重なる場合は、その直下までを編集画面の上限にする。
    return timer && x < timer.right + 6 && x + width > timer.left - 6
      ? Math.max(top, timer.bottom + 6) : top;
  };

  const placePaintDialog = (position = paintDialogPositionRef.current) => {
    const dialog = paintDialogRef.current;
    if (!dialog || !position) return;
    const viewport = window.visualViewport;
    const margin = 12;
    const left = (viewport?.offsetLeft ?? 0) + margin;
    const top = (viewport?.offsetTop ?? 0) + margin;
    const width = Math.max(1, (viewport?.width ?? window.innerWidth) - margin * 2);
    const height = Math.max(1, (viewport?.height ?? window.innerHeight) - margin * 2);
    const panelWidth = Math.min(position.width, width);
    const x = Math.max(left, Math.min(position.x, left + width - panelWidth));
    const safeTop = Math.min(top + height - 1, paintDialogTop(x, panelWidth, top));
    const availableHeight = top + height - safeTop;
    const y = Math.max(safeTop, Math.min(position.y,
      top + height - Math.min(560, availableHeight)));
    const panelHeight = top + height - y;
    dialog.style.width = `${panelWidth}px`;
    dialog.style.height = `${panelHeight}px`;
    dialog.style.maxHeight = `${availableHeight}px`;
    dialog.style.left = `${Math.round(x)}px`;
    dialog.style.top = `${Math.round(y)}px`;
    return { ...position, x, y };
  };

  const endPaintDialogDrag = (e) => {
    const drag = paintDialogDragRef.current;
    if (!drag || (e?.pointerId != null && e.pointerId !== drag.pointerId)) return;
    paintDialogDragRef.current = null;
    paintDialogRef.current?.classList.remove("is-panel-dragging");
    if (drag.handle.hasPointerCapture(drag.pointerId))
      drag.handle.releasePointerCapture(drag.pointerId);
    syncPaintLayoutRef.current?.();
  };

  const onPaintDialogDown = (e) => {
    if (!canEdit() || e.button !== 0 || e.isPrimary === false ||
      colorPickerRef.current || e.target.closest("button, input, select, textarea, a")) return;
    e.preventDefault();
    onPointerUp();
    const rect = paintDialogRef.current.getBoundingClientRect();
    paintDialogDragRef.current = {
      handle: e.currentTarget, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      x: rect.left, y: rect.top, width: rect.width,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    paintDialogRef.current.classList.add("is-panel-dragging");
  };

  const onPaintDialogMove = (e) => {
    if (!canEdit()) { endPaintDialogDrag(); return; }
    const drag = paintDialogDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    paintDialogPositionRef.current = placePaintDialog({
      x: drag.x + dx, y: drag.y + dy, width: drag.width,
    });
  };

  const updateFig = (key, patch) =>
    setFigs((fs) =>
      fs.map((f) =>
        f.key === key
          ? { ...f, ...(typeof patch === "function" ? patch(f) : patch) }
          : f,
      ),
    );

  const clampPos = (p, s) => {
    const { width, height } = stageRef.current.size;
    return {
      x: Math.round(Math.min(Math.max(p.x, 0), width - s.w)),
      y: Math.round(Math.min(Math.max(p.y, 0), height - s.h)),
    };
  };

  // 今見えている範囲の中心（横に少しずらせる）に新しい人型を置く
  const newFig = (key = MAIN, decoy = false, offset = 0) => {
    const c = stageRef.current.viewCenter();
    const body = active?.body ?? (Object.keys(BODY_TYPES).includes(initialBody.current)
      ? initialBody.current : "standard");
    const joints = createJoints("stand", body);
    const s = getFigureBounds("stand", 0, joints, body);
    return {
      key,
      decoy,
      body,
      pose: "stand",
      rotation: 0,
      joints,
      ...clampPos({ x: c.x - s.w / 2 + offset, y: c.y - s.h / 2 }, s),
    };
  };

  const handleReady = () => {
    if (deadlineRef.current) return;
    const started = Date.now();
    deadlineRef.current = started + HIDE_TIME_LIMIT_SEC * 1000;
    setDeadline(deadlineRef.current);
    setNow(started);
    setFigs([newFig()]);
  };

  const addDecoy = () => {
    if (!canEdit() || !figs.length || decoyCount >= MAX_DECOYS) return;
    onPointerUp();
    setSplashes([]);
    const key = `decoy-${nextKey.current++}`;
    const decoy = newFig(key, true, (decoyCount + 1) * 90);
    setFigs((fs) => [...fs, decoy]);
    setActiveKey(key);
  };

  const removeDecoy = () => {
    if (!canEdit() || !active?.decoy) return;
    onPointerUp();
    setSplashes([]);
    delete painters.current[active.key];
    delete canvasRefs.current[active.key];
    setFigs((fs) => fs.filter((f) => f.key !== active.key));
    setActiveKey(MAIN);
  };

  // canvas が表示されたら Painter を作る（再描画では作り直さない）
  const bindCanvas = (f) => (el) => {
    if (!el) return;
    canvasRefs.current[f.key] = el;
    if (!painters.current[f.key])
      painters.current[f.key] = new JointPainter(el, f.pose, f.rotation, f.body);
  };

  const changeBody = (body) => {
    if (!active || !canEdit()) return;
    onPointerUp();
    const painter = painters.current[active.key];
    const before = figureBounds(active);
    if (!painter?.setBody(body)) return;
    updateFig(active.key, {
      body: painter.body,
      joints: painter.joints,
      ...clampPos({
        x: active.x + painter.bounds.x - before.x,
        y: active.y + painter.bounds.y - before.y,
      }, painter.bounds),
    });
    setSplashes([]);
    syncPaintCanvas();
  };

  // 向きの変更（人型の中心がずれないように位置を補正する）
  const changeRotation = (nextRotation) => {
    if (!active || !canEdit() || nextRotation === active.rotation) return;
    onPointerUp();
    const painter = painters.current[active.key];
    if (!painter) return;
    const cur = figureBounds(active);
    // 回転は塗りと関節を引き継ぎ、関節編集と同じ履歴に記録する。
    const source = painter.snapshot();
    painter.pushUndo();
    painter.rotation = nextRotation;
    painter.setJoints(active.joints, source);
    const next = painter.bounds;
    updateFig(active.key, {
      rotation: nextRotation,
      joints: painter.joints,
      ...clampPos(
        {
          x: active.x + next.x - cur.x,
          y: active.y + next.y - cur.y,
        },
        next,
      ),
    });
    syncPaintCanvas();
  };

  const resetPoseAndRotation = () => {
    if (!active || !canEdit()) return;
    onPointerUp();
    setSplashes([]);
    const painter = painters.current[active.key];
    if (!painter) return;
    const joints = createJoints("stand", active.body);
    const unchanged = active.pose === "stand" && active.rotation === 0 &&
      joints.every((limb, index) => ["root", "bend", "end"].every((point) =>
        Math.hypot(limb[point].x - painter.joints[index][point].x,
          limb[point].y - painter.joints[index][point].y) < 0.001));
    if (unchanged) return;
    const source = painter.snapshot();
    const before = figureBounds(active);
    // ポーズと角度をまとめて1回の履歴にし、塗りと体型は引き継ぐ。
    painter.pushUndo();
    painter.pose = "stand";
    painter.rotation = 0;
    painter.setJoints(joints, source);
    updateFig(active.key, {
      pose: painter.pose,
      rotation: painter.rotation,
      joints: painter.joints,
      ...clampPos({
        x: active.x + painter.bounds.x - before.x,
        y: active.y + painter.bounds.y - before.y,
      }, painter.bounds),
    });
    syncPaintCanvas();
  };

  // -180 <= 角度 < 180 に正規化
  const rotate = (delta) =>
    changeRotation(
      ((((active.rotation + delta + 180) % 360) + 360) % 360) - 180 || 0,
    );

  // ---- 人型の操作（選択 / 移動 / 描画） ----
  const canvasPoint = (key, e, target) => {
    const canvas = canvasRefs.current[key];
    const rect = target.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    ];
  };

  // 首元を共通の持ち手にし、元のポーズと持ち上げた姿の両方をページ内に収める。
  const dragPos = (drag) => {
    const stage = stageRef.current;
    const p = stage.toStagePoint(drag.clientX, drag.clientY);
    const { grab, size, carry } = drag;
    const minX = Math.max(grab.x, carry.grip.x);
    const minY = Math.max(grab.y, carry.grip.y);
    const maxX = Math.min(stage.size.width - size.w + grab.x,
      stage.size.width - carry.bounds.w + carry.grip.x);
    const maxY = Math.min(stage.size.height - size.h + grab.y,
      stage.size.height - carry.bounds.h + carry.grip.y);
    return {
      x: Math.round(Math.min(Math.max(p.x, minX), maxX) - grab.x),
      y: Math.round(Math.min(Math.max(p.y, minY), maxY) - grab.y),
    };
  };

  // ドラッグ中、人型が見えている範囲の上端・下端に来たら、その方向へ自動でスクロールする
  const autoScroll = () => {
    if (!canEdit()) { onPointerUp(); return; }
    const drag = dragRef.current;
    if (!drag || drag.painting || drag.joint) return;
    const stage = stageRef.current;
    const pos = dragPos(drag);
    const carriedTop = pos.y + drag.grab.y - drag.carry.grip.y;
    const view = stage.viewRect();
    const dy = drag.clientY - drag.startY; // つかんだ時点で端にあっても、端へ向かって動かすまではスクロールしない
    const over =
      dy < 0
        ? Math.min(0, carriedTop - (view.top + AUTO_SCROLL_EDGE))
        : dy > 0
          ? Math.max(0, carriedTop + drag.carry.bounds.h - (view.bottom - AUTO_SCROLL_EDGE))
          : 0;
    if (over) {
      stage.scrollBy(
        0,
        Math.sign(over) *
          Math.min(AUTO_SCROLL_MAX, Math.ceil(Math.abs(over) / 4)),
      );
      if (stage.viewRect().top !== view.top) updateFig(drag.key, dragPos(drag));
    }
    drag.raf = requestAnimationFrame(autoScroll);
  };

  const showSplash = (key, x, y) => {
    const painter = painters.current[key];
    if (!painter.splash || !painter.brush ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = nextSplash.current++;
    // 飛沫は表示だけ。塗り跡と違い、保存する画像や背景には残さない。
    const splash = {
      id, color,
      x: x / painter.canvas.width * 100,
      y: y / painter.canvas.height * 100,
      size: painter.brush.radius * 2.8 / painter.canvas.width * 100,
    };
    setSplashes((items) => [...items.slice(-5), splash]);
  };

  const onPointerDown = (f) => (e) => {
    if (!canEdit() || e.button !== 0 || e.isPrimary === false || tool === "joints") return;
    e.preventDefault();
    if (e.currentTarget === paintCanvasRef.current)
      e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveKey(f.key);
    if (tool === "move") {
      const preview = createHangingPreview(painters.current[f.key], {
        animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      const [x1, y1, x2, y2] = POSES[f.pose].limbs[0];
      const grab = toFigurePoint({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
        f.rotation, figureBounds(f));
      const carry = { key: f.key, bounds: preview.bounds, grip: preview.grip,
        sourceGrip: grab,
        layers: preview.layers?.map(({ canvas, ...motion }) => ({
          ...motion, image: canvas.toDataURL("image/png"),
        })) ?? [{ image: preview.canvas.toDataURL("image/png") }] };
      dragRef.current = {
        key: f.key,
        size: figureBounds(f),
        grab,
        carry,
        calm: false,
        shake: Object.fromEntries(["X", "Y"].map((axis) => [axis, {
          extreme: e[`client${axis}`], direction: 0, turns: 0, at: e.timeStamp,
        }])),
        pickedUp: false,
        startX: e.clientX,
        startY: e.clientY,
        clientX: e.clientX,
        clientY: e.clientY,
      };
    } else {
      const [x, y] = canvasPoint(f.key, e, e.currentTarget);
      painters.current[f.key].beginStroke(
        x, y,
        { color, size, erase: tool === "eraser", splash: tool === "pen" },
      );
      dragRef.current = { key: f.key, painting: true,
        lastSplash: { x, y, at: performance.now() } };
      syncPaintCanvas();
      showSplash(f.key, x, y);
    }
  };

  const onPointerMove = (f) => (e) => {
    if (!canEdit()) { onPointerUp(); return; }
    const drag = dragRef.current;
    if (!drag || drag.key !== f.key || drag.joint) return;
    if (drag.painting) {
      const painter = painters.current[f.key];
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e];
      for (const ev of events)
        painter.strokeTo(
          ...canvasPoint(f.key, ev, e.currentTarget),
        );
      syncPaintCanvas();
      if (painter.splash && painter.brush) {
        const [x, y] = canvasPoint(f.key, e, e.currentTarget);
        const at = performance.now();
        if (at - drag.lastSplash.at >= 70 &&
          Math.hypot(x - drag.lastSplash.x, y - drag.lastSplash.y) >= painter.brush.radius * 0.4) {
          showSplash(f.key, x, y);
          drag.lastSplash = { x, y, at };
        }
      }
    } else {
      drag.clientX = e.clientX;
      drag.clientY = e.clientY;
      if (!drag.pickedUp) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 3) return;
        drag.pickedUp = true;
        setCarried(drag.carry);
        drag.raf = requestAnimationFrame(autoScroll);
      }
      if (!drag.calm) {
        const events = e.nativeEvent.getCoalescedEvents?.();
        for (const point of events?.length ? events : [e]) {
          if (!trackShake(drag.shake, point)) continue;
          drag.calm = true;
          // 元の絵をそのまま使い、首元の持ち手を保って通常のポーズへ戻す。
          drag.carry = {
            key: f.key, bounds: drag.size, grip: drag.grab, sourceGrip: drag.grab,
            layers: [{ image: painters.current[f.key].toDataURL() }],
          };
          setCarried(drag.carry);
          break;
        }
      }
      updateFig(f.key, dragPos(drag));
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.painting) painters.current[drag.key].endStroke();
    cancelAnimationFrame(drag?.raf);
    dragRef.current = null;
    if (drag?.carry) setCarried(null);
    syncPaintLayoutRef.current?.();
  };

  useEffect(() => {
    if (!deadline || now < deadline || timeUp || savedId || saving) return;
    colorPickerRef.current?.abort();
    colorPickerRef.current = null;
    endPaintDialogDrag();
    onPointerUp();
    paintDialogRef.current?.close();
    setShowPaint(false);
    setShowHelp(false);
    setTool("move");
    setSplashes([]);
    setTimeUp(true);
  }, [deadline, now, timeUp, savedId, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const endDrag = () => onPointerUp();
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("blur", endDrag);
      cancelAnimationFrame(dragRef.current?.raf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyJoints = (f, joints, source, record = true) => {
    if (!canEdit()) return false;
    const painter = painters.current[f.key];
    const unchanged = joints.every((limb, i) => ["bend", "end"].every((handle) =>
      Math.hypot(limb[handle].x - painter.joints[i][handle].x,
        limb[handle].y - painter.joints[i][handle].y) < 0.001,
    ));
    if (unchanged) return false;
    const before = figureBounds(f);
    const next = getFigureBounds(f.pose, f.rotation, joints, f.body);
    const x = f.x + next.x - before.x;
    const y = f.y + next.y - before.y;
    const stage = stageRef.current.size;
    // 胴の位置を保ち、ページの外へ手足がはみ出す操作だけを制限する。
    if (x < 0 || y < 0 || x + next.w > stage.width || y + next.h > stage.height)
      return false;
    if (record) painter.pushUndo();
    painter.setJoints(joints, source);
    updateFig(f.key, { joints: painter.joints, x, y });
    syncPaintCanvas();
    return true;
  };

  const onJointDown = (index, handle) => (e) => {
    if (!canEdit() || e.button !== 0 || e.isPrimary === false) return;
    e.preventDefault();
    e.stopPropagation();
    onPointerUp();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = activeRef.current;
    dragRef.current = {
      key: f.key, joint: true, index, handle, figure: f,
      source: painters.current[f.key].snapshot(),
      changed: false,
    };
  };

  const onJointMove = (e) => {
    if (!canEdit()) { onPointerUp(); return; }
    const drag = dragRef.current;
    if (!drag?.joint) return;
    const { figure, source, index, handle } = drag;
    const rect = jointEditorRef.current.getBoundingClientRect();
    const point = fromFigurePoint({
      x: ((e.clientX - rect.left) / rect.width - 0.5) * JOINT_VIEW_SIZE,
      y: ((e.clientY - rect.top) / rect.height - 0.5) * JOINT_VIEW_SIZE,
    }, figure.rotation, { x: 0, y: 0 });
    const joints = moveJoint(source.joints, index, handle, point);
    if (applyJoints(figure, joints, source, !drag.changed)) drag.changed = true;
  };

  const onJointKey = (index, handle) => (e) => {
    if (!canEdit()) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!direction) return;
    e.preventDefault();
    e.stopPropagation();
    const f = activeRef.current;
    const source = painters.current[f.key].snapshot();
    const point = toFigurePoint(source.joints[index][handle], f.rotation, { x: 0, y: 0 });
    const step = e.shiftKey ? 5 : 1;
    const target = fromFigurePoint({
      x: point.x + direction[0] * step, y: point.y + direction[1] * step,
    }, f.rotation, { x: 0, y: 0 });
    applyJoints(f, moveJoint(source.joints, index, handle, target), source);
  };

  useEffect(() => {
    if (!showPaint) return;
    const dialog = paintDialogRef.current;
    dialog.showModal();
    syncPaintCanvas();

    // 配置先のページを同じ寸法で描画し、カメレオンと同じ倍率で切り出す。
    const background = paintBackgroundRef.current;
    const preview = paintCanvasRef.current;
    const source = canvasRefs.current[activeKey];
    const stage = source.closest(".stage");
    const scroller = source.closest(".stage-scroll");
    const positionDialog = () => {
      // 操作中は編集画面を固定し、手を離してから新しい外形に合わせる。
      if (dragRef.current || paintDialogDragRef.current) return;
      if (paintDialogPositionRef.current) {
        placePaintDialog();
        return;
      }
      const viewport = window.visualViewport;
      const margin = 12, gap = 20;
      const left = (viewport?.offsetLeft ?? 0) + margin;
      const top = (viewport?.offsetTop ?? 0) + margin;
      const width = (viewport?.width ?? window.innerWidth) - margin * 2;
      const height = (viewport?.height ?? window.innerHeight) - margin * 2;
      const right = left + width, bottom = top + height;
      const target = source.getBoundingClientRect();
      const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
      const room = {
        left: clamp(target.left - gap - left, 0, width),
        right: clamp(right - target.right - gap, 0, width),
      };
      const side = room.left > room.right ? "left" : "right";
      const beside = room[side] >= Math.min(320, width);
      const panelWidth = Math.floor(Math.min(640, beside ? room[side] : width));
      const x = beside
        ? (side === "left" ? left : right - panelWidth)
        : clamp((target.left + target.right - panelWidth) / 2, left, right - panelWidth);
      const y = Math.min(bottom - 1, paintDialogTop(x, panelWidth, top));
      const panelHeight = Math.floor(bottom - y);
      dialog.style.width = `${panelWidth}px`;
      dialog.style.height = `${panelHeight}px`;
      dialog.style.maxHeight = `${panelHeight}px`;
      dialog.style.left = `${Math.round(x)}px`;
      dialog.style.top = `${Math.round(y)}px`;
    };
    const syncBackground = () => {
      const { width, height } = stageRef.current.size;
      if (background.width !== String(width)) background.width = String(width);
      if (background.height !== String(height)) background.height = String(height);
      const f = activeRef.current;
      const bounds = figureBounds(f);
      // どのツールでも同じ倍率・胴体の原点を使い、切り替え時に背景を動かさない。
      const scale = jointEditorRef.current.getBoundingClientRect().width / JOINT_VIEW_SIZE;
      const centerX = f.x - bounds.x;
      const centerY = f.y - bounds.y;
      background.style.transform =
        `scale(${scale}) translate(${-centerX}px, ${-centerY}px)`;
    };
    const syncLayout = () => {
      positionDialog();
      syncBackground();
    };
    syncPaintLayoutRef.current = syncLayout;
    syncLayout();
    const observer = new ResizeObserver(syncLayout);
    observer.observe(dialog);
    observer.observe(source);
    observer.observe(paintSurfaceRef.current);
    observer.observe(preview);
    if (stage) observer.observe(stage);
    scroller?.addEventListener("scroll", syncLayout);
    window.addEventListener("resize", syncLayout);
    window.visualViewport?.addEventListener("resize", syncLayout);
    window.visualViewport?.addEventListener("scroll", syncLayout);
    window.addEventListener("blur", onPointerUp);
    window.addEventListener("blur", endPaintDialogDrag);
    return () => {
      observer.disconnect();
      syncPaintLayoutRef.current = null;
      scroller?.removeEventListener("scroll", syncLayout);
      window.removeEventListener("resize", syncLayout);
      window.visualViewport?.removeEventListener("resize", syncLayout);
      window.visualViewport?.removeEventListener("scroll", syncLayout);
      window.removeEventListener("blur", onPointerUp);
      window.removeEventListener("blur", endPaintDialogDrag);
      colorPickerRef.current?.abort();
      endPaintDialogDrag();
      onPointerUp();
      dialog.close();
    };
  }, [showPaint, activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    syncPaintLayoutRef.current?.();
  }, [active, tool]);

  // キーボード：矢印で移動、Ctrl+Z で元に戻す、Ctrl+Shift+Z / Ctrl+Y でやり直す（選択中の人型に対して）
  useEffect(() => {
    const onKey = (e) => {
      if (showHelp) {
        if (e.key === "Escape") setShowHelp(false);
        return;
      }
      if (e.target instanceof HTMLInputElement && e.target.type === "text")
        return;
      if (!canEdit()) return;
      if (paintDialogDragRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          endPaintDialogDrag();
        }
        return;
      }
      if (dragRef.current?.carry) {
        if (e.key === "Escape") {
          e.preventDefault();
          onPointerUp();
        }
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "z" || e.key === "y")
      ) {
        e.preventDefault();
        const redo = e.key === "y" || e.shiftKey;
        editPaint(redo ? "redo" : "undo");
        return;
      }
      // 塗る画面でも位置を動かせる。入力・色選択・関節の操作を優先する。
      if (e.defaultPrevented || dragRef.current || colorPickerRef.current ||
        e.target.closest?.("input, select, textarea, [contenteditable]:not([contenteditable='false']), .hide-color-spectrum, .hide-joint-handle")) return;
      const d = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[e.key];
      if (d && active) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        updateFig(activeKey, (f) =>
          clampPos(
            { x: f.x + d[0] * step, y: f.y + d[1] * step },
            figureBounds(f),
          ),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeKey, active, showHelp]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickColor = async () => {
    if (!canEdit()) return;
    const dialog = paintDialogRef.current;
    const controller = new AbortController();
    colorPickerRef.current = controller;
    onPointerUp();
    // モーダルは残し、外側の背景幕だけを透過して元の色を拾えるようにする。
    dialog?.classList.add("is-picking-color");
    try {
      // 背景幕が消えたフレームを表示してから画面の色を取得する。
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (controller.signal.aborted) return;
      const { sRGBHex } = await new window.EyeDropper().open({
        signal: controller.signal,
      });
      if (controller.signal.aborted || !canEdit()) return;
      // 一部ブラウザは rgb(...) 形式で返す
      if (sRGBHex.startsWith("#")) setColor(sRGBHex.slice(0, 7));
      else {
        const [r, g, b] = sRGBHex.match(/\d+/g).map(Number);
        setColor(
          "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
        );
      }
      setTool("pen");
    } catch {
      // キャンセル
    } finally {
      if (colorPickerRef.current === controller) colorPickerRef.current = null;
      dialog?.classList.remove("is-picking-color");
    }
  };

  const save = async () => {
    if (saveLockRef.current || savedId || !active) return;
    saveLockRef.current = true;
    const submittedAt = Date.now();
    onPointerUp();
    setSaving(true);
    setError("");
    const toData = (f) => {
      const { w, h } = figureBounds(f);
      return {
        x: f.x,
        y: f.y,
        w,
        h,
        image: painters.current[f.key].toDataURL(),
      };
    };
    try {
      const main = figs.find((f) => f.key === MAIN);
      const { id } = await api.createChameleon({
        site: siteId,
        name,
        ...toData(main),
        decoys: figs.filter((f) => f.decoy).map(toData),
      });
      addMyId(id);
      setSavedAt(submittedAt);
      setSavedId(id);
    } catch (err) {
      saveLockRef.current = false;
      setError(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="b-game">
      {/* 上の段：ホーム・モード名・遊び方・残り時間と、元に戻す・名前・保存／下の段：道具・体型と、枠の表示・デコイ */}
      <header className="b-tools">
        <div className="b-tools__row">
          <div className="b-tools__group">
            <Tab as="a" href="#/" tilt={-2}>← ホーム</Tab>
            <span className="b-hud__mode">隠す</span>
            <button
              type="button"
              className="b-help"
              style={tiltStyle(4)}
              onClick={() => setShowHelp(true)}
              title="隠れるモードの説明"
              aria-label="隠れるモードの説明"
            >
              ?
            </button>
            <Timer ref={timerRef} variant="hide" time={formatTime(remaining)}
              ratio={remaining / HIDE_TIME_LIMIT_SEC} danger={remaining < 30}
              label={`隠す残り時間 ${formatTime(remaining)}`} />
          </div>
          <div className="b-tools__group">
            <Tab className="b-tab--icon" disabled={editingLocked} onClick={() => editPaint("undo")}
              title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
              <Icon name="undo" />
            </Tab>
            <Tab className="b-tab--icon" disabled={editingLocked} onClick={() => editPaint("redo")}
              title="やり直す (Ctrl+Shift+Z)" aria-label="やり直す">
              <Icon name="redo" />
            </Tab>
            <span className="b-tools__sep" aria-hidden="true" />
            <input
              type="text"
              className="b-input"
              aria-label="カメレオンの名前"
              placeholder="カメレオンの名前"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Sticker size="s" color="hide" tilt={-2} disabled={!figs.length || saving || Boolean(savedId)} onClick={save}>
              {saving ? "保存中…" : "ここに隠れる！"}
            </Sticker>
          </div>
        </div>

        <div className="b-tools__row">
          <div className="b-tools__group">
            {TOOLS.map((t) => (
              <Tab
                key={t.key}
                pressed={tool === t.key}
                color="hide"
                disabled={editingLocked || (t.key !== "move" && !active)}
                onClick={() => selectTool(t.key)}
              >
                <Icon name={t.key} /> {t.label}
              </Tab>
            ))}
            <span className="b-tools__sep" aria-hidden="true" />
            <div className="b-bodypick" role="group" aria-label="体型">
              <span>体型</span>
              {Object.entries(BODY_TYPES).map(([key, body]) => (
                <button
                  key={key}
                  type="button"
                  className="b-bodypick__choice"
                  aria-pressed={(active?.body ?? "standard") === key}
                  disabled={!active || editingLocked}
                  onClick={() => changeBody(key)}
                >
                  <BodyPreview body={key} />
                  <span>{body.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="b-tools__group">
            <Check checked={outline} onChange={(e) => setOutline(e.target.checked)}>枠を表示</Check>
            <span className="b-tools__sep" aria-hidden="true" />
            <Tab disabled={editingLocked || !figs.length || decoyCount >= MAX_DECOYS}
              onClick={addDecoy} title="見つける人をだますニセモノを置く">
              <Icon name="decoy" /> デコイを追加 ({decoyCount}/{MAX_DECOYS})
            </Tab>
            {active?.decoy && (
              <Tab disabled={editingLocked} onClick={removeDecoy}>
                <Icon name="trash" /> デコイを削除
              </Tab>
            )}
          </div>
        </div>
      </header>
      {/* 帯の下の1行。編集中の人型と位置。デコイを置いたら注意を添える */}
      <div className="b-hint">
        {active && <strong>{timeUp ? "編集終了" : `${figLabel(active, figs)}を編集中`}</strong>}
        <span>位置: {active ? `(${active.x}, ${active.y})` : "-"}</span>
        {decoyCount > 0 && <span>／　デコイをクリックした人は残り時間が減ります</span>}
        {error && <span className="b-hint__error" role="alert">{error}</span>}
      </div>

      <SiteStage
        ref={stageRef}
        siteId={siteId}
        onReady={handleReady}
      >
        {figs.map((f) => {
          const { w, h } = figureBounds(f);
          const carry = carried?.key === f.key ? carried : null;
          return (
            <div key={f.key}>
              <canvas
                ref={bindCanvas(f)}
                className={[
                  "chameleon editable",
                  `tool-${tool}`,
                  outline && "outlined",
                  f.decoy && "decoy",
                  f.key === activeKey && "active",
                  carry && "is-carried",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ left: f.x, top: f.y, width: w, height: h }}
                onPointerDown={onPointerDown(f)}
                onPointerMove={onPointerMove(f)}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onLostPointerCapture={onPointerUp}
              />
              {carry && (
                <div
                  className="hide-carried-figure"
                  aria-hidden="true"
                  style={{
                    left: f.x + carry.sourceGrip.x - carry.grip.x,
                    top: f.y + carry.sourceGrip.y - carry.grip.y,
                    width: carry.bounds.w,
                    height: carry.bounds.h,
                  }}
                >
                  {carry.layers.map((layer, index) => (
                    <img
                      key={index}
                      className={`hide-carried-layer${layer.origin ? " hide-carried-limb" : ""}`}
                      src={layer.image}
                      alt=""
                      draggable={false}
                      style={layer.origin ? {
                        transformOrigin: `${layer.origin.x}px ${layer.origin.y}px`,
                        "--flutter-angle": `${layer.angle}deg`,
                        "--flutter-duration": `${layer.duration}ms`,
                        "--flutter-delay": `${layer.delay}ms`,
                      } : undefined}
                    />
                  ))}
                </div>
              )}
              {outline && !carry && (
                <span
                  className={`fig-tag ${f.decoy ? "decoy" : ""}`}
                  style={{ left: f.x, top: f.y }}
                >
                  {figLabel(f, figs)}
                </span>
              )}
            </div>
          );
        })}
      </SiteStage>

      {showPaint && active && (
        <dialog
          ref={paintDialogRef}
          className="hide-paint-modal"
          aria-label={`${figLabel(active, figs)}の色塗り・ポーズ調整`}
          onCancel={(e) => {
            e.preventDefault();
            closePaint();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePaint();
          }}
        >
          <span className="b-tape b-tape--left b-tape--hide" aria-hidden="true" />
          <span className="b-tape b-tape--right b-tape--accent" aria-hidden="true" />
          <div className="hide-paint-panel">
            <header className="hide-paint-header"
              title="上部をドラッグして画面を移動"
              onPointerDown={onPaintDialogDown}
              onPointerMove={onPaintDialogMove}
              onPointerUp={endPaintDialogDrag}
              onPointerCancel={endPaintDialogDrag}
              onLostPointerCapture={endPaintDialogDrag}>
              <span className="hide-paint-grip" aria-hidden="true" />
            </header>

            <div className="hide-paint-controls">
              <div className="hide-paint-row">
                <div className="hide-paint-group">
                  {TOOLS.filter((t) => t.key !== "move").map((t) => (
                    <Tab
                      key={t.key}
                      pressed={tool === t.key}
                      color="hide"
                      onClick={() => { if (!canEdit()) return; onPointerUp(); setSplashes([]); setTool(t.key); }}
                    >
                      <Icon name={t.key} /> {t.label}
                    </Tab>
                  ))}
                </div>
                <div className="hide-paint-group">
                  <Tab className="b-tab--icon" onClick={() => editPaint("undo")} aria-label="元に戻す" title="元に戻す (Ctrl+Z)">
                    <Icon name="undo" />
                  </Tab>
                  <Tab className="b-tab--icon" onClick={() => editPaint("redo")} aria-label="やり直す" title="やり直す (Ctrl+Shift+Z)">
                    <Icon name="redo" />
                  </Tab>
                  <Tab className="b-tab--icon hide-paint-close" tilt={3} onClick={closePaint} aria-label="編集を閉じる">×</Tab>
                </div>
              </div>
              <div className="hide-mode-stack">
                <div className={`hide-paint-row${editingJoints ? "" : " is-inactive"}`}
                  aria-hidden={!editingJoints}>
                  <div className="hide-paint-group" role="group" aria-label="全体の角度">
                    <span className="hide-paint-label">全体の角度</span>
                    <Tab className="b-tab--icon" onClick={() => rotate(-ROTATE_STEP)} title={`左に${ROTATE_STEP}度回す`} aria-label="左に回す">
                      <Icon name="rotateLeft" />
                    </Tab>
                    <Tab className="rotation-value" onClick={() => changeRotation(0)} title="クリックでまっすぐに戻す"
                      aria-label={`角度 ${active.rotation}度。まっすぐに戻す`}>
                      {active.rotation}°
                    </Tab>
                    <Tab className="b-tab--icon" onClick={() => rotate(ROTATE_STEP)} title={`右に${ROTATE_STEP}度回す`} aria-label="右に回す">
                      <Icon name="rotateRight" />
                    </Tab>
                  </div>
                </div>
                <label className={`hide-paint-size${editingJoints ? " is-inactive" : ""}`}
                  aria-hidden={editingJoints}>
                  <span className="hide-paint-label">太さ</span>
                  <Range color="hide" min={0.2} max={12} step={0.2} value={size}
                    onChange={(e) => setSize(Number(e.target.value))} />
                  <span className="hide-paint-size-value">{size}</span>
                </label>
              </div>
            </div>

            <div className="hide-paint-surface" ref={paintSurfaceRef}>
              <iframe
                ref={paintBackgroundRef}
                className="hide-paint-background"
                title="配置場所の背景"
                src={`/sites/${siteId}`}
                sandbox="allow-same-origin"
                width={stageRef.current.size.width}
                height={stageRef.current.size.height}
                tabIndex={-1}
                aria-hidden="true"
                onLoad={() => setPaintBackgroundReady(true)}
              />
              {!paintBackgroundReady && (
                <div className="hide-paint-background-loading" role="status">
                  背景を読み込み中…
                </div>
              )}
              <div
                ref={jointEditorRef}
                className={`hide-paint-figure${editingJoints ? " is-joint-editing" : ""}`}
              >
                <div className="hide-paint-artwork" style={{
                  left: `${(paintSize.x / JOINT_VIEW_SIZE + 0.5) * 100}%`,
                  top: `${(paintSize.y / JOINT_VIEW_SIZE + 0.5) * 100}%`,
                  width: `${paintSize.w / JOINT_VIEW_SIZE * 100}%`,
                  height: `${paintSize.h / JOINT_VIEW_SIZE * 100}%`,
                }}>
                  <canvas
                    ref={paintCanvasRef}
                    className="hide-paint-canvas"
                    aria-label={`カメレオンの${editingJoints ? "ポーズ" : "色塗り"}キャンバス`}
                    tabIndex={editingJoints ? -1 : 0}
                    onPointerDown={onPointerDown(active)}
                    onPointerMove={onPointerMove(active)}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onLostPointerCapture={onPointerUp}
                  />
                  {splashes.map((splash) => (
                    <svg
                      key={splash.id}
                      className="hide-paint-splash"
                      viewBox="0 0 100 100"
                      aria-hidden="true"
                      style={{ left: `${splash.x}%`, top: `${splash.y}%`,
                        width: `${splash.size}%`, color: splash.color,
                        "--splash-angle": `${splash.id * 137.5 % 360}deg` }}
                      onAnimationEnd={() => setSplashes((items) => items.filter((item) => item.id !== splash.id))}
                    >
                      <path d="M50 26C57 26 58 32 63 32L76 23Q82 20 79 27L71 40C77 45 73 49 79 53L90 59Q94 64 87 64L73 61C68 64 66 65 66 72L69 84Q68 90 64 84L55 73C49 71 46 76 41 71L28 82Q22 84 25 77L32 64C28 59 24 59 18 60Q10 58 18 54L28 49C31 44 25 39 30 34L24 21Q24 15 29 20L41 31C45 31 45 26 50 26Z" />
                      <circle cx="16" cy="32" r="4" /><circle cx="44" cy="13" r="3" />
                      <circle cx="85" cy="39" r="3.5" /><circle cx="81" cy="79" r="3" />
                      <circle cx="43" cy="88" r="2.5" /><circle cx="13" cy="72" r="2" />
                    </svg>
                  ))}
                </div>
                {editingJoints && (
                  <svg className="hide-joint-overlay" viewBox={`${-JOINT_VIEW_SIZE / 2} ${-JOINT_VIEW_SIZE / 2} ${JOINT_VIEW_SIZE} ${JOINT_VIEW_SIZE}`}>
                    {active.joints.map((limb, index) => {
                      const points = Object.fromEntries(["root", "bend", "end"].map((handle) =>
                        [handle, toFigurePoint(limb[handle], active.rotation, { x: 0, y: 0 })],
                      ));
                      return (
                        <g key={limb.label}>
                          <path
                            className="hide-joint-bones"
                            d={`M${points.root.x} ${points.root.y} L${points.bend.x} ${points.bend.y} L${points.end.x} ${points.end.y}`}
                          />
                          {["bend", "end"].map((handle) => {
                            const point = points[handle];
                            const label = `${limb.label}の${jointLabel(index, handle)}`;
                            return (
                              <g
                                key={handle}
                                className="hide-joint-handle"
                                role="button"
                                tabIndex={0}
                                aria-label={label}
                                onPointerDown={onJointDown(index, handle)}
                                onPointerMove={onJointMove}
                                onPointerUp={onPointerUp}
                                onPointerCancel={onPointerUp}
                                onLostPointerCapture={onPointerUp}
                                onKeyDown={onJointKey(index, handle)}
                              >
                                <title>{label}</title>
                                <circle cx={point.x} cy={point.y} r="9" fill="transparent" />
                                <circle className="hide-joint-dot" cx={point.x} cy={point.y} r="3.5" />
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>
            </div>
            {/* 操作欄は同じ領域に重ね、非表示の欄も高さを確保する。 */}
            <div className="hide-mode-stack hide-paint-details">
              <div className={tool === "pen" ? undefined : "is-inactive"}
                aria-hidden={tool !== "pen"}>
                <InlineColorPicker color={color} onChange={(value) => { if (canEdit()) setColor(value); }}>
                  {hasEyeDropper && (
                    <Tab onClick={pickColor} title="配置場所の背景から色を拾う">
                      <Icon name="eyedropper" /> スポイト
                    </Tab>
                  )}
                  <Tab onClick={() => editPaint("fillAll", color)} title="全体を今の色で1回塗る">
                    <Icon name="fill" /> 全体塗り
                  </Tab>
                  <Tab onClick={resetColor} title="塗った色をすべて消して白に戻す">
                    色をリセット
                  </Tab>
                </InlineColorPicker>
              </div>
              <div className={`hide-joint-help${editingJoints ? "" : " is-inactive"}`}
                aria-hidden={!editingJoints}>
                <p>ひじ・ひざで向きを、手首・足首で曲がり具合を調整できます。黄緑の点をドラッグするか、選んだ関節を矢印キーで動かしてください。</p>
                <Tab onClick={resetPoseAndRotation}>ポーズ・角度をリセット</Tab>
              </div>
              <p className={`hide-eraser-help${tool === "eraser" ? "" : " is-inactive"}`}
                aria-hidden={tool !== "eraser"}>
                ドラッグした部分を白に戻します。
              </p>
            </div>
            <footer className="hide-paint-footer">
              <Sticker size="s" color="hide" tilt={-2} onClick={closePaint}>完了</Sticker>
            </footer>
          </div>
        </dialog>
      )}

      {showHelp && (
        <Modal tapes={["hide", "accent"]} className="hide-help" aria-labelledby="hide-help-title" onBackdropClick={() => setShowHelp(false)}>
          <div className="b-modal__head">
            <h2 id="hide-help-title" className="b-modal__title">隠れるモードの遊び方</h2>
            <Tab tilt={3} aria-label="閉じる" onClick={() => setShowHelp(false)}>×</Tab>
          </div>
          <p>
            人型のカメレオンをページのどこかに置き、背景になじむように色を塗って隠しましょう。
            「ここに隠れる！」を押すと保存され、見つけるモードで他の人に探してもらえます。
          </p>
          <p>隠す制限時間は5分です。時間が来ると編集が終了し、その時点の状態で保存できます。</p>
          <h3>ツール</h3>
          <dl className="hide-help-tools">
            {TOOLS.map((t, index) => (
              <div key={t.key}>
                <dt><span className="b-tab b-fill--sub" style={tiltStyle(index % 2 ? 1.5 : -1.5)}><Icon name={t.key} /> {t.label}</span></dt>
                <dd>{t.hint}</dd>
              </div>
            ))}
          </dl>
          <h3>その他</h3>
          <ul className="hide-help-list">
            <li>「体型」で細め・標準・太めを切り替えられます。塗りと関節のポーズは引き継がれます</li>
            <li>
              「ポーズ・角度」の画面で、<Icon name="rotateLeft" /> <Icon name="rotateRight" /> を押すと全体の角度を
              {ROTATE_STEP}度ずつ調整できます。角度の数字を押すとまっすぐに戻ります
            </li>
            <li><Icon name="decoy" /> デコイ（ニセモノ）を最大{MAX_DECOYS}体まで置けます。デコイをクリックした人は残り時間が減ります</li>
            <li>Ctrl+Z で元に戻す、Ctrl+Shift+Z でやり直し。矢印キーは Shift を押しながらだと10pxずつ移動します</li>
          </ul>
          <div className="b-modal__actions">
            <Sticker color="hide" tilt={-2} onClick={() => setShowHelp(false)}>閉じる</Sticker>
          </div>
        </Modal>
      )}

      {timeUp && !savedId && (
        <Modal tapes={["hide", null]} className="hide-timeup" aria-labelledby="hide-timeup-title">
          <h2 id="hide-timeup-title" className="b-modal__title">タイムアップ！</h2>
          <p>5分が経過したので、編集を終了しました。<br />今の色・ポーズ・場所で隠せます。</p>
          <input type="text" className="b-input hide-timeup-name" aria-label="カメレオンの名前" placeholder="カメレオンの名前"
            maxLength={20} value={name} onChange={(e) => setName(e.target.value)} disabled={saving} autoFocus />
          {error && <p className="b-alert" role="alert">{error}</p>}
          <div className="b-modal__actions">
            <Sticker as="a" href="#/" tilt={2}>ホームへ</Sticker>
            <Sticker as="a" href={`#/hide?site=${siteId}&t=${Date.now()}`} tilt={-1.5}>もう一度</Sticker>
            <Sticker color="hide" tilt={-2} onClick={save} disabled={saving}>
              {saving ? "保存中…" : "この状態で隠す"}
            </Sticker>
          </div>
        </Modal>
      )}

      {savedId && (
        <Modal tapes={["hide", "find"]} aria-labelledby="hide-saved-title">
          <div className="hide-saved-head">
            <span style={tiltStyle(-6)}><FigureIcon className="hide-saved-figure" width={34} height={64} /></span>
            <h2 id="hide-saved-title" className="b-modal__title">隠れました！</h2>
          </div>
          <p>
            「{name.trim() || "ななしのカメレオン"}」がページに潜みました。
            {decoyCount > 0 && (
              <>
                <br />
                デコイ {decoyCount} 体も配置しました。
              </>
            )}
            <br />
            何人に探され、何人に見つかったかはホームで確認できます。
          </p>
          <div className="b-modal__actions">
            <Sticker as="a" href={`#/hide?site=${siteId}&t=${Date.now()}`} tilt={2}>もう一人隠す</Sticker>
            <Sticker as="a" href="#/" color="hide" tilt={-2}>ホームへ</Sticker>
          </div>
        </Modal>
      )}
    </div>
  );
}
