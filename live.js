/* live.js — MarketDataProvider + pipeline ponta a ponta (PAPER). Carrega depois de app.js e engine.js */
const Q=window.QuantEngine, PE_KEY='aiMarketQuantPE', HOSTS=[['api.binance.com','stream.binance.com:9443'],['data-api.binance.vision','data-stream.binance.vision']];

// ---------- MarketDataProvider (troque a fonte implementando start/stop/on) ----------
class BinanceProvider{
  constructor(){this.h={};this.hi=0;this.tries=0;this.want=false;}
  on(e,f){this.h[e]=f;return this;} emit(e,...a){this.h[e]&&this.h[e](...a);}
  cd(x){return{t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],time:x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]};}
  async start(sym,iv){this.stop();this.sym=sym;this.iv=iv;this.want=true;this.tries=0;await this.connect();}
  stop(){this.want=false;clearTimeout(this.rt);if(this.ws){this.ws.onclose=null;try{this.ws.close()}catch{}this.ws=null}}
  async load(){const r=await fetch(`https://${HOSTS[this.hi][0]}/api/v3/klines?symbol=${this.sym}&interval=${this.iv}&limit=1000`);
    if(!r.ok)throw Error('HTTP '+r.status);this.emit('candles',(await r.json()).map(x=>this.cd(x)));}
  async connect(){this.emit('status','CONNECTING');
    try{await this.load();}catch(e){this.hi=(this.hi+1)%HOSTS.length;this.emit('status','DISCONNECTED',e.message);this.retry();return;}
    const ws=this.ws=new WebSocket(`wss://${HOSTS[this.hi][1]}/ws/${this.sym.toLowerCase()}@kline_${this.iv}`);
    ws.onopen=()=>{this.tries=0;this.emit('status','CONNECTED');};
    ws.onmessage=ev=>{const k=JSON.parse(ev.data).k;this.emit('candle',this.cd([k.t,k.o,k.h,k.l,k.c,k.v]),k.x);};
    ws.onerror=()=>{};ws.onclose=()=>{if(!this.want)return;this.emit('status','DISCONNECTED','WebSocket caiu');this.hi=(this.hi+1)%HOSTS.length;this.retry();};}
  retry(){if(!this.want)return;const d=Math.min(30000,1000*2**this.tries++);this.emit('event','Nova tentativa em '+Math.round(d/1000)+'s');this.rt=setTimeout(()=>this.want&&this.connect(),d);}
}
const prov=new BinanceProvider();

// ---------- Estado ----------
let pe=null,candles=[],evs=[],lastClosed=0,lastBlock='',risk={riskPct:1,maxOpen:3,maxDrawdownPct:10};
const mkPE=(cap)=>new Q.PaperEngine(cap,new Q.RiskEngine(risk));
function loadPE(){try{const s=JSON.parse(localStorage.getItem(PE_KEY)||'null');
  if(s&&s.start>0){risk={...risk,...(s.riskCfg||{})};pe=mkPE(s.start);Object.assign(pe,{cash:s.cash,pos:s.pos||[],hist:s.hist||[],peak:s.peak||s.start,streak:s.streak||0,lastLossAt:s.lastLossAt||0});pe.risk=new Q.RiskEngine(risk);return;}}catch{}
  pe=mkPE(state.paper?.startingCapital||1000);}
function persist(){try{localStorage.setItem(PE_KEY,JSON.stringify({start:pe.start,cash:pe.cash,pos:pe.pos,hist:pe.hist.slice(-300),peak:pe.peak,streak:pe.streak,lastLossAt:pe.lastLossAt,riskCfg:risk}))}catch{}}
function ev(title,text){evs.unshift({time:nowTime(),title,text});evs=evs.slice(0,60);}
function sync(px){const eq=pe.equity(px),st=pe.stats();pe.peak=Math.max(pe.peak,eq);const p=pe.pos[0];
  state.paper={startingCapital:pe.start,equity:eq,realizedPnl:pe.cash-pe.start,unrealizedPnl:pe==null?0:pe.unreal(px),trades:st.trades,wins:st.wins,losses:st.losses,peakEquity:pe.peak,history:[],lastSide:'WAIT',lastSignalAt:0,
    position:p?{side:p.dir>0?'BUY':'SELL',entry:p.entry,stop:p.stop,target:p.target,qty:p.qty,capital:p.qty*p.entry}:null};}
// compat com handlers de app.js
loadPaper=function(){if(!pe)loadPE();};
savePaper=function(){if(pe&&!pe.pos.length&&!pe.hist.length&&state.paper&&state.paper.startingCapital>0&&state.paper.startingCapital!==pe.start)pe=mkPE(state.paper.startingCapital);persist();};
resetPaper=function(){pe=mkPE(pe?.start||1000);persist();};
closePaper=function(px,why){pe.pos.slice().forEach(p=>{pe.close(p,px,Date.now(),why);const h=pe.hist.at(-1);ev('Saída PAPER',`${h.side} ${state.live.symbol} • ${h.exit.toFixed(2)} • P&L ${h.pnl>=0?'+':''}${h.pnl.toFixed(2)} • ${why}`)});persist();};

// ---------- Pipeline: candles -> indicadores -> agentes -> sinal -> risco -> paper -> UI ----------
const reasonsMap={};
function run(closed){
  const c=candles.slice(-300),last=c.at(-1);if(!last)return;
  const closes=c.map(x=>x.c),e9=Q.ema(closes,9).at(-1),e21=Q.ema(closes,21).at(-1),r=Q.rsi(closes).at(-1);
  if(pe.pos.length){const n=pe.hist.length;pe.onCandle(last);
    pe.hist.slice(n).forEach(h=>{ev('Saída PAPER',`${h.side} ${state.live.symbol} • ${h.exit.toFixed(2)} • P&L ${h.pnl>=0?'+':''}${h.pnl.toFixed(2)} • ${h.why}`);});}
  const res=Q.AGENTS.map(a=>({a,s:Q.analyze(a,c)}));
  if(closed&&last.t!==lastClosed){lastClosed=last.t;ev('Candle fechado',`${state.live.symbol} ${last.c.toFixed(2)} • EMA9 ${e9?.toFixed(2)??'—'} • RSI ${r?.toFixed(1)??'—'}`);
    const best=res.filter(x=>x.s.status==='SINAL').sort((x,y)=>y.s.confidence-x.s.confidence)[0];
    if(!best)ev('Sem sinal','Nenhum dos 54 agentes encontrou confirmação suficiente');
    else{ev(`Sinal ${best.s.side}`,`${best.a.name} • confiança ${best.s.confidence}% • ${best.s.reasons.join(', ')}`);
      const o=pe.open({...best.s,sym:state.live.symbol},last.t);
      if(o.blocked){if(lastBlock!==o.reason)ev('OPERAÇÃO BLOQUEADA',o.reason);lastBlock=o.reason;}
      else{lastBlock='';ev('Entrada PAPER',`${best.s.side} ${state.live.symbol} • ${best.s.entry.toFixed(2)} • stop ${best.s.stop.toFixed(2)} • alvo ${best.s.target.toFixed(2)} • qtd ${o.pos.qty.toFixed(6)}`);}}}
  sync(last.c);persist();
  const agents=res.map(({a,s})=>{const id='ag-'+a.id,mine=pe.hist.filter(h=>h.strategy===a.name),sig=s.status==='SINAL';
    reasonsMap[id]=sig?s.reasons:(s.reasons||[]).concat(s.status==='SEM SINAL'?[]:[s.status+(s.need?` (${s.have}/${s.need} candles)`:'')]);
    return{id,name:a.name,symbol:state.live.symbol,status:sig?'active':'online',side:sig?(s.side==='LONG'?'BUY':'SELL'):'WAIT',confidence:sig?s.confidence:null,
      entry:sig?s.entry:null,stop:sig?s.stop:null,target:sig?s.target:null,pnl:mine.reduce((t,h)=>t+h.pnl,0),trades:mine.length,capital:null,_st:s.status};});
  if(!state.selected||!agents.some(a=>'ag-'+a.id===state.selected&&false)){const b=agents.filter(a=>a.confidence).sort((x,y)=>y.confidence-x.confidence)[0];if(!state.selected&&b)state.selected=b.id;}
  const p=state.paper,pnl=p.realizedPnl+p.unrealizedPnl,chg=last.o?(last.c-last.o)/last.o*100:0,sel=agents.find(a=>a.id===state.selected);
  const rows=pe.hist.slice(-8).reverse().map(h=>({side:h.dir>0?'BUY':'SELL',symbol:state.live.symbol,price:h.exit,agent:h.strategy,reason:`#${String(h.id).padStart(3,'0')} ${h.result} P&L ${h.pnl.toFixed(2)} • ${Math.round(h.duration/60000)}min • ${h.why}`}));
  applyData({portfolio:p.equity,today:pnl,drawdown:Math.max(0,p.peakEquity-p.equity),
    market:{symbol:state.live.symbol,price:last.c,status:'● CONECTADO • PAPER',priceChangePct:chg,volume:last.v,rsi:r,signal:sel?.confidence?`${sel.side} ${sel.confidence}%`:'SEM SINAL'},
    chart:c.slice(-60).map(x=>x.c),signals:rows,activity:evs,agents});
  window.__ind={e9,e21,r,n:c.length};renderIndicators(null,p.position);
}
renderIndicators=function(_,pos){const i=window.__ind||{},a=state.agents.find(x=>x.id===state.selected),f=v=>v==null?'—':fmtMoney(v);
  $('#ema9Value').textContent=i.n>=9?f(i.e9):'Dados insuficientes';$('#ema21Value').textContent=i.n>=21?f(i.e21):'Dados insuficientes';
  $('#rsiValue').textContent=i.r!=null?i.r.toFixed(1):'Dados insuficientes';
  $('#signalValue').textContent=!a?'—':a.confidence?`${a.side==='BUY'?'LONG':'SHORT'} • ${a.confidence}%`:'SEM SINAL';
  $('#positionValue').textContent=pos?`${pos.side} • ${fmtMoney(pos.entry)}`:'SEM POSIÇÃO';};
const _rs=renderSelected;
renderSelected=function(){_rs();let w=$('#whyBox');if(!w){w=document.createElement('div');w.id='whyBox';w.style.cssText='margin:10px 0;font-size:12px;line-height:1.6;color:#9fb3a8';$('#selectedBody .selected-head').after(w);}
  const a=state.agents.find(x=>x.id===state.selected);if(!a){w.textContent='';return;}
  const r=reasonsMap[a.id]||[];w.innerHTML=a.confidence?`<b style="color:#63f28e">Por quê?</b><br>${r.map(x=>'✓ '+esc(x)).join('<br>')}`:`<b>SEM SINAL</b><br>${esc(r[0]||'Não existe confirmação suficiente.')}`;};

// ---------- Conexão ----------
prov.on('status',(s,msg)=>{const t={CONNECTED:['live','● CONECTADO • PAPER'],CONNECTING:['none','● CONECTANDO'],DISCONNECTED:['none','● DESCONECTADO']}[s];
  setConnection(...t);ev(s==='CONNECTED'?'Market data conectado':s==='CONNECTING'?'Conectando ao mercado':'FONTE DESCONECTADA',msg||state.live.symbol);
  if(s==='DISCONNECTED'){$('#wallSub').textContent='FONTE DESCONECTADA — tentando reconectar';state.activity=evs;renderActivity();}})
 .on('event',m=>{ev('Reconexão',m);state.activity=evs;renderActivity();})
 .on('candles',c=>{candles=c;state.candles=c;lastClosed=c.at(-1)?.t||0;ev('Candles carregados',`${c.length} candles ${state.live.interval}`);run(false);})
 .on('candle',(cd,closed)=>{const i=candles.findIndex(x=>x.t===cd.t);i>=0?candles[i]=cd:candles.push(cd);candles=candles.slice(-1000);state.candles=candles;run(closed);});
connectLive=async function(){state.live.symbol=$('#liveSymbol').value;state.live.interval=$('#liveInterval').value;
  Object.assign(state.config,{marketSymbol:state.live.symbol,marketInterval:state.live.interval});localStorage.setItem('aiMarketConfig',JSON.stringify(state.config));
  loadPaper();const rp=Number($('#riskPct')?.value);if(rp>0&&rp<=5){risk.riskPct=rp;pe.risk=new Q.RiskEngine(risk);}
  candles=[];await prov.start(state.live.symbol,state.live.interval);};
disconnectLive=function(){prov.stop();candles=[];};
const _reset=reset;reset=function(){prov.stop();candles=[];_reset();};

// ---------- UI extra: risco + Laboratório (backtest separado do PAPER) ----------
(function(){const cap=$('#paperCapital')?.closest('label');if(!cap)return;
  const d=document.createElement('div');d.innerHTML=`<label>Risco por operação (%)<input id="riskPct" type="number" min="0.1" max="5" step="0.1" value="1"></label>
  <div style="margin-top:12px;border-top:1px solid #1c292d;padding-top:10px"><b style="font-size:11px;letter-spacing:1px">LABORATÓRIO (backtest)</b>
  <label>Estratégia<select id="btAgent">${Q.AGENTS.map(a=>`<option value="${a.id}">${a.name} — ${a.kind}</option>`).join('')}</select></label>
  <button id="btRun" class="ghost" type="button" style="margin-top:8px">Rodar nos candles carregados</button><pre id="btOut" style="font-size:11px;white-space:pre-wrap;color:#9fb3a8"></pre></div>`;cap.after(d);
  $('#riskPct').value=risk.riskPct;
  $('#btRun').onclick=()=>{const o=$('#btOut');if(candles.length<100){o.textContent='AGUARDANDO DADOS — conecte o mercado primeiro.';return;}
    const ag=Q.AGENTS.find(a=>a.id===+$('#btAgent').value),s=Q.backtest(ag,candles.slice(),{capital:pe.start,riskPct:+$('#riskPct').value||1,symbol:state.live.symbol}),f=(v,d=2)=>v==null?'—':v===Infinity?'∞':v.toFixed(d);
    o.textContent=`${ag.name} • ${state.live.symbol} ${state.live.interval} • ${candles.length} candles\nTrades ${s.trades} | Wins ${s.wins} | Losses ${s.losses}\nWin rate ${f(s.winRate,1)}% | P&L ${f(s.pnl)} (${f(s.pnlPct)}%)\nProfit factor ${f(s.profitFactor)} | Max DD ${f(s.maxDrawdownPct)}%\n(resultado histórico, separado do PAPER ao vivo)`;};})();

// handlers de app.js (encerrar/zerar/capital) chamam applyLiveMarket: redireciona para o pipeline novo (evita o paper antigo)
applyLiveMarket=function(){if(candles.length)run(false);};

// ---------- Init: conecta sozinho ----------
loadPE();sync(pe.start);$('#paperCapital').value=pe.start;connectLive();
