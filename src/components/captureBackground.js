// 表示元iframeのsandboxを維持したまま、描画専用のコピーを作る。
// Safariではsandbox内に作られたcanvas描画用iframeのload待ちが完了しない。
export async function captureBackground(source, options, signal) {
  const { default: html2canvas } = await import('html2canvas-pro');
  signal.throwIfAborted();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', left: '0', top: '0', opacity: '0', zIndex: '-1',
    width: `${options.windowWidth}px`, height: `${options.windowHeight}px`,
    border: '0', pointerEvents: 'none' });
  document.body.appendChild(frame);
  try {
    const copy = source.documentElement.cloneNode(true);
    copy.querySelectorAll('script, iframe, object, embed, meta[http-equiv]').forEach(el => el.remove());
    for (const el of [copy, ...copy.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name) || /^(?:javascript|vbscript):/i.test(attr.value.trim())) el.removeAttribute(attr.name);
      }
    }
    // 別Documentへの移動時にcurrentSrcが親ページ基準で確定するのを防ぐ。
    const originals = [...source.images];
    copy.querySelectorAll('img').forEach((img, index) => {
      img.src = originals[index].currentSrc || originals[index].src;
      img.removeAttribute('srcset');
      img.loading = 'eager';
    });
    copy.querySelectorAll('picture source').forEach(el => el.remove());
    copy.querySelectorAll('link[href]').forEach(link => {
      link.href = new URL(link.getAttribute('href'), source.baseURI).href;
    });
    const head = copy.querySelector('head');
    const base = document.createElement('base');
    base.href = source.baseURI;
    head.prepend(base);
    // 外部スクリプト・インラインスクリプトの両方をコピーでも禁止する。
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "script-src 'none'; object-src 'none'";
    head.prepend(policy);
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head></head><body></body></html>');
    doc.close();
    doc.replaceChild(doc.adoptNode(copy), doc.documentElement);
    // 画像と外部CSSが読み込まれてから位置・色を計測する。
    await Promise.all([
      ...[...doc.images].map(img => img.decode().catch(() => {})),
      ...[...doc.querySelectorAll('link[rel="stylesheet"]')].map(link => new Promise(resolve => {
        if (link.sheet) return resolve();
        const timer = setTimeout(resolve, 5000);
        const done = () => { clearTimeout(timer); resolve(); };
        link.addEventListener('load', done, { once: true });
        link.addEventListener('error', done, { once: true });
        signal.addEventListener('abort', done, { once: true });
      })),
    ]);
    signal.throwIfAborted();
    const rendered = await html2canvas(doc.documentElement, { ...options, iframeContainer: document.body,
      scrollX: 0, scrollY: 0, scale: 1, useCORS: true, logging: false, signal });
    // コピー用iframeの破棄で画素を失わないよう、親ページのcanvasへ移す。
    const image = document.createElement('canvas');
    image.width = rendered.width;
    image.height = rendered.height;
    image.getContext('2d').drawImage(rendered, 0, 0);
    return image;
  } finally {
    frame.remove();
  }
}
