// 自分が隠したカメレオンのIDをブラウザに覚えておく
const KEY = 'kamereon:mine';

export function getMyIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

export function addMyId(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...getMyIds()].slice(0, 100)));
  } catch {
    // ストレージが使えない環境では記録しない
  }
}
