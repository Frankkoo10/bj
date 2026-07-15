let balance = 100000, currentBets = {main: 0, "21+3": 0, pairs: 0}, lastBets = {main: 0, "21+3": 0, pairs: 0}, pHand = [], dHand = [], deck = [], gameStarted = false;
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

function repeatBet() {
    if (gameStarted) return alert("¡Juego en curso!");
    if (lastBets.main === 0) return alert("No hay apuesta previa para repetir");
    
    let totalNeeded = lastBets.main + lastBets["21+3"] + lastBets.pairs;
    let currentTotal = currentBets.main + currentBets["21+3"] + currentBets.pairs;
    
    if (balance + currentTotal >= totalNeeded) {
        // Devolvemos las apuestas actuales a la mesa si ya se había puesto alguna ficha
        balance += currentTotal;
        
        // Aplicamos la última apuesta registrada
        balance -= totalNeeded;
        currentBets = { ...lastBets };
        
        document.getElementById('chip-main').textContent = `$${currentBets.main}`;
        document.getElementById('chip-213').textContent = `$${currentBets["21+3"]}`;
        document.getElementById('chip-pairs').textContent = `$${currentBets.pairs}`;
        document.getElementById('balance').textContent = balance;
    } else {
        alert("Saldo insuficiente para repetir la última apuesta");
    }
}

// Lógica de cálculo de apuestas laterales
function resolveSideBets() {
    let p1 = pHand[0], p2 = pHand[1], d = dHand[0];
    let results = { "21+3": 0, pairs: 0, msg: "" };

    // Lógica 21+3
    if (currentBets["21+3"] > 0) {
        let v = [p1.v, p2.v, d.v], s = [p1.s, p2.s, d.s];
        let isFlush = s[0] === s[1] && s[1] === s[2];
        let isStraight = checkStraight([p1.v, p2.v, d.v]);
        let isThreeOfAKind = v[0] === v[1] && v[1] === v[2];

        if (isThreeOfAKind) results["21+3"] = currentBets["21+3"] * 31;
        else if (isStraight && isFlush) results["21+3"] = currentBets["21+3"] * 11;
        else if (isFlush) results["21+3"] = currentBets["21+3"] * 6;
        else if (isStraight) results["21+3"] = currentBets["21+3"] * 6;
        
        if (results["21+3"] > 0) results.msg += ` 21+3: Ganaste $${results["21+3"]}.`;
    }

    // Lógica Pairs
    if (currentBets.pairs > 0 && p1.v === p2.v) {
        if (p1.s === p2.s) results.pairs = currentBets.pairs * 26;
        else if (['♥','♦'].includes(p1.s) === ['♥','♦'].includes(p2.s)) results.pairs = currentBets.pairs * 13;
        else results.pairs = currentBets.pairs * 7;
        
        results.msg += ` Pairs: Ganaste $${results.pairs}.`;
    }
    return results;
}

function checkStraight(v) {
    let vals = v.map(x => (['J','Q','K','A'].includes(x) ? 10 : parseInt(x))).sort((a,b)=>a-b);
    return (vals[2] - vals[0] === 2 && vals[0] === vals[1]-1);
}

function deal() {
    if (currentBets.main === 0) return alert("Apuesta principal obligatoria");
    gameStarted = true;
    lastBets = { ...currentBets }; // Guardamos la apuesta para poder repetirla luego
    deck = []; ['♥','♦','♣','♠'].forEach(s => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].forEach(v => deck.push({v, s})));
    deck.sort(() => Math.random() - 0.5);
    pHand = [deck.pop(), deck.pop()]; dHand = [deck.pop()];
    document.getElementById('repeat-btn').disabled = true;
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
        let p = getVal(pHand), d = getVal(dHand), side = resolveSideBets();
        let payout = side["21+3"] + side.pairs;
        let msg = side.msg || "";
        
        if (p <= 21 && (d > 21 || p > d)) {
            payout += currentBets.main * 2;
            alert("¡Ganaste la mano! Dealer: " + d + " | Tú: " + p + "." + msg);
        } else if (p === d && p <= 21) {
            payout += currentBets.main;
            alert("Empate. Dealer: " + d + " | Tú: " + p + "." + msg);
        } else {
            alert("Perdiste la mano. Dealer: " + d + " | Tú: " + p + "." + msg);
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
    document.getElementById('repeat-btn').disabled = (lastBets.main === 0);
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