import { forwardRef } from 'react';
import Icon from './Icon.jsx';
import './ui.css';

/*
 * 画面の共通部品（B案「きりがみステッカー」。kamereon-design の src/screens/b-common.jsx をもとにしたもの）
 * 指針：紫の地に葉っぱと人型を散らす／ボタンは白い縁のステッカーを少し傾けて貼る／
 * 紙（白い板）はテープで留める／角丸は使わず、影は真下にずらした濃い紫
 *
 * 傾きは --tilt（CSS の変数）で渡す。transform を直接書かないので、ホバーでまっすぐにしたり押した時に沈めたりを CSS で上書きできる
 * 座標を測る要素（ステージ、色塗りのダイアログ、色選び）とその親は傾けないこと。getBoundingClientRect の値がずれる
 */

/** --tilt を付けた style。0 のときは付けない */
export const tiltStyle = (deg, style) => (deg ? { '--tilt': `${deg}deg`, ...style } : style);

/** カクカクした人型（ロゴ・アイコン用）。viewBox は 0 0 88 168 */
export const figurePath = 'M32 4H56V28H62V40L70 92H60L58 60V88H62V166H48V96H40V166H26V88H30V60L28 92H18L26 40V28H32Z';

// 葉っぱ：[x, y, 角度, 倍率, 濃さ]。viewBox 0 0 1280 860 の座標
const LEAVES = [
  [-20, 90, -20, 1.6, 'light'], [40, 270, 25, 1.2, 'dark'], [-10, 520, -35, 1.8, 'light'], [70, 770, 10, 1.4, 'dark'],
  [300, 30, -8, 1, 'dark'], [220, 850, -15, 1.2, 'light'], [1130, 70, 200, 1.6, 'light'], [1290, 250, 160, 1.3, 'dark'],
  [1200, 500, 215, 1.9, 'light'], [1300, 730, 170, 1.5, 'dark'], [930, 20, 190, 1.1, 'dark'], [1040, 860, 195, 1.3, 'light'],
];

/** 紫の地に散らす葉っぱと、葉っぱに紛れた人型。.b-screen の中に置くと、画面の後ろに固定される */
export function Ground() {
  return (
    <svg className="b-ground" viewBox="0 0 1280 860" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {LEAVES.map(([x, y, deg, scale, tone]) => (
        <path key={`${x},${y}`} className={`b-ground__${tone}`} d="M0 0L64 -34L170 -6L76 30Z"
          transform={`translate(${x} ${y}) rotate(${deg}) scale(${scale})`} />
      ))}
      <path className="b-ground__light" d={figurePath} transform="translate(120 360) rotate(-6) scale(0.62)" />
      <path className="b-ground__dark" d={figurePath} transform="translate(1110 600) rotate(5) scale(0.56)" />
    </svg>
  );
}

/**
 * 白い縁のステッカーのボタン。リンクにするときは as="a" と href を渡す
 * color：paper（白）/ find / hide / accent / sub。size：l（タイトルのモード）/ m / s
 */
export function Sticker({ as: Tag = 'button', color = 'paper', size = 'm', tilt = 0, className = '', style, children, ...props }) {
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      className={`b-sticker b-sticker--${size} b-fill--${color}${color === 'paper' ? ' b-sticker--paper' : ''} ${className}`}
      style={tiltStyle(tilt, style)}
      {...props}
    >
      {children}
    </Tag>
  );
}

/**
 * 小さい札のボタン。pressed を渡すと切り替えボタンになり、押されていない間は薄紫
 * color は Sticker と同じ。白のときは外側に細い線を引く
 */
export function Tab({ as: Tag = 'button', pressed, color = 'paper', tilt = 0, className = '', style, children, ...props }) {
  const off = pressed === false;
  const fill = off ? 'b-tab--off' : `b-fill--${color}${color === 'paper' ? ' b-tab--paper' : ''}`;
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      aria-pressed={Tag === 'button' ? pressed : undefined}
      className={`b-tab ${fill} ${className}`}
      style={tiltStyle(tilt, style)}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** テープで留めた紙。tapes は左上・右上のテープの色（accent / hide / find、null で貼らない）。ref は紙そのものに付く */
export const Board = forwardRef(function Board(
  { as: Tag = 'section', tilt = -0.6, tapes = ['accent', 'hide'], className = '', style, children, ...props },
  ref,
) {
  return (
    <Tag ref={ref} className={`b-board ${className}`} style={tiltStyle(tilt, style)} {...props}>
      {tapes[0] && <span className={`b-tape b-tape--left b-tape--${tapes[0]}`} aria-hidden="true" />}
      {tapes[1] && <span className={`b-tape b-tape--right b-tape--${tapes[1]}`} aria-hidden="true" />}
      {children}
    </Tag>
  );
});

/**
 * 背景幕の上に出す紙のモーダル（<dialog> を使わないもの）
 * onBackdropClick を渡すと、紙の外側を押したときに呼ぶ
 */
export function Modal({ tapes, tilt, className = '', onBackdropClick, children, ...props }) {
  return (
    <div
      className="b-backdrop"
      onClick={onBackdropClick ? (e) => { if (e.target === e.currentTarget) onBackdropClick(); } : undefined}
    >
      <Board as="div" role="dialog" aria-modal="true" tapes={tapes} tilt={tilt} className={`b-modal ${className}`} {...props}>
        {children}
      </Board>
    </div>
  );
}

/** 紙の帯に書いた大見出し */
export function Heading({ as: Tag = 'h1', tilt = -1.5, className = '', children, ...props }) {
  return <Tag className={`b-heading ${className}`} style={tiltStyle(tilt)} {...props}>{children}</Tag>;
}

/** 見つける・隠すの色の付いた札。モードの名前に使う */
export function ModeTag({ mode, tilt = 2, children }) {
  return (
    <span className={`b-modetag b-fill--${mode}`} style={tiltStyle(tilt)}>
      {children ?? (mode === 'find' ? '見つける' : '隠す')}
    </span>
  );
}

/** カクカクした人型の小さいアイコン（残りの数など）。色は color（CSS の色） */
export function FigureIcon({ color = 'currentColor', width = 16, height = 30, className }) {
  return (
    <svg className={className} width={width} height={height} viewBox="0 0 88 168" aria-hidden="true" focusable="false">
      <path d={figurePath} fill={color} />
    </svg>
  );
}

/** 横に滑らせるつまみ（<input type="range">）。value と min・max から、つまみの左を color で塗る */
export function Range({ value, min = 0, max = 100, color = 'find', className = '', style, ...props }) {
  const ratio = max > min ? (Number(value) - min) / (max - min) : 0;
  return (
    <input
      type="range"
      className={`b-range b-fill--${color} ${className}`}
      min={min}
      max={max}
      value={value}
      style={{ '--value': `${Math.max(0, Math.min(1, ratio)) * 100}%`, ...style }}
      {...props}
    />
  );
}

/** 四角いチェックボックス。中身は本物の <input type="checkbox"> なので、checked と onChange はそのまま渡す */
export function Check({ children, className = '', ...props }) {
  return (
    <label className={`b-check ${className}`}>
      <input type="checkbox" {...props} />
      <span className="b-check__box" aria-hidden="true"><Icon name="check" size={16} /></span>
      {children}
    </label>
  );
}

/**
 * 残り時間。見つける（黄緑）と隠す（桃色、小さめ）で同じ形を使う
 * time は表示する文字（例 "2:14"）、ratio は残りの割合（0〜1）、danger で残りわずかの色にする。計算は画面の側で行う
 */
export const Timer = forwardRef(function Timer({ time, ratio, danger = false, variant = 'find', tilt = -2, label }, ref) {
  return (
    <div
      ref={ref}
      className={`b-timer b-timer--${variant}${danger ? ' is-danger' : ''}`}
      style={tiltStyle(tilt)}
      role="timer"
      aria-label={label ?? `残り時間 ${time}`}
    >
      <div className="b-timer__row"><span>残り</span><strong>{time}</strong></div>
      <div className="b-timer__bar"><span style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} /></div>
    </div>
  );
});
