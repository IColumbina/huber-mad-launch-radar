(() => {
  const D = window.RADAR;
  if (!D) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtUsd = (n) => !Number.isFinite(n) ? '-' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`;
  const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? '<span class="muted">n/a</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function clientImplied(r, params) {
    const k = params.k ?? D.model.shrinkage_k;
    const scExp = params.sc ?? D.model.scale_exponent;
    const gw = params.gw ?? D.model.growth_weight;
    const slv = r.tier === 'cohort' ? (params.slv ?? D.model.cohort_sleeve_factor) : 1.0;
    const pObj = D.priors[r.category || 'Other'] || D.priors.__global__;
    const gMed = D.priors.__global__.raw_median_multiple;
    const effK = D.model.formula_kind === 'asinh' ? k * (1 + (pObj.iqr_spread || 0.2)) : k;
    const catMult = params.k !== undefined
      ? clamp((pObj.peer_count * pObj.raw_median_multiple + effK * gMed) / (pObj.peer_count + effK), D.model.prior_floor, D.model.prior_cap)
      : r.category_multiple;

    const tvlM = Math.max(r.tvl_usd, 1_000_000);
    let scaleMult = clamp(Math.pow(D.model.scale_anchor_usd / tvlM, scExp), 0.56, 1.35);
    if (D.model.formula_kind === 'ols') scaleMult = clamp(Math.pow(tvlM / D.model.scale_anchor_usd, D.model.ols_beta - 1), 0.58, 1.35);
    else if (D.model.formula_kind === 'mm') scaleMult = clamp(1.18 - 0.56 * (tvlM / (tvlM + 350_000_000)), 0.58, 1.25);
    else if (D.model.formula_kind === 'logtvl') scaleMult = clamp(1 / (1 + 0.085 * Math.log(Math.max(tvlM / 50_000_000, 0.25))), 0.60, 1.25);

    const rawG = Number.isFinite(r.change_7d) ? r.change_7d : 0;
    let growthMult = 1 + gw * Math.tanh(rawG / D.model.growth_scale_pct);
    if (D.model.formula_kind === 'asinh') growthMult = clamp(1 + gw * Math.asinh(rawG / D.model.growth_scale_pct) * 0.45, 0.65, 1.35);
    else if (D.model.formula_kind === 'atan') growthMult = 1 + gw * (2 / Math.PI) * Math.atan(rawG / D.model.growth_scale_pct);
    else if (D.model.formula_kind === 'asym') growthMult = rawG < 0 ? 1 + (gw * 1.15) * Math.tanh(rawG / 22) : 1 + (gw * 0.72) * Math.tanh(rawG / 42);
    else if (D.model.formula_kind === 'sigmoid') growthMult = 1 + gw * (2 / (1 + Math.exp(-rawG / D.model.growth_scale_pct)) - 1);

    const ageM = r.age_days !== null && r.age_days !== undefined ? r.age_days : D.model.unknown_age_days;
    let matMult = D.model.maturity_floor + (clamp(ageM, 0, D.model.maturity_days) / D.model.maturity_days) * D.model.maturity_range;
    if (D.model.formula_kind === 'mm') matMult = 0.70 + 0.44 * (ageM / (ageM + 300));
    else if (D.model.formula_kind === 'gauss') matMult = 0.74 + 0.36 * Math.exp(-Math.pow((ageM - 680) / 520, 2));

    const chainMult = 1 + Math.min(Math.max((r.chains || []).length - 1, 0) * D.model.chain_step, D.model.chain_cap);
    const fdv = Math.max(1, Math.round(r.tvl_usd * catMult * scaleMult * growthMult * matMult * chainMult * slv));
    const pool = Math.max(1, Math.round(fdv * r.airdrop_share));
    return { fdv, per1k: Math.max(1, Math.round((pool / Math.max(r.tvl_usd, 1)) * 1000)) };
  }

  let maxDrift = 0;
  for (const r of D.rows) {
    const c = clientImplied(r, {});
    const d = Math.abs(c.fdv - r.implied_value_usd) / Math.max(1, r.implied_value_usd);
    if (d > maxDrift) maxDrift = d;
  }

  document.getElementById('as-of').textContent = D.as_of;
  const fp = document.getElementById('floor-pill');
  if (fp) fp.textContent = fmtUsd(D.floor_usd);
  document.getElementById('formula-text').textContent = D.formula_desc;
  document.getElementById('parity-badge').textContent = `Parity OK (${(maxDrift * 100).toFixed(3)}%)`;

  const state = { q: '', tier: 'all', cat: 'all', chain: 'all', sort: 'rank' };
  const catSel = document.getElementById('cat');
  const chainSel = document.getElementById('chain');
  [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort().forEach((c) => catSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
  [...new Set(D.rows.flatMap((r) => r.chains || []))].sort().forEach((c) => chainSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));

  const tierLabel = (t) => t === 'watchlist' ? 'Watchlist' : t === 'cohort' ? 'Cohort >=50M' : 'Early <50M';

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return D.rows.filter((r) => {
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (q && !`${r.name} ${r.slug} ${r.category || ''} ${(r.chains || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => {
      if (state.sort === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (state.sort === 'airdrop') return b.airdrop_per_1k_usd - a.airdrop_per_1k_usd;
      if (state.sort === 'growth') return (b.change_7d ?? -999) - (a.change_7d ?? -999);
      if (state.sort === 'mult') return b.category_multiple - a.category_multiple;
      return a.rank - b.rank;
    });
  }

  function renderChart(rows) {
    const svg = document.getElementById('radar-svg');
    if (!svg) return;
    if (document.body.className.includes('topo-command-donut')) {
      const tiers = [['watchlist', 'var(--accent)', 'Watchlist'], ['cohort', 'var(--amber)', 'Cohort >=50M'], ['early', 'var(--blue)', 'Early <50M']];
      const sums = tiers.map(([t, col, lbl]) => ({ t, col, lbl, v: rows.filter((r) => r.tier === t).reduce((s, r) => s + r.tvl_usd, 0), c: rows.filter((r) => r.tier === t).length })).filter((x) => x.c > 0);
      const tot = Math.max(1, sums.reduce((s, x) => s + x.v, 0));
      let acc = 0;
      const r = 36, cx = 56, cy = 56, circ = 2 * Math.PI * r;
      const arcs = sums.map((x) => {
        const dash = (x.v / tot) * circ;
        const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${x.col}" stroke-width="16" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
        acc += dash;
        return el;
      }).join('');
      const leg = sums.map((x, i) => `<rect x="118" y="${16 + i * 26}" width="10" height="10" rx="2" fill="${x.col}"/><text x="134" y="${25 + i * 26}" fill="var(--ink)" font-size="11" font-family="var(--mono)">${x.lbl}: ${x.c} (${fmtUsd(x.v)})</text>`).join('');
      svg.innerHTML = arcs + `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="var(--ink)" font-size="11" font-weight="700" font-family="var(--mono)">${rows.length}</text>` + leg;
      return;
    }
    const byCat = new Map();
    for (const r of rows) {
      const k = r.category || 'Other';
      byCat.set(k, (byCat.get(k) || 0) + r.implied_value_usd);
    }
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const maxV = Math.max(1, ...top.map((x) => x[1]));
    svg.innerHTML = top.map(([cat, val], i) => {
      const y = 8 + i * 25;
      const w = Math.max(18, Math.round((val / maxV) * 215));
      return `<text x="2" y="${y + 13}" fill="var(--muted)" font-size="10.5" font-family="var(--mono)">${esc(cat.slice(0, 18))}</text><rect x="135" y="${y + 2}" width="${w}" height="13" rx="3" fill="var(--accent)" fill-opacity="${(0.95 - i * 0.16).toFixed(2)}"/><text x="${141 + w}" y="${y + 13}" fill="var(--ink)" font-size="10.5" font-family="var(--mono)">${fmtUsd(val)}</text>`;
    }).join('');
  }

  function renderBoard() {
    const rows = filtered();
    const isF = rows.length !== D.rows.length;
    const tvl = rows.reduce((s, r) => s + r.tvl_usd, 0);
    const fdv = rows.reduce((s, r) => s + r.implied_value_usd, 0);
    const top = rows[0];
    document.getElementById('kpi-grid').innerHTML = `
      <div class="kpi"><div class="kpi-label">${isF ? 'Filtered Scope' : 'Watchlist'}</div><div class="kpi-val">${isF ? `${rows.length}/${D.board_size}` : `${D.watchlist_size}/40`}</div><div class="kpi-sub">${D.early_size} early &middot; ${D.cohort_size} sleeves</div></div>
      <div class="kpi"><div class="kpi-label">Tracked TVL</div><div class="kpi-val">${fmtUsd(tvl)}</div><div class="kpi-sub">${rows.length} ranked protocols</div></div>
      <div class="kpi"><div class="kpi-label">Top Implied FDV</div><div class="kpi-val">${top ? fmtUsd(top.implied_value_usd) : '-'}</div><div class="kpi-sub">${top ? esc(top.name) : '-'}</div></div>
      <div class="kpi"><div class="kpi-label">${isF ? 'Filtered FDV' : 'Live Peers'}</div><div class="kpi-val">${isF ? fmtUsd(fdv) : `${D.live_size} comps`}</div><div class="kpi-sub">${D.excluded_size} excluded entries</div></div>
    `;
    renderChart(rows);
    document.getElementById('filter-status').textContent = `Showing ${rows.length} of ${D.rows.length} rows` + (state.cat !== 'all' ? ` | category=${state.cat}` : '');
    document.getElementById('tbody').innerHTML = rows.map((r) => `
      <tr data-row="${esc(r.slug)}">
        <td class="num"><strong>${r.rank}</strong></td>
        <td><div class="p-name">${esc(r.name)}</div><div class="p-meta">${esc(r.category || 'Other')} &middot; ${esc((r.chains || []).slice(0, 3).join(', '))} &middot; ${r.age_days ?? 'n/a'}d</div></td>
        <td><span class="badge tier-${esc(r.tier)}">${tierLabel(r.tier)}</span></td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num">${fmtPct(r.change_7d)}</td>
        <td class="num">${r.category_multiple.toFixed(2)}x</td>
        <td class="num"><strong>${fmtUsd(r.implied_value_usd)}</strong><span class="band-text">${fmtUsd(r.low_value_usd)}&ndash;${fmtUsd(r.high_value_usd)}</span></td>
        <td class="num">$${r.airdrop_per_1k_usd}</td>
        <td><button type="button" class="btn-mini">Plan</button></td>
      </tr>
    `).join('');
  }

  const dlg = document.getElementById('detail-dialog');
  function openDetail(slug) {
    const r = D.rows.find((x) => x.slug === slug);
    if (!r) return;
    document.getElementById('dlg-meta').textContent = `#${r.rank} · ${tierLabel(r.tier)} · ${r.category || 'Other'} · ${(r.chains || []).join(', ')}`;
    document.getElementById('dlg-title').textContent = r.name;
    const peers = D.live.filter((l) => l.category === r.category).slice(0, 4);
    const pHtml = peers.length ? peers.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${fmtUsd(l.tvl_usd)}</td><td class="num">${fmtUsd(l.mcap_usd)}</td><td class="num">${l.mcap_tvl.toFixed(2)}x</td></tr>`).join('')
      : `<tr><td colspan="4" class="muted">Shrunk to Global Median (${D.priors.__global__.raw_median_multiple.toFixed(2)}x)</td></tr>`;
    document.getElementById('dlg-left').innerHTML = `
      <div class="val-box"><div class="kpi-label">Implied Valuation</div><div class="val-num">${fmtUsd(r.implied_value_usd)}</div><div class="val-range">Band: ${fmtUsd(r.low_value_usd)} &ndash; ${fmtUsd(r.high_value_usd)} &middot; Est. Pool ${fmtUsd(r.airdrop_pool_usd)} ($${r.airdrop_per_1k_usd}/$1k)</div></div>
      <div class="factors-grid">
        <div class="f-cell"><div class="f-lbl">Prior (${r.peer_count}p)</div><div class="f-val">${r.category_multiple.toFixed(2)}x</div></div>
        <div class="f-cell"><div class="f-lbl">Scale</div><div class="f-val">${r.scale_multiplier.toFixed(2)}x</div></div>
        <div class="f-cell"><div class="f-lbl">7d Flow</div><div class="f-val">${r.growth_multiplier.toFixed(2)}x</div></div>
        <div class="f-cell"><div class="f-lbl">Maturity</div><div class="f-val">${r.maturity_multiplier.toFixed(2)}x</div></div>
        <div class="f-cell"><div class="f-lbl">Chains (${r.chains.length})</div><div class="f-val">${r.chain_multiplier.toFixed(2)}x</div></div>
        <div class="f-cell"><div class="f-lbl">Sleeve</div><div class="f-val">${r.sleeve_factor.toFixed(2)}x</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Live Peer</th><th class="num">TVL</th><th class="num">MCap</th><th class="num">Ratio</th></tr></thead><tbody>${pHtml}</tbody></table></div>
    `;
    document.getElementById('dlg-right').innerHTML = `<ol class="steps-list">${r.steps.map((s, i) => `<li data-farm-step="${i + 1}"><div class="step-top"><span class="step-num">0${i + 1}</span>${esc(s.text)}</div><div class="step-tags"><span class="tag-cost">Cost: ${esc(s.cost)}</span><span class="tag-time">Time: ${esc(s.time)}</span></div></li>`).join('')}</ol>`;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', 'open');
  }

  function closeDetail() {
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.removeAttribute('open');
  }

  function renderSandbox() {
    const p = {
      k: Number(document.getElementById('sl-k').value),
      sc: Number(document.getElementById('sl-sc').value),
      gw: Number(document.getElementById('sl-gw').value),
      slv: Number(document.getElementById('sl-slv').value),
    };
    document.getElementById('sv-k').textContent = p.k;
    document.getElementById('sv-sc').textContent = p.sc.toFixed(2);
    document.getElementById('sv-gw').textContent = p.gw.toFixed(2);
    document.getElementById('sv-slv').textContent = p.slv.toFixed(2);
    document.getElementById('sb-tbody').innerHTML = D.rows.map((r) => ({ r, sim: clientImplied(r, p) }))
      .sort((a, b) => b.sim.fdv - a.sim.fdv).slice(0, 10)
      .map((it, i) => `<tr><td class="num">${i + 1}</td><td class="num">#${it.r.rank}</td><td>${esc(it.r.name)}</td><td class="num">${fmtUsd(it.sim.fdv)}</td><td class="num">$${it.sim.per1k}</td></tr>`).join('');
  }

  document.getElementById('tbody').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-row]');
    if (tr) openDetail(tr.getAttribute('data-row'));
  });
  dlg.querySelector('[data-close-detail]').addEventListener('click', closeDetail);
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) closeDetail(); });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    const t = b.getAttribute('data-tab');
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${t}`));
    if (t === 'sandbox') renderSandbox();
  }));
  document.querySelectorAll('.pill').forEach((b) => b.addEventListener('click', () => {
    state.tier = b.getAttribute('data-tier');
    document.querySelectorAll('.pill').forEach((x) => x.classList.toggle('active', x === b));
    renderBoard();
  }));
  document.getElementById('q').addEventListener('input', (ev) => { state.q = ev.target.value; renderBoard(); });
  catSel.addEventListener('change', (ev) => { state.cat = ev.target.value; renderBoard(); });
  chainSel.addEventListener('change', (ev) => { state.chain = ev.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', (ev) => { state.sort = ev.target.value; renderBoard(); });
  ['sl-k', 'sl-sc', 'sl-gw', 'sl-slv'].forEach((id) => document.getElementById(id).addEventListener('input', renderSandbox));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('sl-k').value = String(D.model.shrinkage_k);
    document.getElementById('sl-sc').value = String(D.model.scale_exponent);
    document.getElementById('sl-gw').value = String(D.model.growth_weight);
    document.getElementById('sl-slv').value = String(D.model.cohort_sleeve_factor);
    renderSandbox();
  });

  document.getElementById('priors-tbody').innerHTML = Object.values(D.priors).sort((a, b) => b.peer_count - a.peer_count)
    .map((p) => `<tr><td>${esc(p.category)}</td><td class="num">${p.peer_count}</td><td class="num">${p.raw_median_multiple.toFixed(2)}x</td><td class="num">${p.prior_multiple.toFixed(2)}x</td><td class="num">${p.p25_multiple.toFixed(2)}&ndash;${p.p75_multiple.toFixed(2)}x</td></tr>`).join('');
  document.getElementById('live-count').textContent = D.live.length;
  document.getElementById('live-tbody').innerHTML = D.live.slice(0, 30)
    .map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.category || '')}</td><td class="num">${fmtUsd(l.tvl_usd)}</td><td class="num">${fmtUsd(l.mcap_usd)}</td><td class="num">${l.mcap_tvl.toFixed(2)}x</td></tr>`).join('');
  document.getElementById('excl-tbody').innerHTML = D.excluded
    .map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.category || '')}</td><td class="num">${fmtUsd(x.tvl_usd)}</td><td>${esc(x.reason)}</td></tr>`).join('');

  renderBoard();
})();
