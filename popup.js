(async () => {
  'use strict';
  const U = globalThis.RavaUI, $ = U.$;
  const openSettings = () => chrome.runtime.openOptionsPage();
  for (const id of ['open-settings', 'more-settings', 'setup-key']) $(id).addEventListener('click', openSettings);
  try {
    await U.boot(); $('setup-key').hidden = U.config.hasKey;
    $('play-target').value = U.config.settings.target; $('play-tone').value = U.config.settings.tone;
    async function persist(patch) {
      U.config = await U.request({ type: 'UPDATE_PREFERENCES', ...patch });
    }
    U.tones($('quick-tones'), U.config.settings.tone, tone => {
      $('play-tone').value = tone; persist({ tone }).catch(error => translation.showError(error.message));
    });
    $('play-target').addEventListener('change', () => persist({ target: $('play-target').value }).catch(error => translation.showError(error.message)));
    const translation = U.translator();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) {
      const host = new URL(tab.url).hostname;
      function siteLabel() { $('pause-site').textContent = U.t(U.config.settings.pausedSites.includes(host) ? 'resumeSite' : 'pauseSite'); }
      $('pause-site').hidden = false; siteLabel(); $('pause-site').title = host;
      $('pause-site').addEventListener('click', async () => { try { U.config = await U.request({ type: 'TOGGLE_SITE' }); siteLabel(); } catch (e) { translation.showError(e.message); } });
    }
  } catch (error) {
    U.locale(); $('popup-output').hidden = false; $('translation-error').hidden = false;
    $('translation-error').textContent = Rava.errorText(U.config.settings.ui, error.message);
  }
})();
