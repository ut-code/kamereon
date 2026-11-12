import { useLayoutEffect, useRef, useState } from 'react';

// 表示する画像そのものから採色する。ズーム・端末の画素密度に依存させない。
export default function BackgroundColorSampler({ image, onPick, onCancel }) {
  const ref = useRef(null);
  const [point, setPoint] = useState({ x: 0.5, y: 0.5 });
  useLayoutEffect(() => {
    const canvas = ref.current;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    canvas.focus();
  }, [image]);
  const choose = ({ x, y }) => {
    const px = Math.min(image.width - 1, Math.max(0, Math.floor(x * image.width)));
    const py = Math.min(image.height - 1, Math.max(0, Math.floor(y * image.height)));
    const [r, g, b] = image.getContext('2d').getImageData(px, py, 1, 1).data;
    onPick('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  };
  return (
    <div className="hide-color-sampler">
      <canvas ref={ref} role="button" tabIndex={0}
        aria-label="背景の色を選ぶ。クリック・タップ、または矢印キーで位置を選んでEnter。Escapeでキャンセル"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          choose({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
        }}
        onKeyDown={(e) => {
          const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(point); }
          else if (moves[e.key]) {
            e.preventDefault(); e.stopPropagation();
            const [dx, dy] = moves[e.key], step = e.shiftKey ? 10 : 1;
            setPoint(p => ({ x: Math.max(0, Math.min(1, p.x + dx * step / image.width)),
              y: Math.max(0, Math.min(1, p.y + dy * step / image.height)) }));
          }
        }} />
      <span className="hide-color-sampler-crosshair" aria-hidden="true"
        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />

    </div>
  );
}
