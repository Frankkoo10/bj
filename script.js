// ==========================================
// 1. CONFIGURACIÓN SUPABASE Y MULTIJUGADOR
// ==========================================
const supabaseUrl = 'https://wgqqbahoalozgfukioza.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndncXFiYWhvYWxvemdmdWtpb3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNTA3OTYsImV4cCI6MjA5OTgyNjc5Nn0.v_kpYceS8ceIUBNaLLHjfyBeFA2Y3lDRy7Yn6cb5Uz8';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Identidad del Jugador (Persistente para evitar perder la mano al recargar)
let displayUsername = localStorage.getItem('bj_username');
if (!displayUsername) {
    displayUsername = "Jugador_" + Math.floor(Math.random() * 9999);
    localStorage.setItem('bj_username', displayUsername);
}

let myPresenceKey = localStorage.getItem('bj_presence_key');
if (!myPresenceKey) {
    myPresenceKey = 'guest_' + Math.floor(Math.random() * 1000000);
    localStorage.setItem('bj_presence_key', myPresenceKey);
}
let usuarioAutenticado = null;

let bjChannel = null;
let onlineCount = 1; 
let isHost = false; 

// ==========================================
// 2. ESTADO GLOBAL COMPARTIDO 
// ==========================================
let sharedState = {
    gameState: 'BETTING', 
    phaseEndTime: Date.now() + 15000,
    communityCards: [],
    dealerHand: [],
    confirmedPlayers: [], 
    activePlayers: [], 
    playerCardCount: {}, 
    decisions: {} 
};

// Recuperar estado del host fuerte (localStorage en vez de sessionStorage)
let savedHostState = localStorage.getItem('bj_host_state');
if (savedHostState) {
    try { sharedState = JSON.parse(savedHostState); } catch(e) {}
}

// ==========================================
// 3. SEGURIDAD ANTI-TRAMPAS (Host)
// ==========================================
let secretHostDeck = []; 
let savedHostDeck = localStorage.getItem('bj_host_deck');
if (savedHostDeck) {
    try { secretHostDeck = JSON.parse(savedHostDeck); } catch(e) {}
}

function generateSecureDeck() {
    let fullDeck = [];
    ['♥','♦','♣','♠'].forEach(s => ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].forEach(v => fullDeck.push({v, s, hidden: false})));
    fullDeck.sort(() => Math.random() - 0.5);

    let inPlay = [...sharedState.communityCards, ...sharedState.dealerHand];
    inPlay.forEach(c => {
        let idx = fullDeck.findIndex(fc => fc.v === c.v && fc.s === c.s);
        if (idx > -1) fullDeck.splice(idx, 1);
    });
    localStorage.setItem('bj_host_deck', JSON.stringify(fullDeck));
    return fullDeck;
}

// ESTADO LOCAL DEL CLIENTE (Fuerte)
let balance = 5000;
let currentBets = JSON.parse(localStorage.getItem('bj_current_bets') || '{"main":0,"21+3":0,"pairs":0}');
let lastBets = JSON.parse(localStorage.getItem('bj_last_bets') || '{"main":0,"21+3":0,"pairs":0}');
let selectedChipValue = 100;
let imPlaying = localStorage.getItem('bj_im_playing') === 'true'; 
let roundResolved = false;

const suitMap = { '♥': 'corazones', '♦': 'diamantes', '♣': 'treboles', '♠': 'picas' };

window.onload = async () => {
    await cargarPerfil();
    renderGameUI(); // SOLUCIÓN: Dibuja las apuestas guardadas inmediatamente al cargar
    iniciarConexionMultijugador();
    setInterval(gameLoop, 1000); 
};

// ==========================================
// SALDO Y PERFIL
// ==========================================
async function cargarPerfil() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
            usuarioAutenticado = session.user;
            displayUsername = session.user.email ? session.user.email.split('@')[0] : "Jugador_VIP";
            localStorage.setItem('bj_username', displayUsername);
            
            const { data, error } = await supabaseClient
                .from('perfiles')
                .select('saldo')
                .eq('id', session.user.id)
                .single();
            
            if (data && data.saldo != null) {
                balance = data.saldo;
            } else {
                console.warn("No se encontró registro en perfiles para este usuario, usando saldo por defecto.");
            }
        } else {
            let savedBalance = localStorage.getItem('bj_balance');
            balance = savedBalance ? parseInt(savedBalance) : 5000;
        }
    } catch(e) {
        console.log("Error cargando perfil de Supabase:", e);
    }
    updateBalanceUI();
}

async function modificarSaldo(monto) {
    balance += monto;
    updateBalanceUI();
    
    if (usuarioAutenticado) {
        try {
            await supabaseClient
                .from('perfiles')
                .update({ saldo: balance })
                .eq('id', usuarioAutenticado.id);
        } catch(e) { 
            console.log("Error guardando saldo en DB:", e); 
        }
    } else {
        localStorage.setItem('bj_balance', balance);
    }
}

// ==========================================
// CONEXIÓN MULTIJUGADOR
// ==========================================
function iniciarConexionMultijugador() {
    bjChannel = supabaseClient.channel('bj_room_sync', {
        config: { presence: { key: myPresenceKey } },
    });
    
    bjChannel.on('presence', { event: 'sync' }, () => {
        let presences = bjChannel.presenceState();
        let keys = Object.keys(presences).sort();
        onlineCount = keys.length || 1;
        document.getElementById('online-count-value').innerText = onlineCount;
        
        isHost = keys[0] === myPresenceKey;
        if (!isHost) {
            bjChannel.send({ type: 'broadcast', event: 'request_state', payload: {} });
        }
    });

    bjChannel.on('broadcast', { event: 'chat_message' }, (payload) => {
        mostrarMensajeEnChat(payload.payload.user, payload.payload.text);
    });

    bjChannel.on('broadcast', { event: 'sync_state' }, (payload) => {
        sharedState = payload.payload.state;
        renderGameUI();
    });

    bjChannel.on('broadcast', { event: 'request_state' }, () => {
        if (isHost) emitState();
    });

    bjChannel.on('broadcast', { event: 'player_action' }, (payload) => {
        manejarAccionJugador(payload.payload);
    });

    bjChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await bjChannel.track({ online_at: new Date().toISOString() });
    });
}

function manejarAccionJugador(data) {
    if (data.action === 'confirm' && sharedState.gameState === 'BETTING') {
        if (!sharedState.confirmedPlayers.includes(data.user)) {
            sharedState.confirmedPlayers.push(data.user);
            if (isHost) emitState();
            renderGameUI();
        }
    } else if (['hit', 'stand', 'double'].includes(data.action) && sharedState.gameState === 'DECISION') {
        sharedState.decisions[data.user] = data.action;
        renderGameUI();
        if (isHost) verificarDecisionesCompletas();
    }
}

// ==========================================
// 4. LÓGICA DEL ANFITRIÓN (HOST)
// ==========================================
function gameLoop() {
    let timeLeft = Math.max(0, Math.ceil((sharedState.phaseEndTime - Date.now()) / 1000));
    actualizarTextosEstado(timeLeft);
    
    if (sharedState.gameState === 'BETTING') {
        roundResolved = false;
        
        // Si el jugador recargó tras mucho rato y la mesa ya limpió su lugar para una nueva ronda
        if (imPlaying && sharedState.confirmedPlayers.indexOf(displayUsername) === -1 && timeLeft > 0) {
            imPlaying = false;
            localStorage.setItem('bj_im_playing', 'false');
            currentBets = {main: 0, "21+3": 0, pairs: 0};
            localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
            renderGameUI(); // SOLUCIÓN: Limpiar visualmente si fuimos removidos de la mesa
        }
    }

    if (isHost) {
        if (secretHostDeck.length === 0) secretHostDeck = generateSecureDeck();

        if (sharedState.gameState === 'BETTING' && timeLeft <= 0) {
            if (sharedState.confirmedPlayers.length === 0) {
                sharedState.phaseEndTime = Date.now() + 15000; 
                emitState();
            } else {
                startDealingAnimation();
            }
        } 
        else if (sharedState.gameState === 'DECISION' && timeLeft <= 0) {
            procesarResolucionDeRondaDecision();
        }
    }
    
    evaluarPagosLocales();
}

function verificarDecisionesCompletas() {
    let todosDecidieron = sharedState.activePlayers.length > 0 && 
                          sharedState.activePlayers.every(p => sharedState.decisions[p]);
                          
    if (todosDecidieron) {
        sharedState.phaseEndTime = Date.now(); 
        emitState();
        procesarResolucionDeRondaDecision();
    }
}

function emitState() {
    if (isHost) {
        localStorage.setItem('bj_host_state', JSON.stringify(sharedState));
        localStorage.setItem('bj_host_deck', JSON.stringify(secretHostDeck));
    }
    if (bjChannel) bjChannel.send({ type: 'broadcast', event: 'sync_state', payload: { state: sharedState } });
    renderGameUI();
}

function startDealingAnimation() {
    sharedState.gameState = 'ANIMATING_DEAL';
    emitState();

    secretHostDeck = generateSecureDeck();
    sharedState.communityCards = [];
    sharedState.dealerHand = [];
    
    setTimeout(() => { sharedState.communityCards.push(secretHostDeck.pop()); emitState(); }, 600);
    setTimeout(() => { sharedState.dealerHand.push(secretHostDeck.pop()); emitState(); }, 1200);
    setTimeout(() => { sharedState.communityCards.push(secretHostDeck.pop()); emitState(); }, 1800);
    setTimeout(() => { 
        sharedState.dealerHand.push({ ...secretHostDeck.pop(), hidden: true }); 
        
        sharedState.activePlayers = [...sharedState.confirmedPlayers];
        sharedState.playerCardCount = {};
        sharedState.confirmedPlayers.forEach(p => sharedState.playerCardCount[p] = 2);
        sharedState.decisions = {};
        
        if (getVal(sharedState.communityCards) === 21) {
            startDealerTurn();
        } else {
            sharedState.gameState = 'DECISION';
            sharedState.phaseEndTime = Date.now() + 15000;
            emitState();
        }
    }, 2400);
}

function procesarResolucionDeRondaDecision() {
    let alguienPidio = false;
    let siguientesActivos = [];

    sharedState.activePlayers.forEach(p => {
        if (!sharedState.decisions[p]) sharedState.decisions[p] = 'stand';
        if (['hit', 'double'].includes(sharedState.decisions[p])) alguienPidio = true;
    });

    if (alguienPidio) {
        sharedState.gameState = 'ANIMATING_DEAL'; 
        emitState();
        
        setTimeout(() => {
            sharedState.communityCards.push(secretHostDeck.pop());
            
            sharedState.activePlayers.forEach(p => {
                let accion = sharedState.decisions[p];
                if (accion === 'hit' || accion === 'double') {
                    sharedState.playerCardCount[p]++;
                }
                
                let misCartas = sharedState.communityCards.slice(0, sharedState.playerCardCount[p]);
                let miValor = getVal(misCartas);
                
                if (accion === 'hit' && miValor < 21) {
                    siguientesActivos.push(p);
                }
            });

            sharedState.activePlayers = siguientesActivos;
            sharedState.decisions = {};
            
            if (siguientesActivos.length > 0) {
                sharedState.gameState = 'DECISION';
                sharedState.phaseEndTime = Date.now() + 15000;
                emitState();
            } else {
                startDealerTurn();
            }
        }, 1000);
    } else {
        startDealerTurn();
    }
}

function startDealerTurn() {
    sharedState.gameState = 'DEALER_TURN';
    sharedState.dealerHand[1].hidden = false;
    emitState();
    setTimeout(playDealerLoop, 1500);
}

function playDealerLoop() {
    if (getVal(sharedState.dealerHand) < 17) {
        sharedState.dealerHand.push(secretHostDeck.pop());
        emitState();
        setTimeout(playDealerLoop, 1500);
    } else {
        sharedState.gameState = 'RESOLVED';
        sharedState.phaseEndTime = Date.now() + 5000;
        emitState();
    }
}

// ==========================================
// 5. LÓGICA LOCAL DEL CLIENTE Y PAGOS
// ==========================================
function updateBalanceUI() { 
    document.getElementById('balance').textContent = balance; 
}
function updateStatus(text) { document.getElementById('game-status').innerText = text; }
function updateSubStatus(text) { document.getElementById('sub-status').innerText = text; }

document.querySelectorAll('.selector-chip').forEach(chip => {
    chip.addEventListener('click', function() {
        document.querySelector('.selector-chip.active').classList.remove('active');
        this.classList.add('active');
        selectedChipValue = parseInt(this.getAttribute('data-value'));
    });
});

function addBet(type) {
    if (sharedState.gameState !== 'BETTING' || imPlaying) return showToast("Espera la fase de apuestas", false);
    if (balance >= selectedChipValue) {
        modificarSaldo(-selectedChipValue);
        currentBets[type] += selectedChipValue;
        localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
        renderGameUI(); 
    } else { showToast("Saldo insuficiente", false); }
}

function repeatBet() {
    if (sharedState.gameState !== 'BETTING' || imPlaying) return;
    if (lastBets.main === 0) return showToast("No hay apuesta previa", false);
    let total = lastBets.main + lastBets["21+3"] + lastBets.pairs;
    if (balance >= total) {
        modificarSaldo(-total);
        currentBets = { ...lastBets };
        localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
        renderGameUI(); 
    } else { showToast("Saldo insuficiente", false); }
}

function clearBets() {
    if (sharedState.gameState !== 'BETTING' || imPlaying) return;
    
    // Devolvemos el total apostado al saldo actual
    let totalApostado = currentBets.main + currentBets["21+3"] + currentBets.pairs;
    if (totalApostado > 0) {
        modificarSaldo(totalApostado);
        currentBets = { main: 0, "21+3": 0, pairs: 0 };
        localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
        renderGameUI();
        showToast("Apuestas borradas", true);
    }
}

function confirmBet() {
    if (currentBets.main === 0) return showToast("Apuesta principal obligatoria", false);
    imPlaying = true;
    localStorage.setItem('bj_im_playing', 'true');
    lastBets = { ...currentBets };
    localStorage.setItem('bj_last_bets', JSON.stringify(lastBets));
    
    bjChannel.send({ type: 'broadcast', event: 'player_action', payload: { action: 'confirm', user: displayUsername } });
    manejarAccionJugador({action: 'confirm', user: displayUsername}); 
    renderGameUI(); 
}

function sendAction(action) {
    if (action === 'double') {
        if (balance < currentBets.main) return showToast("Saldo insuficiente", false);
        modificarSaldo(-currentBets.main);
        currentBets.main *= 2;
        localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
        renderGameUI();
    }
    bjChannel.send({ type: 'broadcast', event: 'player_action', payload: { action: action, user: displayUsername } });
    manejarAccionJugador({action: action, user: displayUsername});
}

function evaluarPagosLocales() {
    if (sharedState.gameState === 'RESOLVED' && !roundResolved) {
        roundResolved = true;
        
        if (imPlaying) {
            let numCartasMias = sharedState.playerCardCount[displayUsername] || 2;
            let misCartas = sharedState.communityCards.slice(0, numCartasMias);
            let pVal = getVal(misCartas);
            let dVal = getVal(sharedState.dealerHand);
            
            let payout = 0, msg = "";
            let isBJ = (misCartas.length === 2 && pVal === 21);
            
            let sb = resolverApuestasLaterales(sharedState.communityCards.slice(0,2), sharedState.dealerHand[0]);
            payout += sb.total; msg += sb.msg;

            if (pVal <= 21) {
                if (isBJ && dVal !== 21) { payout += currentBets.main + (currentBets.main * 1.5); }
                else if (dVal > 21 || pVal > dVal) { payout += currentBets.main * 2; }
                else if (pVal === dVal) { payout += currentBets.main; }
            }

            if (payout > 0) {
                modificarSaldo(payout);
                showToast(`Ganaste $${payout}! ${msg}`, true);
            } else if (payout === currentBets.main) {
                modificarSaldo(payout);
                showToast(`Empate. Devuelven $${payout}. ${msg}`, true);
            } else {
                if (sb.total > 0) { 
                    modificarSaldo(sb.total); 
                    showToast(`Perdiste mano, ganaste $${sb.total} en extras`, true); 
                }
                else { showToast("Perdiste esta ronda", false); }
            }
        }
        
        imPlaying = false;
        localStorage.setItem('bj_im_playing', 'false');
        currentBets = {main: 0, "21+3": 0, pairs: 0};
        localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
        renderGameUI();
        
        setTimeout(() => { 
            if (isHost) { 
                sharedState.gameState = 'BETTING'; 
                sharedState.phaseEndTime = Date.now() + 15000; 
                sharedState.confirmedPlayers = []; 
                sharedState.communityCards = []; 
                sharedState.dealerHand = []; 
                emitState(); 
            } 
        }, 4000);
    }
}

// ==========================================
// 6. RENDERIZADO VISUAL
// ==========================================
function getVal(hand) {
    let s = 0, a = 0;
    hand.filter(c => !c.hidden).forEach(c => {
        if (['J','Q','K'].includes(c.v)) s += 10;
        else if (c.v === 'A') { s += 11; a++; }
        else s += parseInt(c.v);
    });
    while (s > 21 && a > 0) { s -= 10; a--; }
    return s;
}

function actualizarTextosEstado(timeLeft) {
    if (sharedState.gameState === 'BETTING') {
        updateStatus(`APUESTAS ABIERTAS: ${timeLeft}s`);
        updateSubStatus(`Confirmados: ${sharedState.confirmedPlayers.length}`);
    } else if (sharedState.gameState === 'ANIMATING_DEAL') {
        updateStatus(`REPARTIENDO CARTAS...`);
        updateSubStatus('');
    } else if (sharedState.gameState === 'DECISION') {
        updateStatus(`TIEMPO PARA DECIDIR: ${timeLeft}s`);
        let listos = Object.keys(sharedState.decisions).length;
        let totales = sharedState.activePlayers.length;
        updateSubStatus(totales > 0 ? `Decisiones: ${listos} de ${totales}` : `Evaluando...`);
    } else if (sharedState.gameState === 'DEALER_TURN') {
        updateStatus(`TURNO DEL DEALER`);
        updateSubStatus('');
    } else if (sharedState.gameState === 'RESOLVED') {
        updateStatus(`RONDA FINALIZADA`);
        updateSubStatus('Pagando ganancias...');
    }
}

function renderGameUI() {
    // SISTEMA DE REEMBOLSO: Si la ronda empieza y NO confirmaste la apuesta, te devuelve el dinero
    let hayPlataApostada = (currentBets.main > 0 || currentBets["21+3"] > 0 || currentBets.pairs > 0);
    if (sharedState.gameState !== 'BETTING' && !imPlaying && hayPlataApostada) {
        let devolucion = currentBets.main + currentBets["21+3"] + currentBets.pairs;
        modificarSaldo(devolucion);
        currentBets = {main: 0, "21+3": 0, pairs: 0};
        localStorage.setItem('bj_current_bets', JSON.stringify(currentBets));
        showToast("No confirmaste a tiempo. Apuesta devuelta.", true);
    }

    document.getElementById('stat-playing').innerText = sharedState.confirmedPlayers.length;
    let decList = Object.values(sharedState.decisions);
    document.getElementById('stat-hit').innerText = decList.filter(x => x === 'hit' || x === 'double').length;
    document.getElementById('stat-stand').innerText = decList.filter(x => x === 'stand').length;

    

    // Dealer Cards
    document.getElementById('dealer-cards').innerHTML = sharedState.dealerHand.map(c => 
        c.hidden ? `<img src="cartas/dorso.png" class="card-img">` : `<img src="cartas/${c.v}_${suitMap[c.s]}.png" class="card-img" onerror="this.src='cartas/dorso.png'">`
    ).join('');
    document.getElementById('d-score').textContent = getVal(sharedState.dealerHand);

    // Community Cards & Mi Puntaje
    let wrap = document.getElementById('community-hand');
    let miLimite = sharedState.playerCardCount[displayUsername] || sharedState.communityCards.length;
    
    wrap.innerHTML = sharedState.communityCards.map((c, idx) => {
        let isMine = imPlaying ? (idx < miLimite) : true; 
        let cssClass = isMine ? "card-img" : "card-img card-dimmed";
        return `<img src="cartas/${c.v}_${suitMap[c.s]}.png" class="${cssClass}" onerror="this.src='cartas/dorso.png'">`;
    }).join('');
    
    if (sharedState.communityCards.length > 0) {
        document.getElementById('my-score').textContent = imPlaying ? getVal(sharedState.communityCards.slice(0, miLimite)) : '0';
        document.getElementById('c-score').textContent = getVal(sharedState.communityCards);
    } else {
        document.getElementById('my-score').textContent = '0';
        document.getElementById('c-score').textContent = '0';
    }

    // SIEMPRE MOSTRAR LA PLATA PUESTA, AUNQUE SE ACTUALICE
    document.getElementById('chip-main').textContent = `$${currentBets.main}`;
    document.getElementById('chip-213').textContent = `$${currentBets["21+3"]}`;
    document.getElementById('chip-pairs').textContent = `$${currentBets.pairs}`;

    if (sharedState.gameState === 'BETTING') {
        document.getElementById('deal-btn').disabled = imPlaying || currentBets.main === 0;
        document.getElementById('repeat-btn').disabled = imPlaying || lastBets.main === 0;
        
        // --- AGREGA ESTA LÍNEA AQUÍ ---
        document.getElementById('clear-btn').disabled = imPlaying; 
        // ------------------------------
        
        document.getElementById('hit-btn').disabled = true;
        document.getElementById('stand-btn').disabled = true;
        document.getElementById('double-btn').disabled = true;
    } else {
        document.getElementById('deal-btn').disabled = true;
        document.getElementById('repeat-btn').disabled = true;
        
        // --- Y ESTA OTRA LÍNEA AQUÍ PARA CUANDO NO ESTÉS EN FASE DE APUESTAS ---
        document.getElementById('clear-btn').disabled = true;
        
        let miTurno = imPlaying && sharedState.gameState === 'DECISION' && sharedState.activePlayers.includes(displayUsername) && !sharedState.decisions[displayUsername];
        
        document.getElementById('hit-btn').disabled = !miTurno;
        document.getElementById('stand-btn').disabled = !miTurno;
        
        let misCartasCount = sharedState.playerCardCount[displayUsername] || 0;
        document.getElementById('double-btn').disabled = !(miTurno && misCartasCount === 2 && balance >= currentBets.main);
    }
}

// 7. APUESTAS LATERALES Y UTILIDADES
function resolverApuestasLaterales(pCards, dCard) {
    let res = { total: 0, msg: "" };
    if(!pCards[0] || !pCards[1] || !dCard) return res;

    let p1 = pCards[0], p2 = pCards[1], d = dCard;

    if (currentBets["21+3"] > 0) {
        let v = [p1.v, p2.v, d.v], s = [p1.s, p2.s, d.s];
        let isFlush = s[0] === s[1] && s[1] === s[2];
        let vals = v.map(x => (['J','Q','K','A'].includes(x) ? (x==='A'?14: (x==='K'?13: (x==='Q'?12:11))) : parseInt(x))).sort((a,b)=>a-b);
        let isStraight = (vals[2] - vals[0] === 2 && vals[1] - vals[0] === 1) || (vals[0]===2 && vals[1]===3 && vals[2]===14);
        let isThreeOfAKind = v[0] === v[1] && v[1] === v[2];

        if (isThreeOfAKind && isFlush) res.total += currentBets["21+3"] * 31;
        else if (isStraight && isFlush) res.total += currentBets["21+3"] * 11;
        else if (isThreeOfAKind) res.total += currentBets["21+3"] * 31;
        else if (isFlush) res.total += currentBets["21+3"] * 7;
        else if (isStraight) res.total += currentBets["21+3"] * 6;
        if(res.total > 0) res.msg += ` (21+3: +$${res.total})`;
    }
    
    if (currentBets.pairs > 0 && p1.v === p2.v) {
        let pTotal = 0;
        if (p1.s === p2.s) pTotal = currentBets.pairs * 26; 
        else if (['♥','♦'].includes(p1.s) === ['♥','♦'].includes(p2.s)) pTotal = currentBets.pairs * 13; 
        else pTotal = currentBets.pairs * 7; 
        res.total += pTotal;
        if(pTotal > 0) res.msg += ` (Pairs: +$${pTotal})`;
    }
    return res;
}

function showToast(msg, isWin) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-msg ${isWin ? 'win' : 'lose'}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(()=>toast.remove(), 500); }, 3000);
}

function toggleModal(show) { document.getElementById('rules-modal').style.display = show ? 'flex' : 'none'; }
function toggleChat() {
    const popup = document.getElementById("chat-popup");
    popup.style.display = (popup.style.display === "flex") ? "none" : "flex";
    if (popup.style.display === "flex") {
        document.getElementById("chat-messages").scrollTop = document.getElementById("chat-messages").scrollHeight;
        document.getElementById("chat-input").focus();
    }
}
function manejarEnterChat(e) { if (e.key === 'Enter') enviarMensajeChat(); }
function enviarMensajeChat() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    mostrarMensajeEnChat(displayUsername, text);
    if (bjChannel) bjChannel.send({ type: 'broadcast', event: 'chat_message', payload: { user: displayUsername, text: text } });
    input.value = "";
}
function mostrarMensajeEnChat(user, text) {
    const container = document.getElementById("chat-messages");
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("chat-msg");
    msgDiv.innerHTML = `<span class="user">${user}:</span><span> ${text}</span>`;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}