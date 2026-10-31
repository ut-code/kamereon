import { useEffect, useRef, useState } from 'react';
import SiteStage from '../components/SiteStage.jsx';
import { api } from '../api.js';
import { getMyIds } from '../myChameleons.js';

const ZOOMS = [1, 1.5, 2, 3];
const HIT_TOLERANCE = 3; // クリック判定の余裕 (px)
const DECOY_PENALTY_SEC = 10; // デコイをクリックしたときに減る時間
const CLICK_COOLDOWN_MS = 500; // クリックのクールダウン時間

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

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export default function Find({ siteId }) {
  const stageRef = useRef(null);
  const masksRef = useRef({});
  const [stageReady, setStageReady] = useState(false);
  const [phase, setPhase] = useState('intro'); // intro | starting | playing | over | empty
  const [game, setGame] = useState(null);
  const [found, setFound] = useState([]);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [misses, setMisses] = useState([]);
  const [tripped, setTripped] = useState([]); // 引っかかったデコイの key
  const [zoom, setZoom] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [error, setError] = useState('');
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [animatingFound, setAnimatingFound] = useState([]);
  const [showFound, setShowFound] = useState(false);

  const remaining = Math.max(0, (deadline - now) / 1000);

  const start = async () => {
    setPhase('starting');
    setError('');
    try {
      const g = await api.startGame(siteId, getMyIds());
      if (g.chameleons.length === 0) {
        setPhase('empty');
        return;
      }
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

  // タイマー
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    if (remaining <= 0 || found.length === game.chameleons.length) setPhase('over');
  }, [phase, remaining, found, game]);

  const onStageClick = (e) => {
    if (phase !== 'playing' || isCoolingDown) return;
    const { x, y } = stageRef.current.toStagePoint(e.clientX, e.clientY);
    const hit = game.chameleons.find(
      (c) => !found.includes(c.id) && hits(c, masksRef.current[c.id], x, y),
    );
    const decoy = !hit && game.decoys.find(
      (d) => !tripped.includes(d.key) && hits(d, masksRef.current[d.key], x, y),
    );
    if (hit) {
      setFound((f) => [...f, hit.id]);
      setAnimatingFound((af) => [...af, hit.id]);
      setTimeout(() => {
        setAnimatingFound((a) => a.filter((id) => id !== hit.id));
      }, 2000);
      api.reportFound(game.gameId, hit.id).catch(() => {});
    } else if (decoy) {
      setIsCoolingDown(true);
      setTimeout(() => setIsCoolingDown(false), CLICK_COOLDOWN_MS);
      setTripped((t) => [...t, decoy.key]);
      setDeadline((d) => d - DECOY_PENALTY_SEC * 1000);
      const miss = { id: Date.now() + Math.random(), x, y, decoy: true };
      setMisses((m) => [...m, miss]);
      setTimeout(() => setMisses((m) => m.filter((v) => v.id !== miss.id)), 1200);
    } else {
      setIsCoolingDown(true);
      setTimeout(() => setIsCoolingDown(false), CLICK_COOLDOWN_MS);
      const miss = { id: Date.now() + Math.random(), x, y };
      setMisses((m) => [...m, miss]);
      setTimeout(() => setMisses((m) => m.filter((v) => v.id !== miss.id)), 700);
    }
  };

  const total = game?.chameleons.length ?? 0;
  const over = phase === 'over';

  return (
    <div className="game-page">
    <header className="toolbar">
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
        </div>

        {/* 右側グループ：人型アイコン、カウント、各ボタン */}
        <div className="toolbar-right">
          {game && phase === 'playing' && (
            <>
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
            {over && <button onClick={() => setPanelOpen((v) => !v)}>結果を{panelOpen ? '隠す' : '見る'}</button>}
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
        overlayProps={{ onClick: onStageClick, className: `stage-overlay ${phase === 'playing' ? 'seeking' : ''}` }}
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
              className={`chameleon-slot ${isFound ? 'found' : ''} ${isAnimating ? 'blinking' : ''}`}
              //className={`chameleon-slot ${isFound ? 'found' : ''} ${over && !isFound ? 'revealed' : ''}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            >
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

      {over && panelOpen && (
        <aside className="result-panel">
          <h2>{found.length === total ? '全員発見！🎉' : remaining <= 0 ? 'タイムアップ！' : '結果'}</h2>
          <p className="result-summary">
            {total}人中 <strong>{found.length}人</strong> 見つけました
            {found.length === total && `（残り ${fmt(remaining)}）`}
            {game.decoys.length > 0 && (
              <>
                <br />
                デコイ {game.decoys.length} 体中 {tripped.length} 体に引っかかりました
              </>
            )}
          </p>
          <ul>
            {game.chameleons.map((c) => (
              <li key={c.id} className={found.includes(c.id) ? 'ok' : 'ng'}>
                <img src={c.image} alt="" />
                <div>
                  <div className="result-name">{c.name}</div>
                  <div className="result-state">{found.includes(c.id) ? '発見 ✓' : '見逃し ✗'}</div>
                </div>
                <button onClick={() => stageRef.current.scrollToPoint(c.x + c.w / 2, c.y + c.h / 2)}>場所を見る</button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
