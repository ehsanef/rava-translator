(() => {
  'use strict';
  const C = globalThis.Rava, $ = id => document.getElementById(id);
  const U = { config: { settings: { ...C.defaults }, hasKey: false }, $ };
  U.t = key => C.t(U.config.settings.ui, key);
  U.request = async message => {
    let result;
    try { result = await chrome.runtime.sendMessage(message); } catch { throw new Error('RELOAD'); }
    if (!result?.ok) { const error = new Error(result?.code || 'UNKNOWN'); error.details = result?.details; throw error; }
    return result;
  };
  U.theme = theme => {
    document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  };
  U.locale = () => {
    document.documentElement.lang = U.config.settings.ui;
    document.documentElement.dir = U.config.settings.ui === 'fa' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = U.t(element.dataset.i18n); });
    document.querySelectorAll('[data-placeholder]').forEach(element => { element.placeholder = U.t(element.dataset.placeholder); });
    document.querySelectorAll('[data-title]').forEach(element => { element.title = U.t(element.dataset.title); element.setAttribute('aria-label', U.t(element.dataset.title)); });
    U.theme(U.config.settings.theme); U.connection();
  };
  U.connection = () => {
    const status = $('connection-status');
    if (status) { status.textContent = U.t(U.config.hasKey ? 'ready' : 'setup'); status.classList.toggle('connected', U.config.hasKey); }
  };
  U.languages = () => document.querySelectorAll('[data-languages]').forEach(select => {
    for (const [id, [name]] of Object.entries(C.languages)) { const option = document.createElement('option'); option.value = id; option.textContent = name; select.append(option); }
  });
  U.message = (element, text, kind = '') => { element.hidden = false; element.className = 'message ' + kind; element.textContent = text; };
  U.error = (element, error) => U.message(element, C.errorText(U.config.settings.ui, error.message, error.details), 'error');
  U.tones = (container, selected, onChange, cards = false) => {
    container.replaceChildren();
    const symbols = { tweet: '↗', casual: '☺', natural: '≈', formal: 'Aa' };
    for (const tone of ['tweet', 'casual', 'natural', 'formal']) {
      const button = document.createElement('button'); button.type = 'button'; button.className = cards ? 'tone-card' : 'tone-tab'; button.dataset.tone = tone;
      button.setAttribute('aria-pressed', String(tone === selected));
      if (cards) {
        const strong = document.createElement('strong'); strong.textContent = U.t(tone);
        const small = document.createElement('small'); small.textContent = U.t(tone + 'Desc');
        const symbol = document.createElement('span'); symbol.className = 'tone-symbol'; symbol.textContent = symbols[tone]; symbol.setAttribute('aria-hidden', 'true'); button.append(strong, small, symbol);
      } else button.textContent = U.t(tone);
      button.addEventListener('click', () => {
        container.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        onChange(tone);
      }); container.append(button);
    }
  };
  U.renderFavorites = async () => {
    if (!$('favorites-list')) return;
    const { favorites } = await U.request({ type: 'GET_APP' });
    const list = $('favorites-list'); list.replaceChildren(); $('favorite-count').textContent = String(favorites.length); $('clear-favorites').hidden = !favorites.length;
    if (!favorites.length) { const p = document.createElement('p'); p.className = 'favorites-empty'; p.textContent = U.t('emptyFavorites'); list.append(p); return; }
    for (const item of favorites) {
      const article = document.createElement('article'); article.className = 'favorite-item';
      const meta = document.createElement('div'); meta.className = 'favorite-meta';
      meta.textContent = `${C.languages[item.target]?.[0] || ''} · ${U.t(item.tone)} · ${new Intl.DateTimeFormat(U.config.settings.ui === 'fa' ? 'fa-IR' : 'en', { month: 'short', day: 'numeric' }).format(item.date)}`;
      const text = document.createElement('p'); text.className = 'favorite-text'; text.dir = C.languages[item.target]?.[2] || 'auto'; text.textContent = item.text;
      const details = document.createElement('details'); details.className = 'favorite-source'; const summary = document.createElement('summary'); summary.textContent = U.t('source');
      const source = document.createElement('p'); source.dir = 'auto'; source.textContent = item.source; details.append(summary, source);
      const actions = document.createElement('div'); actions.className = 'favorite-actions';
      const copy = document.createElement('button'); copy.className = 'text-button'; copy.type = 'button'; copy.textContent = U.t('copy');
      copy.addEventListener('click', async () => { try { await C.copyText(item.text); copy.textContent = U.t('copied'); } catch { copy.textContent = C.errorText(U.config.settings.ui, 'COPY'); } });
      const remove = document.createElement('button'); remove.className = 'text-button muted'; remove.type = 'button'; remove.textContent = U.t('delete');
      remove.addEventListener('click', async () => { try { await U.request({ type: 'DELETE_FAVORITE', id: item.id }); await U.renderFavorites(); } catch (e) { remove.textContent = C.errorText(U.config.settings.ui, e.message); } });
      actions.append(copy, remove); article.append(meta, text, details, actions); list.append(article);
    }
  };
  U.translator = ({ beforeRun, afterSave } = {}) => {
    let port, busy = false, output = '', source = '', target, tone, finished = false, runVersion = 0;
    function setBusy(value) {
      busy = value; document.body.classList.toggle('is-loading', value);
      $('translate').disabled = value; $('stop').hidden = !value;
      for (const id of ['source-text','play-target','play-tone']) $(id).disabled = value;
      document.querySelectorAll('#quick-tones button').forEach(b => { b.disabled = value; });
      $('copy-result').disabled = !output || value; $('favorite-result').disabled = !finished || value;
    }
    function stop() { runVersion++; if (port) { port.disconnect(); port = null; } setBusy(false); }
    function showError(code, details) {
      if (code === 'BLOCKED') { output = ''; $('translation-result').textContent = ''; }
      $('translation-error').textContent = C.errorText(U.config.settings.ui, code, details); $('translation-error').hidden = false;
      $('translation-status').textContent = ''; $('empty-result').hidden = true; setBusy(false);
    }
    async function run() {
      if (busy) return;
      const version = ++runVersion;
      source = $('source-text').value;
      if ($('popup-output')) $('popup-output').hidden = false;
      $('translation-error').hidden = true; output = ''; finished = false; $('translation-result').textContent = '';
      $('translation-result').hidden = false; $('empty-result').hidden = true; $('result-actions').hidden = true;
      $('copy-result').textContent = U.t('copy'); $('favorite-result').textContent = U.t('favorite');
      setBusy(true); $('translation-status').textContent = U.t('loading');
      try {
        C.validateText(source);
        if (beforeRun) await beforeRun();
        if (version !== runVersion) return;
        target = $('play-target').value; tone = $('play-tone').value;
        $('translation-result').dir = C.languages[target][2];
        const connection = chrome.runtime.connect({ name: 'rava-translate' }); port = connection;
        connection.onMessage.addListener(message => {
          if (port !== connection) return;
          if (message.type === 'CHUNK' || message.type === 'DONE') {
            output = message.text; $('translation-result').textContent = output;
            if (message.type === 'DONE') {
              finished = true; setBusy(false); $('translation-status').textContent = U.t(message.cached ? 'cached' : 'result');
              $('result-actions').hidden = false; port = null; connection.disconnect();
            }
          } else if (message.type === 'ERROR') {
            if (message.code === 'CANCELLED') { setBusy(false); $('translation-status').textContent = U.t('stopped'); }
            else showError(message.code, message.details);
            port = null; connection.disconnect();
          }
        });
        connection.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === connection) { port = null; showError('RELOAD'); } });
        connection.postMessage({ type: 'TRANSLATE', text: source, target, tone });
      } catch (error) { if (version === runVersion) showError(error.message); }
    }
    $('translate').addEventListener('click', run);
    $('stop').addEventListener('click', () => { stop(); $('translation-status').textContent = U.t('stopped'); });
    $('source-text').addEventListener('input', () => { $('char-count').textContent = `${$('source-text').value.length.toLocaleString('en')} / 12,000`; });
    $('source-text').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); } });
    $('copy-result').addEventListener('click', async () => { try { await C.copyText(output); $('copy-result').textContent = U.t('copied'); } catch { showError('COPY'); } });
    $('favorite-result').addEventListener('click', async () => {
      if (!finished) return;
      try { await U.request({ type: 'SAVE_FAVORITE', item: { text: output, source, target, tone } }); $('favorite-result').textContent = U.t('saved'); $('favorite-result').disabled = true; if (afterSave) await afterSave(); }
      catch (error) { showError(error.message); }
    });
    window.addEventListener('pagehide', stop);
    return { run, stop, showError };
  };
  U.boot = async () => { U.config = await U.request({ type: 'GET_APP' }); U.languages(); U.locale(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => U.theme(U.config.settings.theme));
  globalThis.RavaUI = U;
})();
