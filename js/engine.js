/* engine.js — baralho, regras oficiais do UNO, IA dos bots e máquina de estados */
/* linguagem: JavaScript, arquivo: js/engine.js, runtime: navegador
   host-autoritativo: o estado só roda aqui no dono da sala (ou local vs bots) */

(function (global) {
  "use strict";

  const COLORS = ["red", "yellow", "green", "blue"];
  const COLOR_PT = { red: "vermelho", yellow: "amarelo", green: "verde", blue: "azul" };
  const TARGET = 500;  const MAX_PLAYERS = 4;

  let idc = 0;
  function mk(color, kind, value) {
    return { id: "k" + (idc++), color: color, kind: kind, value: value === undefined ? null : value };
  }

  function buildDeck() {
    const d = [];
    for (const c of COLORS) {
      d.push(mk(c, "number", 0));
      for (let n = 1; n <= 9; n++) { d.push(mk(c, "number", n)); d.push(mk(c, "number", n)); }
      for (let i = 0; i < 2; i++) {
        d.push(mk(c, "skip"));
        d.push(mk(c, "reverse"));
        d.push(mk(c, "draw2"));
      }
    }
    for (let i = 0; i < 4; i++) { d.push(mk("wild", "wild")); d.push(mk("wild", "wild4")); }
    return d; // 108 cartas
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function hasColor(hand, color) {
    for (const c of hand) if (c.color === color) return true;
    return false;
  }

  /* uma carta é jogável contra o topo + cor atual + restante da mão */
  function isPlayable(card, top, curColor, hand) {
    if (card.kind === "wild") return true;
    if (card.kind === "wild4") {
      // oficial: só se você não tiver nenhuma carta da cor atual
      const others = hand.filter(c => c.id !== card.id);
      return !hasColor(others, curColor);
    }
    if (card.color === curColor) return true;
    // casa por símbolo/número com o topo
    if (top.kind === "number" && card.kind === "number" && card.value === top.value) return true;
    if (card.kind !== "number" && card.kind === top.kind) return true;
    return false;
  }

  function cardPoints(card) {
    if (card.kind === "number") return card.value;
    if (card.kind === "wild" || card.kind === "wild4") return 50;
    return 20;
  }

  function cardLabel(card) {
    if (card.kind === "number") return String(card.value);
    if (card.kind === "skip") return "bloqueio";
    if (card.kind === "reverse") return "inversão";
    if (card.kind === "draw2") return "+2";
    if (card.kind === "wild") return "curinga";
    return "+4";
  }

  /* ---------------- IA ---------------- */
  function botChooseColor(hand) {
    const count = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of hand) if (count[c.color] !== undefined) count[c.color]++;
    let best = COLORS[Math.floor(Math.random() * 4)];
    let n = -1;
    for (const col of COLORS) if (count[col] > n) { n = count[col]; best = col; }
    return best;
  }

  function botPick(hand, top, curColor) {
    const playable = hand.filter(c => isPlayable(c, top, curColor, hand));
    if (!playable.length) return null;

    const handAfter = c => hand.filter(x => x.id !== c.id);
    const colorCount = col => hand.filter(x => x.color === col).length;

    let best = null, bestScore = -Infinity;
    for (const c of playable) {
      let s = 0;
      const rest = handAfter(c);

      if (c.kind === "number") {
        // mantém a cor que domina a mão
        const own = colorCount(c.color);
        s += c.color === curColor ? 4 : 2;
        s += own * 1.5;
        if (rest.length && rest.every(x => x.color === c.color)) s += 8; // segue no mono
        if (c.value >= 7) s += 1;
      } else if (c.kind === "skip" || c.kind === "reverse" || c.kind === "draw2") {
        s += c.color === curColor ? 5 : 2.5;
        s += colorCount(c.color) * 1.2;
        if (c.kind === "draw2" && rest.length) s += 2; // bate +2 antes de largar
      } else if (c.kind === "wild") {
        s += rest.length <= 3 ? 5 : -2.5; // guarda curinga pra emergência
        if (!rest.length) s += 100;
      } else if (c.kind === "wild4") {
        s += rest.length <= 2 ? 6 : -4;
        if (!rest.length) s += 100;
      }
      if (rest.length === 1) s += 40; // prefere chegar a 1 carta agora
      if (!rest.length) s += 1000;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  /* ---------------- estado ---------------- */
  const Game = {
    mode: null,        // 'local' | 'host'
    mySeat: 0,
    state: null,
    emit: null,        // chamado a cada mutação (render local + broadcast)
    timers: [],

    /* ---------- novo: timer de 10s por turno ---------- */
    gameTimer: null,
    gameStartTime: null,
    gameRemaining: null,   // ms restantes quando o relógio é pausado entre rodadas
    GAME_TIME_MS: 5 * 60 * 1000,  // 5 minutos
    turnTimer: null,
    TURN_LIMIT_MS: 10000,  // 10 segundos

    /* ---------- ciclo de sala ---------- */
    startLobby(mode, hostName) {
      this.mode = mode;
      this.mySeat = 0;
      this.clearTimers();
      this.clearGameTimer();
      this.state = {
        phase: "lobby",
        players: [{
          id: "p0", name: hostName || "Jogador", bot: false, connected: true,
          hand: [], score: 0, uno: false, declaredUno: false
        }],
        turn: 0, dir: 1, round: 1,
        color: null, top: null, topRot: 0,
        draw: [], discard: [],
        drawnThisTurn: false,
        turnStartedAt: null,  // início do turno atual (contagem de 10s)
        turnLimit: this.TURN_LIMIT_MS,
        grace: null,          // {seat, until}
        log: [], last: null,  // last: {kind, text}
        winner: null, roundPts: null
      };
      if (mode === "local") {
        for (let i = 0; i < 3; i++) this.addBot();
      }
      this.fire();
    },

    addBot() {
      const s = this.state;
      if (s.phase !== "lobby" || s.players.length >= MAX_PLAYERS) return;
      const names = ["Lia", "Davi", "Maya", "Rui", "Nina", "Caio"];
      const used = s.players.map(p => p.name);
      const name = names.find(n => !used.includes(n)) || "Bot " + s.players.length;
      const colors = ["av-yellow", "av-green", "av-blue", "av-red"];
      s.players.push({
        id: "p" + s.players.length, name, bot: true, connected: true,
        hand: [], score: 0, uno: false, declaredUno: false,
        av: colors[s.players.length % colors.length]
      });
      this.log(name + " entrou (bot)", "good");
      this.fire();
    },

    delBot() {
      const s = this.state;
      if (s.phase !== "lobby" || s.players.length <= 2) return;
      for (let i = s.players.length - 1; i >= 1; i--) {
        if (s.players[i].bot) { this.log(s.players[i].name + " saiu", null); s.players.splice(i, 1); break; }
      }
      this.fire();
    },

    removePlayer(idx) {
      const s = this.state;
      if (!s || idx < 0 || idx >= s.players.length) return;
      const wasTurn = s.turn === idx;
      const leaving = s.players[idx].name;
      s.players.splice(idx, 1);
      this.log(leaving + " saiu da mesa", "bad");
      if (s.players.length < 2) {
        this.clearTimers();
        s.phase = "lobby";
        s.turn = 0;
        s.grace = null;
        this.fire();
        return;
      }
      if (s.phase === "playing") {
        if (idx < s.turn) s.turn -= 1;
        else if (wasTurn) {
          if (s.dir === -1) {
            s.turn -= 1;
            if (s.turn < 0) s.turn = s.players.length - 1;
          } else if (s.turn >= s.players.length) {
            s.turn = 0; // era o último da volta
          }
          s.drawnThisTurn = false;
        }
        if (s.grace && s.grace.seat === idx) { clearTimeout(s.grace.timer); s.grace = null; }
        else if (s.grace && s.grace.seat > idx) s.grace.seat -= 1;
        this.startTurnTimer();
        this.scheduleBot();
      } else if (s.phase === "roundover" || s.phase === "matchover") {
        if (idx < s.turn) s.turn = Math.max(0, s.turn - 1);
        if (s.winner === idx) s.winner = 0; // anfitrião assume o papel de "próxima rodada"
        else if (s.winner !== null && s.winner > idx) s.winner -= 1;
      }
      this.fire();
    },

    clearTurnTimer() {
      if (this.turnTimer) clearTimeout(this.turnTimer);
      this.turnTimer = null;
    },

    startTurnTimer() {
      const s = this.state;
      this.clearTurnTimer();
      if (!s || s.phase !== "playing" || s.turn === null) return;
      const seat = s.turn;
      s.turnStartedAt = Date.now();
      s.turnLimit = this.TURN_LIMIT_MS;
      this.turnTimer = setTimeout(() => {
        if (this.state !== s) return;
        if (s.phase !== "playing" || s.turn !== seat) return;
        this.autoPlay(seat);
      }, this.TURN_LIMIT_MS);
    },

    /* o jogador demorou mais de 10s: joga a melhor carta ou compra e passa */
    autoPlay(seat) {
      const s = this.state;
      if (!s || s.phase !== "playing" || s.turn !== seat) return;
      const p = s.players[seat];
      if (!p) return;
      const pick = botPick(p.hand, s.top, s.color);
      if (pick) {
        const color = (pick.kind === "wild" || pick.kind === "wild4") ? botChooseColor(p.hand) : null;
        this.act(seat, { k: "play", id: pick.id, color: color });
      } else {
        this.act(seat, { k: "draw" }); // compra e passa automaticamente
      }
    },

    /* ---------- rodada ---------- */
    startRound() {
      const s = this.state;
      this.clearTimers();
      s.phase = "playing";
      // relógio de 5 min da partida: continua de onde parou entre rodadas
      if (!this.gameTimer) this.startGameTimer();
      s.dir = 1;
      s.color = null;
      s.top = null;
      s.drawnThisTurn = false;
      s.grace = null;
      s.winner = null;
      s.roundPts = null;
      s.draw = shuffle(buildDeck());
      s.discard = [];
      for (const p of s.players) { p.hand = []; p.uno = false; p.declaredUno = false; }
      for (let i = 0; i < 7; i++) {
        for (const p of s.players) p.hand.push(s.draw.pop());
      }
      // primeira carta: sem curinga — as sorteadas voltam pro baralho (senão somem: 107 cartas)
      let first;
      const bounced = [];
      do {
        first = s.draw.pop();
        if (first.kind === "wild" || first.kind === "wild4") bounced.push(first);
      } while (first.kind === "wild" || first.kind === "wild4");
      if (bounced.length) s.draw = shuffle(s.draw.concat(bounced));
      s.discard.push(first);
      s.top = first;
      s.color = first.color;
      s.topRot = Math.round(Math.random() * 24 - 12);
      s.turn = Math.floor(Math.random() * s.players.length);
      s.last = { kind: "start", text: "rodada " + s.round + " começou" };
      this.log("rodada " + s.round + " — boa sorte!", "good");
      this.startTurnTimer();
      this.fire();
      this.scheduleBot();
    },

    /* rastreia se o convidado já aprovou o início */
    act(seat, a) {
      const s = this.state;
      if (!s) return;
      if (a.k === "start") {
        // modo local: anfitrião pode começar sozinho
        if (s.mode === "local" && seat === 0 && s.players.length >= 2) { s.round = 1; for (const p of s.players) p.score = 0; this.startRound(); return; }
        // multiplayer: inicia se houver 2 jogadores humanos (host + guest real)
        if (s.phase === "lobby" && s.players.length >= 2 && seat === 0) {
      // conta jogadores humanos (não-bot)
      const humanos = s.players.filter(p => !p.bot).length;
      if (humanos >= 2) {
        // ambos presentes: pode começar imediatamente
        s.round = 1; for (const p of s.players) p.score = 0; this.startRound();
      } else if (humanos === 1) {
        // apenas host humano: marcarei consentimento e aguarda guest se juntar
        if (!s.consensoHost) s.consensoHost = true;
        if (s.consensoHost && s.consensoGuest) {
          s.round = 1; for (const p of s.players) p.score = 0; this.startRound();
        }
      }
      return;
        }
        return;
      }
      if (a.k === "bot" && seat === 0 && s.phase === "lobby") return this.addBot();
      if (a.k === "botDel" && seat === 0 && s.phase === "lobby") return this.delBot();
      if (a.k === "nextRound") {
        // o vencedor da rodada ou o anfitrião (seat 0) avança — bots não apertam botão
        if (s.phase === "roundover" && (seat === 0 || seat === s.winner)) this.startRoundNext();
        return;
      }
      if (a.k === "rematch") {
        if (s.phase === "matchover" && seat === 0) { s.round = 1; for (const p of s.players) p.score = 0; this.startRound(); }
        return;
      }
      if (a.k === "backToLobby") {
        if (s.phase === "matchover" && seat === 0) this.backToLobby();
        return;
      }
      // UNO pode ser declarado fora da própria vez (a janela de carência continua)
      if (a.k === "uno") {
        if (s.phase !== "playing") return;
        return this.declareUno(seat);
      }
      if (s.phase !== "playing" || seat !== s.turn) return;

      if (a.k === "play") return this.playCard(seat, a.id, a.color);
      if (a.k === "draw") return this.drawCard(seat);
    },

    startRoundNext() {
      this.state.round += 1;
      this.startRound();
    },

    /* volta ao lobby da sala (mantém jogadores, zera placar e cartas) */
    backToLobby() {
      const s = this.state;
      if (!s) return;
      this.clearTimers();
      this.clearGameTimer();
      s.phase = "lobby";
      s.round = 1;
      s.turn = 0;
      s.dir = 1;
      s.color = null;
      s.top = null;
      s.draw = [];
      s.discard = [];
      s.drawnThisTurn = false;
      s.turnStartedAt = null;
      s.grace = null;
      s.winner = null;
      s.roundPts = null;
      s.last = null;
      s.log = [];
      s.consensoHost = false;
      s.consensoGuest = false;
      for (const p of s.players) {
        p.hand = [];
        p.score = 0;
        p.uno = false;
        p.declaredUno = false;
      }
      this.log("de volta à sala — preparem-se!", "good");
      this.fire();
    },

    playCard(seat, cardId, chosenColor) {
      const s = this.state;
      const p = s.players[seat];
      const idx = p.hand.findIndex(c => c.id === cardId);
      if (idx < 0) return this.reject(seat);
      const card = p.hand[idx];
      if (!isPlayable(card, s.top, s.color, p.hand)) return this.reject(seat);

      // curinga exige cor válida
      const wild = card.kind === "wild" || card.kind === "wild4";
      if (wild && COLORS.indexOf(chosenColor) < 0) return this.reject(seat);

      p.hand.splice(idx, 1);
      s.discard.push(card);
      s.top = card;
      s.topRot = Math.round(Math.random() * 24 - 12);
      s.color = wild ? chosenColor : card.color;
      s.drawnThisTurn = false;

      const who = p.name;
      const label = cardLabel(card);
      let kind = "play";
      this.log(who + " jogou " + (wild ? label + " (" + COLOR_PT[s.color] + ")" : label), "good");

      let advance = 1;
      const n = s.players.length;

      if (card.kind === "skip") {
        kind = "skip";
        advance = 2;
        this.log(s.players[this.seatAt(seat, 1)].name + " foi bloqueado(a)", "bad");
      } else if (card.kind === "reverse") {
        kind = "reverse";
        s.dir *= -1;
        if (n === 2) { advance = 2; this.log("inversão: " + s.players[this.seatAt(seat, 1)].name + " foi pulado(a)", "bad"); }
        else this.log("sentido invertido!", null);
      } else if (card.kind === "draw2") {
        kind = "penalty";
        advance = 2;
        const victim = this.seatAt(seat, 1);
        this.give(victim, 2);
        this.log(s.players[victim].name + " comprou 2 e perdeu a vez", "bad");
      } else if (card.kind === "wild4") {
        kind = "penalty";
        advance = 2;
        const victim = this.seatAt(seat, 1);
        this.give(victim, 4);
        this.log(s.players[victim].name + " comprou 4 e perdeu a vez", "bad");
      } else if (wild) {
        kind = "wild";
        this.log("cor definida: " + COLOR_PT[s.color], null);
      }

      s.last = { kind: kind, text: this.eventText(kind, who) };

      // UNO
      if (p.hand.length === 1) {
        if (p.declaredUno) {
          p.uno = true;
          p.declaredUno = false;
          this.log(who + " falou UNO!", "good");
        } else if (p.bot) {
          if (Math.random() < 0.9) {
            p.uno = true;
            this.log(who + " falou UNO!", "good");
          } else {
            this.setGrace(seat, 2200, who + " esqueceu de falar UNO");
          }
        } else {
          this.setGrace(seat, 5000, null); // janela pra apertar o botão
        }
      } else {
        p.uno = false;
        p.declaredUno = false;
      }

      // fim de rodada
      if (p.hand.length === 0) return this.endRound(seat, card);

      this.turnAdvance(advance);
      this.fire();
      this.scheduleBot();
    },

    drawCard(seat) {
      const s = this.state;
      if (s.phase !== "playing" || s.turn !== seat) return this.reject(seat);
      if (s.drawnThisTurn) return this.reject(seat);
      const p = s.players[seat];
      const card = this.takeOne();
      if (!card) {
        // baralho e descarte esgotados: não há o que comprar, passa a vez
        s.drawnThisTurn = false;
        s.last = { kind: "pass", text: p.name + " não tinha carta para comprar" };
        this.log(p.name + " não tinha carta para comprar — vez passada", null);
        this.turnAdvance(1);
        this.fire();
        this.scheduleBot();
        return;
      }
      p.hand.push(card);
      s.drawnThisTurn = false;
      s.last = { kind: "draw", text: p.name + " comprou e passou" };
      this.log(p.name + " comprou uma carta e passou a vez", null);
      p.uno = false;
      p.declaredUno = false;
      this.turnAdvance(1); // comprou: passa automaticamente (sem chance de jogar a comprada)
      this.fire();
      this.scheduleBot();
    },

    declareUno(seat) {
      const s = this.state;
      const p = s.players[seat];
      if (!p) return;
      const inGrace = !!(s.grace && s.grace.seat === seat);
      // pode gritar com 2 (antes de jogar) ou com 1 carta na mão (depois de jogar)
      if (!inGrace && p.hand.length !== 1 && p.hand.length !== 2) return this.reject(seat);
      if (p.uno) return; // já falou UNO nesta rodada
      if (inGrace) {
        // chegou a tempo: cancela a penalidade
        clearTimeout(s.grace.timer);
        s.grace = null;
      }
      p.uno = true;
      p.declaredUno = p.hand.length === 2; // pré-declarou: vale ao baixar para 1
      this.log(p.name + " falou UNO!", "good");
      Sfx.uno();
      this.fire();
    },

    /* ---------- auxiliares de estado ---------- */
    seatAt(seat, offset) {
      const n = this.state.players.length;
      return ((seat + offset * this.state.dir) % n + n) % n;
    },

    turnAdvance(steps) {
      const s = this.state;
      const n = s.players.length;
      s.turn = ((s.turn + steps * s.dir) % n + n) % n;
      s.drawnThisTurn = false;
      this.startTurnTimer(); // reinicia a contagem de 10s do próximo jogador
    },

    give(seat, count) {
      const s = this.state;
      for (let i = 0; i < count; i++) {
        const c = this.takeOne();
        if (c) s.players[seat].hand.push(c);
      }
      s.players[seat].uno = false;
      s.players[seat].declaredUno = false;
    },

    takeOne() {
      const s = this.state;
      if (!s.draw.length) {
        if (s.discard.length <= 1) return null;
        const top = s.discard.pop();
        s.draw = shuffle(s.discard);
        s.discard = [top];
      }
      return s.draw.pop();
    },

    setGrace(seat, ms, failMsg) {
      const s = this.state;
      if (s.grace) clearTimeout(s.grace.timer);
      const g = { seat: seat, until: Date.now() + ms, failMsg: failMsg, timer: null };
      g.timer = setTimeout(() => {
        if (this.state && this.state.grace === g) {
          const p = this.state.players[seat];
          if (p && p.hand.length === 1) {
            this.give(seat, 2);
            this.log(p.name + " não falou UNO — comprou 2!", "bad");
            this.state.last = { kind: "penalty", text: p.name + " pegou +2" };
            Sfx.penalty();
          }
          this.state.grace = null;
          this.fire();
        }
      }, ms);
      s.grace = g;
    },

    endRound(seat, lastCard) {
      const s = this.state;
      this.clearTimers();
      this.pauseGameTimer();
      s.grace = null;
      let pts = 0;
      for (const p of s.players) for (const c of p.hand) pts += cardPoints(c);
      s.players[seat].score += pts;
      s.winner = seat;
      s.roundPts = pts;
      s.phase = "roundover";
      s.last = { kind: "win", text: s.players[seat].name + " venceu a rodada" };
      this.log(s.players[seat].name + " venceu a rodada (+" + pts + " pts)", "good");

      if (s.players[seat].score >= TARGET) {
        this.clearGameTimer();
        s.phase = "matchover";
        this.log(s.players[seat].name + " venceu a partida!", "good");
        s.last = { kind: "match", text: s.players[seat].name + " venceu a partida" };
      }
      this.fire();
    },

    reject(seat) {
      Sfx.invalid();
      if (this.state && this.state.players[seat] === undefined) return;
      // sinaliza pro cliente local tremer a carta (só afeta quem tentou)
      this.onReject && this.onReject(seat);
    },

    eventText(kind, who) {
      switch (kind) {
        case "skip": return who + " bloqueou!";
        case "reverse": return "sentido invertido!";
        case "penalty": return "carta de penalidade!";
        case "wild": return "curinga!";
        case "start": return "rodada começou";
        default: return who + " jogou";
      }
    },

    log(text, cls) {
      const s = this.state;
      if (!s) return;
      s.log.unshift({ t: text, c: cls || null, id: Math.random() });
      if (s.log.length > 30) s.log.pop();
    },

    /* ---------- bots ---------- */
    scheduleBot() {
      const s = this.state;
      if (!s || s.phase !== "playing") return;
      const p = s.players[s.turn];
      if (!p || !p.bot) return;
      const seat = s.turn;
      const delay = 750 + Math.random() * 700;
      const t = setTimeout(() => {
        if (this.state.phase !== "playing" || this.state.turn !== seat) return;
        this.botTurn(seat);
      }, delay);
      this.timers.push(t);
    },

    botTurn(seat) {
      const s = this.state;
      if (!s || s.phase !== "playing" || s.turn !== seat) return;
      const p = s.players[seat];
      const pick = botPick(p.hand, s.top, s.color);
      if (pick) {
        const color = (pick.kind === "wild" || pick.kind === "wild4") ? botChooseColor(p.hand) : null;
        this.act(seat, { k: "play", id: pick.id, color: color });
      } else {
        this.act(seat, { k: "draw" }); // compra e passa automaticamente
      }
    },

    clearTimers() {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      if (this.state && this.state.grace) {
        clearTimeout(this.state.grace.timer);
        this.state.grace = null;
      }
      this.clearTurnTimer();
    },

    clearGameTimer() {
      if (this.gameTimer) clearTimeout(this.gameTimer);
      this.gameTimer = null;
      this.gameStartTime = null;
      this.gameRemaining = null;
    },

    gameTimeLeft() {
      if (this.gameStartTime) {
        return Math.max(0, (this.gameRemaining == null ? this.GAME_TIME_MS : this.gameRemaining) - (Date.now() - this.gameStartTime));
      }
      return this.gameRemaining == null ? null : this.gameRemaining;
    },

    pauseGameTimer() {
      if (!this.gameTimer) return;
      this.gameRemaining = this.gameTimeLeft();
      clearTimeout(this.gameTimer);
      this.gameTimer = null;
      this.gameStartTime = null;
    },

    startGameTimer() {
      const s = this.state;
      if (!s || s.phase !== "playing") return;
      if (this.gameRemaining == null) this.gameRemaining = this.GAME_TIME_MS;
      if (this.gameTimer) clearTimeout(this.gameTimer);
      this.gameStartTime = Date.now();
      this.gameTimer = setTimeout(() => {
        this.gameTimer = null;
        this.gameStartTime = null;
        this.endGameByTime();
      }, Math.max(0, this.gameRemaining));
    },

    endGameByTime() {
      const s = this.state;
      if (!s) return;
      this.clearGameTimer();
      let minCards = Infinity;
      for (const p of s.players) minCards = Math.min(minCards, p.hand.length);
      const leaders = s.players.filter(p => p.hand.length === minCards);
      this.clearTimers();
      s.phase = "matchover";
      if (leaders.length === 1) {
        const winnerSeat = s.players.indexOf(leaders[0]);
        s.winner = winnerSeat;
        s.last = { kind: "match", text: leaders[0].name + " venceu por tempo! (menos cartas)" };
        this.log(leaders[0].name + " venceu por tempo! (menos cartas)", "good");
      } else {
        s.winner = null;
        const nomes = leaders.map(p => p.name).join(", ");
        s.last = { kind: "match", text: "Empate por tempo! " + nomes + " com " + minCards + " cartas." };
        this.log("Empate por tempo! " + nomes + " com " + minCards + " cartas.", "good");
      }
      this.fire();
    },
    /* ---------- máscara por espectador (não vaza mão dos outros) ---------- */
    mask(viewer) {
      const s = this.state;
      if (!s) return null;
      return {
        phase: s.phase,
        round: s.round,
        dir: s.dir,
        turn: s.turn,
        color: s.color,
        top: s.top,
        topRot: s.topRot,
        pile: s.draw.length,
        discardN: s.discard.length,
        drawnThisTurn: s.turn === viewer ? s.drawnThisTurn : false,
        timeLeft: this.gameTimeLeft(),
        turnLeft: (s.phase === "playing" && s.turnStartedAt)
          ? Math.max(0, this.TURN_LIMIT_MS - (Date.now() - s.turnStartedAt))
          : null,
        turnLimit: this.TURN_LIMIT_MS,
        grace: s.grace && s.grace.seat === viewer
          ? Math.max(0, s.grace.until - Date.now()) : null,
        winner: s.winner,
        roundPts: s.roundPts,
        target: TARGET,
        me: viewer,
        players: s.players.map((p, i) => ({
          i: i,
          name: p.name,
          bot: p.bot,
          connected: p.connected,
          score: p.score,
          uno: p.uno,
          av: p.av || null,
          hand: i === viewer ? p.hand : null,
          count: p.hand.length
        })),
        log: s.log.slice(0, 10),
        last: s.last
      };
    },

    fire() {
      if (this.emit) this.emit();
    }
  };

  global.UNO = {
    Game, COLORS, COLOR_PT, TARGET, MAX_PLAYERS,
    isPlayable, cardPoints, cardLabel, botChooseColor, shuffle, buildDeck
  };
})(window);
