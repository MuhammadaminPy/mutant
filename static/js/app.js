/* ═══════════════════════════════════════════════════════════════════
   TMA Bot — Main App Logic
   ═══════════════════════════════════════════════════════════════════ */

const API = window.location.origin; // same-origin API calls
let USER = {};
let currentTab = 'games';
let currentGameScreen = null;

// ─── TOAST ──────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg, type='') {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── INIT ───────────────────────────────────────────────────────
async function initApp() {
  // Try Telegram WebApp SDK
  let tg = window.Telegram?.WebApp;
  let initData = {};
  if (tg) {
    tg.expand();
    tg.enableClosingConfirmation();
    let user = tg.initData ? JSON.parse(decodeURIComponent(tg.initData.split('user=')[1]?.split('&')[0] || '{}')) : {};
    initData = {
      telegram_id: user.id || tg.initDataUnsafe?.user?.id || 12345,
      first_name: user.first_name || tg.initDataUnsafe?.user?.first_name || 'Demo',
      last_name: user.last_name || '',
      username: user.username || tg.initDataUnsafe?.user?.username || 'demouser',
      photo_url: user.photo_url || tg.initDataUnsafe?.user?.photo_url || '',
    };
    // referral from start param
    let startParam = tg.initDataUnsafe?.start_param;
    if (startParam && !isNaN(startParam)) initData.ref_id = parseInt(startParam);
  } else {
    // Demo / local development fallback
    initData = {
      telegram_id: 12345,
      first_name: 'Demo',
      last_name: 'User',
      username: 'demouser',
      photo_url: '',
    };
  }

  try {
    let res = await fetch(API + '/api/init', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(initData) });
    USER = await res.json();
  } catch(e) {
    // Offline demo mode
    USER = { telegram_id: initData.telegram_id, first_name: initData.first_name, username: initData.username, balance: 1.5, total_deposited: 10, games_played: 3, ref_percent: 10, ref_balance: 0.45 };
  }

  updateBalanceDisplay();
  updateProfilePage();
  buildRouletteWheel(1.3); // default
  buildMultiplierButtons();
  buildRollsChips();
  startRollsPolling();
  loadFreeTimerStatus();
}

function updateBalanceDisplay() {
  document.getElementById('balance-display').textContent = USER.balance?.toFixed(4) || '0.0000';
}

// ─── TAB SWITCHING ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  currentTab = tab;
  if (tab === 'leaderboard') loadLeaderboard();
  if (tab === 'profile') { updateProfilePage(); loadInventory(); }
}

// ─── PROFILE ────────────────────────────────────────────────────
function updateProfilePage() {
  document.getElementById('profile-name').textContent = USER.first_name || 'User';
  document.getElementById('profile-username').textContent = '@' + (USER.username || 'user');
  document.getElementById('stat-games').textContent = USER.games_played || 0;
  document.getElementById('stat-balance').textContent = (USER.balance || 0).toFixed(4);
  document.getElementById('stat-deposited').textContent = (USER.total_deposited || 0).toFixed(2);
  let img = document.getElementById('profile-avatar-img');
  let fb = document.getElementById('profile-avatar-fb');
  if (USER.photo_url) { img.src = USER.photo_url; img.style.display='block'; fb.style.display='none'; }
  else { img.style.display='none'; fb.style.display='flex'; fb.textContent = (USER.first_name||'?')[0].toUpperCase(); }
}

async function loadInventory() {
  try {
    let res = await fetch(API + '/api/inventory/' + USER.telegram_id);
    let items = await res.json();
    let grid = document.getElementById('inventory-grid');
    if (!items.length) { grid.innerHTML = '<div class="inventory-empty">Инвентарь пуст</div>'; return; }
    grid.innerHTML = items.map(i => `
      <div class="inv-item" onclick="openInvAction(${i.id},'${i.image}','${i.name}',${i.sell_price})">
        <div class="inv-item-icon">${i.image}</div>
        <div class="inv-item-name">${i.name}</div>
        <div class="inv-item-price">${i.sell_price} TON</div>
      </div>
    `).join('');
  } catch(e) {
    document.getElementById('inventory-grid').innerHTML = '<div class="inventory-empty">Инвентарь пуст</div>';
  }
}

let _invActionId, _invActionPrice;
function openInvAction(id, icon, name, price) {
  _invActionId = id; _invActionPrice = price;
  document.getElementById('inv-action-icon').textContent = icon;
  document.getElementById('inv-action-name').textContent = name;
  document.getElementById('inv-action-price-val').textContent = price;
  document.getElementById('inv-action-msg').style.display = 'none';
  openModal('modal-inv-action');
}
async function sellInventoryItem() {
  try {
    let res = await fetch(API + '/api/inventory/sell', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, item_id: _invActionId }) });
    let data = await res.json();
    if (data.success) {
      USER.balance = data.new_balance;
      updateBalanceDisplay();
      showToast('Продано за ' + data.sold_price + ' TON', 'success');
      closeModal('modal-inv-action');
      loadInventory();
    }
  } catch(e) { showToast('Ошибка', 'error'); }
}
async function withdrawInventoryItem() {
  try {
    let res = await fetch(API + '/api/inventory/withdraw_gift', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ item_id: _invActionId }) });
    let data = await res.json();
    document.getElementById('inv-action-msg').textContent = data.message;
    document.getElementById('inv-action-msg').style.display = 'block';
  } catch(e) { showToast('Ошибка', 'error'); }
}
async function sellAll() {
  let res = await fetch(API + '/api/inventory/' + USER.telegram_id);
  let items = await res.json();
  for (let item of items) {
    await fetch(API + '/api/inventory/sell', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, item_id: item.id }) });
  }
  await refreshBalance();
  loadInventory();
  showToast('Все предметы проданы', 'success');
}

// ─── LEADERBOARD ────────────────────────────────────────────────
async function loadLeaderboard() {
  try {
    let res = await fetch(API + '/api/leaderboard');
    let board = await res.json();
    let el = document.getElementById('leaderboard-list');
    if (!board.length) { el.innerHTML='<div class="leaderboard-loading">Нет данных</div>'; return; }
    el.innerHTML = board.map(u => {
      let rankClass = u.rank <= 3 ? `lb-rank-${u.rank}` : (u.rank <= 7 ? 'lb-rank-top7' : 'lb-rank-other');
      let avatarSrc = u.photo_url || '';
      return `<div class="leaderboard-item">
        <div class="lb-rank ${rankClass}">${u.rank}</div>
        <div class="lb-avatar"><img src="${avatarSrc}" alt="" onerror="this.style.display='none'"/></div>
        <div class="lb-info">
          <div class="lb-name">${u.name || 'User'}</div>
          <div class="lb-user">@${u.username || '—'}</div>
        </div>
        <div class="lb-amount">${u.total_deposited.toFixed(2)} TON</div>
      </div>`;
    }).join('');
  } catch(e) { document.getElementById('leaderboard-list').innerHTML='<div class="leaderboard-loading">Ошибка загрузки</div>'; }
}

// ═══════════════════════════════════════════════════════════════════
// GAME SCREENS
// ═══════════════════════════════════════════════════════════════════

function openGame(name) {
  if (name === 'gift_upgrade') openGiftUpgrade();
  else if (name === 'rolls') openRolls();
  else if (name === 'mutants') openMutants();
}

function openGameScreen(id) {
  document.getElementById('screen-' + id).classList.add('active');
  currentGameScreen = id;
}
function closeGameScreen(id) {
  document.getElementById('screen-' + id).classList.remove('active');
  currentGameScreen = null;
}

// ── Gift Upgrade (Roulette) ──────────────────────────────────────
let selectedMultiplier = 1.3;
const MULTIPLIERS = [1.3, 1.5, 2, 3, 5, 7, 10, 15, 20];

function openGiftUpgrade() {
  document.getElementById('gu-balance').textContent = USER.balance.toFixed(4) + ' TON';
  openGameScreen('gift-upgrade');
}

function buildMultiplierButtons() {
  let wrap = document.getElementById('gu-mult-btns');
  wrap.innerHTML = MULTIPLIERS.map(m => `<button class="gu-mult-btn ${m===1.3?'active':''}" onclick="selectMultiplier(${m})">${m}×</button>`).join('');
}

function selectMultiplier(m) {
  selectedMultiplier = m;
  document.querySelectorAll('.gu-mult-btn').forEach(b => b.classList.remove('active'));
  [...document.querySelectorAll('.gu-mult-btn')].find(b => b.textContent === m+'×')?.classList.add('active');
  updateRouletteInfo();
  buildRouletteWheel(m);
}

function updateRouletteInfo() {
  let stake = parseFloat(document.getElementById('gu-stake-input').value) || 0.1;
  let chance = Math.min(95, Math.max(5, (1 / selectedMultiplier) * 100));
  document.getElementById('gu-potential').textContent = (stake * selectedMultiplier).toFixed(4) + ' TON';
  document.getElementById('gu-chance').textContent = chance.toFixed(1) + '%';
}

function changeStake(delta) {
  let inp = document.getElementById('gu-stake-input');
  let val = Math.max(0.01, parseFloat(inp.value || 0) + delta);
  inp.value = val.toFixed(2);
  updateRouletteInfo();
}

// SVG Roulette wheel builder
function buildRouletteWheel(multiplier) {
  let winChance = Math.min(0.95, Math.max(0.05, 1 / multiplier));
  let segments = document.getElementById('wheel-segments');
  let n = 24; // number of segments
  let winSegs = Math.max(1, Math.round(winChance * n));
  let loseSegs = n - winSegs;
  // Interleave: place win segments evenly
  let arr = [];
  for (let i = 0; i < n; i++) arr.push(i < winSegs ? 'win' : 'lose');
  // Shuffle: spread wins evenly
  let result = new Array(n).fill('lose');
  let step = n / winSegs;
  for (let i = 0; i < winSegs; i++) result[Math.floor(i * step)] = 'win';

  let html = '';
  let angle = 360 / n;
  for (let i = 0; i < n; i++) {
    let startAngle = i * angle - 90;
    let endAngle = startAngle + angle;
    let color = result[i] === 'win' ? '#3edc81' : '#e84545';
    let lightColor = result[i] === 'win' ? '#5ef5a0' : '#ff6b6b';
    let path = describeArc(200, 200, 118, startAngle, endAngle);
    html += `<path d="${path}" fill="${color}" stroke="${lightColor}" stroke-width="1.5" opacity="0.92"/>`;
    // label
    let midAngle = (startAngle + endAngle) / 2;
    let rad = midAngle * Math.PI / 180;
    let tx = 200 + 90 * Math.cos(rad);
    let ty = 200 + 90 * Math.sin(rad);
    let label = result[i] === 'win' ? '✓' : '✗';
    html += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" font-size="13" fill="#fff" font-weight="bold" opacity="0.9">${label}</text>`;
  }
  segments.innerHTML = html;
  updateRouletteInfo();
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  let s = polarToCartesian(cx, cy, r, endAngle);
  let e = polarToCartesian(cx, cy, r, startAngle);
  let largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 0 ${e.x} ${e.y} Z`;
}
function polarToCartesian(cx, cy, r, angleDeg) {
  let rad = angleDeg * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Spin animation
let spinning = false;
async function spinRoulette() {
  if (spinning) return;
  let stake = parseFloat(document.getElementById('gu-stake-input').value) || 0.1;
  if (USER.balance < stake) { showToast('Недостаточный баланс', 'error'); return; }

  spinning = true;
  document.getElementById('btn-spin').disabled = true;
  document.getElementById('btn-spin').textContent = '🔄 Вращается...';

  // Animate wheel rotation
  let wheel = document.getElementById('wheel-segments');
  let totalRotation = 1800 + Math.random() * 720; // 5-7 full spins
  let duration = 4000;
  let start = performance.now();
  function animate(now) {
    let elapsed = now - start;
    let progress = Math.min(1, elapsed / duration);
    let eased = 1 - Math.pow(1 - progress, 4); // ease-out quartic
    wheel.style.transform = `rotate(${eased * totalRotation}deg)`;
    wheel.style.transformOrigin = '200px 200px';
    if (progress < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // API call
  try {
    let res = await fetch(API + '/api/gift_upgrade/spin', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, stake, multiplier: selectedMultiplier }) });
    let data = await res.json();

    // Wait for animation to finish
    await new Promise(r => setTimeout(r, 4200));
    // Reset rotation
    wheel.style.transform = 'rotate(0deg)';
    wheel.style.transition = 'none';
    setTimeout(() => { wheel.style.transition = ''; }, 50);

    if (data.error) { showToast(data.error, 'error'); }
    else {
      USER.balance = data.new_balance;
      updateBalanceDisplay();
      document.getElementById('gu-balance').textContent = USER.balance.toFixed(4) + ' TON';

      // Show result overlay
      let overlay = document.getElementById('gu-result-overlay');
      let title = document.getElementById('gu-result-title');
      let amount = document.getElementById('gu-result-amount');
      let icon = document.getElementById('gu-result-icon');
      if (data.won) {
        title.textContent = '🎉 WIN!'; title.className = 'gu-result-title win';
        amount.textContent = '+' + data.result.toFixed(4) + ' TON';
        icon.textContent = '🎉';
      } else {
        title.textContent = '💀 LOSE'; title.className = 'gu-result-title lose';
        amount.textContent = '−' + stake.toFixed(4) + ' TON';
        icon.textContent = '😞';
      }
      overlay.classList.add('active');

      // Update last game strip
      let lastGame = document.getElementById('gu-last-game');
      lastGame.style.display = 'flex';
      document.getElementById('gu-last-badge').className = 'gu-last-badge ' + (data.won ? 'win' : 'lose');
      document.getElementById('gu-last-badge').textContent = data.won ? 'WIN' : 'LOSE';
      document.getElementById('gu-last-stake').textContent = stake.toFixed(4);
      document.getElementById('gu-last-result').textContent = Math.abs(data.result).toFixed(4);
      document.getElementById('gu-last-result-text').textContent = (data.won ? 'Выигрыш: ' : 'Проигрыш: ');
    }
  } catch(e) {
    await new Promise(r => setTimeout(r, 4200));
    wheel.style.transform = 'rotate(0deg)';
    showToast('Ошибка сервера', 'error');
  }

  spinning = false;
  document.getElementById('btn-spin').disabled = false;
  document.getElementById('btn-spin').textContent = '🎰 Вращать';
}

function closeResultOverlay() {
  document.getElementById('gu-result-overlay').classList.remove('active');
}

// ── Rolls ────────────────────────────────────────────────────────
let rollsPolling = null;
let myBet = null;

function openRolls() {
  document.getElementById('rolls-balance').textContent = USER.balance.toFixed(4) + ' TON';
  openGameScreen('rolls');
}

function buildRollsChips() {
  // Build the visible strip of chips (show ~9 chips, scrollable feel)
  let strip = document.getElementById('rolls-chips');
  let colors = [];
  for (let i = 0; i < 15; i++) {
    let r = Math.random();
    colors.push(r < 0.49 ? 'red' : (r < 0.98 ? 'blue' : 'green'));
  }
  strip.innerHTML = colors.map(c => `<div class="rolls-chip chip-${c}">💎</div>`).join('');
}

function startRollsPolling() {
  if (rollsPolling) return;
  rollsPolling = setInterval(pollRolls, 500);
}

async function pollRolls() {
  try {
    let res = await fetch(API + '/api/rolls/state');
    let data = await res.json();

    // Update countdown
    document.getElementById('rolls-countdown').textContent = data.countdown.toFixed(2);

    // Update last result highlight
    if (data.last_result) {
      // Animate chips — shift and highlight center
      animateRollsChips(data.last_result);
    }

    // Mini history
    let miniEl = document.getElementById('rolls-mini-history');
    miniEl.innerHTML = (data.history || []).slice(0, 20).map(c => `<div class="rolls-mini-dot ${c}"></div>`).join('');

    // Counts
    document.getElementById('rolls-count-red').textContent = data.red_count;
    document.getElementById('rolls-count-green').textContent = data.green_count;
    document.getElementById('rolls-count-blue').textContent = data.blue_count;

    // Check if our bet was resolved
    if (data.last_payouts && data.last_payouts[USER.telegram_id.toString()]) {
      let payout = data.last_payouts[USER.telegram_id.toString()];
      if (payout.won) {
        showToast('🎉 Выиграли! +' + payout.amount.toFixed(4) + ' TON (' + payout.mult + '×)', 'success');
      } else {
        showToast('💀 Проиграли ставку', 'error');
      }
      myBet = null;
      document.getElementById('rolls-active-bet').style.display = 'none';
      await refreshBalance();
      document.getElementById('rolls-balance').textContent = USER.balance.toFixed(4) + ' TON';
    }

    // If betting is closed (countdown < 1), disable buttons visually
    let btns = document.querySelectorAll('.rolls-color-btn');
    btns.forEach(b => b.style.opacity = data.countdown < 1 ? '0.4' : '1');

  } catch(e) { /* offline */ }
}

let lastAnimResult = null;
function animateRollsChips(result) {
  if (result === lastAnimResult) return;
  lastAnimResult = result;
  let strip = document.getElementById('rolls-chips');
  // Rebuild: push result to center, shift others
  let chips = strip.querySelectorAll('.rolls-chip');
  let colors = [...chips].map(c => c.className.includes('red')?'red':(c.className.includes('blue')?'blue':'green'));
  colors.unshift(result);
  if (colors.length > 15) colors.pop();
  // center index = 7 (for 15 chips)
  strip.innerHTML = colors.map((c,i) => {
    let highlight = (i === 0) ? ' style="box-shadow: 0 0 16px 4px rgba(201,162,39,0.7), inset 0 2px 4px rgba(255,255,255,0.2); border-color: rgba(201,162,39,0.8);"' : '';
    return `<div class="rolls-chip chip-${c}"${highlight}>💎</div>`;
  }).join('');
}

function changeRollsStake(delta) {
  let inp = document.getElementById('rolls-stake-input');
  let val = Math.max(0.01, parseFloat(inp.value || 0) + delta);
  inp.value = val.toFixed(2);
}

async function placeBet(color) {
  let amount = parseFloat(document.getElementById('rolls-stake-input').value) || 0.1;
  if (USER.balance < amount) { showToast('Недостаточный баланс', 'error'); return; }
  if (myBet) { showToast('Ставка уже сделана', 'error'); return; }

  try {
    let res = await fetch(API + '/api/rolls/bet', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, color, amount }) });
    let data = await res.json();
    if (data.error) { showToast(data.error, 'error'); return; }
    if (data.success) {
      myBet = { color, amount };
      USER.balance = data.new_balance;
      updateBalanceDisplay();
      document.getElementById('rolls-balance').textContent = USER.balance.toFixed(4) + ' TON';
      // Show active bet
      let abEl = document.getElementById('rolls-active-bet');
      abEl.style.display = 'flex';
      document.getElementById('rolls-bet-color').textContent = color.charAt(0).toUpperCase() + color.slice(1);
      document.getElementById('rolls-bet-color').className = 'rolls-bet-color ' + color;
      document.getElementById('rolls-bet-amt').textContent = amount.toFixed(4) + ' TON';
      showToast('Ставка принята: ' + color + ' ' + amount + ' TON', 'success');
    }
  } catch(e) { showToast('Ошибка', 'error'); }
}

// ── Mutants (Cases) ──────────────────────────────────────────────
async function openMutants() {
  openGameScreen('mutants');
  document.getElementById('mutants-balance').textContent = USER.balance.toFixed(4) + ' TON';
  // Check access
  try {
    let res = await fetch(API + '/api/mutants/check', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id }) });
    let data = await res.json();
    document.getElementById('mutants-locked').classList.toggle('active', !data.available);
  } catch(e) {
    // Demo: unlock if total_deposited >= 5
    document.getElementById('mutants-locked').classList.toggle('active', (USER.total_deposited || 0) < 5);
  }
  loadFreeTimerStatus();
}

function filterCases(filter, btn) {
  document.querySelectorAll('.mutants-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.case-card').forEach(card => {
    let f = card.dataset.filter;
    let show = filter === 'all' || f === filter || (filter === 'regular' && f === 'regular') || (filter === 'limited' && f === 'limited') || (filter === 'free' && f === 'free');
    card.style.display = show ? '' : 'none';
  });
}

async function loadFreeTimerStatus() {
  try {
    let res = await fetch(API + '/api/mutants/free_case_status?telegram_id=' + USER.telegram_id);
    let data = await res.json();
    let el = document.getElementById('free-case-timer');
    if (data.available) { el.textContent = 'Бесплатно'; el.className = 'case-card-price free-price'; }
    else {
      let sec = data.remaining_seconds;
      let h = Math.floor(sec / 3600);
      let m = Math.floor((sec % 3600) / 60);
      let s = sec % 60;
      el.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      el.className = 'case-card-price free-price';
      el.style.background = '#555';
      // Update every second
      setTimeout(loadFreeTimerStatus, 1000);
    }
  } catch(e) {}
}

// Case open items for animation strip
const CASE_ITEMS_POOL = {
  free: [
    {icon:'💎',name:'0.05 TON'},{icon:'💎',name:'0.05 TON'},{icon:'💎',name:'0.05 TON'},
    {icon:'🎁',name:'Snoop Gift'},{icon:'📅',name:'Calendar'},{icon:'💎',name:'0.05 TON'},
  ],
  regular: [
    {icon:'🐒',name:'Jolly Chimp'},{icon:'💎',name:'1 TON'},{icon:'💎',name:'3.4 TON'},
    {icon:'🏺',name:'Restless Jar'},{icon:'🪖',name:'Neko Helmet'},{icon:'💎',name:'1 TON'},
    {icon:'💎',name:'1 TON'},{icon:'🐒',name:'Jolly Chimp'},{icon:'💎',name:'1 TON'},
  ],
  snoop: [
    {icon:'🚗',name:'Low Rider'},{icon:'🚬',name:'Cigar Dog'},{icon:'♾️',name:'Cigar ∞'},
    {icon:'🌌',name:'Cigar Space'},{icon:'👑',name:'King Snoop'},{icon:'🐕',name:'Snoop Dog'},
    {icon:'👜',name:'Swag Bag'},{icon:'💎',name:'2.2 TON'},{icon:'💎',name:'2.2 TON'},
    {icon:'💎',name:'2.2 TON'},{icon:'🐕',name:'Snoop Dog'},{icon:'👜',name:'Swag Bag'},
  ]
};

async function openCase(caseType) {
  if (caseType === 'free' && document.getElementById('free-case-timer').textContent.includes(':')) {
    showToast('Кейс ещё недоступен', 'error'); return;
  }
  let costs = { free: 0, regular: 5, snoop: 7 };
  if (USER.balance < costs[caseType] && caseType !== 'free') { showToast('Недостаточный баланс', 'error'); return; }

  // Show opening overlay
  let overlay = document.getElementById('case-open-overlay');
  let strip = document.getElementById('case-open-strip');
  let result = document.getElementById('case-open-result');
  result.style.display = 'none';

  // Build items for strip (pool + random winner at position)
  let pool = CASE_ITEMS_POOL[caseType] || CASE_ITEMS_POOL.regular;
  let items = [];
  for (let i = 0; i < 40; i++) items.push(pool[Math.floor(Math.random() * pool.length)]);

  strip.innerHTML = items.map(it => `
    <div class="case-open-item">
      <div class="case-open-item-icon">${it.icon}</div>
      <div class="case-open-item-name">${it.name}</div>
    </div>
  `).join('');

  // Add selector line
  let anim = document.getElementById('case-open-anim');
  if (!anim.querySelector('.case-open-selector')) {
    let sel = document.createElement('div');
    sel.className = 'case-open-selector';
    anim.appendChild(sel);
  }

  overlay.classList.add('active');

  // Animate scroll
  let totalWidth = 40 * 120;
  let targetX = -(totalWidth * 0.6 + Math.random() * 120 * 3);
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  await new Promise(r => setTimeout(r, 50));
  strip.style.transition = 'transform 3.5s cubic-bezier(.22,1,.36,1)';
  strip.style.transform = `translateX(${targetX}px)`;

  // API call
  let apiData;
  try {
    let res = await fetch(API + '/api/mutants/open_case', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, case_type: caseType }) });
    apiData = await res.json();
  } catch(e) {
    // Demo fallback
    apiData = { reward: { name: '0.05 TON', image: '💎', sell_price: 0.05, type: 'ton' }, new_balance: USER.balance - costs[caseType] + 0.05 };
  }

  await new Promise(r => setTimeout(r, 3600));

  // Show result
  if (apiData && !apiData.error) {
    USER.balance = apiData.new_balance;
    updateBalanceDisplay();
    document.getElementById('mutants-balance').textContent = USER.balance.toFixed(4) + ' TON';
    document.getElementById('case-result-icon').textContent = apiData.reward.image || '🎁';
    document.getElementById('case-result-name').textContent = apiData.reward.name;
    document.getElementById('case-result-value').textContent = apiData.reward.type === 'ton' ? '+' + apiData.reward.sell_price + ' TON' : 'NFT: ' + apiData.reward.sell_price + ' TON';
    result.style.display = 'block';
    loadFreeTimerStatus();
  } else {
    showToast(apiData?.error || 'Ошибка', 'error');
    closeCaseResult();
  }
}

function closeCaseResult() {
  document.getElementById('case-open-overlay').classList.remove('active');
  loadInventory();
}

// ═══════════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ── Deposit ──────────────────────────────────────────────────────
function openDepositModal() { openModal('modal-deposit'); }
function closeDepositModal() { closeModal('modal-deposit'); document.getElementById('dep-ton-address').style.display='none'; }
function switchDepTab(tab) {
  document.getElementById('dep-tab-ton').classList.toggle('active', tab==='ton');
  document.getElementById('dep-tab-stars').classList.toggle('active', tab==='stars');
  document.getElementById('dep-panel-ton').style.display = tab==='ton' ? 'block' : 'none';
  document.getElementById('dep-panel-stars').style.display = tab==='stars' ? 'block' : 'none';
}

let _currentDepositId = null;
async function submitTonDeposit() {
  let amount = parseFloat(document.getElementById('dep-ton-amount').value);
  if (!amount || amount <= 0) { showToast('Введите сумму', 'error'); return; }
  try {
    let res = await fetch(API + '/api/deposit/ton', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, amount }) });
    let data = await res.json();
    if (data.wallet_address) {
      document.getElementById('dep-addr-value').textContent = data.wallet_address;
      document.getElementById('dep-memo-value').textContent = data.memo;
      document.getElementById('dep-ton-address').style.display = 'block';
      _currentDepositId = data.deposit_id;
      showToast('Адрес скопирован', 'success');
    }
  } catch(e) {
    // Demo: show fake address
    document.getElementById('dep-addr-value').textContent = 'UQD_demo_wallet_address...';
    document.getElementById('dep-memo-value').textContent = 'DEP-12345-' + Date.now();
    document.getElementById('dep-ton-address').style.display = 'block';
    _currentDepositId = 1;
  }
}

async function confirmTonDeposit() {
  if (!_currentDepositId) return;
  try {
    let res = await fetch(API + '/api/deposit/confirm', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ deposit_id: _currentDepositId }) });
    let data = await res.json();
    if (data.success) {
      USER.balance = data.new_balance;
      USER.total_deposited = (USER.total_deposited || 0) + parseFloat(document.getElementById('dep-ton-amount').value);
      updateBalanceDisplay();
      updateProfilePage();
      showToast('Пополнено успешно!', 'success');
      closeDepositModal();
    }
  } catch(e) {
    // Demo fallback
    let amt = parseFloat(document.getElementById('dep-ton-amount').value) || 0;
    USER.balance += amt;
    USER.total_deposited = (USER.total_deposited || 0) + amt;
    updateBalanceDisplay();
    updateProfilePage();
    showToast('Пополнено ' + amt + ' TON (demo)', 'success');
    closeDepositModal();
  }
}

async function submitStarsDeposit() {
  let stars = parseInt(document.getElementById('dep-stars-amount').value);
  if (!stars || stars < 100) { showToast('Минимум 100 Stars', 'error'); return; }
  try {
    let res = await fetch(API + '/api/deposit/stars', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, stars }) });
    let data = await res.json();
    if (data.success) {
      USER.balance = data.new_balance;
      USER.total_deposited = (USER.total_deposited || 0) + data.ton_amount;
      updateBalanceDisplay();
      updateProfilePage();
      showToast('Пополнено ' + data.ton_amount + ' TON из ' + stars + ' Stars', 'success');
      closeDepositModal();
    }
  } catch(e) {
    // Demo
    let tonAmt = Math.round(stars * 1.099 / 100 * 10000) / 10000;
    USER.balance += tonAmt;
    USER.total_deposited = (USER.total_deposited || 0) + tonAmt;
    updateBalanceDisplay();
    showToast('Пополнено ' + tonAmt + ' TON (demo)', 'success');
    closeDepositModal();
  }
}

// Stars conversion live update
document.addEventListener('DOMContentLoaded', () => {
  let starsInput = document.getElementById('dep-stars-amount');
  if (starsInput) {
    starsInput.addEventListener('input', () => {
      let s = parseInt(starsInput.value) || 0;
      document.getElementById('dep-stars-conv').textContent = s + ' Stars = ' + (s * 1.099 / 100).toFixed(4) + ' TON';
    });
  }
});

// ── Withdraw ─────────────────────────────────────────────────────
function openWithdrawModal() {
  openModal('modal-withdraw');
  loadWithdrawalStatus();
}
async function loadWithdrawalStatus() {
  try {
    let res = await fetch(API + '/api/withdraw/status/' + USER.telegram_id);
    let reqs = await res.json();
    let el = document.getElementById('withdraw-pending');
    if (!reqs.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div style="font-size:12px;color:#7a7a9a;margin-top:12px;font-weight:600;">Заявки:</div>' +
      reqs.map(r => `<div class="wd-item"><span>${r.amount} TON — ${r.created_at}</span><span class="wd-status ${r.status}">${r.status === 'pending' ? 'Ожидание' : (r.status==='approved'?'Одобрен':'Отклонён')}</span></div>`).join('');
  } catch(e) {}
}
async function submitWithdraw() {
  let amount = parseFloat(document.getElementById('wd-amount').value);
  let wallet = document.getElementById('wd-wallet').value.trim();
  if (!amount || amount < 10) { showToast('Минимум 10 TON', 'error'); return; }
  if (!wallet) { showToast('Введите адрес кошелёка', 'error'); return; }
  if (USER.balance < amount) { showToast('Недостаточный баланс', 'error'); return; }
  try {
    let res = await fetch(API + '/api/withdraw/create', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id, amount, wallet_address: wallet }) });
    let data = await res.json();
    if (data.success) {
      USER.balance = data.new_balance;
      updateBalanceDisplay();
      updateProfilePage();
      showToast('Заявка создана! ID: ' + data.request_id, 'success');
      loadWithdrawalStatus();
    } else { showToast(data.error || 'Ошибка', 'error'); }
  } catch(e) {
    USER.balance -= amount;
    updateBalanceDisplay();
    showToast('Заявка создана (demo)', 'success');
  }
}

// ── Referral ─────────────────────────────────────────────────────
function openReferralModal() {
  openModal('modal-referral');
  let link = (window.location.origin || 'https://t.me/yourbotname') + '/start?' + USER.telegram_id;
  document.getElementById('ref-link-input').value = link;
  loadReferrals();
}
function copyRefLink() {
  navigator.clipboard?.writeText(document.getElementById('ref-link-input').value);
  showToast('Ссылка скопирована!', 'success');
}
async function loadReferrals() {
  try {
    let res = await fetch(API + '/api/referrals/' + USER.telegram_id);
    let data = await res.json();
    document.getElementById('ref-invited').textContent = data.total_referred;
    document.getElementById('ref-earned').textContent = data.ref_balance.toFixed(4);
    document.getElementById('ref-percent-disp').textContent = data.ref_percent + '%';
    USER.ref_balance = data.ref_balance;
    if (data.ref_balance >= 3) document.getElementById('ref-withdraw-wrap').style.display = 'block';
    else document.getElementById('ref-withdraw-wrap').style.display = 'none';
    let list = document.getElementById('ref-list');
    let items = data.referrals.map(r => `<div class="ref-list-item"><span>${r.name || 'User'}</span><span class="ref-dep">${r.total_deposited.toFixed(2)} TON</span></div>`).join('');
    list.innerHTML = '<div class="ref-list-title">Приглашённые</div>' + (items || '<div style="color:#5a5a7a;font-size:13px;">Пока никто</div>');
  } catch(e) {
    // Demo
    document.getElementById('ref-invited').textContent = '2';
    document.getElementById('ref-earned').textContent = '0.45';
    document.getElementById('ref-percent-disp').textContent = '10%';
  }
}
async function withdrawRefBalance() {
  try {
    let res = await fetch(API + '/api/referrals/withdraw', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ telegram_id: USER.telegram_id }) });
    let data = await res.json();
    if (data.success) {
      USER.balance = data.new_balance;
      USER.ref_balance = 0;
      updateBalanceDisplay();
      showToast('Реферальный баланс перенесён на основной', 'success');
      document.getElementById('ref-withdraw-wrap').style.display = 'none';
    }
  } catch(e) { showToast('Ошибка', 'error'); }
}

// ── Helpers ──────────────────────────────────────────────────────
async function refreshBalance() {
  try {
    let res = await fetch(API + '/api/balance/' + USER.telegram_id);
    let data = await res.json();
    USER.balance = data.balance;
    USER.ref_balance = data.ref_balance;
    updateBalanceDisplay();
  } catch(e) {}
}

// ─── INIT ON LOAD ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { initApp(); });
