import os, json, time, uuid, random, math, hashlib, hmac
from flask import Flask, request, jsonify, send_from_directory, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-prod')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///tma_bot.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ─── TELEGRAM BOT TOKEN & ADMIN ─────────────────────────────────
BOT_TOKEN = os.environ.get('BOT_TOKEN', 'YOUR_BOT_TOKEN')
ADMIN_CHAT_ID = os.environ.get('ADMIN_CHAT_ID', 'YOUR_ADMIN_ID')
TON_API_KEY = os.environ.get('TON_API_KEY', '')

# ─── MODELS ─────────────────────────────────────────────────────
class User(db.Model):
    id = db.Column(db.BigInteger, primary_key=True)
    telegram_id = db.Column(db.BigInteger, unique=True, nullable=False)
    first_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100))
    username = db.Column(db.String(100))
    photo_url = db.Column(db.Text)
    balance = db.Column(db.Float, default=0.0)
    total_deposited = db.Column(db.Float, default=0.0)
    games_played = db.Column(db.Integer, default=0)
    ref_id = db.Column(db.BigInteger, nullable=True)  # who referred this user
    ref_percent = db.Column(db.Float, default=10.0)   # referral bonus %
    ref_balance = db.Column(db.Float, default=0.0)    # accumulated ref earnings
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_online = db.Column(db.DateTime, default=datetime.utcnow)
    free_case_last = db.Column(db.DateTime, nullable=True)

class GameHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('user.telegram_id'))
    game_type = db.Column(db.String(50))  # gift_upgrade, rolls, mutants
    stake = db.Column(db.Float)
    result = db.Column(db.Float)  # positive = win, negative = loss
    multiplier = db.Column(db.Float, nullable=True)
    details = db.Column(db.Text, nullable=True)  # JSON extra info
    played_at = db.Column(db.DateTime, default=datetime.utcnow)

class Inventory(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('user.telegram_id'))
    gift_name = db.Column(db.String(100))
    gift_image = db.Column(db.String(200))
    sell_price = db.Column(db.Float)
    obtained_at = db.Column(db.DateTime, default=datetime.utcnow)

class WithdrawalRequest(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('user.telegram_id'))
    amount = db.Column(db.Float)
    wallet_address = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    admin_note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)

class DepositRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('user.telegram_id'))
    amount = db.Column(db.Float)
    method = db.Column(db.String(20))  # 'ton', 'stars'
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# ─── ROLLS GAME SHARED STATE ────────────────────────────────────
# 100 chips: 49 red, 49 blue, 2 green
rolls_game_state = {
    'bets': {},           # user_id -> {'color': str, 'amount': float}
    'countdown': 10,
    'last_result': None,  # 'red'|'blue'|'green'
    'history': [],        # last 20 results
    'last_spin_time': time.time()
}

def generate_rolls_result():
    """49 red, 49 blue, 2 green out of 100"""
    chips = ['red']*49 + ['blue']*49 + ['green']*2
    return random.choice(chips)

# ─── GIFT UPGRADE (ROULETTE) LOGIC ─────────────────────────────
def calculate_win_chance(multiplier):
    """Lower multiplier = higher chance. 1.3x -> ~76%, 20x -> ~5%"""
    return min(0.95, max(0.05, 1.0 / multiplier))

# ─── MUTANTS CASE REWARDS ─────────────────────────────────────
REGULAR_CASE_REWARDS = [
    {"name": "Jolly Chimp", "image": "🐒", "chance": 5.36, "type": "nft", "sell_price": 0.5},
    {"name": "1 TON", "image": "💎", "chance": 79.0, "type": "ton", "sell_price": 1.0},
    {"name": "3.4 TON", "image": "💎💎", "chance": 10.64, "type": "ton", "sell_price": 3.4},
    {"name": "Restless Jar", "image": "🏺", "chance": 2.0, "type": "nft", "sell_price": 1.5},
    {"name": "Neko Helmet", "image": "🪖", "chance": 0.2, "type": "nft", "sell_price": 8.0},
    {"name": "Nothing", "image": "❌", "chance": 2.8, "type": "nothing", "sell_price": 0},
]

SNOOP_CASE_REWARDS = [
    {"name": "Low Rider", "image": "🚗", "chance": 0.01, "type": "nft", "sell_price": 50.0},
    {"name": "Cigar Doggystyle", "image": "🚬", "chance": 0.36, "type": "nft", "sell_price": 20.0},
    {"name": "Cigar Infinity", "image": "♾️", "chance": 1.0, "type": "nft", "sell_price": 12.0},
    {"name": "Cigar Space", "image": "🌌", "chance": 1.76, "type": "nft", "sell_price": 8.0},
    {"name": "King Snoop", "image": "👑", "chance": 2.52, "type": "nft", "sell_price": 6.0},
    {"name": "Snoop Dog", "image": "🐕", "chance": 8.41, "type": "nft", "sell_price": 4.0},
    {"name": "Swag Bag", "image": "👜", "chance": 9.0, "type": "nft", "sell_price": 2.5},
    {"name": "2.2 TON", "image": "💎", "chance": 76.94, "type": "ton", "sell_price": 2.2},
]

FREE_CASE_REWARD = {"name": "0.05 TON", "image": "💎", "chance": 100, "type": "ton", "sell_price": 0.05}

# NFT gift chances shown in free case UI (cosmetic display)
FREE_CASE_NFT_DISPLAY = [
    {"name": "Snoop Dog Gift", "chance": 0.5},
    {"name": "Desk Calendar", "chance": 0.3},
]

def spin_case(case_type):
    if case_type == 'free':
        return FREE_CASE_REWARD
    rewards = REGULAR_CASE_REWARDS if case_type == 'regular' else SNOOP_CASE_REWARDS
    roll = random.uniform(0, 100)
    cumulative = 0
    for reward in rewards:
        cumulative += reward['chance']
        if roll <= cumulative:
            return reward
    return rewards[-1]

# ─── HELPERS ────────────────────────────────────────────────────
def get_or_create_user(telegram_id, first_name='', last_name='', username='', photo_url=''):
    user = User.query.filter_by(telegram_id=telegram_id).first()
    if not user:
        user = User(telegram_id=telegram_id, first_name=first_name, last_name=last_name,
                    username=username, photo_url=photo_url)
        db.session.add(user)
        db.session.commit()
    else:
        user.last_online = datetime.utcnow()
        if first_name: user.first_name = first_name
        if photo_url: user.photo_url = photo_url
        db.session.commit()
    return user

def send_telegram_message(chat_id, text):
    """Send message via Telegram Bot API"""
    import requests
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    try:
        requests.post(url, json=payload, timeout=5)
    except:
        pass

def notify_admin(text):
    send_telegram_message(ADMIN_CHAT_ID, text)

# ─── ROUTES ─────────────────────────────────────────────────────

# Serve the TMA frontend
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/admin')
def admin_panel():
    return send_from_directory('static', 'admin.html')

# ── USER INIT ────────────────────────────────────────────────────
@app.route('/api/init', methods=['POST'])
def api_init():
    data = request.get_json()
    tid = data.get('telegram_id')
    user = get_or_create_user(
        tid, data.get('first_name',''), data.get('last_name',''),
        data.get('username',''), data.get('photo_url','')
    )
    # Handle referral
    ref_id = data.get('ref_id')
    if ref_id and user.ref_id is None and ref_id != tid:
        user.ref_id = ref_id
        db.session.commit()

    return jsonify({
        'telegram_id': user.telegram_id,
        'first_name': user.first_name,
        'username': user.username,
        'photo_url': user.photo_url,
        'balance': user.balance,
        'total_deposited': user.total_deposited,
        'games_played': user.games_played,
        'ref_id': user.ref_id,
        'ref_percent': user.ref_percent,
        'ref_balance': user.ref_balance,
    })

# ── BALANCE ──────────────────────────────────────────────────────
@app.route('/api/balance/<int:telegram_id>', methods=['GET'])
def get_balance(telegram_id):
    user = User.query.filter_by(telegram_id=telegram_id).first()
    if not user:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'balance': user.balance, 'ref_balance': user.ref_balance})

# ── GIFT UPGRADE (ROULETTE) ─────────────────────────────────────
@app.route('/api/gift_upgrade/spin', methods=['POST'])
def gift_upgrade_spin():
    data = request.get_json()
    tid = data.get('telegram_id')
    stake = float(data.get('stake', 0))
    multiplier = float(data.get('multiplier', 1.3))

    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.balance < stake:
        return jsonify({'error': 'Insufficient balance'}), 400
    if stake <= 0:
        return jsonify({'error': 'Invalid stake'}), 400
    if multiplier < 1.3 or multiplier > 20:
        return jsonify({'error': 'Invalid multiplier'}), 400

    win_chance = calculate_win_chance(multiplier)
    won = random.random() < win_chance

    user.balance -= stake
    user.games_played += 1

    if won:
        winnings = round(stake * multiplier, 4)
        user.balance += winnings
        result_amount = round(winnings - stake, 4)
        result_text = 'win'
    else:
        winnings = 0
        result_amount = -stake
        result_text = 'lose'

    db.session.commit()

    # Save to history
    hist = GameHistory(user_id=tid, game_type='gift_upgrade', stake=stake,
                       result=result_amount, multiplier=multiplier,
                       details=json.dumps({'won': won, 'win_chance': round(win_chance*100,1)}))
    db.session.add(hist)
    db.session.commit()

    return jsonify({
        'won': won,
        'stake': stake,
        'multiplier': multiplier,
        'win_chance': round(win_chance * 100, 1),
        'result': result_amount,
        'new_balance': round(user.balance, 4),
        'history_id': hist.id
    })

# ── ROLLS GAME ───────────────────────────────────────────────────
@app.route('/api/rolls/state', methods=['GET'])
def rolls_state():
    now = time.time()
    elapsed = now - rolls_game_state['last_spin_time']
    remaining = max(0, 10 - elapsed)

    # If countdown expired, do the spin
    if remaining <= 0 and rolls_game_state.get('needs_spin', True):
        result = generate_rolls_result()
        rolls_game_state['last_result'] = result
        rolls_game_state['history'].insert(0, result)
        if len(rolls_game_state['history']) > 100:
            rolls_game_state['history'] = rolls_game_state['history'][:100]

        # Resolve bets
        payouts = {}
        for uid_str, bet in rolls_game_state['bets'].items():
            uid = int(uid_str)
            user = User.query.filter_by(telegram_id=uid).first()
            if not user:
                continue
            if bet['color'] == result:
                mult = 10 if result == 'green' else 2
                winnings = round(bet['amount'] * mult, 4)
                user.balance += winnings
                payouts[uid_str] = {'won': True, 'amount': winnings, 'mult': mult}
                hist = GameHistory(user_id=uid, game_type='rolls', stake=bet['amount'],
                                   result=round(winnings - bet['amount'], 4), multiplier=mult)
                db.session.add(hist)
            else:
                payouts[uid_str] = {'won': False, 'amount': 0, 'mult': 0}
                hist = GameHistory(user_id=uid, game_type='rolls', stake=bet['amount'],
                                   result=-bet['amount'], multiplier=0)
                db.session.add(hist)
            user.games_played += 1
        db.session.commit()

        rolls_game_state['bets'] = {}
        rolls_game_state['last_spin_time'] = now
        rolls_game_state['needs_spin'] = True
        rolls_game_state['last_payouts'] = payouts
        remaining = 10

    history = rolls_game_state['history'][:20]
    red_count = history.count('red')
    blue_count = history.count('blue')
    green_count = history.count('green')

    return jsonify({
        'countdown': round(remaining, 2),
        'last_result': rolls_game_state['last_result'],
        'history': history,
        'red_count': red_count,
        'blue_count': blue_count,
        'green_count': green_count,
        'last_payouts': rolls_game_state.get('last_payouts', {})
    })

@app.route('/api/rolls/bet', methods=['POST'])
def rolls_bet():
    data = request.get_json()
    tid = data.get('telegram_id')
    color = data.get('color')
    amount = float(data.get('amount', 0))

    if color not in ('red', 'blue', 'green'):
        return jsonify({'error': 'Invalid color'}), 400
    if amount <= 0:
        return jsonify({'error': 'Invalid amount'}), 400

    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.balance < amount:
        return jsonify({'error': 'Insufficient balance'}), 400

    # Check countdown — can't bet if < 1 second left
    elapsed = time.time() - rolls_game_state['last_spin_time']
    if elapsed >= 9:
        return jsonify({'error': 'Betting closed'}), 400

    user.balance -= amount
    db.session.commit()

    rolls_game_state['bets'][str(tid)] = {'color': color, 'amount': amount}
    rolls_game_state['needs_spin'] = True

    return jsonify({'success': True, 'new_balance': round(user.balance, 4), 'bet': {'color': color, 'amount': amount}})

# ── MUTANTS (CASES) ─────────────────────────────────────────────
@app.route('/api/mutants/check', methods=['POST'])
def mutants_check():
    data = request.get_json()
    tid = data.get('telegram_id')
    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.total_deposited < 5:
        return jsonify({'available': False, 'message': 'Игра доступна только при пополнении 5+ TON на баланс'})
    return jsonify({'available': True})

@app.route('/api/mutants/open_case', methods=['POST'])
def mutants_open_case():
    data = request.get_json()
    tid = data.get('telegram_id')
    case_type = data.get('case_type')  # 'free', 'regular', 'snoop'

    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    case_costs = {'free': 0, 'regular': 5, 'snoop': 7}
    cost = case_costs.get(case_type, 0)

    # Free case cooldown check
    if case_type == 'free':
        if user.free_case_last:
            cooldown_end = user.free_case_last + timedelta(hours=24)
            if datetime.utcnow() < cooldown_end:
                remaining = cooldown_end - datetime.utcnow()
                hours = remaining.seconds // 3600
                minutes = (remaining.seconds % 3600) // 60
                return jsonify({'error': f'Кейс будет доступен через {hours}ч {minutes}м'})

    if user.balance < cost:
        return jsonify({'error': 'Insufficient balance'}), 400

    user.balance -= cost
    if case_type == 'free':
        user.free_case_last = datetime.utcnow()

    reward = spin_case(case_type)
    user.games_played += 1

    # Credit TON rewards to balance
    if reward['type'] == 'ton':
        user.balance += reward['sell_price']
    elif reward['type'] == 'nft':
        inv = Inventory(user_id=tid, gift_name=reward['name'],
                        gift_image=reward.get('image', '🎁'), sell_price=reward['sell_price'])
        db.session.add(inv)

    db.session.commit()

    hist = GameHistory(user_id=tid, game_type='mutants', stake=cost,
                       result=reward['sell_price'] - cost,
                       details=json.dumps({'case_type': case_type, 'reward': reward['name']}))
    db.session.add(hist)
    db.session.commit()

    return jsonify({
        'reward': reward,
        'new_balance': round(user.balance, 4)
    })

@app.route('/api/mutants/free_case_status', methods=['GET'])
def free_case_status():
    tid = request.args.get('telegram_id', type=int)
    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'available': True})
    if user.free_case_last:
        cooldown_end = user.free_case_last + timedelta(hours=24)
        if datetime.utcnow() < cooldown_end:
            remaining = cooldown_end - datetime.utcnow()
            total_seconds = int(remaining.total_seconds())
            return jsonify({'available': False, 'remaining_seconds': total_seconds})
    return jsonify({'available': True, 'remaining_seconds': 0})

# ── INVENTORY ────────────────────────────────────────────────────
@app.route('/api/inventory/<int:telegram_id>', methods=['GET'])
def get_inventory(telegram_id):
    items = Inventory.query.filter_by(user_id=telegram_id).order_by(Inventory.obtained_at.desc()).all()
    return jsonify([{'id': i.id, 'name': i.gift_name, 'image': i.gift_image, 'sell_price': i.sell_price} for i in items])

@app.route('/api/inventory/sell', methods=['POST'])
def sell_inventory():
    data = request.get_json()
    tid = data.get('telegram_id')
    item_id = data.get('item_id')

    item = Inventory.query.get(item_id)
    if not item or item.user_id != tid:
        return jsonify({'error': 'Item not found'}), 404

    user = User.query.filter_by(telegram_id=tid).first()
    user.balance += item.sell_price
    db.session.delete(item)
    db.session.commit()
    return jsonify({'success': True, 'sold_price': item.sell_price, 'new_balance': round(user.balance, 4)})

@app.route('/api/inventory/withdraw_gift', methods=['POST'])
def withdraw_gift():
    """User wants to withdraw a gift - returns instructions"""
    data = request.get_json()
    item_id = data.get('item_id')
    item = Inventory.query.get(item_id)
    if not item:
        return jsonify({'error': 'Item not found'}), 404
    return jsonify({'message': f'Напишите Админу слово "Hi" и название подарка: {item.gift_name}'})

# ── LEADERBOARD ──────────────────────────────────────────────────
@app.route('/api/leaderboard', methods=['GET'])
def leaderboard():
    users = User.query.order_by(User.total_deposited.desc()).limit(35).all()
    board = []
    for i, u in enumerate(users):
        board.append({
            'rank': i + 1,
            'telegram_id': u.telegram_id,
            'name': u.first_name or 'User',
            'username': u.username,
            'photo_url': u.photo_url,
            'total_deposited': u.total_deposited,
        })
    return jsonify(board)

# ── REFERRALS ────────────────────────────────────────────────────
@app.route('/api/referrals/<int:telegram_id>', methods=['GET'])
def get_referrals(telegram_id):
    refs = User.query.filter_by(ref_id=telegram_id).all()
    user = User.query.filter_by(telegram_id=telegram_id).first()
    return jsonify({
        'referrals': [{'name': r.first_name, 'username': r.username, 'total_deposited': r.total_deposited} for r in refs],
        'total_referred': len(refs),
        'ref_balance': user.ref_balance if user else 0,
        'ref_percent': user.ref_percent if user else 10
    })

@app.route('/api/referrals/withdraw', methods=['POST'])
def withdraw_ref_balance():
    data = request.get_json()
    tid = data.get('telegram_id')
    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.ref_balance < 3:
        return jsonify({'error': 'Минимум 3 TON для вывода реферального баланса'})
    user.balance += user.ref_balance
    user.ref_balance = 0
    db.session.commit()
    return jsonify({'success': True, 'transferred': True, 'new_balance': round(user.balance, 4)})

# ── DEPOSITS ─────────────────────────────────────────────────────
@app.route('/api/deposit/stars', methods=['POST'])
def deposit_stars():
    """Handle Telegram Stars deposit (simulated — real impl needs Telegram payment webhook)"""
    data = request.get_json()
    tid = data.get('telegram_id')
    stars = int(data.get('stars', 0))
    if stars <= 0:
        return jsonify({'error': 'Invalid stars amount'}), 400

    ton_amount = round(stars * 1.099 / 100, 4)  # 100 stars = 1.099 TON

    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404

    user.balance += ton_amount
    user.total_deposited += ton_amount

    # Credit referrer
    if user.ref_id:
        referrer = User.query.filter_by(telegram_id=user.ref_id).first()
        if referrer:
            ref_bonus = round(ton_amount * referrer.ref_percent / 100, 4)
            referrer.ref_balance += ref_bonus
            db.session.commit()

    db.session.commit()

    rec = DepositRecord(user_id=tid, amount=ton_amount, method='stars', status='completed')
    db.session.add(rec)
    db.session.commit()

    notify_admin(f"💰 Новое пополнение через Stars!\nПользователь ID: {tid} ({user.first_name})\nСумма: {stars} Stars = {ton_amount} TON")
    return jsonify({'success': True, 'ton_amount': ton_amount, 'new_balance': round(user.balance, 4)})

@app.route('/api/deposit/ton', methods=['POST'])
def deposit_ton():
    """Initiate TON deposit — user connects wallet, we give them a unique memo"""
    data = request.get_json()
    tid = data.get('telegram_id')
    amount = float(data.get('amount', 0))
    if amount <= 0:
        return jsonify({'error': 'Invalid amount'}), 400

    memo = f"DEP-{tid}-{int(time.time())}"
    rec = DepositRecord(user_id=tid, amount=amount, method='ton', status='pending')
    db.session.add(rec)
    db.session.commit()

    # Bot address where user should send TON
    bot_wallet = os.environ.get('BOT_WALLET_ADDRESS', 'UQD...')
    return jsonify({'wallet_address': bot_wallet, 'memo': memo, 'amount': amount, 'deposit_id': rec.id})

@app.route('/api/deposit/confirm', methods=['POST'])
def confirm_deposit():
    """Admin or webhook confirms a TON deposit"""
    data = request.get_json()
    deposit_id = data.get('deposit_id')
    rec = DepositRecord.query.get(deposit_id)
    if not rec:
        return jsonify({'error': 'Deposit not found'}), 404

    rec.status = 'completed'
    user = User.query.filter_by(telegram_id=rec.user_id).first()
    user.balance += rec.amount
    user.total_deposited += rec.amount

    # Credit referrer
    if user.ref_id:
        referrer = User.query.filter_by(telegram_id=user.ref_id).first()
        if referrer:
            ref_bonus = round(rec.amount * referrer.ref_percent / 100, 4)
            referrer.ref_balance += ref_bonus

    db.session.commit()
    notify_admin(f"💰 Подтверждено пополнение TON!\nПользователь: {user.first_name} (ID: {rec.user_id})\nСумма: {rec.amount} TON")
    return jsonify({'success': True, 'new_balance': round(user.balance, 4)})

# ── WITHDRAWALS ──────────────────────────────────────────────────
@app.route('/api/withdraw/create', methods=['POST'])
def create_withdrawal():
    data = request.get_json()
    tid = data.get('telegram_id')
    amount = float(data.get('amount', 0))
    wallet = data.get('wallet_address', '')

    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if amount < 10:
        return jsonify({'error': 'Минимум вывода 10 TON'})
    if user.balance < amount:
        return jsonify({'error': 'Недостаточный баланс'})
    if not wallet:
        return jsonify({'error': 'Укажите адрес кошелёка'})

    user.balance -= amount
    db.session.commit()

    wr = WithdrawalRequest(user_id=tid, amount=amount, wallet_address=wallet)
    db.session.add(wr)
    db.session.commit()

    notify_admin(f"📤 Запрос на вывод!\nПользователь: {user.first_name} (ID: {tid})\nСумма: {amount} TON\nКошелёк: {wallet}\nID заявки: {wr.id}")
    return jsonify({'success': True, 'request_id': wr.id, 'new_balance': round(user.balance, 4)})

@app.route('/api/withdraw/status/<int:telegram_id>', methods=['GET'])
def get_withdrawal_status(telegram_id):
    reqs = WithdrawalRequest.query.filter_by(user_id=telegram_id).order_by(WithdrawalRequest.created_at.desc()).all()
    return jsonify([{
        'id': r.id, 'amount': r.amount, 'status': r.status,
        'admin_note': r.admin_note,
        'created_at': r.created_at.strftime('%d.%m %H:%M')
    } for r in reqs])

# ── ADMIN ENDPOINTS ─────────────────────────────────────────────
@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    total_users = User.query.count()
    now = datetime.utcnow()
    online_24h = User.query.filter(User.last_online >= now - timedelta(hours=24)).count()
    online_now = User.query.filter(User.last_online >= now - timedelta(minutes=5)).count()
    total_deposited = db.session.query(db.func.sum(User.total_deposited)).scalar() or 0
    return jsonify({
        'total_users': total_users,
        'online_24h': online_24h,
        'online_now': online_now,
        'total_deposited': round(total_deposited, 4)
    })

@app.route('/api/admin/user/<int:telegram_id>', methods=['GET'])
def admin_get_user(telegram_id):
    user = User.query.filter_by(telegram_id=telegram_id).first()
    if not user:
        return jsonify({'error': 'Not found'}), 404

    refs = User.query.filter_by(ref_id=telegram_id).all()
    history = GameHistory.query.filter_by(user_id=telegram_id).order_by(GameHistory.played_at.desc()).limit(20).all()

    return jsonify({
        'user': {
            'telegram_id': user.telegram_id,
            'first_name': user.first_name,
            'username': user.username,
            'balance': user.balance,
            'total_deposited': user.total_deposited,
            'games_played': user.games_played,
            'ref_percent': user.ref_percent,
            'ref_balance': user.ref_balance,
            'created_at': user.created_at.strftime('%d.%m.%Y %H:%M'),
            'last_online': user.last_online.strftime('%d.%m.%Y %H:%M'),
        },
        'referrals': [{'name': r.first_name, 'deposited': r.total_deposited} for r in refs],
        'game_history': [{'type': h.game_type, 'stake': h.stake, 'result': h.result, 'played_at': h.played_at.strftime('%d.%m %H:%M')} for h in history]
    })

@app.route('/api/admin/user/update', methods=['POST'])
def admin_update_user():
    data = request.get_json()
    tid = data.get('telegram_id')
    user = User.query.filter_by(telegram_id=tid).first()
    if not user:
        return jsonify({'error': 'Not found'}), 404

    if 'balance_add' in data:
        user.balance += float(data['balance_add'])
    if 'balance_set' in data:
        user.balance = float(data['balance_set'])
    if 'ref_percent' in data:
        user.ref_percent = float(data['ref_percent'])
    db.session.commit()
    return jsonify({'success': True, 'new_balance': round(user.balance, 4)})

@app.route('/api/admin/withdrawal/<int:wr_id>/action', methods=['POST'])
def admin_withdrawal_action(wr_id):
    data = request.get_json()
    action = data.get('action')  # 'approve' or 'reject'
    note = data.get('note', '')

    wr = WithdrawalRequest.query.get(wr_id)
    if not wr:
        return jsonify({'error': 'Not found'}), 404

    wr.status = 'approved' if action == 'approve' else 'rejected'
    wr.admin_note = note
    wr.updated_at = datetime.utcnow()
    db.session.commit()

    # If rejected, refund
    if action == 'reject':
        user = User.query.filter_by(telegram_id=wr.user_id).first()
        if user:
            user.balance += wr.amount
            db.session.commit()

    # Notify user
    msg = f"{'✅ Вывод одобрен' if action == 'approve' else '❌ Вывод отклонён'}: {wr.amount} TON"
    if note:
        msg += f"\nПримечание: {note}"
    send_telegram_message(wr.user_id, msg)

    return jsonify({'success': True, 'status': wr.status})

@app.route('/api/admin/withdrawals/pending', methods=['GET'])
def admin_pending_withdrawals():
    reqs = WithdrawalRequest.query.filter_by(status='pending').order_by(WithdrawalRequest.created_at.desc()).all()
    result = []
    for r in reqs:
        user = User.query.filter_by(telegram_id=r.user_id).first()
        result.append({
            'id': r.id,
            'user_name': user.first_name if user else 'Unknown',
            'user_id': r.user_id,
            'amount': r.amount,
            'wallet': r.wallet_address,
            'created_at': r.created_at.strftime('%d.%m %H:%M')
        })
    return jsonify(result)

@app.route('/api/admin/users/search', methods=['GET'])
def admin_search_users():
    q = request.args.get('q', '')
    users = User.query.filter(
        (User.telegram_id == int(q) if q.isdigit() else False) |
        User.first_name.ilike(f'%{q}%') |
        User.username.ilike(f'%{q}%')
    ).limit(20).all()
    return jsonify([{'telegram_id': u.telegram_id, 'name': u.first_name, 'username': u.username, 'balance': u.balance} for u in users])

# ── GAME HISTORY (last played) ──────────────────────────────────
@app.route('/api/history/last/<int:telegram_id>', methods=['GET'])
def last_game(telegram_id):
    h = GameHistory.query.filter_by(user_id=telegram_id).order_by(GameHistory.played_at.desc()).first()
    if not h:
        return jsonify(None)
    return jsonify({
        'game_type': h.game_type,
        'stake': h.stake,
        'result': h.result,
        'multiplier': h.multiplier,
        'played_at': h.played_at.strftime('%H:%M:%S'),
        'details': json.loads(h.details) if h.details else {}
    })

# ── STATIC FILES ─────────────────────────────────────────────────
@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

# ── DB INIT ──────────────────────────────────────────────────────
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
