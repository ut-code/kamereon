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
  reportFound: (gameId, chameleonId) => request('POST', `/api/games/${gameId}/found`, { chameleonId }),
  stats: () => request('GET', '/api/stats'),
};
