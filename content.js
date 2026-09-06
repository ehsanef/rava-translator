(() => {
  'use strict';
  if (globalThis.__ravaLoaded) return;
  globalThis.__ravaLoaded = true;
  const C = globalThis.Rava;
  let config = { settings: { ...C.defaults }, hasKey: false }, host, root, panel, trigger;
  let selectionText = '', anchor = { left: 24, bottom: 100, top: 70 }, port, currentResult = '', currentTarget = 'fa', currentTone = 'tweet';
  let visible = false, expanded = false, busy = false, selectionTimer, lastFocus, finished = false;
  let pointerDown = false, dismissedText = '', selectionRoot = document;
  const $ = name => root.querySelector('[data-' + name + ']');
  const t = key => C.t(config.settings.ui, key);
  const send = message => chrome.runtime.sendMessage(message);
  function isEnabled() { return config.settings.enabled && !config.settings.pausedSites.includes(location.hostname); }
  function refreshTheme() {
    if (!host) return;
    const dark = config.settings.theme === 'dark' || (config.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    host.setAttribute('data-theme', dark ? 'dark' : 'light');
    panel.dir = config.settings.ui === 'fa' ? 'rtl' : 'ltr';
  }
  function build() {
    if (host?.isConnected) return;
    host = document.createElement('rava-translator');
    host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;display:none!important;left:0!important;top:0!important;width:auto!important;height:auto!important;isolation:isolate!important;';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{--bg:#fffefa;--fg:#232721;--muted:#6d756b;--line:#e6e8de;--soft:#f3f4eb;--accent:#28644c;--lime:#dcf28a;--error:#a44231;color-scheme:light}
      :host([data-theme=dark]){--bg:#202822;--fg:#f2f3e9;--muted:#b4beb0;--line:#3b463a;--soft:#2a352c;--accent:#b9e087;--lime:#cde995;--error:#ffb2a3;color-scheme:dark}
      *{box-sizing:border-box} [hidden]{display:none!important} button,select{font:inherit} button{cursor:pointer}button:disabled{opacity:.5;cursor:default}
      button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #7b9c46;outline-offset:3px}
      .trigger{border:1px solid #41694b;background:#263e2e;color:#f3ffd7;border-radius:100px;padding:7px 12px 7px 8px;font:750 11px/1.3 'Segoe UI',Tahoma,sans-serif;letter-spacing:1px;direction:ltr;box-shadow:0 4px 18px #122e292b;display:flex;gap:7px;align-items:center;white-space:nowrap;animation:enter .12s ease-out}.rava-logo{position:relative;width:23px;height:23px;border-radius:7px;background:#d8ee9b;display:block}.rava-logo i{position:absolute;left:6px;top:4px;width:8px;height:12px;background:#294c39;border-radius:3px;transform:rotate(18deg)}.rava-logo i+i{left:11px;top:8px;background:#629165}
      .spark{font-size:20px;line-height:1;color:#d8f28a}.panel{width:min(380px,calc(100vw - 24px));max-height:min(540px,calc(100dvh - 24px));overflow:auto;border:1px solid var(--line);border-radius:20px;background:var(--bg);box-shadow:0 12px 50px #152b242b;color:var(--fg);font:13px/1.8 'Segoe UI',Tahoma,sans-serif;animation:enter .16s ease-out;overscroll-behavior:contain}
      .header{display:flex;align-items:center;gap:9px;padding:15px 17px 11px}.brand{font-size:17px;font-weight:800}.subtitle{font-size:10px;color:var(--muted);margin-inline-start:auto}.icon{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:9px;background:transparent;color:var(--muted);font-size:19px}.icon:hover{background:var(--soft);color:var(--fg)}
      .controls{padding:0 17px 12px}.row{display:flex;gap:8px;align-items:center;justify-content:space-between}.label{font-size:11px;color:var(--muted)}select{max-width:160px;border:1px solid var(--line);background:var(--soft);color:var(--fg);padding:5px 9px;border-radius:9px;font-size:12px}.tones{display:flex;gap:4px;margin-top:12px;padding:4px;background:var(--soft);border-radius:11px}.tone{flex:1;border:0;border-radius:8px;color:var(--muted);background:transparent;padding:6px 3px;font-size:11px;white-space:nowrap}.tone[aria-pressed=true]{background:var(--bg);color:var(--accent);box-shadow:0 1px 4px #172b2415;font-weight:bold}
      .body{padding:15px 19px;border-block:1px solid var(--line)}.status{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:7px;min-height:20px}.status[data-busy=true]::before{content:'';width:9px;height:9px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}.result{font-size:15px;line-height:2.05;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 5px;user-select:text}.result:empty{display:none}.error{font-size:12px;color:var(--error);margin:8px 0}.original{font-size:11px;color:var(--muted);margin:14px 0 0}.original summary{cursor:pointer}.source{max-height:100px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:9px;background:var(--soft);border-radius:8px;line-height:1.7;font:12px/1.7 Tahoma,'Segoe UI',sans-serif}
      .footer{display:flex;gap:6px;padding:11px 16px;align-items:center}.action{border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);padding:7px 10px;font-size:11px;display:flex;align-items:center;gap:5px}.action.primary{background:var(--accent);border-color:transparent;color:var(--bg);font-weight:bold}.action:hover{filter:brightness(.96)}.push{margin-inline-start:auto}.privacy{color:var(--muted);font-size:9px;padding:0 18px 10px;text-align:center}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
      .skeleton{display:grid;gap:10px;padding:18px 0 12px}.skeleton span{height:10px;border-radius:10px;background:var(--soft);animation:breathe 1.3s ease-in-out infinite}.skeleton span:last-child{width:65%}@keyframes breathe{50%{opacity:.4}}
      @keyframes spin{to{transform:rotate(360deg)}}@keyframes enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}
    `;
    const wrapper = document.createElement('div');
    // Only constant extension markup is used here; source/model output is textContent.
    wrapper.innerHTML = `<button class="trigger" data-trigger type="button"><span class="rava-logo" aria-hidden="true"><i></i><i></i></span><span data-trigger-label>RAVA</span></button>
      <section class="panel" data-panel role="dialog" aria-label="Rava translation" hidden>
        <header class="header"><span class="spark" aria-hidden="true">✦</span><b class="brand">Rava</b><span class="subtitle" data-tagline></span><button class="icon" data-settings type="button">⚙</button><button class="icon" data-close type="button">×</button></header>
        <div class="controls"><div class="row"><label class="label" for="rava-language" data-target-label></label><select id="rava-language" data-target></select></div><div class="tones" data-tones role="group"></div></div>
        <div class="body"><div class="status" data-status role="status" aria-live="polite"></div><div class="skeleton" data-skeleton aria-hidden="true" hidden><span></span><span></span><span></span></div><div class="result" data-result dir="auto"></div><p class="error" data-error role="alert" hidden></p><details class="original"><summary data-source-label></summary><div class="source" dir="auto" data-source></div></details></div>
        <footer class="footer"><button class="action primary" data-copy type="button" disabled></button><button class="action" data-favorite type="button" disabled></button><button class="action push" data-retry type="button"></button><button class="action" data-cancel type="button" hidden></button></footer>
        <div class="privacy" data-privacy></div><div class="privacy" data-credit></div><span class="sr" data-live aria-live="polite"></span>
      </section>`;
    root.append(style, wrapper); document.documentElement.append(host);
    panel = $('panel'); trigger = $('trigger');
    for (const [id, [label]] of Object.entries(C.languages)) {
      const option = document.createElement('option'); option.value = id; option.textContent = label; $('target').append(option);
    }
    for (const tone of ['tweet','casual','natural','formal']) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tone'; button.dataset.tone = tone;
      button.addEventListener('click', () => { if (currentTone === tone) return; currentTone = tone; updateTones(); translate(); });
      $('tones').append(button);
    }
    host.addEventListener('pointerdown', e => e.stopPropagation());
    trigger.addEventListener('mousedown', e => e.preventDefault());
    trigger.addEventListener('click', () => openPanel());
    $('close').addEventListener('click', () => hide(true));
    $('settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }).catch(() => error('RELOAD')));
    $('target').addEventListener('change', () => { currentTarget = $('target').value; translate(); });
    $('retry').addEventListener('click', () => translate(true));
    $('cancel').addEventListener('click', () => { stop(); $('status').textContent = t('stopped'); });
    $('copy').addEventListener('click', async () => {
      try { await C.copyText(currentResult, root); $('copy').textContent = t('copied'); } catch { error('COPY'); }
    });
    $('favorite').addEventListener('click', async () => {
      if (!finished) return;
      const result = await send({ type: 'SAVE_FAVORITE', item: { source: selectionText, text: currentResult, target: currentTarget, tone: currentTone } }).catch(() => ({ code: 'RELOAD' }));
      if (result.ok) { $('favorite').textContent = t('saved'); $('favorite').disabled = true; } else error(result.code);
    });
    new ResizeObserver(() => { if (visible) position(); }).observe(panel);
    refreshLabels();
  }
  function refreshLabels() {
    if (!root) return;
    for (const [name, key] of Object.entries({ tagline:'tagline', 'target-label':'target', 'source-label':'source', copy:'copy', favorite:'favorite', retry:'retry', cancel:'cancel', privacy:'selectedOnly', credit:'madeBy' })) $(name).textContent = t(key);
    trigger.title = t('translate'); trigger.setAttribute('aria-label', 'RAVA · ' + t('translate'));
    for (const key of ['settings', 'close']) { $(key).title = t(key); $(key).setAttribute('aria-label', t(key)); }
    for (const button of root.querySelectorAll('[data-tone]')) button.textContent = t(button.dataset.tone);
    $('tones').setAttribute('aria-label', t('tone')); refreshTheme();
  }
  function updateTones() { for (const button of root.querySelectorAll('[data-tone]')) button.setAttribute('aria-pressed', String(button.dataset.tone === currentTone)); }
  function position() {
    if (!visible) return;
    const element = expanded ? panel : trigger;
    const rect = element.getBoundingClientRect();
    const width = innerWidth, height = innerHeight;
    let left = config.settings.ui === 'fa' ? (anchor.right || anchor.left + 28) - rect.width : anchor.left;
    left = Math.max(12, Math.min(left, width - rect.width - 12));
    let top = anchor.bottom + 9;
    if (top + rect.height > height - 12) top = anchor.top - rect.height - 9;
    top = Math.max(12, Math.min(top, height - rect.height - 12));
    host.style.setProperty('left', left + 'px', 'important'); host.style.setProperty('top', top + 'px', 'important');
  }
  function showTrigger(text, rect) {
    build(); stop(); selectionText = text; anchor = rect;
    currentTarget = config.settings.target; currentTone = config.settings.tone;
    trigger.hidden = false; panel.hidden = true; expanded = false; visible = true;
    host.style.setProperty('display', 'block', 'important'); refreshLabels(); position();
  }
  function openPanel() {
    build(); lastFocus = document.activeElement;
    expanded = true; visible = true; trigger.hidden = true; panel.hidden = false;
    host.style.setProperty('display', 'block', 'important');
    $('target').value = currentTarget; updateTones(); $('source').textContent = selectionText;
    refreshLabels(); position(); $('close').focus({ preventScroll: true }); translate();
  }
  function setBusy(value) {
    busy = value; $('status').dataset.busy = String(value); $('cancel').hidden = !value; $('retry').hidden = value;
    $('skeleton').hidden = !value || Boolean(currentResult);
    $('copy').disabled = !currentResult || value; $('favorite').disabled = !finished || value;
  }
  function stop() { if (port) { port.disconnect(); port = null; } if (root) setBusy(false); }
  function hide(restore = false) {
    if (restore) dismissedText = selectionText;
    clearTimeout(selectionTimer);
    stop(); visible = false; expanded = false;
    if (host) host.style.setProperty('display', 'none', 'important');
    if (restore && lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true });
  }
  function error(code, details) {
    if (code === 'BLOCKED') { currentResult = ''; $('result').textContent = ''; }
    $('error').textContent = C.errorText(config.settings.ui, code, details); $('error').hidden = false;
    $('status').textContent = ''; setBusy(false);
  }
  function translate(fresh = false) {
    stop(); currentResult = ''; finished = false; $('result').textContent = ''; $('result').dir = C.languages[currentTarget][2];
    $('error').hidden = true; $('copy').textContent = t('copy'); $('favorite').textContent = t('favorite');
    try { C.validateText(selectionText); } catch (e) { error(e.message); return; }
    setBusy(true); $('status').textContent = t('loading');
    try {
      const connection = chrome.runtime.connect({ name: 'rava-translate' }); port = connection;
      connection.onMessage.addListener(message => {
        if (port !== connection) return;
        if (message.type === 'CHUNK' || message.type === 'DONE') {
          currentResult = message.text; $('result').textContent = currentResult;
          if (message.type === 'DONE') {
            finished = true; setBusy(false); $('status').textContent = message.cached ? t('cached') : t('result');
            $('live').textContent = t('ready'); port = null; connection.disconnect();
          }
        } else if (message.type === 'ERROR') {
          if (message.code === 'CANCELLED') { setBusy(false); $('status').textContent = t('stopped'); }
          else error(message.code, message.details);
          port = null; connection.disconnect();
        }
      });
      connection.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === connection) { port = null; error('RELOAD'); } });
      connection.postMessage({ type: 'TRANSLATE', text: selectionText, target: currentTarget, tone: currentTone, fresh });
    } catch { error('RELOAD'); }
  }
  function getSelectionInfo() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active === host || active?.closest?.('input[type=password]')) return null;
    if (active?.tagName === 'INPUT' && !['text','search','url','tel'].includes(active.type)) return null;
    if (['TEXTAREA','INPUT'].includes(active?.tagName) && typeof active.selectionStart === 'number' && active.selectionStart !== active.selectionEnd) {
      return { text: active.value.slice(active.selectionStart, active.selectionEnd), rect: active.getBoundingClientRect() };
    }
    const selection = selectionRoot?.getSelection?.() || window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return null;
    const range = selection.getRangeAt(0);
    if (root?.contains(range.commonAncestorContainer)) return null;
    const rects = range.getClientRects();
    const visibleRects = [...rects].filter(r => r.bottom > 0 && r.top < innerHeight && r.width);
    const rect = visibleRects.length ? visibleRects.at(-1) : range.getBoundingClientRect();
    return { text: selection.toString(), rect };
  }
  function selectionChanged(event) {
    if (!event.isTrusted || event.composedPath().includes(host) || !isEnabled() || pointerDown) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (pointerDown || !isEnabled()) return;
      const selection = getSelectionInfo();
      if (!selection) { if (!expanded) hide(); return; }
      if (selection.text === dismissedText) return;
      if (selection.text === selectionText && visible) return;
      showTrigger(selection.text, selection.rect);
    }, 40);
  }
  // Capture listeners still see selection gestures when a site stops bubbling events.
  document.addEventListener('pointerup', event => { pointerDown = false; selectionChanged(event); }, true);
  document.addEventListener('selectionchange', selectionChanged, true);
  document.addEventListener('select', selectionChanged, true);
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape') { hide(true); return; }
    if (event.key === 'Shift' || event.key.startsWith('Arrow') || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) { dismissedText = ''; selectionChanged(event); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (event.composedPath().includes(host)) return;
    pointerDown = true; dismissedText = '';
    const target = event.composedPath()[0]; selectionRoot = target?.getRootNode?.() || document;
    if (visible) hide();
  }, true);
  window.addEventListener('blur', () => { pointerDown = false; });
  document.addEventListener('scroll', event => { if (visible && !expanded && !event.composedPath().includes(host)) hide(); }, true);
  window.addEventListener('resize', () => { if (visible) position(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'RAVA_SETTINGS') {
      config = message; refreshLabels(); if (!isEnabled()) hide();
    }
    if (message.type === 'RAVA_OPEN') {
      if (!isEnabled()) { respond({ opened: false }); return; }
      const selection = getSelectionInfo();
      const text = typeof message.text === 'string' ? message.text : selection?.text;
      if (text) {
        showTrigger(text, selection?.rect || { left: innerWidth / 2, bottom: 120, top: 100 }); openPanel();
        respond({ opened: true });
      }
    }
  });
  send({ type: 'GET_SETTINGS' }).then(data => { if (data.ok) config = data; }).catch(() => {});
})();
