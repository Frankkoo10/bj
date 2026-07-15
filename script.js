let balance = 100000, currentBets = {main: 0, "21+3": 0, pairs: 0}, pHand = [], dHand = [], deck = [], gameStarted = false;
let selectedChipValue = 100;

document.querySelectorAll('.selector-chip').forEach(chip => {
    chip.addEventListener('click', function() {
        document.querySelector('.selector-chip.active').classList.remove('active');
        this.classList.add('active');
        selectedChipValue = parseInt(this.getAttribute('data-value'));
    });
});

function addBet(type) {
    if (gameStarted) return alert("¡Juego en curso!");
    if (balance >= selectedChipValue) {
        balance -= selectedChipValue;
        currentBets[type] += selectedChipValue;
        document.getElementById('chip-' + (type==='main'?'main':type==='21+3'?'213':'pairs')).textContent = `$${currentBets[type]}`;
        document.getElementById('balance').textContent = balance;
    } else {
        alert("Saldo insuficiente");
    }
}

function deal() {
    if (currentBets.main === 0) return alert("Apuesta principal obligatoria");
    gameStarted = true;
    deck = []; ['♥','♦','♣','♠'].forEach(s => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].forEach(v => deck.push({v, s})));
    deck.sort(() => Math.random() - 0.5);
    pHand = [deck.pop(), deck.pop()]; dHand = [deck.pop()];
    document.getElementById('deal-btn').disabled = true;
    document.getElementById('hit-btn').disabled = false;
    document.getElementById('stand-btn').disabled = false;
    document.getElementById('double-btn').disabled = false;
    render();
}

function hit() {
    pHand.push(deck.pop());
    render();
    if (getVal(pHand) > 21) {
        alert("¡Te pasaste!");
        reset();
    }
}

function doubleDown() {
    if (balance < currentBets.main) return alert("Saldo insuficiente");
    balance -= currentBets.main;
    currentBets.main *= 2;
    pHand.push(deck.pop());
    document.getElementById('balance').textContent = balance;
    render();
    if (getVal(pHand) > 21) {
        alert("¡Te pasaste!");
        reset();
    } else {
        stand();
    }
}

function stand() {
    document.getElementById('hit-btn').disabled = true;
    document.getElementById('stand-btn').disabled = true;
    document.getElementById('double-btn').disabled = true;
    while (getVal(dHand) < 17) dHand.push(deck.pop());
    render();
    setTimeout(() => {
        let p = getVal(pHand), d = getVal(dHand), payout = 0;
        if (p <= 21 && (d > 21 || p > d)) {
            payout = currentBets.main * 2;
            alert("¡Ganaste! Dealer: " + d + " | Tú: " + p);
        } else if (p === d && p <= 21) {
            payout = currentBets.main;
            alert("Empate. Dealer: " + d + " | Tú: " + p);
        } else {
            alert("Perdiste. Dealer: " + d + " | Tú: " + p);
        }
        balance += payout;
        document.getElementById('balance').textContent = balance;
        reset();
    }, 100);
}

function getVal(hand) {
    let s = 0, a = 0;
    hand.forEach(c => {
        if (['J','Q','K'].includes(c.v)) s += 10;
        else if (c.v === 'A') { s += 11; a++; }
        else s += parseInt(c.v);
    });
    while (s > 21 && a > 0) { s -= 10; a--; }
    return s;
}

function reset() {
    gameStarted = false;
    currentBets = {main: 0, "21+3": 0, pairs: 0};
    document.querySelectorAll('[id^=chip-]').forEach(el => el.textContent = '$0');
    document.getElementById('deal-btn').disabled = false;
    document.getElementById('hit-btn').disabled = true;
    document.getElementById('stand-btn').disabled = true;
    document.getElementById('double-btn').disabled = true;
    pHand = []; dHand = [];
    document.getElementById('player-cards').innerHTML = "";
    document.getElementById('dealer-cards').innerHTML = "";
    document.getElementById('p-score').textContent = "0";
    document.getElementById('d-score').textContent = "0";
}

function render() {
    document.getElementById('player-cards').innerHTML = pHand.map(c => `<div class="card ${['♥','♦'].includes(c.s)?'red':''}">${c.v}${c.s}</div>`).join('');
    document.getElementById('dealer-cards').innerHTML = dHand.map(c => `<div class="card ${['♥','♦'].includes(c.s)?'red':''}">${c.v}${c.s}</div>`).join('');
    document.getElementById('p-score').textContent = getVal(pHand);
    document.getElementById('d-score').textContent = getVal(dHand);
}