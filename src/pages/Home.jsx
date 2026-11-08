import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { SITES } from '../../server/sites.js';
import { Board, FigureIcon, Ground, Sticker, Tab, tiltStyle } from '../components/ui.jsx';
import './Home.css';

const number = (value) => Number(value ?? 0).toLocaleString('ja-JP');

// スタートページ側の選択だけを管理し、共通ルーターやゲーム本体には手を入れない。
const AVAILABLE_SITES = Object.entries(SITES)
  .filter(([, site]) => site && typeof site.title === 'string' && typeof site.file === 'string')
  .map(([id, site]) => ({ id, ...site }));
const HOME_STEPS = new Set(['hide-site', 'hide-body', 'find-site', 'find-ready']);
const homeHref = (step, values = {}) => `#/?${new URLSearchParams({ step, ...values })}`;

function readHomeRoute() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const step = params.get('step');
  const site = AVAILABLE_SITES.find((entry) => entry.id === params.get('site'));
  // 以前の体型選択画面へのリンクだけ、選択済みの体型を引き継ぐ。
  const requestedBody = params.get('body');
  const body = ['slim', 'standard', 'round'].includes(requestedBody) ? requestedBody : 'standard';
  if (!HOME_STEPS.has(step)) return { step: '', site: null, body };
  if ((step === 'hide-body' || step === 'find-ready') && !site) {
    return { step: step === 'hide-body' ? 'hide-site' : 'find-site', site: null, body };
  }
  return { step, site, body };
}

function useHomeRoute() {
  const [route, setRoute] = useState(() => readHomeRoute());
  useEffect(() => {
    const update = () => setRoute(readHomeRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.step, route.site?.id]);
  return route;
}

function SitePreview({ site }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = frameRef.current;
    const update = () => setScale(el.clientWidth / (site.width || 1280));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [site.width]);
  return <div className="home-site-preview" ref={frameRef} aria-hidden="true">
    <iframe title={`${site.title}のプレビュー`} src={`/sites/${encodeURIComponent(site.id)}`} sandbox="" tabIndex={-1} loading="lazy"
      width={site.width || 1280} height={440} style={{ width: site.width || 1280, height: Math.max(440, Math.ceil(180 / scale)), transform: `scale(${scale})` }} />
  </div>;
}

function FlowHeader({ mode, backHref }) {
  return <header className="home-flow-header">
    <a className="button" href={backHref || '#/'}>{backHref ? '← ページ選択へ' : '← ホームへ'}</a>
    <span className="home-flow-label" data-mode={mode}>{mode === 'hide' ? '隠す' : '見つける'}</span>
    {backHref && <a className="home-flow-home" href="#/">ホームへ</a>}
  </header>;
}

function HomeFlow({ route }) {
  if (route.step === 'hide-site' || route.step === 'find-site') {
    const hiding = route.step === 'hide-site';
    return <main className="home-screen home-flow-screen">
      <FlowHeader mode={hiding ? 'hide' : 'find'} />
      <div className="home-flow-heading"><h1>Webページを選択</h1></div>
      <div className="home-site-options">
        {AVAILABLE_SITES.map((site) => <a className="home-site-option" key={site.id}
          href={hiding ? `#/hide?${new URLSearchParams({ site: site.id })}` : homeHref('find-ready', { site: site.id })}>
          <SitePreview site={site} />
          <div className="home-site-info"><h2>{site.title}</h2></div>
          <span className="button primary">選択する →</span>
        </a>)}
        {Array.from({ length: Math.max(0, 4 - AVAILABLE_SITES.length) }, (_, index) => <div className="home-site-option home-site-option-empty" key={`empty-${index}`}>
          <div className="home-site-preview home-site-preview-empty" aria-hidden="true" />
          <div className="home-site-info"><h2>準備中</h2></div>
        </div>)}
      </div>
    </main>;
  }

  return <main className="home-screen home-flow-screen">
    <FlowHeader mode="find" backHref={homeHref('find-site', { site: route.site.id })} />
    <div className="home-flow-heading"><h1>選んだWebページ</h1></div>
    <section className="home-find-ready" aria-live="polite">
      <div className="home-find-site"><SitePreview site={route.site} /><h2>{route.site.title}</h2></div>
      <div className="home-find-actions"><a className="button primary" href={`#/find?site=${encodeURIComponent(route.site.id)}`}>探しに行く →</a></div>
    </section>
  </main>;
}


// 順位の札の傾き。見つけ上手・隠れ上手で向きを変え、4位以下は同じ並びをくり返す
const BADGE_TILTS = { find: [-6, 4, -3], hide: [5, -4, 3] };
const badgeTilt = (mode, index) => BADGE_TILTS[mode][index % 3];

/** 順位の札。1番目だけモードの色、ほかは薄紫 */
function Badge({ mode, index, children }) {
  return <span className={`b-badge${index === 0 ? ` b-fill--${mode}` : ''}`} style={tiltStyle(badgeTilt(mode, index))}>{children}</span>;
}

function RankingCard({ mode, entries, loading, failed, period }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [period]);
  const hiding = mode === 'hide';
  const visible = entries.slice(0, expanded ? 10 : 3);
  // 一覧の代わりに出す文。デイリーは準備中
  const message = period === 'daily' ? '準備中'
    : loading ? '読み込み中…'
    : failed ? 'ランキングを表示できませんでした。'
    : visible.length === 0 ? (hiding ? '評価が3回以上のカメレオンはまだいません' : '記録はまだありません')
    : null;
  return (
    <section className={`b-ranking b-ranking--${mode}`} aria-labelledby={`ranking-${mode}-title`}>
      <div className="b-ranking__head">
        <h3 id={`ranking-${mode}-title`}>
          <span className={`b-ranking__mark b-fill--${mode}`} style={tiltStyle(hiding ? -10 : 12)} aria-hidden="true" />
          {hiding ? '隠れ上手' : '見つけ上手'}
        </h3>
        <span>スコア</span>
      </div>
      {message ? (
        <p className="b-ranking__empty">{message}</p>
      ) : (
        <ol>
          {visible.map((entry, index) => (
            <li key={entry.id}>
              <Badge mode={mode} index={index}>{index + 1}<span className="b-sr-only">位</span></Badge>
              <span className="b-ranking__person">
                <span className="b-ranking__name" title={entry.name}>{entry.name}</span>
                {/* 隠れ上手は平均点の下に評価・出題・発見の回数を添える */}
                {hiding && <span className="b-ranking__detail">{`評価${number(entry.view_count)}回・出題${number(entry.searched)}回・発見${number(entry.found)}回`}</span>}
              </span>
              <span className="b-ranking__score">{number(entry.score)}<small>点</small></span>
            </li>
          ))}
        </ol>
      )}
      {!message && entries.length > 3 && (
        <button className="b-ranking__more" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? '3位まで' : '4位以下'}
        </button>
      )}
    </section>
  );
}

// 遊び方。手順を短く出し、点数は1行だけ添える
const RULES = [
  {
    mode: 'find',
    label: '見つける',
    steps: ['探すWebページを選んでスタート', '毎回選ばれる5体を、3分以内に見つけてクリック', '発見数と早さでスコアが決まる'],
    note: '1体100点＋早さのボーナス最大20点。デコイを押すと残り時間が10秒減る',
  },
  {
    mode: 'hide',
    label: '隠す',
    steps: ['隠すWebページを選ぶ', '隠れる画面で、細め・標準・太めから体型を選ぶ', '配置して色を塗り、背景に溶け込ませる', '「ここに隠れる！」で公開する'],
    note: '画面に映って見つからない間だけ、照準との距離に応じて毎秒1〜3点。見つかるとためた点が半分になる',
  },
];

function Rules({ open, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const closeOnBackdrop = (event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  };

  return (
    <Board as="dialog" ref={dialogRef} id="home-rules" className="b-modal b-rules" tapes={['find', 'hide']}
      aria-labelledby="home-rules-title" onClose={onClose} onClick={closeOnBackdrop}>
      <div className="b-modal__head">
        <h2 id="home-rules-title" className="b-modal__title">遊び方</h2>
        <Tab tilt={3} aria-label="ルールを閉じる" onClick={onClose} autoFocus>×</Tab>
      </div>
      <div className="b-rules__cols">
        {RULES.map(({ mode, label, steps, note }, col) => (
          <section key={mode} className="b-rules__col">
            <h3 className={`b-rules__mode b-fill--${mode}`} style={tiltStyle(col ? 2 : -2)}>{label}</h3>
            <ol>
              {steps.map((step, index) => (
                <li key={step}><Badge mode={mode} index={index}>{index + 1}</Badge>{step}</li>
              ))}
            </ol>
            <p className="b-modal__note">{note}</p>
          </section>
        ))}
      </div>
      <div className="b-modal__actions">
        <Sticker color="find" tilt={-2} onClick={onClose}>わかった</Sticker>
      </div>
    </Board>
  );
}

// ロゴ。小さい行は白い札、大きい行は色の札。「オ」だけ地の色に溶け込ませる（カメレオン）
const LOGO_SMALL = [['む', -6], ['っ', 4], ['ち', -3], ['ゃ', 5]];
const LOGO_LARGE = [['カ', 'hide', -4], ['メ', 'find', 3], ['レ', 'accent', -2], ['オ', 'camo', 4], ['ン', 'paper', -3]];

function Logo() {
  return (
    <h1 className="b-logo" aria-label="むっちゃカメレオン">
      <span className="b-logo__row b-logo__row--s" aria-hidden="true">
        {LOGO_SMALL.map(([char, deg]) => <span key={char} className="b-logo__tile b-logo__tile--s" style={tiltStyle(deg)}>{char}</span>)}
      </span>
      <span className="b-logo__row" aria-hidden="true">
        {LOGO_LARGE.map(([char, color, deg]) => <span key={char} className={`b-logo__tile b-logo__tile--${color}`} style={tiltStyle(deg)}>{char}</span>)}
      </span>
    </h1>
  );
}

/** 見つけるの虫めがね（カクカクしたレンズ） */
function FindIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square" aria-hidden="true" focusable="false">
      <path d="M13 4.5L21.5 8L23 14L19 21L11 22L5 16.5L6 9Z" />
      <path d="M19.5 20L27.5 28" />
    </svg>
  );
}

export default function Home({ siteId = 'utcode' }) {
  const route = useHomeRoute();
  const [period, setPeriod] = useState('all');
  const [ranking, setRanking] = useState(null);
  const [finderRanking, setFinderRanking] = useState(null);
  const [rankingError, setRankingError] = useState(false);
  const [reload, setReload] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => { setRulesOpen(false); }, [route.step]);

  useEffect(() => {
    if (route.step === 'hide-body') {
      window.location.replace(`#/hide?${new URLSearchParams({ site: route.site.id, body: route.body })}`);
    }
  }, [route.step, route.site?.id, route.body]);

  useEffect(() => {
    let active = true;
    setRanking(null);
    setFinderRanking(null);
    setRankingError(false);
    Promise.all([
      api.getHiderRanking(),
      api.getFinderRanking(),
    ])
      .then(([hiderData, finderData]) => {
        if (!active) return;
        setRanking(hiderData.map((c) => ({
          ...c,
          score: Math.round(c.avg_score),
        })));
        setFinderRanking(finderData.map((g) => ({
          id: g.id,
          name: g.player_name,
          score: g.score,
          found: g.score,
        })));
      })
      .catch(() => { if (active) setRankingError(true); });
    return () => { active = false; };
  }, [siteId, reload]);

  if (route.step === 'hide-body') return <main className="home-screen home-flow-screen"><p role="status">隠れる画面を開いています…</p></main>;
  if (route.step) return <HomeFlow route={route} />;

  return (
    <div className="b-screen">
      <Ground />
      <main className="b-home">
        <Sticker className="b-home__rules" tilt={3} aria-haspopup="dialog" aria-controls="home-rules" onClick={() => setRulesOpen(true)}>
          ？ ルール
        </Sticker>

        <Logo />

        <nav className="b-home__modes" aria-label="遊ぶモードを選ぶ">
          <Sticker as="a" href={homeHref('find-site')} size="l" color="find" tilt={-2} className="b-mode">
            <FindIcon />見つける
          </Sticker>
          <Sticker as="a" href={homeHref('hide-site')} size="l" color="hide" tilt={2} className="b-mode">
            <FigureIcon width={30} height={56} />隠す
          </Sticker>
        </nav>

        <Board className="b-rankings" aria-labelledby="home-ranking-title">
          <div className="b-board__head">
            <h2 id="home-ranking-title">ランキング</h2>
            <div className="b-board__periods" role="group" aria-label="ランキングの期間">
              <Tab pressed={period === 'all'} color="accent" tilt={-2} onClick={() => setPeriod('all')}>総合</Tab>
              <Tab pressed={period === 'daily'} color="accent" tilt={1.5} onClick={() => setPeriod('daily')}>
                デイリー<span className="b-chip">準備中</span>
              </Tab>
            </div>
          </div>
          {rankingError && (
            <div className="b-rankings__error" role="alert">
              <span>ランキングを読み込めませんでした。</span>
              <Tab onClick={() => setReload((r) => r + 1)}>再読み込み</Tab>
            </div>
          )}
          <div className="b-board__lists" aria-busy={ranking === null && !rankingError}>
            <RankingCard mode="find" entries={finderRanking ?? []} period={period} loading={!finderRanking && !rankingError} failed={rankingError} />
            <RankingCard mode="hide" entries={ranking ?? []} period={period} loading={!ranking && !rankingError} failed={rankingError} />
          </div>
        </Board>
      </main>

      <Rules open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
