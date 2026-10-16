import assert from 'node:assert/strict';
import { chat, toolDefinition } from '@tanstack/ai';
import { createOpenRouterText } from '@tanstack/ai-openrouter';
import { HTTPClient } from '@openrouter/sdk/lib/http';
import { EventStream } from '@openrouter/sdk/lib/event-streams';
import { z } from 'zod';

const shape = {type:'object',properties:{sql:{type:'string'}},additionalProperties:false};
const chunk = choice => ({id:'fixture',object:'chat.completion.chunk',created:1,model:'openai/gpt-4.1-mini',choices:[{index:0,delta:{},finish_reason:null,...choice}]});
function fixtures(scenario) {
  const end = {finish_reason:scenario.finish ?? 'tool_calls',native_finish_reason:scenario.native};
  return [chunk({delta:{role:'assistant',tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'run_query',arguments:scenario.args}}]}}),
    chunk(end),...(scenario.usage ? [{...chunk(end),usage:{prompt_tokens:10,completion_tokens:12,total_tokens:22}}] : [])];
}
function stream(events) {
  const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n');
  let offset=0;
  return new Response(new ReadableStream({pull(controller){
    if(offset===bytes.length){controller.close();return;}
    const end=Math.min(offset+17,bytes.length);controller.enqueue(bytes.slice(offset,end));offset=end;
  }}),{headers:{'content-type':'text/event-stream'}});
}
async function observe(body, psj, expected) {
  const adapter=new psj.OpenRouterStreamAdapter();
  const gate=psj.createToolCallExecutionGate(undefined,undefined,{run_query:shape});
  const received=[];
  for await(const event of new EventStream(body,message=>({done:false,value:message.data==='[DONE]'?null:JSON.parse(message.data)}))) {
    if(!event)continue;
    received.push(event);
    for(const part of adapter.push(event))gate.push(part);
  }
  assert.deepEqual(received,expected);
  for(const part of adapter.finish())gate.push(part);
  return {gate,final:gate.finish()};
}
async function run(scenario, guarded) {
  const psj=guarded?await import('prefix-safe-json'):undefined;
  const events=fixtures(scenario), effects=[],requests=[];
  let evidenceTask;
  let guardedDecisions=[];
  const adapter=createOpenRouterText('openai/gpt-4.1-mini','fixture-not-a-real-key',{
    serverURL:'https://fixture.invalid/api/v1',httpClient:new HTTPClient({fetcher:async request=>{
      assert.equal(new URL(request.url).hostname,'fixture.invalid');
      requests.push(await request.clone().json());
      assert.ok(requests.length<=2);
      const source=stream(requests.length===1?events:[chunk({delta:{role:'assistant',content:'Done.'}}),chunk({finish_reason:'stop',native_finish_reason:'stop'})]);
      if(!psj||requests.length!==1)return source;
      const [sdkBody,evidenceBody]=source.body.tee();
      evidenceTask=observe(evidenceBody,psj,events).then(value=>({value}),error=>({error}));
      return new Response(sdkBody,{headers:source.headers});
    }})});
  const runQuery=toolDefinition({name:'run_query',description:'Harmless in-memory recording',inputSchema:z.object({sql:z.string().optional()})})
    .server(async (input,context)=>{
      if(psj){
        const observed=await evidenceTask;
        if(observed.error)throw observed.error;
        const {gate,final}=observed.value;
        guardedDecisions=final.decisions.map(({action,reason,evidence})=>({action,reason,evidence}));
        assert.equal(final.decisions.length,1);
        assert.equal(context.toolCallId,'call_1');
        const decision=final.decisions[0];
        assert.equal(decision.toolCallId,context.toolCallId);
        if(decision.action!=='execute')throw new Error('PSJ refused original evidence');
        const authority=gate.takeDecision(decision.internalId);
        assert.ok(authority);
        assert.equal(gate.takeDecision(decision.internalId),undefined);
        effects.push(authority.value);
      } else effects.push(input);
      return 'harmless effect recorded';
    });
  const received=[];
  for await(const event of chat({adapter,tools:[runQuery],messages:[{role:'user',content:'Record a query'}]}))received.push(event.type);
  assert.ok(received.includes('RUN_FINISHED'),'The framework must finish the streamed run');
  assert.ok(received.includes('TEXT_MESSAGE_CONTENT'),'The follow-up assistant text must be consumed');
  assert.equal(received.includes('RUN_ERROR'),false);
  const observed=await evidenceTask;
  if(observed?.error)throw observed.error;
  assert.equal(requests.length,2);
  if(psj)assert.equal(guardedDecisions.length,1);
  const outputs=requests[1].messages.filter(message=>message.role==='tool');
  assert.equal(outputs.length,1,'Exactly one result must be paired with the single fixture call');
  assert.equal(outputs[0].tool_call_id,'call_1');
  if(effects.length)assert.equal(outputs[0].content,'harmless effect recorded');
  else assert.match(outputs[0].content,/PSJ refused original evidence/,'A blocked effect must come from the gate, not an unrelated wrapper error');
  return {effects:effects.length,values:effects,requestCount:requests.length,guardedDecisions,
    resultContents:requests[1].messages.filter(message=>message.role==='tool').map(message=>message.content)};
}
for(const scenario of [
  {name:'complete-with-documented-usage',args:'{"sql":"SELECT 1"}',native:'stop',usage:true,expected:{native:1,psj:1}},
  {name:'malformed-json-with-usage',args:'{"sql":"SELECT 1"',native:'max_output_tokens',usage:true,expected:{native:1,psj:0}},
  {name:'valid-json-native-limit-with-usage',args:'{"sql":"SELECT 1"}',native:'max_output_tokens',usage:true,expected:{native:1,psj:0}},
  {name:'valid-json-native-limit-without-usage',args:'{"sql":"SELECT 1"}',native:'max_output_tokens',usage:false,expected:{native:1,psj:0}},
  {name:'valid-json-normalized-length',args:'{"sql":"SELECT 1"}',native:'max_output_tokens',finish:'length',usage:true,expected:{native:1,psj:0}},
]) {
  const variants=['native','psj'];
  const results={};
  for(const variant of variants) {
    results[variant]=await run(scenario,variant==='psj');
    assert.equal(results[variant].effects,scenario.expected[variant],`${scenario.name} ${variant}`);
  }
  console.log(JSON.stringify({scenario:scenario.name,...results}));
}
console.log('Authored HTTP/SSE fixtures through installed TanStack packages; no live model calls or independent adoption.');
