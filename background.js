/* All credentials and API traffic stay in this service worker. */
importScripts('core.js', 'api.js');
'use strict';
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
]);
const cache = new Map();
let activeCount = 0, writeQueue = Promise.resolve();
const validKey = key => typeof key === 'string' && /^[\x21-\x7e]{20,256}$/.test(key);
const isOurs = sender => sender?.id === chrome.runtime.id;
const isApp = sender => isOurs(sender) && [chrome.runtime.getURL('options.html'), chrome.runtime.getURL('popup.html')].some(url => sender.url?.split(/[?#]/)[0] === url);
function serialized(task) { const result = writeQueue.then(task); writeQueue = result.catch(() => {}); return result; }
async function state() {
  await ready;
  const [local, session] = await Promise.all([
    chrome.storage.local.get(['settings', 'apiKey']), chrome.storage.session.get('apiKey')
  ]);
  return { settings: Rava.normalizeSettings(local.settings), apiKey: session.apiKey || local.apiKey || '', remember: Boolean(local.apiKey) };
}
async function publicState() { const s = await state(); return { settings: s.settings, hasKey: Boolean(s.apiKey), remember: s.remember }; }
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
async function notifySettings() {
  const config = await publicState();
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(t => t.id).map(tab => chrome.tabs.sendMessage(tab.id, { type: 'RAVA_SETTINGS', ...config })));
}
async function checkConnection(draftKey, draftModel) {
  const s = await state();
  const key = draftKey?.trim() || s.apiKey;
  if (!key) throw new Error('NO_KEY');
  if (!validKey(key)) throw new Error('KEY');
  const models = await RavaAPI.models({ apiKey: key });
  if (!models.length) throw new Error('MODEL');
  const recommendedModel = RavaAPI.recommendModel(models);
  const requestedModel = draftModel || s.settings.model;
  const selectedModel = models.some(m => m.id === requestedModel) ? requestedModel : recommendedModel;
  const start = Date.now();
  try {
    const result = await RavaAPI.translate({ apiKey: key, text: 'Hello! How are you?', settings: { ...s.settings, model: selectedModel, target: 'fa', tone: 'casual' } });
    return { models, selectedModel, recommendedModel, probe: { ok: true, text: result.text, elapsedMs: Date.now() - start } };
  } catch (error) {
    return { models, selectedModel, recommendedModel, probe: { ok: false, code: safeCode(error), details: RavaAPI.diagnostic(error) } };
  }
}
async function handle(message, sender) {
  if (!isOurs(sender) || !message || typeof message.type !== 'string') throw new Error('FORBIDDEN');
  await ready;
  if (message.type === 'GET_SETTINGS') return publicState();
  if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return {}; }
  if (message.type === 'SAVE_FAVORITE') return serialized(async () => {
    if (sender.tab?.incognito || sender.incognito) throw new Error('FORBIDDEN');
    const source = Rava.validateText(message.item?.source);
    const text = message.item?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 50000) throw new Error('INVALID');
    const { favorites = [] } = await chrome.storage.local.get('favorites');
    if (favorites.some(f => f.source === source && f.text === text)) return {};
    if (favorites.length >= 100) throw new Error('LIMIT');
    const cfg = Rava.normalizeSettings(message.item);
    favorites.unshift({ id: crypto.randomUUID(), source, text, target: cfg.target, tone: cfg.tone, date: Date.now() });
    await chrome.storage.local.set({ favorites }); return {};
  });
  if (!isApp(sender)) throw new Error('FORBIDDEN');
  switch (message.type) {
    case 'GET_APP': {
      const config = await publicState();
      const { favorites = [] } = await chrome.storage.local.get('favorites');
      return { ...config, favorites };
    }
    case 'GET_PENDING': {
      const { pendingText = '' } = await chrome.storage.session.get('pendingText');
      await chrome.storage.session.remove('pendingText'); return { text: pendingText };
    }
    case 'CHECK_KEY': return checkConnection(message.apiKey, message.model);
    case 'UPDATE_PREFERENCES': return serialized(async () => {
      const current = await state();
      const patch = {};
      if (Object.hasOwn(Rava.languages, message.target)) patch.target = message.target;
      if (['tweet','casual','natural','formal'].includes(message.tone)) patch.tone = message.tone;
      await chrome.storage.local.set({ settings: { ...current.settings, ...patch } });
      notifySettings().catch(() => {}); return publicState();
    });
    case 'SAVE_SETTINGS': return serialized(async () => {
      const current = await state();
      const key = typeof message.apiKey === 'string' && message.apiKey.trim() ? message.apiKey.trim() : current.apiKey;
      if (key && !validKey(key)) throw new Error('KEY');
      const settings = Rava.normalizeSettings(message.settings);
      // Credential copies are removed before changing the retention policy.
      if (message.remember) {
        await chrome.storage.session.remove('apiKey');
        await chrome.storage.local.set({ settings, apiKey: key });
      } else {
        await chrome.storage.local.remove('apiKey');
        await chrome.storage.session.set({ apiKey: key });
        await chrome.storage.local.set({ settings });
      }
      cache.clear(); notifySettings().catch(() => {}); return publicState();
    });
    case 'REMOVE_KEY': return serialized(async () => {
      await Promise.all([chrome.storage.local.remove('apiKey'), chrome.storage.session.remove('apiKey')]);
      cache.clear(); notifySettings().catch(() => {}); return publicState();
    });
    case 'DELETE_FAVORITE': return serialized(async () => {
      const { favorites = [] } = await chrome.storage.local.get('favorites');
      await chrome.storage.local.set({ favorites: favorites.filter(f => f.id !== message.id) }); return {};
    });
    case 'CLEAR_FAVORITES': return serialized(async () => { await chrome.storage.local.remove('favorites'); return {}; });
    case 'TOGGLE_SITE': return serialized(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!/^https?:/.test(tab?.url || '')) throw new Error('INVALID');
      const host = hostOf(tab.url), current = await state(), sites = current.settings.pausedSites;
      current.settings.pausedSites = sites.includes(host) ? sites.filter(h => h !== host) : [...sites, host].slice(-200);
      await chrome.storage.local.set({ settings: current.settings });
      notifySettings().catch(() => {}); return publicState();
    });
    default: throw new Error('INVALID');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ ok: true, ...data }), error => respond({ ok: false, code: safeCode(error), details: RavaAPI.diagnostic(error) }));
  return true;
});
function safeCode(error) {
  const codes = ['NO_KEY','EMPTY','TOO_LONG','KEY','QUOTA','MODEL','NETWORK','TIMEOUT','BLOCKED','TRUNCATED','BUSY','INVALID','DISABLED','FORBIDDEN','STORAGE','LIMIT','PROTOCOL','REGION','BILLING','SERVICE','EMPTY_RESPONSE','CANCELLED'];
  return codes.includes(error?.message) ? error.message : 'INTERNAL';
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'rava-translate' || !isOurs(port.sender)) { port.disconnect(); return; }
  const sender = port.sender;
  const controller = new AbortController();
  let started = false, disconnected = false;
  const post = data => { if (!disconnected) { try { port.postMessage(data); } catch { controller.abort(); } } };
  port.onDisconnect.addListener(() => { disconnected = true; controller.abort(); });
  port.onMessage.addListener(message => {
    if (message.type === 'CANCEL') { controller.abort(); return; }
    if (started || message.type !== 'TRANSLATE') return;
    started = true;
    (async () => {
      if (activeCount >= 4) throw new Error('BUSY');
      activeCount++;
      try {
        const source = Rava.validateText(message.text);
        const { settings, apiKey } = await state();
        if (controller.signal.aborted) return;
        if (!apiKey) throw new Error('NO_KEY');
        if (!isApp(sender) && (!settings.enabled || settings.pausedSites.includes(hostOf(sender.url)))) throw new Error('DISABLED');
        const cfg = Rava.normalizeSettings({ ...settings, target: message.target || settings.target, tone: message.tone || settings.tone });
        const prompt = Rava.promptFor(cfg);
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([apiKey, cfg.model, prompt, source])));
        const cacheKey = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.time < 600000 && !message.fresh && !sender.tab?.incognito) {
          post({ type: 'DONE', text: cached.text, target: cfg.target, tone: cfg.tone, cached: true }); return;
        }
        const result = await RavaAPI.translate({ apiKey, text: source, settings: cfg, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!sender.tab?.incognito) {
          cache.set(cacheKey, { text: result.text, time: Date.now() });
          while (cache.size > 30) cache.delete(cache.keys().next().value);
        }
        post({ type: 'DONE', ...result, cached: false });
      } finally { activeCount--; }
    })().catch(error => {
      if (controller.signal.aborted) { if (!disconnected) post({ type: 'ERROR', code: controller.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED' }); }
      else post({ type: 'ERROR', code: safeCode(error), details: RavaAPI.diagnostic(error) });
    });
  });
});
async function openSelection(tab, text, frameId) {
  if (!tab?.id) return;
  const message = { type: 'RAVA_OPEN', text };
  const target = Number.isInteger(frameId) ? { frameId } : undefined;
  try {
    await chrome.tabs.sendMessage(tab.id, message, target);
  } catch {
    try {
      // activeTab is granted by the user's context-menu/keyboard invocation. Keep translation in this tab.
      await chrome.scripting.executeScript({ target: { tabId: tab.id, ...(Number.isInteger(frameId) ? { frameIds: [frameId] } : {}) }, files: ['core.js','content.js'] });
      await chrome.tabs.sendMessage(tab.id, message, target);
    } catch {
      await chrome.action.setBadgeText({ tabId: tab.id, text: '↻' });
      await chrome.action.setTitle({ tabId: tab.id, title: 'Rava · برای ترجمه در همین صفحه، آن را رفرش کن.' });
      return;
    }
  }
  await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'rava-translate') openSelection(tab, info.selectionText, info.frameId).catch(() => {});
});
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openSelection(tab);
});
chrome.runtime.onInstalled.addListener(async details => {
  await ready;
  if (details.reason === 'update' && details.previousVersion === '1.1.0') {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings?.model === 'gemini-2.5-flash-lite') {
      await chrome.storage.local.set({ settings: { ...settings, model: Rava.defaults.model } });
    }
  }
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'rava-translate', title: 'Rava · ترجمه کن', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  if (details.reason === 'install') await chrome.runtime.openOptionsPage();
});
