import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import SiteStage from '../components/SiteStage.jsx';
import Icon from '../components/Icon.jsx';
import { FigureIcon, Modal, Range, Sticker, Tab, Timer, tiltStyle } from '../components/ui.jsx';
import { api } from '../api.js';
import './Find.css';
import { getRandomName } from "../userNames.js";

const ZOOMS = [1, 1.5, 2, 3];
const HIT_TOLERANCE = 3; // クリック判定の余裕 (px)
const CLICK_COOLDOWN_MS = 5000; // フィールドをクリックしたあとのクールタイム
const DEFAULT_TIME_LIMIT_SEC = 180; // 制限時間（server/api.js の TIME_LIMIT_SEC と同じ）。スタート前は game.timeLimit がまだ無いので、こちらを表示に使う
const RETICLE_RADIUS_PX = 60; // 照準の円の半径 (画面px)。照らす範囲（影を出す円）の半径でもある
const SHADOW_MIN_OFFSET = 6; // 影のずれの最小値 (ページpx)
const SHADOW_MAX_EXTRA = 12; // 光源から離れるほど増える影のずれの上限 (ページpx)
const SHADOW_DIST_RATIO = 0.2; // 光源からの距離に対する影のずれの割合
const TILE = 256; // カメレオンを描く canvas タイルの1辺 (ページpx)
const TILE_SCALE = 2; // タイルの解像度の倍率（カメレオン画像の解像度 FIG_SCALE と同じ）
const HINT_THRESHOLDS = [120, 90, 60, 30, 10]; // 1分30秒, 1分, 30秒, 10秒
const HINT_DURATION_MS = 1500; // ヒントを表示する時間（4.5秒）
const RETICLE_ARROW_DIST = RETICLE_RADIUS_PX + 36; // ヒントの矢印を出す、照準の中心からの距離 (画面px)


// ヒントのときに効果音を鳴らす
function playHintSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1318.51, now + 0.08);

    // 音量のフェードアウト
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.56);
    osc.onended = () => ctx.close();
  } catch {
    // 音声再生がブロックされた場合は無視
  }
}

function getDirectionInfo(dx, dy) {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // -180 ~ 180 (右が0, 下が90)
  const snapped = Math.round(deg / 45) * 45;
  const rad = (snapped * Math.PI) / 180;
  const map = {
    0: { key: 'right', arrowDeg: 90 },
    45: { key: 'bottom-right', arrowDeg: 135 },
    90: { key: 'bottom', arrowDeg: 180 },
    135: { key: 'bottom-left', arrowDeg: 225 },
    180: { key: 'left', arrowDeg: 270 },
    '-180': { key: 'left', arrowDeg: 270 },
    '-135': { key: 'top-left', arrowDeg: 315 },
    '-90': { key: 'top', arrowDeg: 0 },
    '-45': { key: 'top-right', arrowDeg: 45 },
  };
  const info = map[snapped] ?? { key: 'top', arrowDeg: 0 };
  return {
    ...info,
    offsetX: Math.round(Math.cos(rad) * RETICLE_ARROW_DIST),
    offsetY: Math.round(Math.sin(rad) * RETICLE_ARROW_DIST),
  };
}

// カメレオンの画像を読み込み、不透明ピクセルをクリックしたかどうかを判定するためのマスクも作る
async function loadFigure(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { img, mask: { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data } };
}

// まだ見つかっていないカメレオンとデコイを、ページ全体に敷き詰めた canvas タイルに描く。
// 1体ずつ <img> にすると開発者ツールで要素を選ぶだけで位置が分かってしまうため、
// どのタイルも同じ大きさ・同じ属性にして、要素からは場所が分からないようにする。
// 何も描かないタイルは getContext しないので、描画用のメモリも確保されない。
function FigureTiles({ width, height, figures }) {
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  const tilesRef = useRef([]);
  const drawnRef = useRef(new Set());

  useLayoutEffect(() => {
    const next = new Map();
    for (const f of figures) {
      const c0 = Math.max(0, Math.floor(f.x / TILE)), c1 = Math.min(cols - 1, Math.floor((f.x + f.w) / TILE));
      const r0 = Math.max(0, Math.floor(f.y / TILE)), r1 = Math.min(rows - 1, Math.floor((f.y + f.h) / TILE));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (!next.has(i)) next.set(i, []);
          next.get(i).push(f);
        }
      }
    }
    for (const i of new Set([...drawnRef.current, ...next.keys()])) {
      const canvas = tilesRef.current[i];
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const left = (i % cols) * TILE, top = Math.floor(i / cols) * TILE;
      ctx.setTransform(TILE_SCALE, 0, 0, TILE_SCALE, -left * TILE_SCALE, -top * TILE_SCALE);
      ctx.imageSmoothingQuality = 'high';
      for (const f of next.get(i) ?? []) ctx.drawImage(f.img, f.x, f.y, f.w, f.h);
    }
    drawnRef.current = new Set(next.keys());
  }, [figures, cols, rows]);

  return (
    <div className="figure-tiles" aria-hidden="true">
      {Array.from({ length: cols * rows }, (_, i) => (
        <canvas
          key={i}
          ref={(el) => { tilesRef.current[i] = el; }}
          width={TILE * TILE_SCALE}
          height={TILE * TILE_SCALE}
          style={{ left: (i % cols) * TILE, top: Math.floor(i / cols) * TILE }}
        />
      ))}
    </div>
  );
}

function hits(c, mask, px, py) {
  const sx = mask.width / c.w;
  const sy = mask.height / c.h;
  for (let dy = -HIT_TOLERANCE; dy <= HIT_TOLERANCE; dy++) {
    for (let dx = -HIT_TOLERANCE; dx <= HIT_TOLERANCE; dx++) {
      if (dx * dx + dy * dy > HIT_TOLERANCE * HIT_TOLERANCE) continue;
      const lx = Math.floor((px + dx - c.x) * sx);
      const ly = Math.floor((py + dy - c.y) * sy);
      if (lx < 0 || ly < 0 || lx >= mask.width || ly >= mask.height) continue;
      if (mask.data[(ly * mask.width + lx) * 4 + 3] > 40) return true;
    }
  }
  return false;
}

function FlashlightShadow({ obj, aim, radius }) {
  const nx = Math.max(obj.x, Math.min(aim.x, obj.x + obj.w));
  const ny = Math.max(obj.y, Math.min(aim.y, obj.y + obj.h));
  if ((aim.x - nx) ** 2 + (aim.y - ny) ** 2 > radius * radius) return null;
  const vx = obj.x + obj.w / 2 - aim.x;
  const vy = obj.y + obj.h / 2 - aim.y;
  const dist = Math.hypot(vx, vy);
  const [ux, uy] = dist > 0 ? [vx / dist, vy / dist] : [Math.SQRT1_2, Math.SQRT1_2];
  const len = SHADOW_MIN_OFFSET + Math.min(dist * SHADOW_DIST_RATIO, SHADOW_MAX_EXTRA);
  const dx = ux * len * 1.2;
  const dy = uy * len * 1.2;
  const whitedx = dx * 1.4;
  const whitedy = dy * 1.4;
  return (
    <div className="shadow-slot" style={{ left: obj.x, top: obj.y, width: obj.w, height: obj.h }}>
    <img
      className="flashlight-shadow"
      src={obj.img.src}
      alt=""
      draggable={false}
      style={{
        left: dx,
        top: dy,
        clipPath: `circle(${radius}px at ${aim.x - obj.x - dx}px ${aim.y - obj.y - dy}px)`,
        opacity: 0.3,
      }}
    />
    <img
      className="flashlight-shadow"
      src={obj.img.src}
      alt=""
      draggable={false}
      style={{
        left: whitedx,
        top: whitedy,
        clipPath: `circle(${radius}px at ${aim.x - obj.x - whitedx}px ${aim.y - obj.y - whitedy}px)`,
        filter: 'brightness(0) invert(1) drop-shadow(0px 0px 4px rgba(255, 255, 255, 1))'
      }}
    />
    </div>
  );
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// マウスの無い端末（タッチ操作だけ）か。照準のカーソルが無いので、最後にタップした位置にリングを出す
const touchOnly = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;

// クールタイムの経過に合わせて減っていく表示に渡す、アニメーションの開始位置。
// 途中で表示し直しても（カーソルがステージを出入りしても）減り具合が巻き戻らないよう、表示した時点の経過時間から始める。
function useCooldownDelay(until) {
  const [delay] = useState(() => Math.min(0, until - CLICK_COOLDOWN_MS - Date.now()));
  return `${delay}ms`;
}

// 照準の円の、残り時間のぶんの弧。CSS アニメーションで毎フレームなめらかに減らす。
// 待ち中にクリックしたときに作り直しても、その時点の減り具合から続ける
function CooldownArc({ until, denied }) {
  const delay = useCooldownDelay(until);
  // 待ち中にクリックしたときは、減るアニメーションに加えて 0.35 秒だけピンクにするアニメーションを重ねる（Find.css）
  const style = denied
    ? { animationDuration: `${CLICK_COOLDOWN_MS}ms, 350ms`, animationDelay: `${delay}, 0ms` }
    : { animationDuration: `${CLICK_COOLDOWN_MS}ms`, animationDelay: delay };
  return (
    <>
      <circle className="find-reticle__arc-edge" r="24" pathLength="100" style={style} />
      <circle className="find-reticle__arc" r="24" pathLength="100" style={style} />
    </>
  );
}

// 照準。直径 100px の円と破線の十字（濃い紫の縁取りに黄緑）。中心がクリックする位置。
// マウスの端末では、プレイ中はずっと本物のカーソルを隠してこの照準を出す（クールタイムの前後で大きさが変わらないように、
// カーソル画像とは切り替えない）。位置は posRef ではなく、マウスが動くたびに直接合わせる（Find 本体の effect）。
// クールタイム中は円そのものが残り時間のぶんの弧になり、12時から時計回りに減っていく。十字は灰色になる。
// タッチ操作だけの端末では、クールタイム中だけ最後にタップした位置（pos）に出す。
const RETICLE_SIZE_PX = (RETICLE_RADIUS_PX * 50) / 24; // 円の半径が viewBox 上の 24 → RETICLE_RADIUS_PX になる大きさ
const Reticle = forwardRef(function Reticle({ cooling, cooldownUntil, denied, pos }, ref) {
  return (
    <div
      ref={ref}
      className={cooling ? 'find-reticle is-cooling' : 'find-reticle'}
      style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}
      aria-hidden="true"
    >
      <svg width={RETICLE_SIZE_PX} height={RETICLE_SIZE_PX} viewBox="-25 -25 50 50">
        {cooling ? (
          <>
            {/* 減ったところ（うっすら残して、照らす範囲の大きさはわかるようにする） */}
            <circle className="find-reticle__ghost" r="24" />
            <g
              transform="rotate(-90)"
              key={`${cooldownUntil}-${denied?.at ?? 0}`}
              className={denied ? 'is-denied' : undefined}
            >
              <CooldownArc until={cooldownUntil} denied={Boolean(denied)} />
            </g>
          </>
        ) : (
          <>
            <circle className="find-reticle__edge" r="24" />
            <circle className="find-reticle__ring" r="24" />
          </>
        )}
        <path className="find-reticle__cross" d="M0 -24V24M-24 0H24" />
      </svg>
    </div>
  );
});

// 待ち中にクリックしたとき、照準の下に1秒ほど出す「あと○秒」
function CooldownDenied({ x, y, sec }) {
  return (
    <div className="find-cooldown" style={{ transform: `translate(${x}px, ${y}px)` }} aria-hidden="true">
      <span className="find-cooldown__denied" style={{ top: RETICLE_RADIUS_PX + 10 }}>あと{sec}秒</span>
    </div>
  );
}

// HUD のクールタイム札の下に付ける、減っていく横棒
function CooldownBar({ until }) {
  const delay = useCooldownDelay(until);
  return (
    <span className="b-cooldown__bar" aria-hidden="true">
      <span style={{ animationDuration: `${CLICK_COOLDOWN_MS}ms`, animationDelay: delay }} />
    </span>
  );
}

export default function Find({ siteId }) {
  const stageRef = useRef(null);
  const masksRef = useRef({});
  const imagesRef = useRef({});
  const pointerPos = useRef({ x: -9999, y: -9999 });
  const hideScoresRef = useRef({});
  const savedGameRef = useRef(null);
  const [stageReady, setStageReady] = useState(false);
  const [phase, setPhase] = useState('intro'); // intro | starting | playing | over | empty
  const [playerName, setPlayerName] = useState(() => getRandomName("find"));
  const [game, setGame] = useState(null);
  const [found, setFound] = useState([]);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [misses, setMisses] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownDenied, setCooldownDenied] = useState(null); // クールタイム中にクリックしたとき { at, sec }
  const lastClickRef = useRef(null); // 最後にクリックした位置（クライアント座標）。マウスの無い端末でリングを出す場所
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [animatingFound, setAnimatingFound] = useState([]);
  const [showFound, setShowFound] = useState(false);
  const [aim, setAim] = useState(null);
  const pointerRef = useRef(null);
  const aimFrameRef = useRef(null);
  const [totalScore, setTotalScore] = useState(0);
  const activePlayerNameRef = useRef('ななしのハンター');
  const playerNameInputRef = useRef(null);

  const [hintUntil, setHintUntil] = useState(0);
  const [hintCount, setHintCount] = useState(null);
  // hint の中身: { type: 'in-view', count: number, flashKey: number } または { type: 'arrow', dirKey: string, arrowDeg: number }
  const triggeredHintsRef = useRef(new Set());
  const hintTimerRef = useRef(null);

  useLayoutEffect(() => {
    if (phase === 'intro') {
      playerNameInputRef.current?.select();
    }
  }, [phase]);

  const scheduleAim = () => {
    if (aimFrameRef.current != null) return;
    aimFrameRef.current = requestAnimationFrame(() => {
      aimFrameRef.current = null;
      const p = pointerRef.current;
      setAim(p && stageRef.current ? stageRef.current.toStagePoint(p.x, p.y) : null);
    });
  };

  const remaining = Math.max(0, (deadline - now) / 1000);
  const cooldownRemaining = Math.max(0, (cooldownUntil - now) / 1000);
  const cooling = phase === 'playing' && cooldownRemaining > 0;
  // 照準（Reticle）を、マウスが動くたびに直接その位置へ動かす。
  // React の再描画を待たないので遅れない。ステージの外では隠す（本物のカーソルに戻る）
  const reticleRef = useRef(null);
  const domReticle = phase === 'playing' && !touchOnly;
  useLayoutEffect(() => {
    if (!domReticle) return;
    const el = reticleRef.current;
    if (!el) return;
    const place = (x, y, show) => {
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.visibility = show ? '' : 'hidden';
    };
    const p = pointerRef.current;
    place(p?.x ?? 0, p?.y ?? 0, Boolean(p));
    const onMove = (e) => place(e.clientX, e.clientY, Boolean(e.target.closest?.('.stage-overlay')));
    // ステージがウインドウの端に接している所からマウスを外に出すと pointermove が来ないので、
    // ウインドウから出たとき・別のウインドウに切り替えたときにも隠す
    const hide = () => {
      el.style.visibility = 'hidden';
    };
    const onOut = (e) => {
      if (!e.relatedTarget) hide();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', hide);
    };
  }, [domReticle]);
  const trimmedName = playerName.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 20;

  const start = async () => {
    if (!nameValid) return;
    setPhase('starting');
    setError('');
    setTotalScore(0);
    triggeredHintsRef.current = new Set();
    setHintUntil(0);
    setHintCount(null);
    clearTimeout(hintTimerRef.current);
    try {
      activePlayerNameRef.current = trimmedName;

      const started = await api.startGame(siteId, []);
      // 保存されている位置・大きさはページ画像に対する相対座標なので、表示中のページ座標 (px) に直す
      const { fromRelative } = stageRef.current;
      const g = {
        ...started,
        chameleons: started.chameleons.map(fromRelative),
      };
      if (g.chameleons.length === 0) {
        setPhase('empty');
        return;
      }
      hideScoresRef.current = {};
      g.chameleons.forEach((c) => {
        hideScoresRef.current[c.id] = {
          currentScore: 0,
          wasVisible: false,
          isFound: false,
        };
      });
      const targets = g.chameleons.map((c) => [c.id, c.image]);
      const loaded = await Promise.all(targets.map(([, image]) => loadFigure(image)));
      masksRef.current = Object.fromEntries(targets.map(([key], i) => [key, loaded[i].mask]));
      imagesRef.current = Object.fromEntries(targets.map(([key], i) => [key, loaded[i].img]));
      setGame(g);
      setDeadline(Date.now() + g.timeLimit * 1000);
      setNow(Date.now());
      setPhase('playing');
    } catch (err) {
      setError(`ゲームを開始できませんでした: ${err.message}`);
      setPhase('intro');
    }
  };

  useEffect(() => {
    if (phase !== 'playing') return;
    document.addEventListener('scroll', scheduleAim, true);
    return () => {
      document.removeEventListener('scroll', scheduleAim, true);
      if (aimFrameRef.current != null) cancelAnimationFrame(aimFrameRef.current);
      aimFrameRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'playing' && (remaining <= 0 || found.length === game.chameleons.length)) setPhase('over');
  }, [phase, remaining, found, game]);

  useEffect(() => {
    if (phase !== 'over' || savedGameRef.current === game.gameId) return;
    savedGameRef.current = game.gameId;
    setError('');
    const finalScores = Object.fromEntries(Object.entries(hideScoresRef.current).map(([id, state]) => [id, {
      score: Math.round(state.currentScore),
      wasVisible: state.wasVisible,
    }]));
    api.reportHideScores(game.gameId, finalScores).catch(() => {
      savedGameRef.current = null;
      setError('記録を保存できませんでした。');
    });
  }, [phase, game, saveAttempt]);

  const onStageClick = (e) => {
    if (phase !== 'playing') return;
    lastClickRef.current = { x: e.clientX, y: e.clientY };
    if (Date.now() < cooldownUntil) {
      // 黙って無視せず、待ち中であることを照準の上で知らせる
      setCooldownDenied({ at: Date.now(), sec: Math.ceil((cooldownUntil - Date.now()) / 1000) });
      setNow(Date.now());
      return;
    }
    const startCooldown = () => {
      const until = Date.now() + CLICK_COOLDOWN_MS;
      setCooldownUntil(until);
      setCooldownDenied(null);
      setNow(Date.now());
    };
    const { x, y } = stageRef.current.toStagePoint(e.clientX, e.clientY);
    pointerPos.current = { x, y };
    const hit = game.chameleons.find(
      (c) => !found.includes(c.id) && hits(c, masksRef.current[c.id], x, y),
    );
   
    startCooldown();
    if (hit) {
      setFound((f) => [...f, hit.id]);
      const hState = hideScoresRef.current[hit.id];
      if (hState) {
        hState.wasVisible = true;
        hState.currentScore *= 0.5;
        hState.isFound = true;
      }
      const finderScore = Math.round(100 + 20 * Math.max(0, (deadline - Date.now()) / 1000) / game.timeLimit);
      setTotalScore((prev) => prev + finderScore);
      // 点数はサーバーが決める。表示はすぐに出し、記録された点数が届いたらそれに合わせる
      api.reportFound(game.gameId, hit.id, finderScore, activePlayerNameRef.current)
        .then((res) => {
          if (Number.isFinite(res?.score) && res.score !== finderScore) {
            setTotalScore((prev) => prev + res.score - finderScore);
          }
        })
        .catch(() => {});
      setAnimatingFound((af) => [...af, hit.id]);
      setTimeout(() => {
        setAnimatingFound((a) => a.filter((id) => id !== hit.id));
      }, 2000);
    } else {
      const miss = { id: Date.now() + Math.random(), x, y };
      setMisses((m) => [...m, miss]);
      setTimeout(() => setMisses((m) => m.filter((v) => v.id !== miss.id)), 700);
    }
  };

  const total = game?.chameleons.length ?? 0;
  const over = phase === 'over';
  const showShadow = phase === 'playing' && aim;
  const shadowRadius = RETICLE_RADIUS_PX / zoom;

  // まだ見つかっていない（＝場所を知られてはいけない）カメレオン。canvas タイルに描く
  const secretFigures = useMemo(() => {
    if (phase !== 'playing' || !game) return [];
    return game.chameleons
      .filter((c) => !found.includes(c.id))
      .map((c) => ({ key: c.id, x: c.x, y: c.y, w: c.w, h: c.h, img: imagesRef.current[c.id] }));
  }, [phase, game, found]);

  const onMouseMove = (e) => {
    if (stageRef.current) {
      const { x, y } = stageRef.current.toStagePoint(e.clientX, e.clientY);
      pointerPos.current = { x, y };
    }
  };

  useEffect(() => {
    if (phase !== 'playing' || !game?.chameleons) return;
    game.chameleons.forEach((c) => {
      if (!hideScoresRef.current[c.id]) {
        hideScoresRef.current[c.id] = { currentScore: 0, wasVisible: false, isFound: false };
      }
    });
    const updateScores = (addScore) => {
      if (!stageRef.current) return;
      const viewRect = stageRef.current.viewRect();
      game.chameleons.forEach((c) => {
        const state = hideScoresRef.current[c.id];
        if (state.isFound) return;
        const isVisible = (
          c.x + c.w >= viewRect.left &&
          c.x <= viewRect.right &&
          c.y + c.h >= viewRect.top &&
          c.y <= viewRect.bottom
        );
        if (isVisible) {
          state.wasVisible = true;
          const cx = c.x + c.w / 2;
          const cy = c.y + c.h / 2;
          const dist = Math.hypot(pointerPos.current.x - cx, pointerPos.current.y - cy);
          const maxDist = 200;
          const ratio = Math.max(0, Math.min(1, 1 - dist / maxDist));
          const multiplier = 1 + 2 * ratio;
          if (addScore) state.currentScore += multiplier;
        }
      });
    };
    updateScores(false);
    const interval = setInterval(() => updateScores(true), 1000);
    return () => clearInterval(interval);
  }, [phase, game]);

useEffect(() => {
    if (phase !== 'playing' || !game?.chameleons) return;

    const hitThreshold = HINT_THRESHOLDS.find(
      (sec) => remaining <= sec && remaining > 0 && !triggeredHintsRef.current.has(sec),
    );
    if (!hitThreshold) return;

    HINT_THRESHOLDS.forEach((sec) => {
      if (remaining <= sec) triggeredHintsRef.current.add(sec);
    });

    const unfound = game.chameleons.filter((c) => !found.includes(c.id));
    if (unfound.length === 0) return;

    // メッセージ＆効果音用の処理
    if (stageRef.current) {
      const viewRect = stageRef.current.viewRect();
      const inViewCount = unfound.filter(
        (c) =>
          c.x + c.w >= viewRect.left &&
          c.x <= viewRect.right &&
          c.y + c.h >= viewRect.top &&
          c.y <= viewRect.bottom,
      ).length;
      setHintCount(inViewCount);
      playHintSound();
    }

    setHintUntil(Date.now() + HINT_DURATION_MS);
  }, [phase, remaining, game, found]);

  // 矢印の位置計算（※ pointerRef.current のnullチェックを追加）
  let activeArrow = null;
  if (phase === 'playing' && now < hintUntil && game?.chameleons && stageRef.current && pointerRef.current) {
    const unfound = game.chameleons.filter((c) => !found.includes(c.id));
    if (unfound.length > 0) {
      // 照準位置（ページ座標）。ステージ外にカーソルがある場合は画面中心を基準にする
      const origin =
        aim ??
        (pointerPos.current.x > -9000 ? pointerPos.current : stageRef.current.viewCenter());

      let nearest = null;
      let minDist = Infinity;
      for (const c of unfound) {
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        const d = Math.hypot(cx - origin.x, cy - origin.y);
        if (d < minDist) {
          minDist = d;
          nearest = { cx, cy };
        }
      }
      if (nearest) {
        const dir = getDirectionInfo(nearest.cx - origin.x, nearest.cy - origin.y);
        activeArrow = {
          ...dir,
          x: pointerRef.current.x + dir.offsetX,
          y: pointerRef.current.y + dir.offsetY,
        };
      }
    }
  }

  // 終わったときにタイマーの代わりに出す札（タイムアップ・全員発見・途中で終了）
  const result = remaining <= 0 ? { text: 'タイムアップ！', color: 'hide' }
    : found.length === total ? { text: '全員発見！', color: 'find' }
    : { text: '終了', color: 'paper' };

  return (
    <div className="b-game">
      <header className="b-hud">
        <div className="b-hud__group b-hud__group--start">
          <Tab as="a" href="#/" tilt={-2}>← ホーム</Tab>
          <span className="b-hud__mode">見つける</span>
          <label className="b-hud__zoom">
  <Icon name="search" size={18} />
  <span>背景の拡大縮小</span>
  <Range color="hide" min={1} max={4} step={0.1} value={zoom}
    onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110 }} />
  <span className="b-hud__zoom-value">{Math.round(zoom * 100)}%</span>
</label>
        </div>
        <div className="b-hud__center">
          {game && phase === 'playing' && (
            <Timer time={fmt(remaining)} ratio={remaining / (game.timeLimit ?? DEFAULT_TIME_LIMIT_SEC)} danger={remaining < 30} />
          )}
          {over && (
            <div className="b-result-summary">
              <span className={`b-result b-fill--${result.color}`} style={tiltStyle(-2)}>{result.text}</span>
              <span className="b-result-score">スコア：{totalScore}点</span>
            </div>
          )}
        </div>
        <div className="b-hud__group b-hud__group--end">
          {game && phase === 'playing' && (
            <>
              {cooldownRemaining > 0 && (
                <span className="b-cooldown" title="クールタイム中はクリックできません">
                  <span className="b-cooldown__label">
                    <Icon name="hourglass" size={16} />{Math.ceil(cooldownRemaining)}秒
                  </span>
                  <CooldownBar key={cooldownUntil} until={cooldownUntil} />
                </span>
              )}
              <span className="b-found" role="img" aria-label={`${total}体中${found.length}体発見`}>
                {Array.from({ length: total }, (_, i) => (
                  <FigureIcon key={i} className={`b-found__icon${i < found.length ? ' is-found' : ''}`} />
                ))}
              </span>
              <span className="b-count">{found.length}<small>/{total}</small></span>
              <Tab pressed={showFound} color="accent" onClick={() => setShowFound((v) => !v)}>発見済みを表示</Tab>
              <Tab tilt={2} onClick={() => setPhase('over')}>終了</Tab>
            </>
          )}
          {over && error && (
            <>
              <span className="b-hud__error" role="alert">{error}</span>
              <Tab onClick={() => setSaveAttempt((n) => n + 1)}>もう一度保存する</Tab>
            </>
          )}
          {over && <Sticker as="a" href={`#/find?site=${siteId}&t=${Date.now()}`} size="s" color="find" tilt={2}>もう一度</Sticker>}
        </div>
      </header>

      {domReticle && (
        <Reticle ref={reticleRef} cooling={cooling} cooldownUntil={cooldownUntil} denied={cooldownDenied} />
      )}
      {touchOnly && cooling && lastClickRef.current && (
        <Reticle
          key={cooldownUntil}
          cooling
          cooldownUntil={cooldownUntil}
          denied={cooldownDenied}
          pos={lastClickRef.current}
        />
      )}
      {cooling && cooldownDenied && lastClickRef.current && (
        <CooldownDenied
          key={cooldownDenied.at}
          x={lastClickRef.current.x}
          y={lastClickRef.current.y}
          sec={cooldownDenied.sec}
        />
      )}

    {/*矢印のヒント表示ここから*/}
      {activeArrow && (
        <div
          className="find-reticle-arrow"
          style={{ left: activeArrow.x, top: activeArrow.y }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 40 40"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: `rotate(${activeArrow.arrowDeg}deg)` }}
          >
            <path d="M20 33V7M8 19l12-12 12 12" />
          </svg>
        </div>
      )}
      {/*矢印のヒント表示ここまで*/}

      {/* メッセージのヒント表示ここから */}
      {phase === 'playing' && now < hintUntil && hintCount !== null && (
        <div className="find-inview-toast is-large" role="status" aria-live="polite">
          この画面内にカメレオンが <strong>{hintCount}</strong> 体います
        </div>
      )}
      {/* メッセージのヒント表示ここまで */}

      <SiteStage
        ref={stageRef}
        siteId={siteId}
        zoom={zoom}
        minZoom={1}
        maxZoom={3}
        onZoomChange={setZoom}
        onReady={() => setStageReady(true)}
        overlayProps={{
          onClick: onStageClick,
          onMouseDown: (e) => {
            if (e.detail > 1) e.preventDefault();
          },
          onMouseMove: (e) => {
            onMouseMove(e);
            pointerRef.current = { x: e.clientX, y: e.clientY };
            scheduleAim();
          },
          onMouseLeave: () => {
            pointerRef.current = null;
            scheduleAim();
          },
          className: `stage-overlay ${phase === 'playing' ? 'seeking' : ''} ${domReticle ? 'dom-reticle' : ''}`,
        }}
      >
        {/* 照準に照らされたときの影。照準と重なっている間だけ出す（画面に見えている手がかりと同じ） */}
        {showShadow && secretFigures.map((f) => (
          <FlashlightShadow key={f.key} obj={f} aim={aim} radius={shadowRadius} />
        ))}
        {game && (
          <FigureTiles width={stageRef.current.size.width} height={stageRef.current.size.height} figures={secretFigures} />
        )}
        {/* 見つけた・終了後に明かしたものだけを要素として出す（輪と名前の札） */}
        {game?.chameleons.map((c) => {
          const isFound = found.includes(c.id);
          const isAnimating = animatingFound.includes(c.id);
          if (!over && !(isFound && (isAnimating || showFound))) return null;
          return (
            <div
              key={c.id}
              className={`chameleon-slot ${isFound ? 'found' : ''} ${over && !isFound ? 'missed' : ''} ${isAnimating ? 'blinking' : ''}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
              <img src={c.image} alt="" draggable={false} />
              {(isFound || over) && <span className="slot-label">{c.name}</span>}
            </div>
          );
        })}
       
        {misses.map((m) => (
          <span key={m.id} className="miss-mark" style={{ left: m.x, top: m.y }}>
            ×
          </span>
        ))}
      </SiteStage>
      {phase === 'empty' && (
        <Modal tapes={['hide', null]} aria-labelledby="find-empty-title">
          <h2 id="find-empty-title" className="b-modal__title">まだ誰も隠れていません</h2>
          <p>まずは隠すモードで隠れてみましょう。</p>
          <div className="b-modal__actions">
            <Sticker as="a" href="#/" tilt={2}>ホームへ</Sticker>
            <Sticker as="a" href={`#/hide?site=${siteId}`} color="hide" tilt={-2}>隠れる</Sticker>
          </div>
        </Modal>
      )}
      {(phase === 'intro' || phase === 'starting') && (
        <Modal tapes={['accent', 'find']} aria-labelledby="find-intro-title">
          <h2 id="find-intro-title" className="b-modal__title">カメレオンを探せ！</h2>
          <p>
            このページのどこかに、最大5体のカメレオンが潜んでいます。<br />
            見つけたらクリック！<br />
            照準を近づけると、カメレオンにうっすら影がつきます。
          </p>
          <div className="b-stats">
            <div className="b-fill--find" style={tiltStyle(-2)}><strong>最大5体</strong><span>潜んでいる</span></div>
            <div className="b-fill--accent" style={tiltStyle(1.5)}><strong>{fmt(DEFAULT_TIME_LIMIT_SEC)}</strong><span>制限時間</span></div>
          </div>
          <p className="b-modal__note">クリックするたびに{CLICK_COOLDOWN_MS / 1000}秒間はクリックできません（当たり・外れのどれでも）</p>
          <label className="b-player-name">
  ランキングに登録する名前（変更できます）
  <input
    ref={playerNameInputRef}
    className="b-input"
    type="text"
    maxLength={20}
    value={playerName}
    onChange={(e) => setPlayerName(e.target.value)}
    onFocus={(e) => e.target.select()}
  />
</label>
{!nameValid && <p className="b-alert">名前を入力してください</p>}
          {error && <p className="b-alert" role="alert">{error}</p>}
          <div className="b-modal__actions">
            <Sticker color="find" tilt={-2} disabled={!stageReady || phase === 'starting' || !nameValid} onClick={start}>
              {!stageReady ? 'ページ読み込み中…' : phase === 'starting' ? '準備中…' : 'スタート'}
            </Sticker>
          </div>
        </Modal>
      )}
    </div>
  );
}