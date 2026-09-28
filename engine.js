/* AI MARKET QUANT — engine.js (100% PAPER, sem ordens reais, sem dados fictícios) */
(function (root) {
  const MIN = 30;
  const ema = (v, n) => { const k = 2 / (n + 1), o = []; let p;
    v.forEach((x, i) => { p = i === 0 ? x : x * k + p * (1 - k); o.push(i < n - 1 ? null : p); }); return o; };
  const rsi = (v, n = 14) => { const o = Array(v.length).fill(null); if (v.length <= n) return o;
    let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; d > 0 ? g += d : l -= d; }
    g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < v.length; i++) { const d = v[i] - v[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
      o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; };
  const atr = (c, n = 14) => { const s = c.slice(-n - 1); if (s.length < n + 1) return null; let t = 0;
    for (let i = 1; i < s.length; i++) t += Math.max(s[i].h - s[i].l, Math.abs(s[i].h - s[i - 1].c), Math.abs(s[i].l - s[i - 1].c));
    return t / n; };

  // 54 agentes = 6 famílias x 9 variações de parâmetros
  const FAMILIES = [['Tendência', 'trend', 1], ['Scalping', 'trend', 0.6], ['Reversão', 'reversal', 1],
    ['Quant', 'reversal', 1.4], ['Breakout', 'breakout', 1], ['AI Consensus', 'consensus', 1]];
  const AGENTS = []; FAMILIES.forEach(([fam, kind, sc], f) => { for (let v = 0; v < 9; v++)
    AGENTS.push({ id: f * 9 + v + 1, family: fam, kind, name: `${fam} #${f * 9 + v + 1}`,
      fast: Math.max(3, Math.round((5 + v) * sc)), slow: Math.round((15 + v * 2) * sc) + 6,
      rsiLo: 45 + (v % 3) * 2, rsiHi: 68 - (v % 3) * 2, atrMult: 1.2 + (v % 3) * 0.3, rr: 1.5 + (v % 3) * 0.5,
      lookback: 10 + v * 2, z: 1.5 + (v % 3) * 0.25 }); });

  function regime(closes, e9, e21, a) { const i = closes.length - 1, sp = (e9[i] - e21[i]) / closes[i];
    return a / closes[i] < 0.0004 ? 'LATERAL' : Math.abs(sp) > 0.0008 ? (sp > 0 ? 'ALTA' : 'BAIXA') : 'LATERAL'; }

  function base(ag, c) { const cl = c.map(x => x.c), i = cl.length - 1, last = cl[i];
    const ef = ema(cl, ag.fast), es = ema(cl, ag.slow), r = rsi(cl), a = atr(c);
    if (ef[i] == null || es[i] == null || r[i] == null || a == null) return null;
    return { cl, i, last, ef, es, r: r[i], a, reg: regime(cl, ef, es, a) }; }

  function rule(ag, b, c) { const R = [], up = [], dn = []; const { last, ef, es, r, i, reg } = b;
    if (ag.kind === 'trend') {
      const m = last - b.cl[i - 3]; 
      if (ef[i] > es[i]) up.push(`EMA ${ag.fast} acima da EMA ${ag.slow}`); if (ef[i] < es[i]) dn.push(`EMA ${ag.fast} abaixo da EMA ${ag.slow}`);
      if (reg === 'ALTA') up.push('tendência confirmada'); if (reg === 'BAIXA') dn.push('tendência confirmada');
      if (r > ag.rsiLo && r < ag.rsiHi) up.push(`RSI ${r.toFixed(1)} em zona válida`);
      if (r < 100 - ag.rsiLo && r > 100 - ag.rsiHi) dn.push(`RSI ${r.toFixed(1)} em zona válida`);
      if (m > 0) up.push('momentum positivo'); if (m < 0) dn.push('momentum negativo');
    } else if (ag.kind === 'reversal') {
      const w = b.cl.slice(-ag.lookback), mu = w.reduce((x, y) => x + y) / w.length,
        sd = Math.sqrt(w.reduce((x, y) => x + (y - mu) ** 2, 0) / w.length), z = sd ? (last - mu) / sd : 0;
      if (r < 30) up.push(`RSI ${r.toFixed(1)} sobrevendido`); if (r > 70) dn.push(`RSI ${r.toFixed(1)} sobrecomprado`);
      if (z < -ag.z) up.push(`preço ${z.toFixed(2)}σ abaixo da média`); if (z > ag.z) dn.push(`preço ${z.toFixed(2)}σ acima da média`);
      if (reg === 'LATERAL') { up.length && up.push('regime lateral favorece reversão'); dn.length && dn.push('regime lateral favorece reversão'); }
    } else if (ag.kind === 'breakout') {
      const w = c.slice(-ag.lookback - 1, -1), hi = Math.max(...w.map(x => x.h)), lo = Math.min(...w.map(x => x.l));
      if (last > hi) up.push(`rompeu máxima de ${ag.lookback} candles`); if (last < lo) dn.push(`rompeu mínima de ${ag.lookback} candles`);
      if (b.a / last > 0.0004) { up.length && up.push('volatilidade expandindo'); dn.length && dn.push('volatilidade expandindo'); }
    }
    return { up, dn }; }

  function analyze(ag, c) {
    if (!Array.isArray(c) || c.length === 0) return { status: 'AGUARDANDO DADOS' };
    if (c.length < MIN) return { status: 'DADOS INSUFICIENTES', have: c.length, need: MIN };
    const b = base(ag, c); if (!b) return { status: 'DADOS INSUFICIENTES' };
    let up, dn, need = ag.kind === 'trend' ? 4 : 2;
    if (ag.kind === 'consensus') { // maioria das famílias base concorda
      const vs = ['trend', 'reversal', 'breakout'].map(k => analyze({ ...ag, kind: k }, c));
      const L = vs.filter(v => v.side === 'LONG'), S = vs.filter(v => v.side === 'SHORT');
      const w = L.length >= 2 ? L : S.length >= 2 ? S : null;
      if (!w) return { status: 'SEM SINAL', reasons: ['Não existe confirmação suficiente.'], ind: ind(b) };
      up = w[0].side === 'LONG' ? w.flatMap(x => x.reasons) : []; dn = w[0].side === 'SHORT' ? w.flatMap(x => x.reasons) : []; need = 1;
    } else ({ up, dn } = rule(ag, b, c));
    const side = up.length >= need && up.length > dn.length ? 'LONG' : dn.length >= need && dn.length > up.length ? 'SHORT' : null;
    if (!side) return { status: 'SEM SINAL', reasons: ['Não existe confirmação suficiente.'], ind: ind(b), regime: b.reg };
    const reasons = side === 'LONG' ? up : dn, risk = b.a * ag.atrMult, s = side === 'LONG' ? 1 : -1;
    return { status: 'SINAL', side, entry: b.last, stop: b.last - s * risk, target: b.last + s * risk * ag.rr,
      confidence: Math.min(95, 40 + reasons.length * 12), reasons, agent: ag.name, strategy: ag.kind,
      regime: b.reg, ind: ind(b), ts: c[c.length - 1].t }; }
  const ind = b => ({ emaFast: b.ef[b.i], emaSlow: b.es[b.i], rsi: b.r, atr: b.a });

  class RiskEngine {
    constructor(o = {}) { this.o = { riskPct: 1, maxOpen: 3, maxExposurePct: 100, maxDrawdownPct: 10, lossStreak: 3, cooldownMs: 3600e3, ...o }; }
    check(sig, acc) { const o = this.o, d = Math.abs(sig.entry - sig.stop);
      if (!d) return { ok: false, reason: 'Stop inválido' };
      if (acc.open >= o.maxOpen) return { ok: false, reason: 'Máximo de operações simultâneas' };
      if (acc.drawdownPct >= o.maxDrawdownPct) return { ok: false, reason: 'Limite de drawdown atingido' };
      if (acc.lossStreak >= o.lossStreak && Date.now() - acc.lastLossAt < o.cooldownMs) return { ok: false, reason: 'Pausa após sequência de perdas' };
      let qty = (acc.equity * o.riskPct / 100) / d; const room = acc.equity * o.maxExposurePct / 100 - acc.exposure;
      qty = Math.min(qty, room / sig.entry); if (qty <= 0) return { ok: false, reason: 'Exposição máxima atingida' };
      return { ok: true, qty }; } }

  class PaperEngine {
    constructor(cap = 1000, risk) { this.start = cap; this.cash = cap; this.pos = []; this.hist = []; this.peak = cap; this.streak = 0; this.lastLossAt = 0; this.risk = risk || new RiskEngine(); }
    get exposure() { return this.pos.reduce((s, p) => s + p.qty * p.entry, 0); }
    unreal(px) { return this.pos.reduce((s, p) => s + (px - p.entry) * p.qty * p.dir, 0); }
    equity(px) { return this.cash + (px == null ? 0 : this.unreal(px)); }
    account(px) { const eq = this.equity(px); return { equity: eq, open: this.pos.length, exposure: this.exposure, lossStreak: this.streak,
      lastLossAt: this.lastLossAt, drawdownPct: Math.max(0, (this.peak - eq) / this.peak * 100) }; }
    open(sig, t = Date.now()) { const r = this.risk.check(sig, this.account(sig.entry)); if (!r.ok) return { blocked: true, reason: r.reason };
      const p = { id: this.hist.length + this.pos.length + 1, sym: sig.sym, dir: sig.side === 'LONG' ? 1 : -1, side: sig.side, entry: sig.entry,
        stop: sig.stop, target: sig.target, qty: r.qty, strategy: sig.agent, openedAt: t }; this.pos.push(p); return { blocked: false, pos: p }; }
    onCandle(cd) { for (const p of [...this.pos]) { // stop tem prioridade (conservador)
        const hitS = p.dir > 0 ? cd.l <= p.stop : cd.h >= p.stop, hitT = p.dir > 0 ? cd.h >= p.target : cd.l <= p.target;
        if (hitS || hitT) this.close(p, hitS ? p.stop : p.target, cd.t, hitS ? 'STOP' : 'ALVO'); } }
    close(p, px, t, why = 'MANUAL') { const pnl = (px - p.entry) * p.qty * p.dir; this.cash += pnl; this.pos = this.pos.filter(x => x !== p);
      pnl < 0 ? (this.streak++, this.lastLossAt = Date.now()) : (this.streak = 0);
      this.peak = Math.max(this.peak, this.cash); this.hist.push({ ...p, exit: px, closedAt: t, pnl, result: pnl >= 0 ? 'WIN' : 'LOSS', why, duration: t - p.openedAt }); }
    stats() { const h = this.hist, w = h.filter(x => x.pnl > 0), l = h.filter(x => x.pnl <= 0), gp = w.reduce((s, x) => s + x.pnl, 0), gl = -l.reduce((s, x) => s + x.pnl, 0);
      let pk = this.start, eq = this.start, dd = 0; h.forEach(x => { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.max(dd, (pk - eq) / pk * 100); });
      return { trades: h.length, wins: w.length, losses: l.length, winRate: h.length ? w.length / h.length * 100 : null,
        pnl: this.cash - this.start, pnlPct: (this.cash - this.start) / this.start * 100, profitFactor: gl ? gp / gl : (gp ? Infinity : null), maxDrawdownPct: dd }; } }

  function backtest(ag, candles, o = {}) { // separado do PAPER ao vivo: instância própria
    const pe = new PaperEngine(o.capital || 1000, new RiskEngine({ riskPct: o.riskPct || 1, ...o.risk }));
    for (let i = MIN; i < candles.length; i++) { pe.onCandle(candles[i]);
      if (!pe.pos.length) { const s = analyze(ag, candles.slice(0, i + 1)); if (s.status === 'SINAL') pe.open({ ...s, sym: o.symbol }, candles[i].t); } }
    return pe.stats(); }

  root.QuantEngine = { ema, rsi, atr, AGENTS, analyze, RiskEngine, PaperEngine, backtest };
  if (typeof module !== 'undefined') module.exports = root.QuantEngine;
})(typeof window !== 'undefined' ? window : globalThis);
