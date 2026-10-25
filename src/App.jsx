import { useEffect, useState } from 'react';
import Home from './pages/Home.jsx';
import Hide from './pages/Hide.jsx';
import Find from './pages/Find.jsx';
import { SITES } from '../server/sites.js';

// ハッシュベースの簡易ルーター（#/hide?site=utcode など）
function useRoute() {
  const parse = () => {
    const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?');
    return { path: path || '/', params: new URLSearchParams(query) };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export default function App() {
  const { path, params } = useRoute();
  const site = params.get('site') ?? 'utcode';

  // ページ遷移ごとに作り直す（ゲーム状態をリセットするため key を付ける）
  switch (path) {
    case '/hide':
      return <Hide key={window.location.hash} siteId={site} />;
    case '/find':
      return <Find key={window.location.hash} siteId={site} />;
    default:
      return <Home siteId={SITES[site] ? site : 'utcode'} />;
  }
}
