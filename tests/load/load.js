import http from 'k6/http';
import {check,sleep,fail} from 'k6';
import execution from 'k6/execution';
import crypto from 'k6/crypto';
import {Counter,Rate,Trend} from 'k6/metrics';

const fixture=JSON.parse(open(__ENV.FIXTURES));
const base=(__ENV.BASE_URL||'http://127.0.0.1:18080').replace(/\/$/,'');
const run=__ENV.RUN_ID, scenario=__ENV.SCENARIO||'browse', profile=__ENV.PROFILE||'smoke';
const allowed=(__ENV.TARGET_ALLOWLIST||'').split(',');
if(!allowed.includes(base)||!/^https?:\/\/[^/@?#]+(?::\d+)?$/.test(base)||/jithendar\.com/i.test(base))throw Error('Explicit isolated target allowlist required; deployed domains rejected');
if(!fixture.synthetic||fixture.runId!==run||fixture.baseUrl!==base||!/^load-[a-z0-9-]{1,35}$/.test(run||''))throw Error('Matching synthetic fixtures/run identity required');
const names=['browse','session','cart','checkout','idempotency','limited-stock','chat','isolation','rate-limit','real-ai'];
if(!names.includes(scenario))throw Error('Unknown scenario');
const vus=Number(__ENV.VUS|| (profile==='baseline'?5:2));
if(!Number.isInteger(vus)||vus<1||vus>100||fixture.users.length<Math.max(vus,profile==='ramp'?50:vus))throw Error('Insufficient independent fixture users');
const real=scenario==='real-ai';
if(real&&(__ENV.REAL_AI_ENABLED!=='yes'||fixture.providerMode!=='real-approved'))throw Error('Real inference requires explicit opt-in and administrator-prepared test fixtures');
if(!real&&fixture.providerMode!=='mock')throw Error('Mock-only scenario cannot target real inference');
const duration=__ENV.DURATION||({smoke:'2m',baseline:'5m',soak:'30m',arrival:'2m'}[profile]||'2m');
let workload={executor:'constant-vus',vus,duration};
if(profile==='ramp')workload={executor:'ramping-vus',startVUs:1,stages:[{duration:'1m',target:10},{duration:'2m',target:20},{duration:'2m',target:50},{duration:'1m',target:0}]};
else if(profile==='arrival')workload={executor:'constant-arrival-rate',rate:Number(__ENV.RATE||1),timeUnit:'1s',duration,preAllocatedVUs:vus,maxVUs:vus};
else if(!['smoke','baseline','soak'].includes(profile))throw Error('Unknown profile');
if(real){const attempts=Number(__ENV.REAL_AI_MAX_REQUESTS||5);if(!Number.isInteger(attempts)||attempts<1||attempts>10)throw Error('Real AI request cap is 1–10');workload={executor:'shared-iterations',vus:1,iterations:attempts,maxDuration:'60s'};}
const unexpected=new Rate('unexpected_failures'),correctness=new Counter('correctness_failures'),success=new Counter('successful_operations'),rejected=new Counter('admission_rejections'),journeys=new Counter('completed_journeys');
const warmupTime=new Trend('warmup_ms');
const latency=new Trend('operation_latency',true),answers=new Counter('ai_successful_answers'),accepted=new Counter('ai_accepted_requests'),aiLatency=new Trend('ai_answer_latency',true),outcomes=new Counter('ai_outcomes');
const operations={browse:['browse','search','detail'],session:['session'],cart:['cart_read','cart_update'],checkout:['cart_update','shipping','checkout','verify'],idempotency:['cart_update','shipping','checkout','verify'], 'limited-stock':['cart_update','shipping','checkout','verify'],chat:['chat'],isolation:['cart_read','cart_update','chat','history'], 'rate-limit':['session'],'real-ai':['chat']}[scenario];
const thresholds={unexpected_failures:[`rate<${__ENV.MAX_UNEXPECTED_RATE||0.01}`],correctness_failures:['count==0'],completed_journeys:['count>0']};
for(const op of operations)thresholds[`operation_latency{operation:${op}}`]=[`p(95)<${__ENV.P95_MS||(op==='chat'?16000:3000)}`];
if(!['rate-limit','limited-stock'].includes(scenario))thresholds.admission_rejections=[`count<=${__ENV.MAX_REJECTIONS||0}`];
if(['chat','real-ai'].includes(scenario)){thresholds.ai_successful_answers=['count>0'];thresholds.ai_answer_latency=[`p(95)<${__ENV.AI_P95_MS||16000}`];}
if(scenario==='rate-limit')thresholds.admission_rejections=['count>0'];
if(profile==='arrival')thresholds.dropped_iterations=[`count<=${__ENV.MAX_DROPPED||0}`];
export const options={scenarios:{[scenario]:{...workload,exec:'journey',gracefulStop:'25s'}},thresholds,summaryTrendStats:['med','p(95)','p(99)','max'],systemTags:['status','method','name','scenario','expected_response'],noCookiesReset:true,discardResponseBodies:false,maxRedirects:0};
let initialized=false;
function user(){return fixture.users[execution.vu.idInTest-1];}
function init(){if(!initialized){http.cookieJar().set(base,'rs_auth',user().session,{path:'/'});initialized=true;}}
function assert(ok,label){check(ok,{[label]:v=>Boolean(v)});if(!ok)correctness.add(1);return ok;}
function send(method,path,data,op,extra={}){
 const traceId=crypto.sha256(run+':'+execution.vu.idInTest+':'+execution.scenario.iterationInTest+':'+op+':'+Math.random(),'hex').slice(0,32);
 const r=http.request(method,base+path,data===undefined?null:JSON.stringify(data),{headers:{Origin:base,'Content-Type':'application/json',traceparent:'00-'+traceId+'-'+traceId.slice(0,16)+'-01',...extra},tags:{name:op,operation:op,phase:'measured'},timeout:'25s',redirects:0});
 if(execution.scenario.iterationInTest===0)console.log(JSON.stringify({operation:op,traceId:r.headers['X-Request-Id']||traceId}));
 return measure(r,op);
}
function measure(r,op){
 latency.add(r.timings.duration,{operation:op});
 const admission=r.status===429||(scenario==='limited-stock'&&[400,409].includes(r.status));
 rejected.add(admission?1:0);unexpected.add(!admission&&(r.status<200||r.status>=300));
 if(r.status>=200&&r.status<300)success.add(1,{operation:op});
 let body;try{body=r.json();}catch{body={};}
 return {r,body,ok:r.status>=200&&r.status<300,admission};
}
export function setup(){
 const setupStart=Date.now();
 const identity=http.get(base+(real?'/api/status':'/__load/identity'),{tags:{name:'lab_identity',phase:'setup'},redirects:0});
 if(identity.status!==200||(real?identity.json('assistantMode')!=='ai':identity.json('runId')!==run||identity.json('synthetic')!==true||identity.json('providerMode')!==fixture.providerMode))fail('Target is not the matching isolated lab');
 const start=Date.now(),warmup=Math.min(30,Number(__ENV.WARMUP_SECONDS||3))*1000;
 while(!real&&Date.now()-start<warmup){http.get(base+'/api/products',{tags:{name:'warmup',phase:'warmup'}});sleep(.5);}
 warmupTime.add(Date.now()-setupStart);
}
function cart(){const r=send('GET','/api/cart',undefined,'cart_read');if(r.ok)assert((r.body.items||[]).every(p=>p.sku===user().sku&&Number.isInteger(p.quantity)&&p.quantity>=1&&p.quantity<=20),'cart belongs to this user');return r.ok;}
function chat(){const marker='load-user-'+user().id;
 const first=send('POST','/moks/chat',{message:'Find a vacuum under INR 500 '+marker},'chat');
 if(first.ok)accepted.add(1);
 let outcome=first.body.mode||first.body.code||'http-error';
 const ok=first.ok&&first.body.mode==='ai'&&(!first.body.status||first.body.status==='success')&&!first.body.error&&typeof first.body.answer==='string'&&first.body.answer.length>0;
 if(ok){answers.add(1);aiLatency.add(first.r.timings.duration);}else if(!first.admission)unexpected.add(true);
 outcomes.add(1,{outcome:['ai','not-configured','provider-unavailable','feature-unavailable','login-required','clarification'].includes(outcome)?outcome:'other'});
 if(real)return ok;
 const second=send('POST','/moks/chat',{message:'Which of those is cheaper? '+marker},'chat');
 const good=second.ok&&second.body.mode==='ai'&&(!second.body.status||second.body.status==='success')&&!second.body.error;
 if(second.ok)accepted.add(1);if(good){answers.add(1);aiLatency.add(second.r.timings.duration);}else if(!second.admission)unexpected.add(true);
 return ok&&good;
}
function checkout(){
 const sku=scenario==='limited-stock'?'LOAD-LIMITED':user().sku;
 if(!send('POST','/api/cart',{sku,quantity:1},'cart_update').ok)return false;
 if(!send('POST','/api/shipping/quote',{country:'IN',city:1,address:{recipient:'Synthetic',line1:'Test street',postalCode:'000000',phone:'+910000000000'}},'shipping').ok)return false;
 const key=run+'-'+execution.vu.idInTest+'-'+execution.scenario.iterationInTest;
 const first=send('POST','/api/payments/orders',{},'checkout',{'Idempotency-Key':key});
 if(!first.ok)return first.admission&&scenario==='limited-stock';
 const order=first.body.order;
 if(!assert(order&&order.paymentMode==='test'&&order.demo===true,'immutable test order provenance'))return false;
 if(scenario==='idempotency'){
  const request={method:'POST',url:base+'/api/payments/orders',body:'{}',params:{headers:{Origin:base,'Content-Type':'application/json','Idempotency-Key':key},tags:{name:'checkout',operation:'checkout',phase:'measured'},timeout:'25s',redirects:0}};
  for(const response of http.batch([request,request])){
   const duplicate=measure(response,'checkout');
   if(!assert(duplicate.ok&&duplicate.body.order?.id===order.id,'concurrent replays return one logical order'))return false;
  }
 }
 const paymentId=order.razorpayOrderId.replace('order_','pay_');
 const callback={orderId:order.id,razorpay_order_id:order.razorpayOrderId,razorpay_payment_id:paymentId,razorpay_signature:crypto.hmac('sha256',fixture.paymentSecret,order.razorpayOrderId+'|'+paymentId,'hex')};
 const result=send('POST','/api/payments/verify',callback,'verify');
 if(!assert(result.ok&&result.body.paymentCaptured===true,'mock capture verified by real payment service'))return false;
 if(scenario==='idempotency'){const replay=send('POST','/api/payments/verify',callback,'verify');assert(replay.ok&&replay.body.id===order.id,'callback replay remains same order');}
 return true;
}
export function journey(){
 init();correctness.add(0);rejected.add(0);let ok=false;
 if(scenario==='browse'){
  const listing=send('GET','/api/products',undefined,'browse');
  const search=send('GET','/api/catalogue/search/vacuum',undefined,'search');
  const detail=send('GET','/api/products/'+user().sku.toLowerCase(),undefined,'detail');
  ok=listing.ok&&search.ok&&detail.ok;assert(!ok||listing.body.products?.length>0,'catalogue has synthetic products');
 }else if(['session','rate-limit'].includes(scenario)){
  const result=send('GET','/api/auth/me',undefined,'session');ok=result.ok;
  if(ok)assert(result.body.user?.id===user().id,'session identifies its owner');
  if(scenario==='rate-limit')ok=ok||result.admission;
 }else if(['cart','isolation'].includes(scenario)){
  ok=send('POST','/api/cart',{sku:user().sku,quantity:1+execution.scenario.iterationInTest%3},'cart_update').ok&&cart();
  if(scenario==='isolation'){
   ok=chat()&&ok;
   const history=send('GET','/moks/history',undefined,'history');
   if(history.ok){const text=JSON.stringify(history.body);assert(!fixture.users.some(u=>u.id!==user().id&&text.includes('load-user-'+u.id)),'history never leaks other users');}else ok=false;
  }
 }else if(['chat','real-ai'].includes(scenario))ok=chat();
 else ok=checkout();
 if(ok)journeys.add(1);
 if(profile!=='arrival'&&!real&&scenario!=='rate-limit')sleep(Number(__ENV.PACE_SECONDS||(['chat','isolation'].includes(scenario)?30:1)));
}
export function handleSummary(data){
 const measuredSeconds=Math.max(.001,(data.state.testRunDurationMs-(data.metrics.warmup_ms?.values.max||0))/1000);
 const throughput={measuredSeconds,completedJourneysPerSecond:(data.metrics.completed_journeys?.values.count||0)/measuredSeconds,successfulOperationsPerSecond:(data.metrics.successful_operations?.values.count||0)/measuredSeconds,offeredIterationsPerSecond:profile==='arrival'?workload.rate:null,droppedIterations:data.metrics.dropped_iterations?.values.count||0};
 const result={throughput,runId:run,scenario,profile,workload,providerMode:fixture.providerMode,maximumProviderAttempts:real?Number(workload.iterations)*2:undefined,metrics:data.metrics,limitations:['No production capacity claim','Default local lab uses MongoMock and single-writer JSON commerce','No email, external fulfilment or real settlement']};
 return {[(__ENV.RESULT_DIR||'.')+'/summary.json']:JSON.stringify(result,null,2),stdout:JSON.stringify({runId:run,scenario,checks:data.metrics.checks?.values,journeys:data.metrics.completed_journeys?.values,dropped:data.metrics.dropped_iterations?.values||{count:0}})+'\n'};
}
