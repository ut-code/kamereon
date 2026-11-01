import { useEffect, useRef, useState } from "react";
import SiteStage from "../components/SiteStage.jsx";
import Icon from "../components/Icon.jsx";
import { POSES, ROTATE_STEP, figureSize } from "../figure.js";
import { Painter, hexToRgb } from "../painter.js";
import { api } from "../api.js";
import { addMyId } from "../myChameleons.js";

const TOOLS = [
  {
    key: "move",
    label: "移動",
    hint: "ドラッグで移動（矢印キーで1pxずつ）",
  },
  {
    key: "pen",
    label: "ペン",
    hint: "重ねて塗るほど少し暗く・鮮やかになります",
  },
  { key: "eraser", label: "消しゴム", hint: "白に戻します" },
];

const ZOOMS = [1, 1.5, 2, 3, 4];
const MAX_DECOYS = 3;
const AUTO_SCROLL_EDGE = 24; // 見えている範囲の上端・下端からこの距離（画面上の px）に入ったら自動スクロール
const AUTO_SCROLL_MAX = 20; // 1フレームあたりの最大スクロール量 (px)
const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

const MAIN = "main";
const figLabel = (f, figs) =>
  f.decoy ? `デコイ${figs.filter((g) => g.decoy).indexOf(f) + 1}` : "本体";

export default function Hide({ siteId }) {
  const stageRef = useRef(null);
  const canvasRefs = useRef({});
  const painters = useRef({});
  const dragRef = useRef(null);
  const nextKey = useRef(1);

  // 本体とデコイ。どれも { key, decoy, x, y, pose, rotation }
  const [figs, setFigs] = useState([]);
  const [activeKey, setActiveKey] = useState(MAIN);
  const [tool, setTool] = useState("move");
  const [color, setColor] = useState("#9aa8b8");
  const [size, setSize] = useState(6);
  const [zoom, setZoom] = useState(1);
  const [outline, setOutline] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const active = figs.find((f) => f.key === activeKey);
  const decoyCount = figs.filter((f) => f.decoy).length;

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
  const newFig = (key, decoy, offset = 0) => {
    const c = stageRef.current.viewCenter();
    const s = figureSize(0);
    return {
      key,
      decoy,
      pose: "stand",
      rotation: 0,
      ...clampPos({ x: c.x - s.w / 2 + offset, y: c.y - s.h / 2 }, s),
    };
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
      painters.current[f.key] = new Painter(el, f.pose, f.rotation);
  };

  // ポーズ・向きの変更（人型の中心がずれないように位置を補正する）
  const reshape = (nextPose, nextRotation) => {
    if (!active) return;
    const painter = painters.current[active.key];
    if (
      painter?.painted &&
      !window.confirm(
        "ポーズや向きを変えると塗りがリセットされます。よろしいですか？",
      )
    )
      return;
    const cur = figureSize(active.rotation);
    const next = figureSize(nextRotation);
    painter?.setPose(nextPose, nextRotation);
    updateFig(active.key, {
      pose: nextPose,
      rotation: nextRotation,
      ...clampPos(
        {
          x: active.x + (cur.w - next.w) / 2,
          y: active.y + (cur.h - next.h) / 2,
        },
        next,
      ),
    });
  };

  // -180 < 角度 <= 180 に正規化
  const rotate = (delta) =>
    reshape(
      active.pose,
      ((((active.rotation + delta + 180) % 360) + 360) % 360) - 180 || 0,
    );

  // ---- 人型の操作（選択 / 移動 / 描画） ----
  const canvasPoint = (key, e) => {
    const canvas = canvasRefs.current[key];
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    ];
  };

  // ドラッグ中の人型の位置（ページ座標でつかんだ点を基準にするので、スクロールしてもポインタに付いてくる）
  const dragPos = (drag) => {
    const p = stageRef.current.toStagePoint(drag.clientX, drag.clientY);
    return clampPos({ x: p.x - drag.grab.x, y: p.y - drag.grab.y }, drag.size);
  };

  // ドラッグ中、人型が見えている範囲の上端・下端に来たら、その方向へ自動でスクロールする
  const autoScroll = () => {
    const drag = dragRef.current;
    if (!drag || drag.painting) return;
    const stage = stageRef.current;
    const pos = dragPos(drag);
    const view = stage.viewRect();
    const edge = AUTO_SCROLL_EDGE / zoom;
    const dy = drag.clientY - drag.startY; // つかんだ時点で端にあっても、端へ向かって動かすまではスクロールしない
    const over =
      dy < 0
        ? Math.min(0, pos.y - (view.top + edge))
        : dy > 0
          ? Math.max(0, pos.y + drag.size.h - (view.bottom - edge))
          : 0;
    if (over) {
      stage.scrollBy(
        0,
        Math.sign(over) *
          Math.min(AUTO_SCROLL_MAX, Math.ceil((Math.abs(over) * zoom) / 4)),
      );
      if (stage.viewRect().top !== view.top) updateFig(drag.key, dragPos(drag));
    }
    drag.raf = requestAnimationFrame(autoScroll);
  };

  useEffect(() => () => cancelAnimationFrame(dragRef.current?.raf), []);

  const onPointerDown = (f) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveKey(f.key);
    if (tool === "move") {
      const p = stageRef.current.toStagePoint(e.clientX, e.clientY);
      dragRef.current = {
        key: f.key,
        size: figureSize(f.rotation),
        grab: { x: p.x - f.x, y: p.y - f.y },
        startY: e.clientY,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      dragRef.current.raf = requestAnimationFrame(autoScroll);
    } else {
      painters.current[f.key].beginStroke(...canvasPoint(f.key, e), {
        color,
        size,
        erase: tool === "eraser",
      });
      dragRef.current = { key: f.key, painting: true };
    }
  };

  const onPointerMove = (f) => (e) => {
    const drag = dragRef.current;
    if (!drag || drag.key !== f.key) return;
    if (drag.painting) {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e];
      for (const ev of events)
        painters.current[f.key].strokeTo(...canvasPoint(f.key, ev));
    } else {
      drag.clientX = e.clientX;
      drag.clientY = e.clientY;
      updateFig(f.key, dragPos(drag));
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.painting) painters.current[drag.key].endStroke();
    cancelAnimationFrame(drag?.raf);
    dragRef.current = null;
  };

  // キーボード：矢印で微調整、Ctrl+Z で元に戻す、Ctrl+Shift+Z / Ctrl+Y でやり直す（選択中の人型に対して）
  useEffect(() => {
    const onKey = (e) => {
      if (showHelp) {
        if (e.key === "Escape") setShowHelp(false);
        return;
      }
      if (e.target instanceof HTMLInputElement && e.target.type === "text")
        return;
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "z" || e.key === "y")
      ) {
        e.preventDefault();
        const redo = e.key === "y" || e.shiftKey;
        painters.current[activeKey]?.[redo ? "redo" : "undo"]();
        return;
      }
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
            figureSize(f.rotation),
          ),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeKey, active, showHelp]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickColor = async () => {
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
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
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const toData = (f) => {
      const { w, h } = figureSize(f.rotation);
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
      setSavedId(id);
    } catch (err) {
      setError(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const [r, g, b] = hexToRgb(color);

  return (
    <div className="game-page">
      <header className="toolbar">
        {/* ホーム・モード名（1行目）とツール（2行目） */}
        <div className="toolbar-start">
          <div className="tool-row">
            <a href="#/" className="toolbar-home">
              🦎 ホーム
            </a>
            <span className="toolbar-title">隠れるモード</span>
            <button
              className="help-button"
              onClick={() => setShowHelp(true)}
              title="隠れるモードの説明"
              aria-label="隠れるモードの説明"
            >
              ?
            </button>
          </div>
          <div className="tool-group">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                className={tool === t.key ? "active" : ""}
                onClick={() => setTool(t.key)}
              >
                <Icon name={t.key} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2列×2行：ポーズ / デコイを追加（1行目）、ズーム・枠 / デコイを削除（2行目） */}
        <div className="figure-options palette">
          <div className="tool-group">
            <select
              value={active?.pose ?? "stand"}
              disabled={!active}
              onChange={(e) => reshape(e.target.value, active.rotation)}
            >
              {Object.entries(POSES).map(([k, p]) => (
                <option key={k} value={k}>
                  ポーズ: {p.label}
                </option>
              ))}
            </select>
            <button
              disabled={!active}
              onClick={() => rotate(-ROTATE_STEP)}
              title="左に回す"
              aria-label="左に回す"
            >
              <Icon name="rotateLeft" />
            </button>
            <button
              className="rotation-value"
              disabled={!active}
              onClick={() => active.rotation !== 0 && reshape(active.pose, 0)}
              title="クリックでまっすぐに戻す"
            >
              {active?.rotation ?? 0}°
            </button>
            <button
              disabled={!active}
              onClick={() => rotate(ROTATE_STEP)}
              title="右に回す"
              aria-label="右に回す"
            >
              <Icon name="rotateRight" />
            </button>
          </div>
          <button
            className="decoy-add"
            disabled={!figs.length || decoyCount >= MAX_DECOYS}
            onClick={addDecoy}
            title="見つける人をだますニセモノを置く"
          >
            <Icon name="decoy" /> デコイを追加 ({decoyCount}/{MAX_DECOYS})
          </button>
          <div className="tool-group">
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  🔍 {z * 100}%
                </option>
              ))}
            </select>
            <label className="check-field">
              <input
                type="checkbox"
                checked={outline}
                onChange={(e) => setOutline(e.target.checked)}
              />
              枠を表示
            </label>
          </div>
          {active?.decoy && (
            <button className="decoy-remove" onClick={removeDecoy}>
              <Icon name="trash" /> デコイを削除
            </button>
          )}
        </div>

        {/* ペン・消しゴムの設定（選んでいる間だけ表示。色の設定はペンのときだけ） */}
        {tool !== "move" && (
          <div className="brush-options palette">
            {tool === "pen" && (
              <div className="tool-group">
                <label className="color-field" title={`rgb(${r}, ${g}, ${b})`}>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </label>
                {hasEyeDropper && (
                  <button onClick={pickColor} title="画面上の色を拾う">
                    <Icon name="eyedropper" /> スポイト
                  </button>
                )}
                <button
                  onClick={() => painters.current[activeKey]?.fillAll(color)}
                  title="選択中の人型全体を今の色で1回塗る"
                >
                  <Icon name="fill" /> 全体塗り
                </button>
              </div>
            )}
            <label className="size-field">
              太さ
              <input
                type="range"
                min="1"
                max="24"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
              <span>{size}</span>
            </label>
          </div>
        )}

        {/* 元に戻す・やり直す（1行目）と名前・保存（2行目） */}
        <div className="toolbar-end">
          <div className="tool-group">
            <button
              onClick={() => painters.current[activeKey]?.undo()}
              title="元に戻す (Ctrl+Z)"
              aria-label="元に戻す"
            >
              <Icon name="undo" />
            </button>
            <button
              onClick={() => painters.current[activeKey]?.redo()}
              title="やり直す (Ctrl+Shift+Z)"
              aria-label="やり直す"
            >
              <Icon name="redo" />
            </button>
          </div>
          <div className="tool-group">
            <input
              type="text"
              placeholder="カメレオンの名前"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="primary"
              disabled={!figs.length || saving}
              onClick={save}
            >
              {saving ? "保存中…" : "ここに隠れる！"}
            </button>
          </div>
        </div>
      </header>
      <div className="toolbar-hint">
        {active && (
          <strong className="editing-label">
            {figLabel(active, figs)}を編集中
          </strong>
        )}
        位置: {active ? `(${active.x}, ${active.y})` : "-"}
        {decoyCount > 0 && "　/　デコイをクリックした人は残り時間が減ります"}
        {error && <span className="error">　{error}</span>}
      </div>

      <SiteStage
        ref={stageRef}
        siteId={siteId}
        zoom={zoom}
        onReady={handleReady}
      >
        {figs.map((f) => {
          const { w, h } = figureSize(f.rotation);
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
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ left: f.x, top: f.y, width: w, height: h }}
                onPointerDown={onPointerDown(f)}
                onPointerMove={onPointerMove(f)}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              {outline && (
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
            <h3>ツール</h3>
            <dl>
              {TOOLS.map((t) => (
                <div key={t.key}>
                  <dt>
                    <Icon name={t.key} /> {t.label}
                  </dt>
                  <dd>{t.hint}</dd>
                </div>
              ))}
            </dl>
            <h3>その他</h3>
            <ul>
              <li>
                ポーズを選んだり、
                <Icon name="rotateLeft" /> <Icon name="rotateRight" />
                で回転させたりできます。
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

      {savedId && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>隠れました！🦎</h2>
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
            <div className="modal-actions">
              <a className="button primary" href="#/">
                ホームへ
              </a>
              <a
                className="button"
                href={`#/hide?site=${siteId}&t=${Date.now()}`}
              >
                もう一人隠す
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
