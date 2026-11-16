-- カメレオン（とデコイ）の位置・大きさを、ページ上の px から「ページ画像に対する相対座標 (0〜1)」に変換する。
-- 幅は表示幅 1280px、高さは scripts/render-sites.js で書き出した画像の高さ (CSS px) で割る。
-- w > 1 の行（まだ px のもの）だけを変換するので、何度実行しても結果は変わらない。
-- ※ w, h 列は INTEGER 型だが、SQLite は小数をそのまま REAL として保存する。
UPDATE chameleons SET
  decoys = COALESCE((
    SELECT json_group_array(json_object(
      'x', json_extract(d.value, '$.x') / 1280.0,
      'y', json_extract(d.value, '$.y') / (CASE chameleons.site
        WHEN 'utcode' THEN 5865.0 WHEN 'museum' THEN 11902.0
        WHEN 'library1' THEN 8302.0 WHEN 'library2' THEN 10117.0 END),
      'w', json_extract(d.value, '$.w') / 1280.0,
      'h', json_extract(d.value, '$.h') / (CASE chameleons.site
        WHEN 'utcode' THEN 5865.0 WHEN 'museum' THEN 11902.0
        WHEN 'library1' THEN 8302.0 WHEN 'library2' THEN 10117.0 END),
      'image', json_extract(d.value, '$.image')
    ))
    FROM json_each(chameleons.decoys) AS d
  ), '[]'),
  x = x / 1280.0,
  w = w / 1280.0,
  y = y / (CASE site
    WHEN 'utcode' THEN 5865.0 WHEN 'museum' THEN 11902.0
    WHEN 'library1' THEN 8302.0 WHEN 'library2' THEN 10117.0 END),
  h = h / (CASE site
    WHEN 'utcode' THEN 5865.0 WHEN 'museum' THEN 11902.0
    WHEN 'library1' THEN 8302.0 WHEN 'library2' THEN 10117.0 END)
WHERE w > 1 AND site IN ('utcode', 'museum', 'library1', 'library2');
