import { useEffect, useRef, useState } from 'react';
import SiteStage from '../components/SiteStage.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../api.js';
import { getMyIds } from '../myChameleons.js';

const ZOOMS = [1, 1.5, 2, 3];
const HIT_TOLERANCE = 3; // クリック判定の余裕 (px)
const DECOY_PENALTY_SEC = 10; // デコイをクリックしたときに減る時間
const CLICK_COOLDOWN_MS = 5000; // フィールドをクリックしたあとのクールタイム
const RETICLE_RADIUS_PX = 48; // 照準の円の半径 (画面px)。styles.css の .stage-overlay.seeking のカーソルと合わせる
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
          wasVisible: true, // 出題された時点で画面内に存在するため true
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
    if (phase !== 'playing') return;

    if (remaining <= 0 || found.length === game.chameleons.length) {
      setPhase('over');

      // 【隠れる側】最後まで見つからなかった個体に100点加点し、スコアを四捨五入して一括送信
      const finalScores = {};
      game.chameleons.forEach((c) => {
        const state = hideScoresRef.current[c.id];
        if (state) {
          if (!state.isFound) {
            state.currentScore += 100; // 完走ボーナス
          }
          finalScores[c.id] = {
            score: Math.round(state.currentScore),
            wasVisible: state.wasVisible,
          };
        }
      });

      // サーバーへ終了時一括送信
      api.reportHideScores(game.gameId, finalScores).catch(() => {});
    }
  }, [phase, remaining, found, game]);

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
        hState.currentScore *= 0.5;
        hState.isFound = true;
      }
      const finderScore = Math.round(100 + 20 * remaining / game.timeLimit);
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

    const interval = setInterval(() => {
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

          state.currentScore += 1 * multiplier;
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, game]);

  return (
    <div className="game-page">
      <header className="toolbar find-toolbar">
        {/* 左側グループ：ホーム、タイトル、倍率スライダー */}
        <div className="toolbar-left">
          <a href="#/" className="toolbar-home">🦎 ホーム</a>
          <span className="toolbar-title">見つける</span>
          <div className="tool-group zoom-slider-group">
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="zoom-slider"
            />
          </div>
        </div>

        {/* 中央グループ：半円ゲージタイマー（完全中央固定） */}
        <div className="toolbar-center">
          {game && phase === 'playing' && (() => {
            const timeLimitSec = (game?.timeLimit ?? 180);
            const elapsedRatio = Math.min(1, Math.max(0, (timeLimitSec - remaining) / timeLimitSec));
            const radius = 36;
            const halfCircumference = Math.PI * radius;
            const strokeDashoffset = halfCircumference * (1 - elapsedRatio);

            return (
              <div className={`semi-circle-timer ${remaining < 30 ? 'danger' : ''}`}>
                <svg viewBox="0 0 100 55" className="gauge-svg">
                  <path
                    d="M 14 46 A 36 36 0 0 1 86 46"
                    fill="none"
                    stroke="#dde5da"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 14 46 A 36 36 0 0 1 86 46"
                    fill="none"
                    stroke="var(--green)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={halfCircumference}
                    strokeDashoffset={strokeDashoffset}
                    className="gauge-progress"
                  />
                </svg>
                <span className="digital-clock">{fmt(remaining)}</span>
              </div>
            );
          })()}
          {/* 終了後はタイマーの代わりに結果を表示する */}
          {over && (
            <span className={`game-over-label ${remaining <= 0 ? 'time-up' : ''}`}>
              {remaining <= 0 ? 'タイムアップ！' : found.length === total ? '全員発見！' : '終了'}
            </span>
          )}
        </div>

        {/* 右側グループ：人型アイコン、カウント、各ボタン */}
        <div className="toolbar-right">
          {game && phase === 'playing' && (
            <>
              {cooldownRemaining > 0 && (
                <span className="hud-cooldown" title="クールタイム中はクリックできません">
                  <Icon name="hourglass" /> {Math.ceil(cooldownRemaining)}秒
                </span>
              )}
              <div className="hud-person-group">
                {Array.from({ length: total }).map((_, i) => {
                  const isFound = i < found.length;
                  return (
                    <div key={i} className={`person-icon-wrapper ${isFound ? 'found' : ''}`}>
                      <svg className="person-icon" viewBox="0 0 24 24" width="26" height="26">
                        <circle cx="12" cy="7" r="4" fill="currentColor" />
                        <path d="M12 12c-4.42 0-8 2.24-8 5v2h16v-2c0-2.76-3.58-5-8-5z" fill="currentColor" />
                      </svg>
                      {isFound && <span className="cross-mark">✕</span>}
                    </div>
                  );
                })}
              </div>
              <span className="hud-count-inline">{found.length}/{total}</span>
            </>
          )}

          <div className="tool-group toolbar-buttons">
            {over && <a className="button primary" href={`#/find?site=${siteId}&t=${Date.now()}`}>もう一度</a>}
            {phase === 'playing' && (
              <button onClick={() => setShowFound((v) => !v)}>
                {showFound ? '発見済みを隠す' : '発見済みを表示'}
              </button>
            )}
            {phase === 'playing' && <button onClick={() => setPhase('over')}>終了</button>}
          </div>
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
            {m.decoy ? `デコイ！ -${DECOY_PENALTY_SEC}秒` : '×'}
          </span>
        ))}
      </SiteStage>

      {(phase === 'intro' || phase === 'starting' || phase === 'empty') && (
        <div className="modal-backdrop">
          <div className="modal">
            {phase === 'empty' ? (
              <>
                <h2>まだ誰も隠れていません</h2>
                <p>（自分が隠したカメレオンは出題されません）<br />まずは隠れるモードで隠れてみましょう。</p>
                <div className="modal-actions">
                  <a className="button primary" href={`#/hide?site=${siteId}`}>隠れる</a>
                  <a className="button" href="#/">ホームへ</a>
                </div>
              </>
            ) : (
              <>
                <h2>カメレオンを探せ！</h2>
                <p>
                  このページのどこかに最大5人のカメレオンが潜んでいます。
                  <br />
                  制限時間は <strong>3分</strong>。見つけたらクリック！
                  <br />
                  ただし<strong>デコイ</strong>（ニセモノ）をクリックすると {DECOY_PENALTY_SEC}秒減ります。
                </p>
                {error && <p className="error">{error}</p>}
                <div className="modal-actions">
                  <button className="primary" disabled={!stageReady || phase === 'starting'} onClick={start}>
                    {!stageReady ? 'ページ読み込み中…' : phase === 'starting' ? '準備中…' : 'スタート'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}