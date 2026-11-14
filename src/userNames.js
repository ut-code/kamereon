// ランダムな名前規定値

//カメレオンの名前
export const HIDE_NAMES = [
  "まぎれたトカゲ",
  "壁と同化する者",

];
// ハンターの名前
export const FIND_NAMES = [
];

export function getRandomName(type) {
  const list = type === "hide" ? HIDE_NAMES : FIND_NAMES;
  return list[Math.floor(Math.random() * list.length)];
}