import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverMapCollector } from '../src/naver-map-collector.mjs';

class FakeResponse {
  constructor(url, payload, status = 200) { this._url=url; this._payload=payload; this._status=status; }
  url(){return this._url;} status(){return this._status;} async json(){return this._payload;}
}
class FakeRequest {
  constructor(url, payload){this._url=url;this._payload=payload;}
  url(){return this._url;} postData(){return JSON.stringify(this._payload);}
}
async function emit(handlers, value){await Promise.all((handlers??[]).map(handler=>handler(value)));}

function makeBrowser(){
  let pageIndex=0;
  const context={
    async newPage(){
      pageIndex+=1;
      const handlers={request:[],response:[]};
      if(pageIndex===1){
        return {
          on(event,handler){handlers[event]?.push(handler);},
          async goto(){await emit(handlers.response,new FakeResponse('https://map.naver.com/p/api/search/allSearch?query=x',{result:{place:{list:[{id:'target',name:'Target Place',placeReviewCount:635,reviewCount:31}]}}}));},
          async content(){return '<html></html>';}, async title(){return '';},
          frameLocator(){throw new Error('pagination should not be needed');}, async waitForTimeout(){}, async close(){},
        };
      }
      return {
        on(event,handler){handlers[event]?.push(handler);},
        async goto(url){
          const parsed=new URL(url);
          assert.equal(parsed.searchParams.get('query'),'하단카페');
          const template=[{operationName:'getRestaurants',query:'query getRestaurants { x }',variables:{input:{query:'하단카페',start:8,display:32,isNx:true,nlu:'seed'}}}];
          await emit(handlers.request,new FakeRequest('https://p-api.place.naver.com/graphql',template));
          await emit(handlers.response,new FakeResponse('https://p-api.place.naver.com/graphql',[{data:{restaurants:{businesses:{items:[{id:'other',name:'Other',saveCount:'200+'}]}}}}]));
        },
        async evaluate(_fn,args){
          assert.equal(args.endpoint,'https://p-api.place.naver.com/graphql');
          const op=Array.isArray(args.body)?args.body[0]:args.body;
          assert.equal(op.variables.input.query,'Target Place');
          assert.equal(op.variables.input.start,1);
          assert.equal(op.variables.input.display,50);
          assert.equal(op.variables.input.nlu,undefined);
          return {status:200,json:[{data:{restaurants:{businesses:{items:[{id:'target',name:'Target Place',visitorReviewCount:'635',blogCafeReviewCount:'31',saveCount:'87,000+'}]}}}}]};
        },
        async waitForTimeout(){}, async close(){},
      };
    },
    async close(){},
  };
  return {async newContext(){return context;},async close(){}};
}

test('replays browser getRestaurants query for exact matched place and preserves raw saveCount',async()=>{
  const collector=new NaverMapCollector({browserFactory:async()=>makeBrowser(),pageDelayMs:0,metricEnrichmentTimeoutMs:100});
  const result=await collector.collect({keyword:'하단카페',targetMid:'target'});
  assert.equal(result.status,'FOUND');
  assert.equal(result.rank,1);
  assert.deepEqual(result.placeMetrics,{visitorReviewCount:635,blogReviewCount:31,saveCountRaw:'87,000+'});
});
