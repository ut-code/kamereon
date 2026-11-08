import { useEffect, useRef, useState } from 'react';
import SiteStage from '../components/SiteStage.jsx';
import Icon from '../components/Icon.jsx';
import { FigureIcon, Modal, Range, Sticker, Tab, Timer, tiltStyle } from '../components/ui.jsx';
import { api } from '../api.js';
import { getMyIds } from '../myChameleons.js';
import './Find.css';

const ZOOMS = [1, 1.5, 2, 3];
const HIT_TOLERANCE = 3; // クリック判定の余裕 (px)
const DECOY_PENALTY_SEC = 10; // デコイをクリックしたときに減る時間
const CLICK_COOLDOWN_MS = 5000; // フィールドをクリックしたあとのクールタイム
const DEFAULT_TIME_LIMIT_SEC = 180; // 制限時間（server/index.js の TIME_LIMIT_SEC と同じ）。スタート前は game.timeLimit がまだ無いので、こちらを表示に使う
const RETICLE_RADIUS_PX = 48; // 照準の円の半径 (画面px)。Find.css の .stage-overlay.seeking のカーソルと合わせる
const SHADOW_MIN_OFFSET = 4; // 影のずれの最小値 (ページpx)
const SHADOW_MAX_EXTRA = 10; // 光源から離れるほど増える影のずれの上限 (ページpx)
const SHADOW_DIST_RATIO = 0.15; // 光源からの距離に対する影のずれの割合

// 画像の不透明ピクセルをクリックしたかどうかを判定するためのマスクを作る
async function loadAlphaMask(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
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

// 懐中電灯（照準）に照らされたときの影。照準の円と重なった部分だけ表示する
function FlashlightShadow({ obj, aim, radius }) {
  // 照準の円とカメレオンの矩形が重なっていなければ何も出さない
  const nx = Math.max(obj.x, Math.min(aim.x, obj.x + obj.w));
  const ny = Math.max(obj.y, Math.min(aim.y, obj.y + obj.h));
  if ((aim.x - nx) ** 2 + (aim.y - ny) ** 2 > radius * radius) return null;

  // 影は光源（照準の中心）から遠ざかる向きにずらす
  const vx = obj.x + obj.w / 2 - aim.x;
  const vy = obj.y + obj.h / 2 - aim.y;
  const dist = Math.hypot(vx, vy);
  const [ux, uy] = dist > 0 ? [vx / dist, vy / dist] : [Math.SQRT1_2, Math.SQRT1_2];
  const len = SHADOW_MIN_OFFSET + Math.min(dist * SHADOW_DIST_RATIO, SHADOW_MAX_EXTRA);
  const dx = ux * len;
  const dy = uy * len;

  return (
    <img
      className="flashlight-shadow"
      src={obj.image}
      alt=""
      draggable={false}
      style={{
        left: dx,
        top: dy,
        // clip-path は影要素自身の座標系なので、照準の中心を影要素基準に直す
        clipPath: `circle(${radius}px at ${aim.x - obj.x - dx}px ${aim.y - obj.y - dy}px)`,
      }}
    />
  );
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export default function Find({ siteId }) {
  const stageRef = useRef(null);
  const masksRef = useRef({});
  const pointerPos = useRef({ x: -9999, y: -9999 });
  const hideScoresRef = useRef({});
  const savedGameRef = useRef(null);
  const [stageReady, setStageReady] = useState(false);
  const [phase, setPhase] = useState('intro'); // intro | starting | playing | over | empty
  const [game, setGame] = useState(null);
  const [found, setFound] = useState([]);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [misses, setMisses] = useState([]);
  const [tripped, setTripped] = useState([]); // 引っかかったデコイの key
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0); // この時刻まではクリックできない
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [animatingFound, setAnimatingFound] = useState([]);
  const [showFound, setShowFound] = useState(false);
  const [aim, setAim] = useState(null); // 照準の中心（ページ座標）。ステージ外なら null
  const pointerRef = useRef(null); // 最後のマウス位置（クライアント座標）
  const aimFrameRef = useRef(null);

  // マウス移動・スクロールのたびに照準位置を更新する（1フレームに1回まで）
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

  const start = async () => {
    setPhase('starting');
    setError('');
    try {
      const g = await api.startGame(siteId, getMyIds());
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
      // デコイは { ...位置, key, owner } に平らにしておく
      const decoys = g.chameleons.flatMap((c) =>
        (c.decoys ?? []).map((d, i) => ({ ...d, key: `${c.id}:${i}`, owner: c.name })),
      );
      const targets = [...g.chameleons.map((c) => [c.id, c.image]), ...decoys.map((d) => [d.key, d.image])];
      const masks = await Promise.all(targets.map(([, image]) => loadAlphaMask(image)));
      masksRef.current = Object.fromEntries(targets.map(([key], i) => [key, masks[i]]));
      setGame({ ...g, decoys });
      setDeadline(Date.now() + g.timeLimit * 1000);
      setNow(Date.now());
      setPhase('playing');
    } catch (err) {
      setError(`ゲームを開始できませんでした: ${err.message}`);
      setPhase('intro');
    }
  };

  // スクロールやズームでマウスの下のページ位置が変わったときも照準を追従させる
  useEffect(() => {
    if (phase !== 'playing') return;
    document.addEventListener('scroll', scheduleAim, true);
    return () => {
      document.removeEventListener('scroll', scheduleAim, true);
      if (aimFrameRef.current != null) cancelAnimationFrame(aimFrameRef.current);
      aimFrameRef.current = null;
    };
  }, [phase]);

  // タイマー
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'playing' && (remaining <= 0 || found.length === game.chameleons.length)) setPhase('over');
  }, [phase, remaining, found, game]);

  // 終了ボタン・全員発見・時間切れで共通の保存処理を使う。
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
    if (phase !== 'playing' || Date.now() < cooldownUntil) return;
    const startCooldown = () => {
      const until = Date.now() + CLICK_COOLDOWN_MS;
      setCooldownUntil(until);
      setNow(Date.now());
    };
    const { x, y } = stageRef.current.toStagePoint(e.clientX, e.clientY);
    pointerPos.current = { x, y };
    const hit = game.chameleons.find(
      (c) => !found.includes(c.id) && hits(c, masksRef.current[c.id], x, y),
    );
    const decoy = !hit && game.decoys.find(
      (d) => !tripped.includes(d.key) && hits(d, masksRef.current[d.key], x, y),
    );
    startCooldown(); // 当たり・デコイ・外れのどれでもクールタイムを発動する
    if (hit) {
      setFound((f) => [...f, hit.id]);
      const hState = hideScoresRef.current[hit.id];
      if (hState) {
        hState.wasVisible = true;
        hState.currentScore *= 0.5;
        hState.isFound = true;
      }
      const finderScore = Math.round(100 + 20 * Math.max(0, (deadline - Date.now()) / 1000) / game.timeLimit);
      api.reportFound(game.gameId, hit.id, finderScore).catch(() => {});
      setAnimatingFound((af) => [...af, hit.id]);
      setTimeout(() => {
        setAnimatingFound((a) => a.filter((id) => id !== hit.id));
      }, 2000);
    } else if (decoy) {
      setTripped((t) => [...t, decoy.key]);
      setDeadline((d) => d - DECOY_PENALTY_SEC * 1000);
      const miss = { id: Date.now() + Math.random(), x, y, decoy: true };
      setMisses((m) => [...m, miss]);
      setTimeout(() => setMisses((m) => m.filter((v) => v.id !== miss.id)), 1200);
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

  // 終わったときにタイマーの代わりに出す札（タイムアップ・全員発見・途中で終了）
  const result = remaining <= 0 ? { text: 'タイムアップ！', color: 'hide' }
    : found.length === total ? { text: '全員発見！', color: 'find' }
    : { text: '終了', color: 'paper' };

  return (
    <div className="b-game">
      <header className="b-hud">
        {/* 左：ホーム、モード名、倍率 */}
        <div className="b-hud__group b-hud__group--start">
          <Tab as="a" href="#/" tilt={-2}>← ホーム</Tab>
          <span className="b-hud__mode">見つける</span>
          <label className="b-hud__zoom">
            <Icon name="search" size={18} />
            <span className="b-sr-only">表示の倍率</span>
            <Range min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110 }} />
            <span className="b-hud__zoom-value">{Math.round(zoom * 100)}%</span>
          </label>
        </div>

        {/* 真ん中：残り時間。終了後は結果 */}
        <div className="b-hud__center">
          {game && phase === 'playing' && (
            <Timer time={fmt(remaining)} ratio={remaining / (game.timeLimit ?? DEFAULT_TIME_LIMIT_SEC)} danger={remaining < 30} />
          )}
          {over && <span className={`b-result b-fill--${result.color}`} style={tiltStyle(-2)}>{result.text}</span>}
        </div>

        {/* 右：クールタイム、残りの数、各ボタン */}
        <div className="b-hud__group b-hud__group--end">
          {game && phase === 'playing' && (
            <>
              {cooldownRemaining > 0 && (
                <span className="b-cooldown" title="クールタイム中はクリックできません">
                  <Icon name="hourglass" size={16} />{Math.ceil(cooldownRemaining)}秒
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

      <SiteStage
        ref={stageRef}
        siteId={siteId}
        zoom={zoom}
        onReady={() => setStageReady(true)}
        overlayProps={{
          onClick: onStageClick,
          // ダブルクリック以降のクリックでブラウザが範囲選択を始めないようにする
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
          className: `stage-overlay ${phase === 'playing' ? 'seeking' : ''}`,
        }}
      >
        {game?.chameleons.map((c) => {
          const isFound = found.includes(c.id);
          const isAnimating = animatingFound.includes(c.id);
          if (phase === 'playing' && isFound && !isAnimating && !showFound) {
            return null;
          }
          return (
            <div
              key={c.id}
              className={`chameleon-slot ${isFound ? 'found' : ''} ${over && !isFound ? 'missed' : ''} ${isAnimating ? 'blinking' : ''}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
              {showShadow && !isFound && <FlashlightShadow obj={c} aim={aim} radius={shadowRadius} />}
              <img src={c.image} alt="" draggable={false} />
              {(isFound || over) && <span className="slot-label">{c.name}</span>}
            </div>
          );
        })}
        {game?.decoys.map((d) => {
          const isTripped = tripped.includes(d.key);
          return (
            <div
              key={d.key}
              className={`chameleon-slot decoy ${isTripped ? 'tripped' : ''} ${over ? 'exposed' : ''}`}
              style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
            >
              {showShadow && !isTripped && <FlashlightShadow obj={d} aim={aim} radius={shadowRadius} />}
              <img src={d.image} alt="" draggable={false} />
              {(isTripped || over) && <span className="slot-label">デコイ（{d.owner}）</span>}
            </div>
          );
        })}
        {misses.map((m) => (
          <span key={m.id} className={`miss-mark ${m.decoy ? 'decoy' : ''}`} style={{ left: m.x, top: m.y }}>
            {m.decoy ? `デコイ！ −${DECOY_PENALTY_SEC}秒` : '×'}
          </span>
        ))}
      </SiteStage>

      {phase === 'empty' && (
        <Modal tapes={['hide', null]} aria-labelledby="find-empty-title">
          <h2 id="find-empty-title" className="b-modal__title">まだ誰も隠れていません</h2>
          <p>自分が隠したカメレオンは出題されません。<br />まずは隠すモードで隠れてみましょう。</p>
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
            <div className="b-fill--hide" style={tiltStyle(-1)}><strong>−{DECOY_PENALTY_SEC}秒</strong><span>デコイを押すと</span></div>
          </div>
          <p className="b-modal__note">クリックするたびに{CLICK_COOLDOWN_MS / 1000}秒間はクリックできません（当たり・外れ・デコイのどれでも）</p>
          {error && <p className="b-alert" role="alert">{error}</p>}
          <div className="b-modal__actions">
            <Sticker color="find" tilt={-2} disabled={!stageReady || phase === 'starting'} onClick={start}>
              {!stageReady ? 'ページ読み込み中…' : phase === 'starting' ? '準備中…' : 'スタート'}
            </Sticker>
          </div>
        </Modal>
      )}
    </div>
  );
}
