const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../api.js');
const C = require('../core.js');
const key = 'AIza-Fake-Key-Only-For-Unit-Tests';
const payload = (text='سلام', finishReason='STOP') => ({candidates:[{content:{parts:[{text}]}, ...(finishReason ? {finishReason} : {})}]});
const mock = data => async () => new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}});

test('translation and probes use the standard POST endpoint, not SSE', async () => {
  let sent;
  const result = await A.translate({apiKey:key,text:'Hello',settings:C.defaults,fetchImpl:async(url,init)=>{
    sent={url,init};return new Response(JSON.stringify(payload()));
  }});
  assert.equal(result.text,'سلام');assert(sent.url.endsWith(':generateContent'));
  assert(!sent.url.includes(key));assert(!sent.url.includes('stream'));assert.equal(sent.init.method,'POST');
  assert.equal(sent.init.headers['x-goog-api-key'],key);
  assert(sent.url.includes('gemini-3.7-flash'));assert.equal(C.defaults.model,'gemini-3.7-flash');
  assert.equal(JSON.parse(sent.init.body).generationConfig.thinkingConfig,undefined);
});
test('complete JSON with omitted finishReason is accepted, not labelled as a network failure', async () => {
  const result=await A.translate({apiKey:key,text:'Hello',fetchImpl:mock(payload('سلام',null))});
  assert.equal(result.text,'سلام');
});
test('provider 503 is SERVICE, 429 is QUOTA and bad keys are KEY; diagnostics do not echo secrets', async () => {
  for(const [status,code] of [[503,'SERVICE'],[429,'QUOTA'],[403,'KEY']]) {
    let error;
    try { await A.translate({apiKey:key,text:'secret input',fetchImpl:async()=>new Response(JSON.stringify({error:{code:status,status:'UNAVAILABLE',message:key+' secret input'}}),{status})}); } catch(e){error=e;}
    assert.equal(error.message,code);assert.equal(error.details.httpStatus,status);
    assert(!JSON.stringify(A.diagnostic(error)).includes(key));assert(!JSON.stringify(error).includes('secret input'));
  }
});
test('fetch transport failure and unreadable successful response have different errors', async () => {
  await assert.rejects(A.translate({apiKey:key,text:'Hello',fetchImpl:async()=>{throw new TypeError('Failed to fetch')}}),{message:'NETWORK'});
  await assert.rejects(A.translate({apiKey:key,text:'Hello',fetchImpl:async()=>new Response('<html>gateway</html>')}),{message:'PROTOCOL'});
});
test('empty, blocked and truncated JSON responses are not successful translations', async () => {
  for(const [data,code] of [[payload(''),'EMPTY_RESPONSE'],[{promptFeedback:{blockReason:'SAFETY'}},'BLOCKED'],[payload('partial','MAX_TOKENS'),'TRUNCATED']]) {
    await assert.rejects(A.translate({apiKey:key,text:'Hello',fetchImpl:mock(data)}),{message:code});
  }
});
test('cancellation reaches fetch and is never relabelled as a network error', async () => {
  const controller = new AbortController();
  const result = A.translate({apiKey:key,text:'Hello',signal:controller.signal,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});
  controller.abort(); await assert.rejects(result,{message:'CANCELLED'});
});
test('request deadline distinguishes TIMEOUT from cancellation', async () => {
  await assert.rejects(A.translate({apiKey:key,text:'Hello',timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))}),{message:'TIMEOUT'});
});
test('fast-model recommendation uses actual available models', () => {
  assert.equal(A.recommendModel([{id:'gemini-3.8-flash'},{id:'gemini-2.5-flash-lite'}]),'gemini-2.5-flash-lite');
  assert.equal(A.recommendModel([{id:'gemini-3.1-flash-lite'}]),'gemini-3.1-flash-lite');
  assert.equal(A.recommendModel([{id:'gemini-2.5-flash'}]),'gemini-2.5-flash');
});
test('region and billing failures preserve a specific actionable category',()=>{
  assert.equal(A.providerError(400,{error:{message:'User location is not supported for the API use.'}},'translation').message,'REGION');
  assert.equal(A.providerError(400,{error:{message:'Free tier is not available. Enable billing.'}},'translation').message,'BILLING');
});
