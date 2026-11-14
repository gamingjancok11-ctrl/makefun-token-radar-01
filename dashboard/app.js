// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, a live-token view, and a model sandbox that re-runs the
// ranking with the reader's own constants. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', wl: false, rising: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: { scale: 1, growth: 0.5, floor: 0.6 } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The sandbox calls it with the reader's own constants.
  function impliedOf(row, model, over) {
    var o = over || {};
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = o.growth === undefined ? model.growth_weight : o.growth;
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var floor = o.floor === undefined ? model.maturity_floor : o.floor;
    var maturity = floor + (1 - floor) * (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);
    var multiple = row.multiple * (o.scale === undefined ? 1 : o.scale);
    multiple = Math.min(3, Math.max(model.multiple_min, multiple));
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * row.breadth_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 25e7) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'about $6 to $12 of gas';
    if (c === 'solana') return 'a few cents of gas';
    if (c === 'binance') return 'about $0.20 of gas';
    if (c === 'tron') return 'about $1 of network fees';
    if (c === 'bitcoin') return 'a few dollars of network fees';
    return 'typically under $1 of gas';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('uncollateralized') >= 0 || c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s highest-TVL vault on " + chain + ' and hold the receipt token.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s main yield position on " + chain + ' and let it compound.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s basis strategy on " + chain + ' and hold the position through one funding cycle.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one position on a market that settles after the snapshot window.';
    if (c.indexOf('stablecoin') >= 0) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('payment') >= 0) return 'Run $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the account funded.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' managed position on ' + chain + ' and let it rebalance.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + " to the chain and use " + name + "'s core app on it, so the wallet is active there.";
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s incentive pool on " + chain + ' and vote once with the position.';
    if (c.indexOf('otc') >= 0 || c.indexOf('marketplace') >= 0) return 'Complete one $' + capital + ' trade through ' + name + ' on ' + chain + ' and keep the account in good standing.';
    if (c.indexOf('card') >= 0) return 'Fund the ' + name + ' card with $' + capital + ' and make one purchase through it.';
    if (c.indexOf('collateral') >= 0) return 'Post $' + capital + ' of collateral with ' + name + ' on ' + chain + ' and keep the position healthy.';
    if (c.indexOf('btc') >= 0 || c.indexOf('bitcoin') >= 0) return 'Deposit $' + capital + ' of BTC-backed collateral through ' + name + ' on ' + chain + ' and hold the receipt.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s managed account on " + chain + ' and keep it funded.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Spread a second, smaller deposit across another ' + name + ' vault, so more than one product sees your wallet.';
    if (c.indexOf('uncollateralized') >= 0 || c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Borrow $' + small + ' against your supply and repay it within the week, so both sides of the market record activity.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through the pool once, so the wallet shows trading activity as well as liquidity.';
    if (c.indexOf('yield') >= 0) return 'Claim or restake one round of yield, so the wallet shows a harvest transaction.';
    if (c.indexOf('basis') >= 0) return 'Top the position up once after the first funding settlement, so the wallet shows repeat deposits.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + small + ' back the other way a week later, so the wallet shows two-way volume.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Delegate or restake a small second amount, so the wallet shows more than one staking transaction.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Close the hedge and open a fresh one, so the wallet shows two round trips.';
    if (c.indexOf('prediction') >= 0) return 'Place a second position on a different market, so the wallet is not a one-trade account.';
    if (c.indexOf('stablecoin') >= 0 || c.indexOf('rwa') >= 0) return 'Add a second, smaller mint a week later, so the wallet shows repeat activity.';
    if (c.indexOf('insurance') >= 0) return 'Renew or extend the cover once, so the wallet shows an ongoing policy.';
    if (c.indexOf('payment') >= 0) return 'Make a second payment a week later, so the wallet shows repeat usage.';
    if (c.indexOf('index') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Add a second, smaller deposit a week later, so the wallet shows repeat activity.';
    if (c.indexOf('chain') >= 0) return 'Use a second app on the chain, so the wallet is active in more than one place.';
    if (c.indexOf('governance') >= 0) return 'Vote a second time on a later proposal, so the wallet shows repeat governance.';
    if (c.indexOf('otc') >= 0 || c.indexOf('marketplace') >= 0) return 'Complete a second trade a week later, so the wallet shows repeat volume.';
    if (c.indexOf('card') >= 0) return 'Make a second purchase a week later, so the card shows repeat spending.';
    return 'Return once and add a second, smaller deposit, so the position shows repeat activity rather than a single transaction.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper kept offline.', cost: 'no cost to create; the first transaction costs gas', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + Math.max(10, Math.round(capital / 5)) + ' of capital and ' + gas, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote, so snapshots keep seeing the wallet.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link the protocol itself publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Size the position so a smart-contract failure would not hurt, and write the wallet, the dates and every transaction in a farm log.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('rising') === '1') state.rising = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1') state.dir = 1;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.rising) params.set('rising', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir === 1) params.set('dir', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wl && !r.watchlist) return false;
      if (state.rising && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function rowBySlug(slug) {
    var found = DATA.rows.filter(function (r) { return r.slug === slug; });
    return found.length ? found[0] : null;
  }

  // The one memorable mark: a radar sweep, drawn once, in the header.
  var SWEEP = '<svg class="mark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.5" fill="none" stroke="#17573f" stroke-width="1.6"/><circle cx="13" cy="13" r="7" fill="none" stroke="#17573f" stroke-width="1" opacity="0.55"/><circle cx="13" cy="13" r="2.5" fill="none" stroke="#17573f" stroke-width="1" opacity="0.4"/><path d="M13 13 L13 1.5 A11.5 11.5 0 0 1 22.6 8.2 Z" fill="#17573f"/><circle cx="19" cy="9" r="2" fill="#b87a10"/></svg>';

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand', html: SWEEP + '<span>Token Radar</span>' }),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { html: '<span class="figure">' + DATA.watchlist_size + ' watchlist protocols</span>, ranked by what a launch would be worth' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, each with a farm plan. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact wide' }, el('span', { text: 'Total implied value of the board' }), el('b', { class: 'num', text: fmtUsd(DATA.total_implied_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var risingBox = el('input', { type: 'checkbox', id: 'rising', checked: state.rising ? 'checked' : null });
    risingBox.addEventListener('change', function () { state.rising = risingBox.checked; writeHash(); render(); });
    function tabButton(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var countText = state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.calibration.rows.length + ' calibrated categories';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'checks' },
        el('label', { for: 'wl' }, wlBox, 'Watchlist only'),
        el('label', { for: 'rising' }, risingBox, 'Growing this week')
      ),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabButton('pre-token', 'Pre-token'), tabButton('live', 'Live token'), tabButton('model', 'How it ranks'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col', class: key === 'name' ? '' : 'num' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function openDetail(slug) {
    state.selected = slug;
    writeHash();
    render();
    window.scrollTo(0, 0);
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; state.rising = false; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: 'row-link',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank-cell' + (r.rank === 1 ? ' top1' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'watch', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { class: r.rank === 1 ? 'top1' : '', style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its value breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.ratio) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-to-TVL ratios are what calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var calibRows = cal.rows.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.live_n) }),
        el('td', { class: 'num', text: fmtMult(c.median_ratio) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'num', text: fmtMult(c.low_multiple) + ' to ' + fmtMult(c.high_multiple) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'multiple = shrink(median live mcap/TVL of the category, toward ' + cal.global_median.toFixed(2) + 'x, prior ' + m.prior_n + ') in [' + m.multiple_min + ', ' + m.multiple_max + ']\n' +
        'implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_extra + ')) )'
      ),
      el('div', { class: 'model-grid' },
        el('div', null,
          el('h3', { text: 'The multiple is the market talking' }),
          el('p', { text: 'The snapshot holds ' + cal.live_n + ' live-token protocols with a market cap and a TVL. Their median market-cap-to-TVL ratio is ' + cal.global_median.toFixed(2) + 'x. Each category takes its own live median, shrunk toward that market median so a thin category cannot set an extreme rate, and clamped to ' + m.multiple_min + 'x-' + m.multiple_max + 'x. A category with no live protocol takes the market median.' }),
          el('h3', { text: 'Growth, clamped' }),
          el('p', { text: 'Seven-day TVL change moves the value by half its weight, clamped to ' + m.growth_floor + '%/+' + m.growth_cap + '% so one wild week cannot decide a rank. A protocol with no reported change is scored as flat.' })
        ),
        el('div', null,
          el('h3', { text: 'Maturity is time with no token' }),
          el('p', { text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token. The factor rises from ' + m.maturity_floor + ' to 1.0 over ' + (m.maturity_days / 365) + ' years; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
          el('h3', { text: 'Breadth and the range' }),
          el('p', { text: 'Each extra chain adds ' + (m.breadth_per_chain * 100) + '% to the value, up to ' + m.breadth_max_extra + ' extra chains: more chains reach more farmers. The detail view shows a range from the category\'s 25th to 75th percentile live ratios, shrunk the same way.' })
        )
      ),
      el('div', { class: 'calib' },
        el('h3', { text: 'Calibration: what the live market pays per dollar of TVL' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', class: 'num', text: 'Live peers' }), el('th', { scope: 'col', class: 'num', text: 'Median mcap / TVL' }), el('th', { scope: 'col', class: 'num', text: 'Multiple used' }), el('th', { scope: 'col', class: 'num', text: 'Range used' }))),
            el('tbody', null, calibRows)
          )
        ),
        el('p', { class: 'sub', text: 'Live ratios are winsorized at ' + m.ratio_cap + 'x before the median, so one thin protocol cannot set a category. The board never ranks a protocol whose token already trades: wrapped, staked and bridged products, versioned pools and exchange products are set aside by the same rule the watchlist uses.' })
      )
    );
  }

  function sandboxPanel() {
    var box = el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { text: 'Change the constants and the ranking re-runs here, in the page, with the same arithmetic the program used. Nothing here changes the board that was handed in.' }),
      el('div', { class: 'sliders' })
    );
    var sliders = box.querySelector('.sliders');
    var list = el('ol', { class: 'mini-top' });
    var note = el('p', { class: 'sub' });
    function rerun() {
      var over = { scale: state.sandbox.scale, growth: state.sandbox.growth, floor: state.sandbox.floor };
      var rescored = DATA.rows.map(function (r) { return { row: r, value: impliedOf(r, DATA.model, over) }; });
      rescored.sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : 1); });
      var top = rescored.slice(0, 10);
      var baseTop = DATA.rows.slice(0, 10).map(function (r) { return r.slug; });
      var changed = top.filter(function (t) { return baseTop.indexOf(t.row.slug) < 0; }).length;
      list.textContent = '';
      top.forEach(function (t, i) {
        list.appendChild(el('li', null,
          el('span', { class: 'rk', text: String(i + 1) }),
          el('span', { class: 'nm', text: t.row.name }),
          el('span', { class: 'vl num', text: fmtUsd(t.value) }),
          el('span', { class: 'sub', text: 'was #' + t.row.rank })
        ));
      });
      note.textContent = changed === 0 ? 'The top 10 is unchanged under these constants.' : changed + ' of the top 10 changed under these constants.';
    }
    function slider(label, min, max, step, get, set, format, hint) {
      var out = el('output', { text: format(get()) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label });
      input.addEventListener('input', function () { set(parseFloat(input.value)); out.textContent = format(get()); rerun(); });
      return el('div', { class: 'slider' },
        el('label', null, el('span', { text: label }), out),
        input,
        el('span', { class: 'sub', text: hint })
      );
    }
    sliders.appendChild(slider('Multiple scale', 0.5, 2, 0.05, function () { return state.sandbox.scale; }, function (v) { state.sandbox.scale = v; }, function (v) { return v.toFixed(2) + 'x'; }, 'Scales every category multiple at once.'));
    sliders.appendChild(slider('Growth weight', 0, 1, 0.05, function () { return state.sandbox.growth; }, function (v) { state.sandbox.growth = v; }, function (v) { return v.toFixed(2); }, 'How much a week of growth moves the value.'));
    sliders.appendChild(slider('Maturity floor', 0.4, 0.8, 0.05, function () { return state.sandbox.floor; }, function (v) { state.sandbox.floor = v; }, function (v) { return v.toFixed(2); }, 'The youngest protocol\'s maturity factor.'));
    box.appendChild(el('h3', { text: 'Top 10 under your constants', style: 'font-size:14px;margin:0 0 8px;' }));
    box.appendChild(list);
    box.appendChild(note);
    rerun();
    return box;
  }

  function whyRank(row) {
    var cat = row.category || 'Other';
    var growth = row.change_7d;
    var growthBit = growth === null ? 'with no seven-day change reported, so growth neither lifts nor lowers it' :
      growth >= 0 ? 'and seven-day growth of ' + fmtPct(growth) + ' lifts it' :
      'and a seven-day change of ' + fmtPct(growth) + ' pulls it down';
    var ageBit = row.age_days === null ? 'an unlisted age, scored as one year' : fmtAge(row.age_days) + ' of running with no token';
    var peerBit = row.live_n > 0
      ? 'the market prices ' + row.live_n + ' live ' + cat + ' token' + (row.live_n === 1 ? '' : 's') + ' at ' + fmtMult(row.multiple) + ' of TVL'
      : 'no live ' + cat + ' token is in the snapshot, so it takes the market-wide multiple of ' + fmtMult(row.multiple);
    var catStanding = row.category_rank === 1
      ? 'the largest of the board\'s ' + row.category_size + ' ' + cat + ' protocols'
      : 'the ' + ordinal(row.category_rank) + ' largest of the board\'s ' + row.category_size + ' ' + cat + ' protocols';
    return row.name + ' ranks ' + ordinal(row.rank) + ' of ' + DATA.board_size + ' because it holds ' + fmtUsd(row.tvl_usd) + ' of TVL, ' + catStanding + ', and ' + peerBit + '. ' +
      'It carries ' + ageBit + ', ' + growthBit + '.';
  }

  function detailView(row) {
    var recomputed = impliedOf(row, DATA.model);
    var steps = farmSteps(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var peers = DATA.live.filter(function (l) { return (l.category || 'Other') === (row.category || 'Other'); }).slice(0, 3);
    var rangeMax = Math.max(row.implied_high_usd, row.implied_value_usd) * 1.08;
    var loPct = Math.max(0, Math.round((row.implied_low_usd / rangeMax) * 100));
    var hiPct = Math.min(100, Math.round((row.implied_high_usd / rangeMax) * 100));
    var dotPct = Math.min(100, Math.round((row.implied_value_usd / rangeMax) * 100));
    var peerBlock = peers.length > 0
      ? el('ul', { class: 'peers' }, peers.map(function (l) {
          return el('li', null, el('span', { class: 'nm', text: l.name }), el('span', { class: 'rt', text: 'mcap ' + fmtUsd(l.mcap_usd) + ' at ' + fmtMult(l.ratio) + ' of TVL' }));
        }))
      : el('p', { class: 'sub', text: 'No live ' + (row.category || 'Other') + ' protocol is in the snapshot, so this row takes the market-wide multiple.' });

    var head = el('div', null,
      el('a', { class: 'back', href: '#', text: 'Back to the board', onclick: function (e) { e.preventDefault(); state.selected = null; writeHash(); render(); } }),
      el('div', { class: 'detail-head' },
        el('div', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' pre-token protocols' }),
        el('h1', { text: row.name }),
        el('p', { class: 'meta', html: '' }),
        el('p', { class: 'why', text: whyRank(row) })
      )
    );
    var meta = head.querySelector('.meta');
    var chainText = row.chains && row.chains.length ? row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) + ' more' : '') : 'an unnamed chain';
    meta.appendChild(document.createTextNode((row.category || 'Other') + ' on ' + chainText + '  '));
    if (row.watchlist) meta.appendChild(el('span', { class: 'watch', text: 'WATCHLIST' }));
    meta.appendChild(document.createTextNode('  Listed ' + (row.listed_at || 'on an unknown date') + '.'));

    var valueSection = el('section', { class: 'detail-section' },
      el('h2', { text: 'Implied value' }),
      el('span', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('ul', { class: 'waterfall' },
        el('li', null, el('span', { class: 'factor', text: 'TVL' }), el('span', { class: 'value num', text: fmtUsd(row.tvl_usd) })),
        el('li', null, el('span', { class: 'factor', text: 'Category multiple (' + row.multiple_category + ', ' + row.live_n + ' live peer' + (row.live_n === 1 ? '' : 's') + ')' }), el('span', { class: 'value num', text: 'x ' + row.multiple.toFixed(2) })),
        el('li', null, el('span', { class: 'factor', text: 'Growth factor (7d ' + fmtPct(row.change_7d) + ')' }), el('span', { class: 'value num', text: 'x ' + row.growth_multiplier.toFixed(2) })),
        el('li', null, el('span', { class: 'factor', text: 'Maturity factor (' + fmtAge(row.age_days) + ' with no token)' }), el('span', { class: 'value num', text: 'x ' + row.maturity_multiplier.toFixed(2) })),
        el('li', null, el('span', { class: 'factor', text: 'Breadth factor (' + (row.chains ? row.chains.length : 0) + ' chain' + ((row.chains ? row.chains.length : 0) === 1 ? '' : 's') + ')' }), el('span', { class: 'value num', text: 'x ' + row.breadth_multiplier.toFixed(2) })),
        el('li', { class: 'total' }, el('span', { class: 'factor', text: 'Implied value' }), el('span', { class: 'value num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('div', { class: 'rangebar' },
        el('div', { class: 'track' },
          el('div', { class: 'fill', style: 'left:' + loPct + '%;width:' + Math.max(1, hiPct - loPct) + '%' }),
          el('div', { class: 'dot', style: 'left:' + dotPct + '%' })
        ),
        el('div', { class: 'labels' }, el('span', { text: 'Low ' + fmtUsd(row.implied_low_usd) }), el('span', { text: 'Market range, 25th-75th percentile' }), el('span', { text: 'High ' + fmtUsd(row.implied_high_usd) }))
      ),
      el('h3', { text: 'Live peers in the same category', style: 'font-size:14px;margin:18px 0 6px;' }),
      peerBlock
    );

    var planSection = el('section', { class: 'detail-section' },
      el('h2', { text: 'Farm plan' }),
      el('span', { class: 'sub', text: 'Seven steps, derived from this protocol\'s own record: its category, its chains, its TVL and its age.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('div', { class: 'totals' },
        el('div', null, el('span', { text: 'Capital to commit' }), el('b', { class: 'num', text: '$' + capital })),
        el('div', null, el('span', { text: 'Minimum hold' }), el('b', { text: hold + ' days' })),
        el('div', null, el('span', { text: 'Weekly time' }), el('b', { text: 'about 10 minutes' }))
      )
    );

    return el('div', null, head, el('div', { class: 'detail-grid' }, valueSection, planSection));
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'A protocol on this board records no token in the snapshot; that is the record, never proof it has none. Wrapped, staked and bridged products of tokens that already trade are set aside, because they are not launches waiting to happen.' }),
      el('p', { text: 'Every number on this page is computed from the sealed snapshot by the program that built it; the model sandbox re-runs the same arithmetic live. Implied value is this entry\'s own model claim, never a price, a prediction of a launch, or a promise of an airdrop.' }),
      el('p', { text: 'Snapshot ' + DATA.as_of + ', DefiLlama protocol index. Model ' + DATA.model_version + '. Board of ' + DATA.board_size + ' rows, watchlist ' + DATA.watchlist_size + ' of ' + DATA.watchlist_size + ' covered.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    var selected = state.selected ? rowBySlug(state.selected) : null;
    if (selected) {
      shell.appendChild(detailView(selected));
    } else {
      shell.appendChild(lede());
      shell.appendChild(controls());
      if (state.tab === 'pre-token') {
        shell.appendChild(boardTable());
        shell.appendChild(modelPanel());
        shell.appendChild(sandboxPanel());
      } else if (state.tab === 'live') {
        shell.appendChild(liveTable());
      } else {
        shell.appendChild(modelPanel());
        shell.appendChild(sandboxPanel());
      }
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    var keep = state.sandbox;
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; state.rising = false;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; state.selected = null;
    state.sandbox = keep;
    readHash();
    render();
  });
})();
