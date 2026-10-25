import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { getMyIds } from '../myChameleons.js';
import { SITES } from '../../server/sites.js';

const survival = (c) => (c.searched === 0 ? null : 1 - c.found / c.searched);

function ChameleonCard({ c, rank }) {
  const rate = survival(c);
  return (
    <li className="card">
      {rank && <span className="rank">{rank}</span>}
      <div className="thumb">
        <img src={c.image} alt={c.name} />
      </div>
      <div className="card-body">
        <div className="card-name">{c.name}</div>
        <dl>
          <dt>探された</dt>
          <dd>{c.searched}人</dd>
          <dt>見つけられた</dt>
          <dd>{c.found}人</dd>
          <dt>隠れ率</dt>
          <dd>{rate === null ? '—' : `${Math.round(rate * 100)}%`}</dd>
        </dl>
        <div className="card-date">{new Date(c.createdAt).toLocaleDateString('ja-JP')}</div>
      </div>
    </li>
  );
}

export default function Home({ siteId: SITE_ID }) {
  const [all, setAll] = useState(null);
  const [mine, setMine] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const myIds = getMyIds();
    Promise.all([
      api.listChameleons(SITE_ID),
      myIds.length ? api.getChameleonsByIds(myIds) : Promise.resolve([]),
      api.stats(),
    ])
      .then(([a, m, s]) => {
        setAll(a);
        setMine(m);
        setStats(s);
      })
      .catch((err) => setError(`データを取得できませんでした（APIサーバーは起動していますか？）: ${err.message}`));
  }, [SITE_ID]);

  const ranking = (all ?? [])
    .filter((c) => c.searched > 0)
    .sort((a, b) => survival(b) - survival(a) || b.searched - a.searched)
    .slice(0, 10);

  return (
    <div className="home">
      <section className="hero">
        <h1>
          めっちゃカメレオン <span>Web</span>
        </h1>
        <p className="tagline">Webページに溶け込め。Webページから見つけ出せ。</p>
        <div className="site-tabs">
          {Object.entries(SITES).map(([id, s]) => (
            <a key={id} className={`site-chip${id === SITE_ID ? ' active' : ''}`} href={`#/?site=${id}`}>
              {s.title}
            </a>
          ))}
        </div>
        <div className="site-link">
          舞台: <a href={SITES[SITE_ID].url ?? `/sites/${SITE_ID}`} target="_blank" rel="noreferrer">{SITES[SITE_ID].title}</a>
        </div>
        <div className="mode-buttons">
          <a className="mode hide" href={`#/hide?site=${SITE_ID}`}>
            <strong>隠れる</strong>
            <span>白い人型をページのどこかに置いて、ペンで背景そっくりに塗ろう</span>
          </a>
          <a className="mode find" href={`#/find?site=${SITE_ID}`}>
            <strong>見つける</strong>
            <span>隠れている5人のカメレオンを3分以内に探し出せ</span>
          </a>
        </div>
        {stats && (
          <div className="global-stats">
            <div><b>{stats.chameleons}</b>人が潜伏中</div>
            <div><b>{stats.games}</b>回のゲーム</div>
            <div><b>{stats.found}</b>回の発見</div>
          </div>
        )}
      </section>

      {error && <p className="error center">{error}</p>}

      <section>
        <h2>あなたのカメレオン</h2>
        {mine.length === 0 ? (
          <p className="empty">まだ隠れていません。「隠れる」から始めましょう。</p>
        ) : (
          <ul className="cards">
            {mine.map((c) => <ChameleonCard key={c.id} c={c} />)}
          </ul>
        )}
      </section>

      <section>
        <h2>隠れ上手ランキング</h2>
        {ranking.length === 0 ? (
          <p className="empty">まだ誰も探されていません。</p>
        ) : (
          <ul className="cards">
            {ranking.map((c, i) => <ChameleonCard key={c.id} c={c} rank={i + 1} />)}
          </ul>
        )}
      </section>

      <section>
        <h2>新着カメレオン</h2>
        {all === null ? (
          <p className="empty">読み込み中…</p>
        ) : all.length === 0 ? (
          <p className="empty">まだ誰もいません。</p>
        ) : (
          <ul className="cards">
            {all.slice(0, 20).map((c) => <ChameleonCard key={c.id} c={c} />)}
          </ul>
        )}
      </section>

      <footer>「めっちゃカメレオン」のパロディ作品です。</footer>
    </div>
  );
}
