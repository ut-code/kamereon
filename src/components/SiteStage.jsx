import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { SITES, siteImageUrl } from '../../server/sites.js';

// 対象のWebページを書き出した1枚の画像として幅 site.width で表示し、その上にカメレオン用のレイヤーを重ねる。
// スクロールは外側の div が担当するので、画面上のカメレオンの座標 = 画像上の座標 (px) になる。
// 保存するときは画像に対する相対座標 (0〜1) にするので、toRelative / fromRelative で変換する。
// onZoomChange を渡すと、トラックパッドのピンチ（と Ctrl+ホイール）で minZoom〜maxZoom の範囲で拡大・縮小できる。
const PINCH_SPEED = 0.01; // ピンチ1回分の deltaY に対する拡大率の変化の速さ

const SiteStage = forwardRef(function SiteStage({
  siteId, zoom = 1, minZoom = 1, maxZoom = 3, onZoomChange, onReady, overlayProps, children,
}, ref) {
  const site = SITES[siteId];
  const scrollRef = useRef(null);
  const sizerRef = useRef(null);
  const overlayRef = useRef(null);
  const imgRef = useRef(null);
  const [height, setHeight] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const width = site?.width ?? 0;

  // 今見えている範囲（ページ座標）。スクロール領域の中でページは中央寄せされ、左右に余白があることがあるので、
  // スクロール量からではなく、スクロール領域とページ（overlay）の画面上の位置の差から求める
  const viewRect = () => {
    const el = scrollRef.current;
    const view = el.getBoundingClientRect();
    const page = overlayRef.current.getBoundingClientRect();
    return {
      left: (view.left - page.left) / zoom,
      right: (view.left + el.clientWidth - page.left) / zoom,
      top: (view.top - page.top) / zoom,
      bottom: (view.top + el.clientHeight - page.top) / zoom,
    };
  };

  useImperativeHandle(ref, () => ({
    // クライアント座標 → ページ座標
    toStagePoint(clientX, clientY) {
      const rect = overlayRef.current.getBoundingClientRect();
      return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    },
    // 今見えている範囲の中心（ページ座標）
    viewCenter() {
      const r = viewRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    },
    // 今見えている範囲（ページ座標）。ズームと横スクロールも反映する。
    // ページより画面が広いときは、ページの左右の余白も含む（left が負、right がページ幅より大きくなる）
    viewRect,
    // 画面上の px 単位で即座にスクロールする
    scrollBy(dx, dy) {
      scrollRef.current.scrollBy(dx, dy);
    },
    scrollToPoint(x, y, behavior = 'smooth') {
      const el = scrollRef.current;
      el.scrollTo({ left: x * zoom - el.clientWidth / 2, top: y * zoom - el.clientHeight / 2, behavior });
    },
    // ページ座標 (px) の {x, y, w, h} ⇔ 画像に対する相対座標 (0〜1)
    toRelative: (r) => ({ ...r, x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height }),
    fromRelative: (r) => ({ ...r, x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height }),
    // ページ座標 (x, y) にあるページ画像の色を "#rrggbb" で返す。範囲外や読めないときは null。
    // EyeDropper API の無いブラウザで、背景から色を拾うのに使う
    sampleColor(x, y) {
      const img = imgRef.current;
      if (!img?.naturalWidth || !height || !(x >= 0 && x < width && y >= 0 && y < height)) return null;
      // 画像全体を canvas に写すと大きすぎるので、必要な1ピクセルだけを写す
      const px = Math.min(img.naturalWidth - 1, Math.floor((x * img.naturalWidth) / width));
      const py = Math.min(img.naturalHeight - 1, Math.floor((y * img.naturalHeight) / height));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      try {
        ctx.drawImage(img, px, py, 1, 1, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      } catch {
        return null; // 別オリジンの画像などで読めないとき
      }
    },
    size: { width, height },
  }), [zoom, width, height]);

  const handleLoad = async (e) => {
    const img = e.currentTarget;
    // 画像全体の展開（デコード）が終わってから準備完了にする。
    // 大きな画像は展開が後回しになり、スクロール中にカメレオンだけ先に見えてしまうため。
    await img.decode().catch(() => {});
    // 表示幅は固定し、高さは画像の縦横比から決める
    setHeight((width * img.naturalHeight) / img.naturalWidth);
    setLoaded(true);
  };

  // 高さが決まって ref の size が更新されてから準備完了を知らせる
  useEffect(() => {
    if (loaded) onReady?.();
  }, [loaded]);

  // ズーム変更時、基準点（ピンチなら指の位置、それ以外は画面の中心）の下にあるページ上の点が動かないようにスクロール位置を補正する
  const prevZoom = useRef(zoom);
  const prevOffset = useRef({ left: 0, top: 0 }); // ページが画面より狭いときの中央寄せの余白
  const anchorRef = useRef(null); // スクロール領域内の基準点 (px)。null なら中心
  const beforeZoom = useRef(null); // ズーム変更直前のスクロール位置

// レンダリング中（DOM がまだ古いサイズのうち）に位置を控える
if (prevZoom.current !== zoom && !beforeZoom.current && scrollRef.current) {
  beforeZoom.current = {
    left: scrollRef.current.scrollLeft,
    top: scrollRef.current.scrollTop,
  };
}
  // 最後のマウス位置を基準点にする（スライダーやキー操作で倍率を変えたときも、カーソルの下を動かさない）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const track = (e) => {
      const r = el.getBoundingClientRect();
      anchorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointermove', track);
    el.addEventListener('wheel', track, { passive: true });
    return () => {
      el.removeEventListener('pointermove', track);
      el.removeEventListener('wheel', track);
    };
  }, [site]);
  useLayoutEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  const ratio = zoom / prevZoom.current;
  if (ratio !== 1 && beforeZoom.current) {
    const ax = anchorRef.current?.x ?? el.clientWidth / 2;
    const ay = anchorRef.current?.y ?? el.clientHeight / 2;
    const { left, top } = beforeZoom.current;
    el.scrollLeft = (left + ax) * ratio - ax;
    el.scrollTop = (top + ay) * ratio - ay;
  }
  beforeZoom.current = null;
  prevZoom.current = zoom;
}, [zoom]);
  // ピンチで拡大・縮小する。ブラウザ自体のページ拡大は止める
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const pinchable = Boolean(onZoomChange);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinchable) return;
    const clamp = (z) => Math.min(maxZoom, Math.max(minZoom, z));
    const zoomAt = (next, clientX, clientY) => {
      next = clamp(next);
      if (next === zoomRef.current) return;
      const rect = el.getBoundingClientRect();
      anchorRef.current = { x: clientX - rect.left, y: clientY - rect.top };
      zoomRef.current = next; // 再描画の前に次のイベントが来ても、続きから計算する
      onZoomChangeRef.current?.(next);
    };
    // Chrome・Edge・Firefox：ピンチは ctrlKey 付きの wheel イベントになる
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // 行単位なら px に直す
      zoomAt(zoomRef.current * Math.exp(-delta * PINCH_SPEED), e.clientX, e.clientY);
    };
    // Safari：独自の gesture イベントで、e.scale がピンチ開始からの倍率
    let gestureStart = 1;
    const onGestureStart = (e) => {
      e.preventDefault();
      gestureStart = zoomRef.current;
    };
    const onGestureChange = (e) => {
      e.preventDefault();
      zoomAt(gestureStart * e.scale, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [pinchable, minZoom, maxZoom, site]);

  if (!site) return <div className="stage-error">サイト「{siteId}」は登録されていません。</div>;

  return (
    <div className="stage-scroll" ref={scrollRef}>
      <div className="stage-sizer" ref={sizerRef} style={{ width: width * zoom, height: height * zoom }}>
        <div
          className="stage"
          style={{ width, height, transform: `scale(${zoom})` }}
        >
          <img
            ref={imgRef}
            src={siteImageUrl(siteId)}
            alt={site.title}
            width={width}
            height={height || undefined}
            draggable={false}
            // 展開を後回しにせず、上に重なるカメレオンと同時に描かせる
            decoding="sync"
            onLoad={handleLoad}
            onError={() => setFailed(true)}
          />
          <div className="stage-overlay" ref={overlayRef} {...overlayProps}>
            {loaded && children}
          </div>
        </div>
      </div>
      {!loaded && (
        <div className="stage-loading">{failed ? 'ページの画像を読み込めませんでした。' : 'ページを読み込み中…'}</div>
      )}
    </div>
  );
});

export default SiteStage;
