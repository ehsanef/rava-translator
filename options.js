(async () => {
  'use strict';
  const U = globalThis.RavaUI, C = globalThis.Rava, $ = U.$;
  let defaultTone, pausedSites, dirty = false, saving, recommendedModel = 'gemini-2.5-flash-lite';
  function markDirty() { dirty = true; U.message($('save-status'), U.t('unsaved'), 'pending'); }
  function renderPaused() {
    $('paused-sites').replaceChildren();
    if (!pausedSites.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = U.t('noPaused'); $('paused-sites').append(p); }
    for (const host of pausedSites) {
      const row = document.createElement('div'); row.className = 'site-chip';
      const name = document.createElement('span'); name.textContent = host;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '×'; button.setAttribute('aria-label', U.t('delete') + ' ' + host);
      button.addEventListener('click', () => { pausedSites = pausedSites.filter(h => h !== host); markDirty(); renderPaused(); });
      row.append(name, button); $('paused-sites').append(row);
    }
  }
  function renderTones() { U.tones($('default-tones'), defaultTone, tone => { defaultTone = tone; $('play-tone').value = tone; markDirty(); }, true); }
  function updateKeyState() {
    $('api-key').placeholder = U.t(U.config.hasKey ? 'keySaved' : 'keyPlaceholder');
    $('remove-key').hidden = !U.config.hasKey; U.connection();
  }
  function formSettings() {
    return { ...U.config.settings, target: $('default-target').value, tone: defaultTone, model: $('model').value.trim(), ui: $('ui-switch').value, theme: $('theme').value, enabled: $('enabled').checked, customStyle: $('custom-style').value, pausedSites };
  }
  async function save() {
    if (saving) return saving;
    if (!$('settings-form').reportValidity()) throw new Error('INVALID');
    $('save-settings').disabled = true; $('save-settings').textContent = U.t('saving');
    saving = U.request({ type: 'SAVE_SETTINGS', settings: formSettings(), apiKey: $('api-key').value, remember: $('remember').checked });
    try {
      const result = await saving; U.config = result; dirty = false; $('api-key').value = ''; $('api-key').type = 'password';
      updateKeyState(); U.message($('save-status'), U.t('saved')); return result;
    } catch (e) { U.error($('save-status'), e); throw e; }
    finally { saving = null; $('save-settings').disabled = false; $('save-settings').textContent = U.t('saveSettings'); }
  }
  try {
    await U.boot(); const s = U.config.settings; defaultTone = s.tone; pausedSites = [...s.pausedSites];
    $('default-target').value = s.target; $('play-target').value = s.target; $('play-tone').value = s.tone;
    $('model').value = s.model; $('ui-switch').value = s.ui; $('theme').value = s.theme; $('enabled').checked = s.enabled;
    $('custom-style').value = s.customStyle; $('remember').checked = U.config.hasKey ? U.config.remember : true;
    updateKeyState(); renderTones(); renderPaused(); await U.renderFavorites();
    $('settings-form').addEventListener('submit', event => { event.preventDefault(); save().catch(() => {}); });
    $('settings-form').addEventListener('input', markDirty);
    $('settings-form').addEventListener('change', markDirty);
    $('default-target').addEventListener('change', () => { $('play-target').value = $('default-target').value; });
    $('theme').addEventListener('change', () => { U.config.settings.theme = $('theme').value; U.theme($('theme').value); });
    $('ui-switch').addEventListener('change', async () => {
      U.config.settings.ui = $('ui-switch').value; U.locale(); renderTones(); renderPaused(); updateKeyState(); markDirty(); await U.renderFavorites();
    });
    $('reveal-key').addEventListener('click', () => { $('api-key').type = $('api-key').type === 'password' ? 'text' : 'password'; });
    $('remove-key').addEventListener('click', async () => {
      try { const result = await U.request({ type: 'REMOVE_KEY' }); U.config.hasKey = result.hasKey; $('api-key').value = ''; updateKeyState(); U.message($('test-status'), U.t('removedKey')); }
      catch (e) { U.error($('test-status'), e); }
    });
    $('test-key').addEventListener('click', async () => {
      $('test-key').disabled = true; $('test-key').textContent = U.t('testing'); $('test-status').hidden = true;
      try {
        const { models, selectedModel, recommendedModel: recommended, probe } = await U.request({ type: 'CHECK_KEY', apiKey: $('api-key').value, model: $('model').value.trim() });
        if (!models.length) throw new Error('MODEL');
        recommendedModel = recommended;
        $('model-list').replaceChildren();
        for (const model of models) { const option = document.createElement('option'); option.value = model.id; option.label = model.name; $('model-list').append(option); }
        if ($('model').value !== selectedModel) {
          $('model').value = selectedModel; markDirty();
        }
        if (!probe?.ok) {
          U.message($('test-status'), U.t('modelListOnly') + C.errorText(U.config.settings.ui, probe?.code || 'UNKNOWN', probe?.details), 'error');
        } else {
          await save();
          U.message($('test-status'), U.t('connected') + ' «' + probe.text + '» · ' + (probe.elapsedMs / 1000).toFixed(1) + ' ' + U.t('seconds'));
        }
      } catch (e) { U.error($('test-status'), e); }
      finally { $('test-key').disabled = false; $('test-key').textContent = U.t('test'); }
    });
    $('quick-model').addEventListener('click', () => { $('model').value = recommendedModel; markDirty(); });
    U.translator({ beforeRun: async () => { if (dirty) await save(); }, afterSave: U.renderFavorites });
    const samples = [
      'I was going to take a quick break. Three hours later, here we are.',
      'Not gonna lie, this update is a game changer. My only regret is not trying it sooner.',
      'The meeting could have been an email. The email could have been a thumbs up.',
      'Some days you’re the main character. Other days you’re the buffering icon.'
    ];
    let sampleIndex = 0;
    $('sample').addEventListener('click', () => { if ($('source-text').disabled) return; $('source-text').value = samples[sampleIndex++ % samples.length]; $('source-text').dispatchEvent(new Event('input')); $('source-text').focus(); });
    $('clear-favorites').addEventListener('click', async () => { try { await U.request({ type: 'CLEAR_FAVORITES' }); await U.renderFavorites(); } catch (e) { U.error($('save-status'), e); } });
    const pending = await U.request({ type: 'GET_PENDING' });
    if (pending.text) { $('source-text').value = pending.text; $('source-text').dispatchEvent(new Event('input')); $('source-text').focus(); }
    // Refresh saved translations from other tabs without losing unsaved form edits.
    window.addEventListener('focus', () => U.renderFavorites().catch(() => {}));
  } catch (error) { U.locale(); U.error($('save-status'), error); }
})();
