import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { SITES } from '../../server/sites.js';
import './Home.css';

const number = (value) => Number(value ?? 0).toLocaleString('ja-JP');
const percent = (value) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

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

function ModeIcon({ mode }) {
  return <svg className="home-mode-icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {mode === 'find' ? <>
      <circle cx="13" cy="13" r="8" />
      <path d="M19 19L27 27" />
    </> : <>
      <path d="M8 18C6 14 10 9 16 10L20 11L23 7L24 11L28 14L25 17H20C17 20 12 21 8 18Z" />
      <path d="M8 18C3 17 2 22 5 25C8 28 13 27 13 23C13 20 9 20 9 23M14 20L13 24H16M22 17L21 23H25" />
      <circle cx="23" cy="13" r="1" fill="currentColor" stroke="none" />
    </>}
  </svg>;
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

function RankingCard({ mode, entries, loading, failed, period }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [period]);
  const hiding = mode === 'hide';
  const unavailable = period === 'daily';
  const visible = entries.slice(0, expanded ? 10 : 3);
  const compact = unavailable || failed || (!loading && visible.length === 0);
  return (
    <section className={`home-ranking-card home-ranking-${mode}${compact ? ' is-compact' : ''}`} aria-labelledby={`ranking-${mode}-title`}>
      <h3 id={`ranking-${mode}-title`}>{hiding ? '隠れ上手ランキング' : '見つけ上手ランキング'}</h3>
      {unavailable ? (
        <p className="home-ranking-empty">準備中</p>
      ) : loading ? (
        <p className="home-ranking-empty">読み込み中…</p>
      ) : failed ? (
        <p className="home-ranking-empty">ランキングを表示できませんでした。</p>
      ) : visible.length === 0 ? (
        <p className="home-ranking-empty">{hiding ? '評価が3回以上のカメレオンはまだいません' : '記録はまだありません'}</p>
      ) : (
        <ol className="home-ranking-list">
          {visible.map((entry, index) => (
            <li className="home-ranking-row" key={entry.id}>
              <span className="home-ranking-rank" aria-label={`${index + 1}位`}>{index + 1}</span>
              <span className="home-ranking-avatar" aria-hidden="true">{Array.from(entry.name || 'カ')[0]}</span>
              <div className="home-ranking-person">
                <span className="home-ranking-name" title={entry.name}>{entry.name}</span>
                <span className="home-ranking-detail">{hiding ? `評価${number(entry.view_count)}回・出題${number(entry.searched)}回・発見${number(entry.found)}回` : ``}</span>
              </div>
              <div className="home-ranking-score">
                <strong>{hiding ? `${number(entry.score)}点` : `${number(entry.found)}点`}</strong>
                <span>{hiding ? 'スコア' : 'スコア'}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {!unavailable && !loading && !failed && entries.length > 3 && (
        <button className="home-text-button home-ranking-more" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? '上位3名だけ表示' : '4位以下も見る'}
        </button>
      )}
    </section>
  );
}

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
    <dialog className="home-rules" id="home-rules" ref={dialogRef} aria-labelledby="home-rules-title" onClose={onClose} onClick={closeOnBackdrop}>
      <div className="home-rules-heading">
        <h2 id="home-rules-title">遊び方（仕様案）</h2>
        <button type="button" className="home-rules-close" aria-label="ルールを閉じる" onClick={onClose} autoFocus>×</button>
      </div>
      <section className="home-rule-group home-rule-find">
        <h3>見つける</h3>
        <ol>
          <li>探すWebページを選んでスタート</li>
          <li>毎回選ばれる5体を、3分以内に見つけてクリック</li>
          <li>発見数と早さでスコアが決まる</li>
        </ol>
        <p>1体100点に、早さのボーナス最大20点を加えます。得点の端数は四捨五入します。</p>
      </section>
      <section className="home-rule-group home-rule-hide">
        <h3>隠す</h3>
        <ol>
          <li>隠すWebページを選ぶ</li>
          <li>隠れる画面で、細め・標準・太めから体型を選ぶ</li>
          <li>配置して色を塗り、背景に溶け込ませる</li>
          <li>「ここに隠れる！」で公開する</li>
        </ol>
        <p>画面に映っていて、未発見の間だけ加点します。画面外では加点しません。</p>
        <p>照準あり距離に応じて毎秒1〜3点です。</p>
        <p>見つかると、そのプレイでためた点が<strong>半分（50％減点）</strong>になり、加点が止まります。</p>
      </section>
      <section className="home-rule-group">
        <h3>隠れる側のランキング</h3>
        <p>一度でも画面に映ったプレイを評価対象とし、減点後の平均点で順位を決めます。評価0回は未評価、1〜2回は暫定スコアです。</p>
        <p><strong>総合：</strong>通算3回以上の評価で参加し、全期間の平均点を使います。</p>
        <p><strong>デイリー：</strong>隠した日を問わず、<strong>当日に3回以上</strong>評価されたカメレオンが参加します。当日分だけの平均点を使います。</p>
      </section>
      <div className="home-rules-actions"><button type="button" className="primary" onClick={onClose}>わかった</button></div>
    </dialog>
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
    <main className="home-screen">
      <header className="home-heading">
        <div className="home-brand">
          <h1>めっちゃカメレオン <span>Web</span></h1>
        </div>
        <button type="button" className="home-help" aria-haspopup="dialog" aria-controls="home-rules" aria-label="ルール説明を表示" onClick={() => setRulesOpen(true)}>
          <span className="home-help-icon" aria-hidden="true">?</span><span className="home-help-label">ルール</span>
        </button>
      </header>

      <nav className="home-modes" aria-label="遊ぶモードを選ぶ">
        <a className="home-mode home-mode-find" href={homeHref('find-site')}>
          <div><span className="home-mode-label"><ModeIcon mode="find" /><strong>見つける</strong></span><span className="home-mode-arrow" aria-hidden="true">→</span></div>
        </a>
        <a className="home-mode home-mode-hide" href={homeHref('hide-site')}>
          <div><span className="home-mode-label"><ModeIcon mode="hide" /><strong>隠す</strong></span><span className="home-mode-arrow" aria-hidden="true">→</span></div>
        </a>
      </nav>

      <section className="home-rankings" aria-labelledby="home-ranking-title">
        <div className="home-ranking-heading">
          <div className="home-ranking-title"><h2 id="home-ranking-title">ランキング</h2></div>
          <div className="home-periods" role="group" aria-label="ランキングの期間">
            <button type="button" aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>総合</button>
            <button type="button" aria-pressed={period === 'daily'} onClick={() => setPeriod('daily')}>デイリー<span className="home-coming-soon">準備中</span></button>
          </div>
        </div>
        {rankingError && <div className="home-load-error" role="alert"><span>ランキングを読み込めませんでした。</span><button type="button" onClick={() => setReload((r) => r + 1)}>再読み込み</button></div>}
        <div className="home-ranking-grid" aria-busy={ranking === null && !rankingError}>
          <RankingCard mode="find" entries={finderRanking ?? []} period={period} loading={!finderRanking && !rankingError} failed={rankingError} />
          <RankingCard mode="hide" entries={ranking ?? []} period={period} loading={!ranking && !rankingError} failed={rankingError} />
        </div>
        <section className="home-score-guide" aria-labelledby="home-score-guide-title">
          <h3 id="home-score-guide-title">スコアの計算方法</h3>
          <dl>
            <div>
              <dt>見つける：発見数＋早さのボーナス</dt>
              <dd className="home-score-formula">1体の得点 ＝ 100 ＋ 20 × 発見時の残り時間 ÷ 制限時間</dd>
              <dd>毎回5体・制限時間3分。端数は四捨五入し、発見した各カメレオンの得点を合計します。</dd>
            </div>
            <div>
              <dt>隠す：カメレオンごとの平均点</dt>
              <dd className="home-score-formula">隠れスコア ＝ 各プレイの最終得点の合計 ÷ 評価対象のプレイ回数</dd>
              <dd>画面内の未発見時間に加点。見つかると、そのプレイでためた点が半分になります。</dd>
            </div>
          </dl>
          <details className="home-score-details">
            <summary>詳しく見る</summary>
            <div>
              <section>
                <h4>1. 見つける側</h4>
                <p>出題は毎回5体、制限時間は3分（180秒）で固定します。登録されたカメレオンが増えても、この条件は変わりません。</p>
                <p>1体につき基本点100点と、早さのボーナス最大20点を加えます。</p>
                <p>例：残り2分14秒（134秒）で発見した場合は、100 ＋ 20 × 134 ÷ 180 を四捨五入して115点。得点の端数は四捨五入します。</p>
                <p>5体を出題する条件では、発見数が多い方が必ず高得点になります。同じ発見数なら、早く見つけるほど高得点になります。</p>
              </section>
              <section>
                <h4>2. 隠れる側</h4>
                <p>画面に表示されていて、まだ発見されていない間だけ加点します。画面外にいる時間は加点しません。</p>
                <p>照準が近くを通っても見つからなかった場合ほど、高く評価します。</p>
                <p className="home-score-formula">減点前の得点 ＝ 未発見で表示されていた各時間の「秒数 × 距離による倍率」の合計</p>
                <table className="home-score-table" aria-label="表示状態と照準の距離による加点">
                  <thead><tr><th scope="col">状態</th><th scope="col">加点</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">画面外</th><td>加点なし</td></tr>
                    <tr><th scope="row">画面内・照準から遠い</th><td>毎秒1点</td></tr>
                    <tr><th scope="row">画面内・照準が近い</th><td>最大で毎秒3点</td></tr>
                  </tbody>
                </table>
                <p>倍率は照準が近づくほど1倍から3倍まで滑らかに変化します。具体的な距離の基準は、案1を採用する場合に試遊で調整します。</p>
                <p>例：未発見で30秒間表示されていた場合、減点前の得点は照準から遠ければ30点、近い状態が続けば最大90点。</p>
                <p><strong>見つかった場合の減点</strong></p>
                <p>発見された時点で加点を止め、そのプレイでためた点を半分（50％減点）にします。逃げ切った場合は、ためた点がそのまま最終得点になります。過去のプレイの得点は変更しません。</p>
                <p>例：90点ためて逃げ切れば90点。90点ためた後に見つかると、90 × 0.5 ＝ 45点です。</p>
              </section>
              <section>
                <h4>3. 隠れる側のランキング</h4>
                <p>プレイ回数の多さだけで有利にならないよう、減点を反映した各プレイの最終得点の平均を使います。</p>
                <p>例：最終得点が毎回90点なら、5回プレイされても10回プレイされても、隠れスコアは同じ90点です。</p>
                <p>評価対象は、そのカメレオンが一度でも画面に表示されたプレイです。一度も表示されなかった回は「未評価」とし、得点の合計にも平均の分母にも含めません。</p>
                <p><strong>総合ランキング</strong>は全期間の平均点で比較し、通算3回以上の評価で参加します。</p>
                <table className="home-score-table" aria-label="通算の評価回数と総合ランキングへの参加条件">
                  <thead><tr><th scope="col">通算の評価回数</th><th scope="col">表示・ランキング</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">0回</th><td>未評価</td></tr>
                    <tr><th scope="row">1〜2回</th><td>平均点を「暫定スコア」として表示。ランキングには含めません。</td></tr>
                    <tr><th scope="row">3回以上</th><td>ランキングに参加</td></tr>
                  </tbody>
                </table>
                <p>隠れスコアが高い順に並べ、スコアと併せて評価回数も表示します。</p>
                <p><strong>デイリーランキング</strong>は、隠した日を問わず、当日に3回以上評価されたカメレオンが対象です。</p>
                <p className="home-score-formula">その日の隠れスコア ＝ 当日の各評価対象プレイの最終得点の合計 ÷ 当日の評価回数</p>
                <p>前日以前の得点・評価回数は、当日の平均点にも参加条件の判定にも含めません。発見された場合は50％減点後の得点を使い、当日の平均点が高い順に並べて当日の評価回数も表示します。</p>
                <table className="home-score-table" aria-label="当日の評価回数とデイリーランキングへの参加条件">
                  <thead><tr><th scope="col">当日の評価回数</th><th scope="col">表示・ランキング</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">0回</th><td>当日分は未評価。デイリーランキングには含めません。</td></tr>
                    <tr><th scope="row">1〜2回</th><td>当日の平均点は暫定スコア。デイリーランキングには含めません。</td></tr>
                    <tr><th scope="row">3回以上</th><td>当日のデイリーランキングに参加</td></tr>
                  </tbody>
                </table>
                <p>例：前日に隠したカメレオンが、今日3回評価されて60点・90点・120点だった場合、（60 ＋ 90 ＋ 120）÷ 3 ＝ 90点で今日のランキングに参加します。前日に何点獲得していても、今日の平均点には影響しません。</p>
              </section>
              <section>
                <h4>4. 文化祭での出題</h4>
                <p>3日間を通して、評価回数の少ないカメレオンを優先して出題します。後から隠された作品にも、探してもらう機会を作ります。</p>
                <p>開始時から毎回5体を出題できるよう、運営が事前にカメレオンを用意します。</p>
                <p>出題回数と評価回数は別です。一度も画面に表示されなかった回は評価に含めず、評価対象の各プレイの最終得点を平均して比較します。</p>
                <p>まずはut.code();の1ページだけで試します。ページを増やすと遊ぶ人が分かれ、カメレオンごとに「1日3回以上の評価」を集めにくくなります。遊ぶ人が増えて、十分に評価が集まるようになったら、ページを増やします。</p>
              </section>
              <p className="home-score-note">※制限時間3分、基本点100点、早さのボーナス最大20点、案1の距離倍率1〜3倍、案2の毎秒1点、発見時の減点率50％は仮の値です。試遊で調整します。</p>
            </div>
          </details>
          <p>現在は最大5体をランダムに出題し、隠れ上手ランキングは通算3回以上評価されたカメレオンの平均点で集計しています。デイリーランキングは準備中です。</p>
        </section>
      </section>

      <Rules open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </main>
  );
}
