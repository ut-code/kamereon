// 隠れる舞台となるWebページの一覧（クライアントとサーバーの両方から使う）
// width: 画像を表示するときの幅 (CSS px)。カメレオンの座標は画像に対する相対値 (0〜1) で保存する。
export const SITES = {
  utcode: {
    title: 'ut.code(); ホームページ',
    url: 'https://utcode.net/',
    file: 'utcode.html',
    width: 1280,
  },
  
 /* exhibit: {
    title: '展覧会 ホームページ',
    url: '#',
    file: 'exhibit.html',
    width: 1280,
  },
  
  explore: {
    title: '探検 ホームページ',
    url: '#',
    file: 'explore.html',
    width: 1280,
  },*/
  museum: {
    title: '古今東西美術館 ホームページ',
    url: '#',
    file: 'museum.html',
    width: 1280,
  },
  library1: {
    title: 'AQUA BIBLIOTHECA -ABOVE WATER-',
    url: '#',
    file: 'library1.html',
    width: 1280,
  },
  library2: {
    title: 'AQUA BIBLIOTHECA -UNDER WATER-',
    url: '#',
    file: 'library2.html',
    width: 1280,
  },
};

// 各サイトは scripts/render-sites.js で1枚の画像に書き出したものを表示する。
// HTML を各ブラウザで描画するとフォントや端末の違いでレイアウトが微妙にずれ、カメレオンの位置もずれるため。
export const siteImageUrl = (id) => `/sites/${encodeURIComponent(id)}.webp`;
// ページ選択のプレビュー用。ページ上端 1280×1600px を幅 480px に縮小したもの
export const siteThumbUrl = (id) => `/sites/${encodeURIComponent(id)}-thumb.webp`;
