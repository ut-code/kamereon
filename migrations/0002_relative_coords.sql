-- カメレオンの位置・大きさを、ページ上の px から「ページ画像に対する相対座標 (0〜1)」に変換する。
-- 幅は表示幅 1280px、高さは scripts/render-sites.js で書き出した画像の高さ (CSS px) で割る。
-- w > 1 の行（まだ px のもの）だけを変換するので、何度実行しても結果は変わらない。
-- ※ w, h 列は INTEGER 型だが、SQLite は小数をそのまま REAL として保存する。
-- ※ デコイ機能は削除済みで、新しい DB には decoys 列が無いため、ここでは変換しない。
UPDATE chameleons SET
  x = x / 1280.0,
  w = w / 1280.0,
  y = y / (CASE site
    WHEN 'utcode' THEN 5865.0 WHEN 'museum' THEN 11902.0
    WHEN 'library1' THEN 8302.0 WHEN 'library2' THEN 10117.0 END),
  h = h / (CASE site
    WHEN 'utcode' THEN 5865.0 WHEN 'museum' THEN 11902.0
    WHEN 'library1' THEN 8302.0 WHEN 'library2' THEN 10117.0 END)
WHERE w > 1 AND site IN ('utcode', 'museum', 'library1', 'library2');
