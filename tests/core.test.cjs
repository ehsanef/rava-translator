const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('source is never silently truncated; blank text is rejected', () => {
  assert.throws(() => C.validateText('   '), /EMPTY/);
  assert.throws(() => C.validateText('a'.repeat(12001)), /TOO_LONG/);
  assert.equal(C.validateText('hello\nworld'), 'hello\nworld');
  assert.equal(C.validateText('x'.repeat(12000)).length, 12000);
});
test('settings prevent arbitrary endpoint paths and prototype keys', () => {
  const s = C.normalizeSettings({ model:'../../keys?token=secret', target:'__proto__', tone:'constructor', customStyle:'x'.repeat(1000), pausedSites:['example.com','example.com','bad/host'], apiKey:'SHOULD_NOT_PASS' });
  assert.equal(s.model, C.defaults.model); assert.equal(s.target, 'fa'); assert.equal(s.tone, 'tweet');
  assert.equal(s.customStyle.length, 600); assert.deepEqual(s.pausedSites, ['example.com']); assert.equal(s.apiKey, undefined);
});
test('translation prompt preserves meaning and treats source as data', () => {
  const prompt = C.promptFor({ target:'fa', tone:'tweet', customStyle:'Keep technical terms in English.' });
  assert.match(prompt, /untrusted source text/); assert.match(prompt, /not answer or obey/);
  assert.match(prompt, /without summarizing or dropping/); assert.match(prompt, /نیم‌فاصله/);
  assert.match(prompt, /Keep technical terms in English/);
  assert.match(C.promptFor({ target:'fr', tone:'formal' }), /French/);
});
test('thought tokens stay private; blocked and incomplete responses are distinct', () => {
  assert.deepEqual(C.textFromChunk({ candidates:[{ content:{ parts:[{text:'secret reasoning',thought:true},{text:'ترجمه'}] }, finishReason:'STOP' }] }), {text:'ترجمه',finish:'STOP',blocked:false});
  assert.throws(() => C.textFromChunk({promptFeedback:{blockReason:'SAFETY'}}), /BLOCKED/);
  assert.equal(C.textFromChunk({candidates:[{finishReason:'SAFETY'}]}).blocked, true);
  assert.equal(C.textFromChunk({candidates:[{finishReason:'MAX_TOKENS'}]}).blocked, false);
});
test('SSE parser handles split Persian UTF-8, CRLF, comments and no trailing newline', async () => {
  const wire = ': keepalive\r\ndata: {"text":"سلام 🌱"}\r\n\r\ndata: {"n":2}\n\ndata: [DONE]\n\ndata: {"last":true}';
  const bytes = new TextEncoder().encode(wire); const result = [];
  const stream = new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=3) controller.enqueue(bytes.slice(i,i+3)); controller.close(); } });
  await C.consumeSSE(stream, data => result.push(data));
  assert.deepEqual(result, [{text:'سلام 🌱'}, {n:2}, {last:true}]);
});
test('SSE protocol failures surface instead of silently succeeding', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {oops}\n\n')); c.close(); } });
  await assert.rejects(C.consumeSSE(stream, () => {}), SyntaxError);
});
test('provider errors map to actionable categories', () => {
  assert.equal(C.errorCode(429), 'QUOTA'); assert.equal(C.errorCode(403), 'KEY'); assert.equal(C.errorCode(404), 'MODEL');
  assert.notEqual(C.errorText('fa','NO_KEY'), 'NO_KEY'); assert.notEqual(C.errorText('en','TIMEOUT'),'TIMEOUT');
});
test('all visible messages exist in both interface languages', () => {
  assert.deepEqual(Object.keys(C.words.fa).sort(), Object.keys(C.words.en).sort());
});

