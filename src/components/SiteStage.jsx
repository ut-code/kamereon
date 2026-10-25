import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SITES } from '../../server/sites.js';

const MIN_HEIGHT = 800;

// 対象のWebページを「ページ全体の高さ」の iframe として表示し、その上にカメレオン用のレイヤーを重ねる。
// スクロールは外側の div が担当するので、カメレオンの座標 = ページ上の座標 (px) になる。
const SiteStage = forwardRef(function SiteStage({ siteId, zoom = 1, onReady, overlayProps, children }, ref) {
  const site = SITES[siteId];
  const scrollRef = useRef(null);
  const overlayRef = useRef(null);
  const iframeRef = useRef(null);
  const observerRef = useRef(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  useImperativeHandle(ref, () => ({
    // クライアント座標 → ページ座標
    toStagePoint(clientX, clientY) {
      const rect = overlayRef.current.getBoundingClientRect();
      return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    },
    // 今見えている範囲の中心（ページ座標）
    viewCenter() {
      const el = scrollRef.current;
      return {
        x: (el.scrollLeft + el.clientWidth / 2) / zoom,
        y: (el.scrollTop + el.clientHeight / 2) / zoom,
      };
    },
    scrollToPoint(x, y, behavior = 'smooth') {
      const el = scrollRef.current;
      el.scrollTo({ left: x * zoom - el.clientWidth / 2, top: y * zoom - el.clientHeight / 2, behavior });
    },
    size: { width: site.width, height },
  }));

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const measure = () => setHeight(Math.max(MIN_HEIGHT, doc.documentElement.scrollHeight));
    measure();
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(doc.body);
    setLoaded(true);
    onReady?.();
  };

  // ズーム変更時、見ている中心がずれないようにスクロール位置を補正する
  const prevZoom = useRef(zoom);
  useEffect(() => {
    const el = scrollRef.current;
    const ratio = zoom / prevZoom.current;
    if (ratio !== 1) {
      el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    }
    prevZoom.current = zoom;
  }, [zoom]);

  if (!site) return <div className="stage-error">サイト「{siteId}」は登録されていません。</div>;

  return (
    <div className="stage-scroll" ref={scrollRef}>
      <div className="stage-sizer" style={{ width: site.width * zoom, height: height * zoom }}>
        <div
          className="stage"
          style={{ width: site.width, height, transform: `scale(${zoom})` }}
        >
          <iframe
            ref={iframeRef}
            title={site.title}
            src={`/sites/${siteId}`}
            sandbox="allow-same-origin"
            width={site.width}
            height={height}
            onLoad={handleLoad}
          />
          <div className="stage-overlay" ref={overlayRef} {...overlayProps}>
            {loaded && children}
          </div>
        </div>
      </div>
      {!loaded && <div className="stage-loading">ページを読み込み中…</div>}
    </div>
  );
});

export default SiteStage;
