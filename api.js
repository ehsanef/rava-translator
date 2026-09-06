/* One shared, non-streaming Gemini path for both translation and connection checks. */
(() => {
  'use strict';
  const C = globalThis.Rava || (typeof require === 'function' ? require('./core.js') : null);
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
  class APIError extends Error {
    constructor(code, details = {}) { super(code); this.name = 'RavaAPIError'; this.details = details; }
  }
  function diagnostic(error) {
    const details = error instanceof APIError ? error.details : {};
    return {
      ...(Number.isInteger(details.httpStatus) ? { httpStatus: details.httpStatus } : {}),
      ...(typeof details.providerStatus === 'string' && /^[A-Z_]{1,60}$/.test(details.providerStatus) ? { providerStatus: details.providerStatus } : {}),
      ...(typeof details.stage === 'string' && ['models','translation'].includes(details.stage) ? { stage: details.stage } : {})
    };
  }
  function providerError(status, data, stage) {
    const err = data?.error || {};
    const reasons = Array.isArray(err.details) ? err.details.map(d => d?.reason) : [];
    const message = typeof err.message === 'string' ? err.message : '';
    let code = ({400:'INVALID',401:'KEY',403:'KEY',404:'MODEL',408:'TIMEOUT',429:'QUOTA',500:'SERVICE',502:'SERVICE',503:'SERVICE',504:'TIMEOUT'})[status] || 'SERVICE';
    if (err.status === 'RESOURCE_EXHAUSTED') code = 'QUOTA';
    if (reasons.some(r => /API_KEY/.test(r)) || /API key not valid|API key expired/i.test(message)) code = 'KEY';
    if (/user location is not supported|not available in your country|unsupported.*location/i.test(message)) code = 'REGION';
    else if (/billing|free tier is not available/i.test(message)) code = 'BILLING';
    else if (/not found.*model|model.*not found|not supported for generateContent/i.test(message)) code = 'MODEL';
    // The raw provider message is deliberately discarded; it can echo credentials or source text.
    return new APIError(code, { httpStatus: status, providerStatus: err.status, stage });
  }
  async function request(path, { apiKey, body, signal, stage, timeoutMs = 24000, fetchImpl = globalThis.fetch }) {
    if (!apiKey) throw new APIError('NO_KEY');
    if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{20,256}$/.test(apiKey)) throw new APIError('KEY');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason || 'CANCELLED');
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(BASE + path, {
          method: body ? 'POST' : 'GET',
          headers: { 'x-goog-api-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store'
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (error instanceof TypeError) throw new APIError('NETWORK', { stage });
        throw error;
      }
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        if (!response.ok) throw providerError(response.status, {}, stage);
        throw new APIError('PROTOCOL', { stage, httpStatus: response.status });
      }
      if (!response.ok || data?.error) throw providerError(data?.error?.code || response.status, data, stage);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new APIError('PROTOCOL', { stage, httpStatus: response.status });
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new APIError(controller.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', { stage });
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function recommendModel(models) {
    const preferred = ['gemini-2.5-flash-lite','gemini-3.1-flash-lite','gemini-3.5-flash-lite','gemini-2.5-flash'];
    return preferred.find(id => models.some(m => m.id === id)) || models.find(m => /flash-lite/.test(m.id) && !/preview|exp/.test(m.id))?.id || models.find(m => /flash/.test(m.id) && !/preview|exp/.test(m.id))?.id || models[0]?.id;
  }
  async function models(options) {
    const result = []; let pageToken = '', pages = 0;
    do {
      const query = new URLSearchParams({ pageSize: '1000' });
      if (pageToken) query.set('pageToken', pageToken);
      const data = await request('models?' + query, { ...options, stage: 'models' });
      if (!Array.isArray(data.models)) throw new APIError('PROTOCOL', { stage: 'models' });
      result.push(...data.models.filter(m => m?.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini-[a-z0-9._-]+$/.test(m.name) && !/image|tts|audio|live|robotics|transcribe|omni/i.test(m.name)).map(m => ({ id: m.name.slice(7), name: String(m.displayName || m.name).slice(0,150) })));
      pageToken = data.nextPageToken || '';
    } while (pageToken && ++pages < 5);
    return result.sort((a,b) => a.id.localeCompare(b.id, undefined, { numeric: true })).reverse();
  }
  async function translate({ text, settings, ...options }) {
    const source = C.validateText(text), cfg = C.normalizeSettings(settings);
    const generationConfig = { temperature: cfg.tone === 'formal' ? 0.25 : 0.65, maxOutputTokens: 8192 };
    if (/^gemini-2\.5-flash/.test(cfg.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const data = await request('models/' + encodeURIComponent(cfg.model) + ':generateContent', {
      ...options, stage: 'translation',
      body: { systemInstruction: { parts: [{ text: C.promptFor(cfg) }] }, contents: [{ role: 'user', parts: [{ text: source }] }], generationConfig }
    });
    let chunk;
    try { chunk = C.textFromChunk(data); }
    catch (error) { throw new APIError(error.message === 'BLOCKED' ? 'BLOCKED' : 'PROTOCOL', { stage: 'translation' }); }
    if (chunk.blocked) throw new APIError('BLOCKED', { stage: 'translation' });
    if (chunk.finish === 'MAX_TOKENS' || chunk.text.length > 50000) throw new APIError('TRUNCATED', { stage: 'translation' });
    if (!chunk.text.trim()) throw new APIError('EMPTY_RESPONSE', { stage: 'translation' });
    if (chunk.finish && !['STOP','FINISH_REASON_UNSPECIFIED'].includes(chunk.finish)) throw new APIError('PROTOCOL', { stage: 'translation' });
    // A completed HTTP JSON response is not an interrupted SSE stream. Some compatible responses omit finishReason.
    return { text: chunk.text.trim(), target: cfg.target, tone: cfg.tone };
  }
  const api = { APIError, diagnostic, providerError, request, models, recommendModel, translate };
  globalThis.RavaAPI = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
