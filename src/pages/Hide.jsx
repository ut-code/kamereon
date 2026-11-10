import { useEffect, useRef, useState } from 'react';
import SiteStage from '../components/SiteStage.jsx';
import { POSES, ROTATE_STEP, figureSize } from '../figure.js';
import { Painter, hexToRgb } from '../painter.js';
import { api } from '../api.js';
import { addMyId } from '../myChameleons.js';

const TOOLS = [
  { key: 'move', label: '✋ 移動', hint: 'ドラッグで移動（矢印キーで1pxずつ）' },
  { key: 'pen', label: '🖊 ペン', hint: '重ねて塗るほど少し暗く・鮮やかになります' },
  { key: 'eraser', label: '🩹 消しゴム', hint: '白に戻します' },
];

const ZOOMS = [1, 1.5, 2, 3, 4];
const MAX_DECOYS = 3;
const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

const MAIN = 'main';
const figLabel = (f, figs) =>
  f.decoy ? `デコイ${figs.filter((g) => g.decoy).indexOf(f) + 1}` : '本体';

export default function Hide({ siteId }) {
  const stageRef = useRef(null);
  const canvasRefs = useRef({});
  const painters = useRef({});
  const dragRef = useRef(null);
  const nextKey = useRef(1);

  // 本体とデコイ。どれも { key, decoy, x, y, pose, rotation }
  const [figs, setFigs] = useState([]);
  const [activeKey, setActiveKey] = useState(MAIN);
  const [tool, setTool] = useState('move');
  const [color, setColor] = useState('#9aa8b8');
  const [size, setSize] = useState(6);
  const [zoom, setZoom] = useState(1);
  const [outline, setOutline] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState('');

  const active = figs.find((f) => f.key === activeKey);
  const decoyCount = figs.filter((f) => f.decoy).length;

  const updateFig = (key, patch) =>
    setFigs((fs) => fs.map((f) => (f.key === key ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f)));

  const clampPos = (p, s) => {
    const { width, height } = stageRef.current.size;
    return {
      x: Math.round(Math.min(Math.max(p.x, 0), width - s.w)),
      y: Math.round(Math.min(Math.max(p.y, 0), height - s.h)),
    };
  };

  // 今見えている範囲の中心（横に少しずらせる）に新しい人型を置く
  const newFig = (key, decoy, offset = 0) => {
    const c = stageRef.current.viewCenter();
    const s = figureSize(0);
    return { key, decoy, pose: 'stand', rotation: 0, ...clampPos({ x: c.x - s.w / 2 + offset, y: c.y - s.h / 2 }, s) };
  };

  const handleReady = () => setFigs([newFig(MAIN, false)]);

  const addDecoy = () => {
    if (decoyCount >= MAX_DECOYS) return;
    const key = `decoy-${nextKey.current++}`;
    setFigs((fs) => [...fs, newFig(key, true, (decoyCount + 1) * 90)]);
    setActiveKey(key);
  };

  const removeDecoy = () => {
    if (!active?.decoy) return;
    if (painters.current[active.key]?.painted && !window.confirm('このデコイを削除しますか？')) return;
    delete painters.current[active.key];
    delete canvasRefs.current[active.key];
    setFigs((fs) => fs.filter((f) => f.key !== active.key));
    setActiveKey(MAIN);
  };

  // canvas が表示されたら Painter を作る（再描画では作り直さない）
  const bindCanvas = (f) => (el) => {
    if (!el) return;
    canvasRefs.current[f.key] = el;
    if (!painters.current[f.key]) painters.current[f.key] = new Painter(el, f.pose, f.rotation);
  };

  // ポーズ・向きの変更（人型の中心がずれないように位置を補正する）
  const reshape = (nextPose, nextRotation) => {
    if (!active) return;
    const painter = painters.current[active.key];
    if (painter?.painted && !window.confirm('ポーズや向きを変えると塗りがリセットされます。よろしいですか？')) return;
    const cur = figureSize(active.rotation);
    const next = figureSize(nextRotation);
    painter?.setPose(nextPose, nextRotation);
    updateFig(active.key, {
      pose: nextPose,
      rotation: nextRotation,
      ...clampPos({ x: active.x + (cur.w - next.w) / 2, y: active.y + (cur.h - next.h) / 2 }, next),
    });
  };

  // -180 < 角度 <= 180 に正規化
  const rotate = (delta) =>
    reshape(active.pose, ((((active.rotation + delta + 180) % 360) + 360) % 360) - 180 || 0);

  // ---- 人型の操作（選択 / 移動 / 描画） ----
  const canvasPoint = (key, e) => {
    const canvas = canvasRefs.current[key];
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    ];
  };

  const onPointerDown = (f) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveKey(f.key);
    if (tool === 'move') {
      dragRef.current = { key: f.key, startX: e.clientX, startY: e.clientY, origin: { x: f.x, y: f.y } };
    } else {
      painters.current[f.key].beginStroke(...canvasPoint(f.key, e), { color, size, erase: tool === 'eraser' });
      dragRef.current = { key: f.key, painting: true };
    }
  };

  const onPointerMove = (f) => (e) => {
    const drag = dragRef.current;
    if (!drag || drag.key !== f.key) return;
    if (drag.painting) {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e];
      for (const ev of events) painters.current[f.key].strokeTo(...canvasPoint(f.key, ev));
    } else {
      updateFig(f.key, clampPos(
        {
          x: drag.origin.x + (e.clientX - drag.startX) / zoom,
          y: drag.origin.y + (e.clientY - drag.startY) / zoom,
        },
        figureSize(f.rotation),
      ));
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.painting) painters.current[drag.key].endStroke();
    dragRef.current = null;
  };

  // キーボード：矢印で微調整、Ctrl+Z で元に戻す（選択中の人型に対して）
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        painters.current[activeKey]?.undo();
        return;
      }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d && active) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        updateFig(activeKey, (f) => clampPos({ x: f.x + d[0] * step, y: f.y + d[1] * step }, figureSize(f.rotation)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeKey, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickColor = async () => {
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      // 一部ブラウザは rgb(...) 形式で返す
      if (sRGBHex.startsWith('#')) setColor(sRGBHex.slice(0, 7));
      else {
        const [r, g, b] = sRGBHex.match(/\d+/g).map(Number);
        setColor('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
      }
      setTool('pen');
    } catch {
      // キャンセル
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const toData = (f) => {
      const { w, h } = figureSize(f.rotation);
      return { x: f.x, y: f.y, w, h, image: painters.current[f.key].toDataURL() };
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
      setSavedId(id);
    } catch (err) {
      setError(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const currentTool = TOOLS.find((t) => t.key === tool);
  const [r, g, b] = hexToRgb(color);

  return (
    <div className="game-page">
      <header className="toolbar">
        <a href="#/" className="toolbar-home">🦎 ホーム</a>
        <span className="toolbar-title">隠れるモード</span>

        <div className="tool-group">
          {TOOLS.map((t) => (
            <button key={t.key} className={tool === t.key ? 'active' : ''} onClick={() => setTool(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="tool-group">
          <label className="color-field" title={`rgb(${r}, ${g}, ${b})`}>
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool('pen'); }} />
          </label>
          {hasEyeDropper && (
            <button onClick={pickColor} title="画面上の色を拾う">💧 スポイト</button>
          )}
          <label className="size-field">
            太さ
            <input type="range" min="1" max="24" value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <span>{size}</span>
          </label>
          <button onClick={() => painters.current[activeKey]?.fillAll(color)} title="選択中の人型全体を今の色で1回塗る">🪣 全体塗り</button>
          <button onClick={() => painters.current[activeKey]?.undo()} title="Ctrl+Z">↩ 元に戻す</button>
        </div>

        <div className="tool-group">
          <select value={active?.pose ?? 'stand'} disabled={!active} onChange={(e) => reshape(e.target.value, active.rotation)}>
            {Object.entries(POSES).map(([k, p]) => (
              <option key={k} value={k}>ポーズ: {p.label}</option>
            ))}
          </select>
          <button disabled={!active} onClick={() => rotate(-ROTATE_STEP)} title="左に回す">⟲</button>
          <button
            className="rotation-value"
            disabled={!active}
            onClick={() => active.rotation !== 0 && reshape(active.pose, 0)}
            title="クリックでまっすぐに戻す"
          >
            {active?.rotation ?? 0}°
          </button>
          <button disabled={!active} onClick={() => rotate(ROTATE_STEP)} title="右に回す">⟳</button>
        </div>

        <div className="tool-group">
          <button disabled={!figs.length || decoyCount >= MAX_DECOYS} onClick={addDecoy} title="見つける人をだますニセモノを置く">
            🎭 デコイを追加 ({decoyCount}/{MAX_DECOYS})
          </button>
          {active?.decoy && <button onClick={removeDecoy}>🗑 このデコイを削除</button>}
        </div>

        <div className="tool-group">
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => <option key={z} value={z}>🔍 {z * 100}%</option>)}
          </select>
          <label className="check-field">
            <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />
            枠を表示
          </label>
        </div>

        <div className="tool-group toolbar-end">
          <input
            type="text"
            placeholder="カメレオンの名前"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" disabled={!figs.length || saving} onClick={save}>
            {saving ? '保存中…' : 'ここに隠れる！'}
          </button>
        </div>
      </header>
      <div className="toolbar-hint">
        {active && <strong>{figLabel(active, figs)}を編集中</strong>}　{currentTool.hint}
        　/　位置: {active ? `(${active.x}, ${active.y})` : '-'}
        {decoyCount > 0 && '　/　デコイをクリックした人は残り時間が減ります'}
        {error && <span className="error">　{error}</span>}
      </div>

      <SiteStage ref={stageRef} siteId={siteId} zoom={zoom} onReady={handleReady}>
        {figs.map((f) => {
          const { w, h } = figureSize(f.rotation);
          return (
            <div key={f.key}>
              <canvas
                ref={bindCanvas(f)}
                className={[
                  'chameleon editable',
                  `tool-${tool}`,
                  outline && 'outlined',
                  f.decoy && 'decoy',
                  f.key === activeKey && 'active',
                ].filter(Boolean).join(' ')}
                style={{ left: f.x, top: f.y, width: w, height: h }}
                onPointerDown={onPointerDown(f)}
                onPointerMove={onPointerMove(f)}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              {outline && (
                <span className={`fig-tag ${f.decoy ? 'decoy' : ''}`} style={{ left: f.x, top: f.y }}>
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
                <div className="tool-group">
                  {TOOLS.filter((t) => t.key !== "move").map((t) => (
                    <button
                      key={t.key}
                      className={tool === t.key ? "active" : ""}
                      aria-pressed={tool === t.key}
                      onClick={() => { if (!canEdit()) return; onPointerUp(); setSplashes([]); setTool(t.key); }}
                    >
                      <ToolIcon name={t.key} /> {t.label}
                    </button>
                  ))}
                </div>
                <div className="tool-group">
                  <button
                    onClick={() => editPaint("undo")}
                    aria-label="元に戻す"
                    title="元に戻す (Ctrl+Z)"
                  >
                    <Icon name="undo" />
                  </button>
                  <button
                    onClick={() => editPaint("redo")}
                    aria-label="やり直す"
                    title="やり直す (Ctrl+Shift+Z)"
                  >
                    <Icon name="redo" />
                  </button>
                  <button className="hide-paint-close" onClick={closePaint} aria-label="編集を閉じる">×</button>
                </div>
              </div>
              <div className="hide-mode-stack">
                <div className={`hide-paint-row${editingJoints ? "" : " is-inactive"}`}
                  aria-hidden={!editingJoints}>
                  <div className="tool-group" role="group" aria-label="全体の角度">
                    <span>全体の角度</span>
                    <button
                      onClick={() => rotate(-ROTATE_STEP)}
                      title={`左に${ROTATE_STEP}度回す`}
                      aria-label="左に回す"
                    >
                      <Icon name="rotateLeft" />
                    </button>
                    <button
                      className="rotation-value"
                      onClick={() => changeRotation(0)}
                      title="クリックでまっすぐに戻す"
                      aria-label={`角度 ${active.rotation}度。まっすぐに戻す`}
                    >
                      {active.rotation}°
                    </button>
                    <button
                      onClick={() => rotate(ROTATE_STEP)}
                      title={`右に${ROTATE_STEP}度回す`}
                      aria-label="右に回す"
                    >
                      <Icon name="rotateRight" />
                    </button>
                  </div>
                </div>
                <label className={`size-field hide-paint-size${editingJoints ? " is-inactive" : ""}`}
                  aria-hidden={editingJoints}>
                  太さ
                  <input
                    type="range"
                    min="0.2"
                    max="12"
                    step="0.2"
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                  />
                  <span>{size}</span>
                </label>
              </div>
            </div>

            <div className="hide-paint-surface" ref={paintSurfaceRef}>
              <iframe
                ref={paintBackgroundRef}
                className="hide-paint-background"
                title="配置場所の背景"
                src={`/sites/${siteId}`}
                sandbox="allow-scripts allow-same-origin"
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
                    <button onClick={pickColor} title="配置場所の背景から色を拾う">
                      <Icon name="eyedropper" /> スポイト
                    </button>
                  )}
                  <button onClick={() => editPaint("fillAll", color)} title="全体を今の色で1回塗る">
                    <Icon name="fill" /> 全体塗り
                  </button>
                  <button onClick={resetColor} title="塗った色をすべて消して白に戻す">
                    色をリセット
                  </button>
                </InlineColorPicker>
              </div>
              <div className={`hide-joint-help${editingJoints ? "" : " is-inactive"}`}
                aria-hidden={!editingJoints}>
                <p>ひじ・ひざで向きを、手首・足首で曲がり具合を調整できます。緑の点をドラッグするか、選んだ関節を矢印キーで動かしてください。</p>
                <button onClick={resetPoseAndRotation}>
                  ポーズ・角度をリセット
                </button>
              </div>
              <p className={`hide-eraser-help${tool === "eraser" ? "" : " is-inactive"}`}
                aria-hidden={tool !== "eraser"}>
                ドラッグした部分を白に戻します。
              </p>
            </div>
            <footer className="hide-paint-footer">
              <button className="primary" onClick={closePaint}>
                完了
              </button>
            </footer>
          </div>
        </dialog>
      )}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>隠れるモードの遊び方</h2>
            <p>
              人型のカメレオンをページのどこかに置き、背景になじむように色を塗って隠しましょう。
              「ここに隠れる！」を押すと保存され、見つけるモードで他の人に探してもらえます。
            </p>
            <p>隠す制限時間は5分です。時間が来ると編集が終了し、その時点の状態で保存できます。</p>
            <h3>ツール</h3>
            <dl>
              {TOOLS.map((t) => (
                <div key={t.key}>
                  <dt>
                    <ToolIcon name={t.key} /> {t.label}
                  </dt>
                  <dd>{t.hint}</dd>
                </div>
              ))}
            </dl>
            <h3>その他</h3>
            <ul>
              <li>「体型」で細め・標準・太めを切り替えられます。塗りと関節のポーズは引き継がれます。</li>
              <li>
                「ポーズ・角度」の画面で、
                <Icon name="rotateLeft" /> <Icon name="rotateRight" />
                を押すと全体の角度を15度ずつ調整できます。角度の数字を押すとまっすぐに戻ります。
              </li>
              <li>
                <Icon name="decoy" /> デコイ（ニセモノ）を最大{MAX_DECOYS}
                体まで置けます。デコイをクリックした人は残り時間が減ります。
              </li>
              <li>
                Ctrl+Z で元に戻す、Ctrl+Shift+Z でやり直し。矢印キーは Shift
                を押しながらだと10pxずつ移動します。
              </li>
            </ul>
            <div className="modal-actions">
              <button className="primary" onClick={() => setShowHelp(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {timeUp && !savedId && (
        <div className="modal-backdrop">
          <div className="modal hide-timeup" role="dialog" aria-modal="true" aria-labelledby="hide-timeup-title">
            <h2 id="hide-timeup-title">タイムアップ！</h2>
            <p>5分が経過したので、編集を終了しました。<br />今の色・ポーズ・場所で隠せます。</p>
            <input type="text" aria-label="カメレオンの名前" placeholder="カメレオンの名前"
              maxLength={20} value={name} onChange={(e) => setName(e.target.value)} disabled={saving} autoFocus />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="primary" onClick={save} disabled={saving}>
                {saving ? "保存中…" : "この状態で隠す"}
              </button>
              <a className="button" href={`#/hide?site=${siteId}&t=${Date.now()}`}>もう一度</a>
              <a className="button" href="#/">ホームへ</a>
            </div>
          </div>
        </div>
      )}

      {savedId && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>隠れました！🦎</h2>
            <p>
              「{name.trim() || 'ななしのカメレオン'}」がページに潜みました。
              {decoyCount > 0 && <><br />デコイ {decoyCount} 体も配置しました。</>}
              <br />
              何人に探され、何人に見つかったかはホームで確認できます。
            </p>
            <div className="modal-actions">
              <a className="button primary" href="#/">ホームへ</a>
              <a className="button" href={`#/hide?site=${siteId}&t=${Date.now()}`}>もう一人隠す</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
