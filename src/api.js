async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  listChameleons: (site) => request('GET', `/api/chameleons?site=${encodeURIComponent(site)}`),
  getChameleonsByIds: (ids) => request('GET', `/api/chameleons?ids=${ids.map(encodeURIComponent).join(',')}`),
  createChameleon: (data) => request('POST', '/api/chameleons', data),
  startGame: (site, exclude) => request('POST', '/api/games', { site, count: 5, exclude }),
  reportFound: (gameId, chameleonId, score, playerName) => request('POST', `/api/games/${gameId}/found`, { chameleonId, score, playerName }),
  reportHideScores: (gameId, hideScores) => request('POST', `/api/games/${gameId}/finish-hide-scores`, { hideScores }),
  // period: 'all'（総合）か 'daily'（今日。日本時間の0時で切り替わる）
  getFinderRanking: (period = 'all') => request('GET', `/api/rankings/finder?period=${period}`),
  getHiderRanking: (period = 'all') => request('GET', `/api/rankings/hider?period=${period}`),
  stats: () => request('GET', '/api/stats'),
};
