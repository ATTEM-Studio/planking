import {
  extractFirstPageItems,
  extractGraphqlItems,
  extractPlaceItemByMid,
  extractPlaceMetrics,
  normalizeOrganicItems,
} from './normalize.mjs';
import { findRankAcrossPages } from './rank-engine.mjs';
import { assertRankResult } from './types.mjs';

const FIRST_PAGE_MARKER = '/p/api/search/allSearch';
const RANK_GRAPHQL_MARKER = 'pcmap-api.place.naver.com/graphql';
const SEARCH_GRAPHQL_MARKER = 'p-api.place.naver.com/graphql';

async function defaultBrowserFactory() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

function scannedCounts(pages) {
  return {
    pagesScanned: pages.length,
    itemsScanned: pages.reduce((sum, page) => sum + normalizeOrganicItems(page).length, 0),
  };
}
function errorResult(status, pages, errorCode, errorMessage) {
  return assertRankResult({ status, rank:null, ...scannedCounts(pages), matchedMid:null, errorCode, errorMessage });
}
function incompleteResult(pages, maxRank, reason='pagination ended before the requested rank limit') {
  const counts=scannedCounts(pages);
  return assertRankResult({status:'INCOMPLETE',rank:null,...counts,matchedMid:null,errorCode:'INCOMPLETE_TRAVERSAL',errorMessage:`${reason}: scanned ${counts.itemsScanned} of ${maxRank}`});
}
function isTimeoutError(error){const n=String(error?.name??'').toLowerCase(),m=String(error?.message??'').toLowerCase();return n.includes('timeout')||m.includes('timeout');}
function isBlockedText(text){const v=String(text??'').toLowerCase();return v.includes('captcha')||v.includes('too many requests');}
function tryCurrentRank(targetMid,pages,maxRank){try{return findRankAcrossPages({targetMid,pages,maxRank});}catch(error){if(String(error?.message??'').includes('incomplete traversal'))return null;throw error;}}
function findMatchedOrganicItem(targetMid,pages){const target=String(targetMid);for(const page of pages){const match=normalizeOrganicItems(page).find(item=>item.mid===target);if(match)return match;}return null;}
function attachPlaceMetrics(result,matchedItem){if(!result||result.status!=='FOUND'||!matchedItem)return result;const metrics=extractPlaceMetrics(matchedItem.raw);return Object.values(metrics).some(v=>v!==null)?assertRankResult({...result,placeMetrics:metrics}):result;}
function shouldEnrichSaveCount(result){const m=result?.placeMetrics;return Boolean(m&&m.saveCountRaw===null&&(m.visitorReviewCount!==null||m.blogReviewCount!==null));}
function mergePlaceMetrics(base,rich){return{visitorReviewCount:rich?.visitorReviewCount??base?.visitorReviewCount??null,blogReviewCount:rich?.blogReviewCount??base?.blogReviewCount??null,saveCountRaw:rich?.saveCountRaw??base?.saveCountRaw??null};}
function parseGetRestaurantsTemplate(request){
  try{
    const url=typeof request.url==='function'?request.url():'';
    if(!url.includes(SEARCH_GRAPHQL_MARKER))return null;
    const body=JSON.parse(request.postData()||'null');
    const ops=Array.isArray(body)?body:[body];
    if(!ops.some(op=>op?.operationName==='getRestaurants'&&op?.variables?.input))return null;
    return{endpoint:url,body};
  }catch{return null;}
}
function rewriteGetRestaurantsTemplate(template,exactPlaceName){
  const body=JSON.parse(JSON.stringify(template.body));
  const ops=Array.isArray(body)?body:[body];
  for(const op of ops){
    if(op?.operationName!=='getRestaurants'||!op?.variables?.input)continue;
    op.variables.input.query=exactPlaceName;
    op.variables.input.start=1;
    op.variables.input.display=50;
    delete op.variables.input.nlu;
  }
  return{endpoint:template.endpoint,body};
}
async function replayGetRestaurants(metricsPage,template,exactPlaceName){
  const replay=rewriteGetRestaurantsTemplate(template,exactPlaceName);
  return metricsPage.evaluate(async({endpoint,body})=>{
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return{status:response.status,json:await response.json()};
  },replay);
}
async function enrichPlaceMetricsFromNaverSearch({context,seedKeyword,exactPlaceName,targetMid,result,timeoutMs}){
  if(!shouldEnrichSaveCount(result))return result;
  const seed=String(seedKeyword??'').trim(),exact=String(exactPlaceName??'').trim();
  if(!seed||!exact)return result;
  let metricsPage,template=null,richMetrics=null;
  try{
    metricsPage=await context.newPage();
    metricsPage.on('request',request=>{if(!template)template=parseGetRestaurantsTemplate(request);});
    metricsPage.on('response',async response=>{
      try{
        const status=typeof response.status==='function'?response.status():0;
        if(status===429)return;
        const url=typeof response.url==='function'?response.url():'';
        if(!url.includes(SEARCH_GRAPHQL_MARKER))return;
        const payload=await response.json();
        const raw=extractPlaceItemByMid(payload,targetMid);
        if(!raw)return;
        const candidate=extractPlaceMetrics(raw);
        if(Object.values(candidate).some(v=>v!==null))richMetrics=mergePlaceMetrics(richMetrics,candidate);
      }catch{}
    });
    await metricsPage.goto(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(seed)}`,{waitUntil:'domcontentloaded',timeout:timeoutMs});
    const started=Date.now();
    while(!template&&Date.now()-started<timeoutMs){if(typeof metricsPage.waitForTimeout==='function')await metricsPage.waitForTimeout(25);else await new Promise(r=>setTimeout(r,25));}
    if(richMetrics?.saveCountRaw)return assertRankResult({...result,placeMetrics:mergePlaceMetrics(result.placeMetrics,richMetrics)});
    if(!template)return result;
    const replay=await replayGetRestaurants(metricsPage,template,exact);
    if(Number(replay?.status)!==200)return result;
    const raw=extractPlaceItemByMid(replay?.json,targetMid);
    if(!raw)return result;
    const replayMetrics=extractPlaceMetrics(raw);
    if(!Object.values(replayMetrics).some(v=>v!==null))return result;
    return assertRankResult({...result,placeMetrics:mergePlaceMetrics(result.placeMetrics,replayMetrics)});
  }catch{return result;}
  finally{if(metricsPage&&typeof metricsPage.close==='function')await metricsPage.close().catch(()=>{});}
}

export class NaverMapCollector {
  constructor({browserFactory=defaultBrowserFactory,timeoutMs=15000,pageDelayMs=600,metricEnrichmentTimeoutMs=10000}={}){
    this.browserFactory=browserFactory;this.timeoutMs=timeoutMs;this.pageDelayMs=pageDelayMs;this.metricEnrichmentTimeoutMs=metricEnrichmentTimeoutMs;
  }
  async collect({keyword,targetMid,maxRank=300}){
    const cleanKeyword=String(keyword??'').trim(),cleanMid=String(targetMid??'').trim();
    if(!cleanKeyword)throw new TypeError('keyword is required');if(!cleanMid)throw new TypeError('targetMid is required');
    const pages=[];let browser,context;
    const capture={first:[],graphql:[],blocked:false,parseError:null};
    const waitForCapture=async(kind,previousCount)=>{const started=Date.now();while(capture[kind].length<=previousCount){if(capture.blocked)throw Object.assign(new Error('naver blocked request'),{code:'BLOCKED'});if(capture.parseError)throw capture.parseError;if(Date.now()-started>=this.timeoutMs){const e=new Error(`timeout waiting for ${kind} response`);e.name='TimeoutError';throw e;}await new Promise(r=>setTimeout(r,20));}return capture[kind][previousCount];};
    const finalizeFound=async found=>{
      const matchedItem=findMatchedOrganicItem(cleanMid,pages),withBaseMetrics=attachPlaceMetrics(found,matchedItem),exactPlaceName=String(matchedItem?.name??'').trim();
      return enrichPlaceMetricsFromNaverSearch({context,seedKeyword:cleanKeyword,exactPlaceName,targetMid:cleanMid,result:withBaseMetrics,timeoutMs:this.metricEnrichmentTimeoutMs});
    };
    try{
      browser=await this.browserFactory();context=await browser.newContext({viewport:{width:1920,height:1080}});const page=await context.newPage();
      page.on('response',async response=>{try{const status=typeof response.status==='function'?response.status():0;if(status===429){capture.blocked=true;return;}const url=typeof response.url==='function'?response.url():'';if(!url.includes(FIRST_PAGE_MARKER)&&!url.includes(RANK_GRAPHQL_MARKER))return;const payload=await response.json();if(url.includes(FIRST_PAGE_MARKER))capture.first.push(extractFirstPageItems(payload));else capture.graphql.push(extractGraphqlItems(payload));}catch(error){capture.parseError=error;}});
      const firstBefore=capture.first.length;await page.goto(`https://map.naver.com/p/search/${encodeURIComponent(cleanKeyword)}`,{waitUntil:'domcontentloaded',timeout:this.timeoutMs});
      if(capture.blocked)return errorResult('BLOCKED',pages,'HTTP_429','Naver returned HTTP 429');const initialText=`${await page.title()}\n${await page.content()}`;if(isBlockedText(initialText))return errorResult('BLOCKED',pages,'BLOCK_PAGE','Naver block/captcha page detected');
      pages.push(await waitForCapture('first',firstBefore));let found=tryCurrentRank(cleanMid,pages,maxRank);if(found)return await finalizeFound(found);
      const maxPages=Math.min(6,Math.ceil(maxRank/50));
      for(let pageNumber=2;pageNumber<=maxPages;pageNumber+=1){const frame=page.frameLocator('#searchIframe'),link=frame.getByRole('link',{name:String(pageNumber),exact:true}),count=await link.count();if(count===0)return incompleteResult(pages,maxRank,`page ${pageNumber} was unavailable`);const graphBefore=capture.graphql.length;await link.click({timeout:this.timeoutMs});if(this.pageDelayMs>0&&typeof page.waitForTimeout==='function')await page.waitForTimeout(this.pageDelayMs);if(capture.blocked)return errorResult('BLOCKED',pages,'HTTP_429','Naver returned HTTP 429');const body=`${await page.title()}\n${await page.content()}`;if(isBlockedText(body))return errorResult('BLOCKED',pages,'BLOCK_PAGE','Naver block/captcha page detected');pages.push(await waitForCapture('graphql',graphBefore));found=tryCurrentRank(cleanMid,pages,maxRank);if(found)return await finalizeFound(found);}
      found=tryCurrentRank(cleanMid,pages,maxRank);return found?await finalizeFound(found):incompleteResult(pages,maxRank);
    }catch(error){if(error?.code==='BLOCKED')return errorResult('BLOCKED',pages,'BLOCKED',String(error.message??'Naver blocked request'));if(isTimeoutError(error))return errorResult('TIMEOUT',pages,'TIMEOUT',String(error.message??'collection timed out'));return errorResult('FAILED',pages,error?.code??'COLLECTOR_ERROR',String(error?.message??error));}
    finally{if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});}
  }
}
