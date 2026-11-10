/* ui.js — renderização da mesa: máscara de estado → DOM, sons por transição, modais */
/* linguagem: JavaScript, arquivo: js/ui.js, runtime: navegador */

(function (global) {
  "use strict";

  const AV = ["av-red", "av-yellow", "av-green", "av-blue"];
  const $ = id => document.getElementById(id);

  const UI = {
    prev: null,
    pendingWild: null,   // id da curinga aguardando escolha de cor
    bannerTimer: null,
    graceEnd: 0,
    seenLog: new Set(),
    dealtRound: -1,

    /* ---------- telas ---------- */
    screen(name) {
      for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
      $("screen-" + name).classList.add("active");
      this.seenLog.clear();
      this.prev = null;
    },

    toast(msg, ms) {
      const t = $("toast");
      t.textContent = msg;
      t.classList.remove("hidden");
      clearTimeout(this._toast);
      this._toast = setTimeout(() => t.classList.add("hidden"), ms || 2600);
    },

    info(title, msg) {
      $("info-title").textContent = title;
      $("info-text").textContent = msg;
      $("modal-info").classList.remove("hidden");
    },

    /* ---------- lobbi ---------- */
    lobby(kind, m) {
      // kind: 'local' | 'host' | 'guest'
      const players = m.players;
      $("lobby-title").textContent =
        kind === "local" ? "contra o computador" : kind === "host" ? "sua sala" : "sala";
      $("lobby-code-block").classList.toggle("hidden", kind === "local");
      if (kind !== "local") {
        $("room-code").textContent = m.code || "------";
      }
      if (kind === "guest") {
        $("wait-code").textContent = m.code || "------";
      }
      $("bt-copy").classList.toggle("hidden", kind !== "host");
      $("bt-start").classList.toggle("hidden", kind === "guest");
      $("bt-bot-add").classList.toggle("hidden", kind !== "local" && kind !== "host");
      $("bt-bot-del").classList.toggle("hidden", kind !== "local" && kind !== "host");

      const box = kind === "guest" ? $("wait-players") : $("lobby-players");
      const other = kind === "guest" ? $("lobby-players") : $("wait-players");
      other.innerHTML = "";
      box.innerHTML = "";
      players.forEach((p, i) => {
        const chip = document.createElement("div");
        chip.className = "seat-chip";
        const av = document.createElement("div");
        av.className = "avatar " + (p.av || AV[i % 4]);
        av.textContent = (p.name || "?").charAt(0).toUpperCase();
        const txt = document.createElement("div");
        const nm = document.createElement("div");
        nm.className = "s-name";
        nm.textContent = p.name + (i === 0 ? " (anfitrião)" : "");
        const tg = document.createElement("div");
        tg.className = "s-tag";
        tg.textContent = p.bot ? "bot" : i === 0 ? "você" : "online";
        txt.appendChild(nm);
        txt.appendChild(tg);
        chip.appendChild(av);
        chip.appendChild(txt);
        if (p.bot && (kind === "local" || kind === "host") && players.length > 2) {
          const del = document.createElement("button");
          del.className = "s-del";
          del.textContent = "×";
          del.title = "remover bot";
          del.onclick = () => global.main.act({ k: "botDel" });
          chip.appendChild(del);
        }
        box.appendChild(chip);
      });
      for (let i = players.length; i < 4; i++) {
        const e = document.createElement("div");
        e.className = "seat-empty";
        e.textContent = "vaga livre";
        box.appendChild(e);
      }

      const enough = players.length >= 2;
      $("bt-start").disabled = !enough;
      $("bt-bot-add").disabled = players.length >= 4;
      $("bt-bot-del").disabled = players.length <= 2;
      const hint = kind === "guest"
        ? "aguardando o anfitrião iniciar a partida…"
        : enough
          ? "pronto — pode começar (" + players.length + " jogadores)"
          : "aguardando jogadores… mínimo 2";
      if (kind === "guest") $("waiting-hint").textContent = hint;
      else $("lobby-hint").textContent = hint;
    },

    /* ---------- mesa ---------- */
    render(m) {
      if (!m) return;
      const prev = this.prev;
      const me = m.me;
      const myTurn = m.phase === "playing" && m.turn === me;

      /* --- transições de som --- */
      if (prev) {
        if (prev.phase !== "playing" && m.phase === "playing") {
          Sfx.deal();
          this.dealtRound = m.round;
        }
        if (prev.phase === "playing" && (m.phase === "roundover" || m.phase === "matchover")) {
          const win = m.winner === me;
          win ? Sfx.win() : Sfx.lose();
        }
        if (prev.top && m.top && prev.top.id !== m.top.id && prev.phase === "playing") {
          Sfx.place();
        }
        if (prev.turn !== m.turn && m.phase === "playing") {
          this.banner(m.players[m.turn] ? m.players[m.turn].name : "", m.turn === me);
          if (m.turn === me) Sfx.chime();
        }
        if (prev.last && m.last && prev.last !== m.last && prev.last.text !== m.last.text) {
          const k = m.last.kind;
          if (k === "skip") Sfx.skip();
          else if (k === "reverse") Sfx.reverse();
          else if (k === "penalty") Sfx.penalty();
          else if (k === "wild") Sfx.wild();
        }
        const myPrev = prev.players[me] ? prev.players[me].count : 0;
        const myNow = m.players[me] ? m.players[me].count : 0;
        if (m.phase === "playing" && myNow > myPrev && prev.phase === "playing") Sfx.draw();
      }

      /* --- HUD --- */
      $("hud-round").textContent = "rodada " + m.round;
      $("hud-target").textContent = "meta " + m.target;
      $("hud-dir").classList.toggle("ccw", m.dir === -1);
      const hudTurn = $("hud-turn");
      if (m.phase === "playing") {
        hudTurn.textContent = myTurn ? "sua vez" : "vez de " + m.players[m.turn].name;
        hudTurn.classList.toggle("mine", myTurn);
      } else if (m.phase === "roundover") {
        hudTurn.textContent = "rodada encerrada";
        hudTurn.classList.remove("mine");
      } else if (m.phase === "matchover") {
        hudTurn.textContent = "fim de jogo";
        hudTurn.classList.remove("mine");
      } else {
        hudTurn.textContent = "lobbi";
        hudTurn.classList.remove("mine");
      }

      /* --- cor atual --- */
      $("color-ring").className = "color-ring" + (m.color ? " c-" + m.color : "");

      /* --- pilha de compra --- */
      $("pile-count").textContent = m.pile;
      $("draw-pile").classList.toggle("disabled", !myTurn || m.drawnThisTurn);

      /* --- descarte --- */
      const disc = $("discard-pile");
      if (m.top) {
        const rot = "rotate(" + (m.topRot || 0) + "deg)";
        if (disc.dataset.id !== m.top.id) {
          disc.innerHTML = "";
          disc.appendChild(cardEl(m.top));
          disc.dataset.id = m.top.id;
        }
        disc.firstChild.style.transform = rot;
        $("top-label").textContent = topLabel(m);
      } else {
        disc.innerHTML = "";
        disc.dataset.id = "";
        $("top-label").textContent = "";
      }

      /* --- oponentes --- */
      this.opponents(m);

      /* --- minha mão --- */
      this.hand(m, myTurn, prev);

      /* --- botões de turno --- */
      $("bt-draw").disabled = !myTurn || m.drawnThisTurn;
      $("bt-pass").disabled = !myTurn || !m.drawnThisTurn;

      const mine = m.players[me];
      const unoBtn = $("bt-uno");
      unoBtn.disabled = !(mine && ((mine.hand && mine.hand.length === 2) || m.grace != null));

      /* --- janela do UNO --- */
      const ut = $("uno-timer");
      if (m.grace != null) {
        this.graceEnd = Date.now() + m.grace;
        ut.classList.remove("hidden");
        unoBtn.disabled = false;
      } else {
        ut.classList.add("hidden");
      }

      /* --- meu canto --- */
      $("my-name").textContent = mine ? mine.name : "você";
      $("my-score").textContent = (mine ? mine.score : 0) + " pts";
      const mav = $("my-avatar");
      mav.className = "avatar " + (mine && mine.av ? mine.av : AV[me % 4]);
      mav.textContent = mine ? mine.name.charAt(0).toUpperCase() : "?";
      mav.parentElement.classList.toggle("current", myTurn);

      /* --- log --- */
      this.logLines(m);

      /* --- modais de fim --- */
      if (m.phase === "roundover") this.roundModal(m);
      else $("modal-round").classList.add("hidden");
      if (m.phase === "matchover") this.matchModal(m);

      this.prev = m;
    },

    opponents(m) {
      const box = $("opponents");
      const me = m.me;
      const order = [];
      for (let k = 1; k < m.players.length; k++) order.push((me + k) % m.players.length);
      const prevIds = Array.from(box.children).map(el => el.dataset.pid).join(",");
      const nowIds = order.join(",");
      if (prevIds !== nowIds || box.children.length !== order.length) {
        box.innerHTML = "";
        for (const i of order) {
          const p = m.players[i];
          const d = document.createElement("div");
          d.className = "opponent";
          d.dataset.pid = i;
          d.innerHTML =
            '<div class="o-cards">' +
            '<div class="mini"></div><div class="mini"></div><div class="mini"></div>' +
            '<span class="o-count">0</span></div>' +
            '<div class="avatar ' + (p.av || AV[i % 4]) + '">' + esc(p.name.charAt(0).toUpperCase()) + "</div>" +
            '<div class="o-name">' + esc(p.name) + "</div>" +
            '<div class="o-score">0 pts</div>' +
            '<span class="o-uno hidden">UNO!</span>' +
            '<span class="o-left hidden">caiu</span>';
          box.appendChild(d);
        }
      }
      order.forEach((i, k) => {
        const p = m.players[i];
        const el = box.children[k];
        if (!el) return;
        el.classList.toggle("current", m.phase === "playing" && m.turn === i);
        el.querySelector(".o-count").textContent = p.count;
        el.querySelector(".o-score").textContent = p.score + " pts";
        el.querySelector(".o-uno").classList.toggle("hidden", !p.uno || p.count !== 1);
        el.querySelector(".o-left").classList.toggle("hidden", p.connected !== false);
        el.querySelector(".avatar").classList.toggle("disconnected", p.connected === false);
      });
    },

    hand(m, myTurn, prev) {
      const box = $("my-hand");
      const mine = m.players[m.me];
      const cards = (mine && mine.hand) || [];
      const n = cards.length;
      const mid = (n - 1) / 2;
      const overlap = n > 13 ? -46 : n > 8 ? -36 : -26;
      const roundKey = m.phase + ":" + m.round + ":" + n;
      const fresh = this.dealtRound === m.round && (!prev || prev.phase !== "playing");

      if (box.dataset.key !== roundKey) {
        box.dataset.key = roundKey;
        box.innerHTML = "";
        cards.forEach((c, i) => {
          const slot = document.createElement("div");
          slot.className = "card-slot";
          slot.dataset.id = c.id;
          slot.style.zIndex = i + 1;
          slot.style.marginLeft = i ? overlap + "px" : "0";
          const rot = (i - mid) * 1.7;
          const lift = Math.pow(Math.abs(i - mid), 1.7) * 1.15;
          slot.style.transform = "rotate(" + rot.toFixed(2) + "deg) translateY(" + lift.toFixed(1) + "px)";
          slot.appendChild(cardEl(c));
          if (fresh) {
            slot.classList.add("dealt");
            slot.style.animationDelay = (i * 45) + "ms";
          }
          slot.addEventListener("click", () => this.cardClick(c.id, m));
          box.appendChild(slot);
        });
      }

      // estado jogável / esmaecido a cada mutação (mão pode mudar sem recriar nós)
      const playableMap = {};
      for (const c of cards) playableMap[c.id] = global.UNO.isPlayable(c, m.top, m.color, cards);
      for (const slot of box.children) {
        const ok = playableMap[slot.dataset.id];
        slot.classList.toggle("playable", !!ok && myTurn);
        slot.classList.toggle("dim", !ok || !myTurn);
      }
    },

    cardClick(id, m) {
      if (m.phase !== "playing" || m.turn !== m.me) { this.shake(id); Sfx.invalid(); return; }
      const mine = m.players[m.me];
      const card = mine.hand.find(c => c.id === id);
      if (!card || !global.UNO.isPlayable(card, m.top, m.color, mine.hand)) {
        this.shake(id); Sfx.invalid(); return;
      }
      if (card.kind === "wild" || card.kind === "wild4") {
        this.pendingWild = id;
        $("modal-color").classList.remove("hidden");
        Sfx.button();
        return;
      }
      global.main.act({ k: "play", id: id });
    },

    shake(id) {
      const slot = $('my-hand').querySelector('[data-id="' + id + '"]');
      if (!slot) return;
      slot.classList.remove("shake");
      void slot.offsetWidth;
      slot.classList.add("shake");
    },

    banner(text, mine) {
      const b = $("turn-banner");
      b.textContent = mine ? "sua vez!" : "vez de " + text;
      b.classList.toggle("red", !mine);
      b.classList.remove("hidden");
      clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => b.classList.add("hidden"), 1400);
    },

    logLines(m) {
      const box = $("log");
      const newest = [];
      for (const line of m.log) {
        if (this.seenLog.has(line.id)) break;
        newest.push(line);
      }
      if (newest.length) {
        this.seenLog.add(newest[0].id);
        for (const line of newest) {
          const d = document.createElement("div");
          d.className = "log-line" + (line.c ? " " + line.c : "");
          d.textContent = line.t;
          box.prepend(d);
          this.seenLog.add(line.id);
        }
        while (box.children.length > 6) box.lastChild.remove();
      }
    },

    roundModal(m) {
      $("modal-round").classList.remove("hidden");
      $("round-title").textContent = m.winner === m.me ? "você venceu a rodada!" :
        esc(m.players[m.winner].name) + " venceu a rodada";
      const list = $("round-list");
      list.innerHTML = "";
      const sorted = m.players.slice().sort((a, b) => b.score - a.score);
      sorted.forEach(p => {
        const row = document.createElement("div");
        row.className = "score-row" + (p.i === m.winner ? " winner" : "");
        row.innerHTML =
          '<span class="sr-left"><span class="avatar ' + (p.av || AV[p.i % 4]) + '">' +
          esc(p.name.charAt(0).toUpperCase()) + "</span>" +
          '<span class="sr-name">' + esc(p.name) + "</span>" +
          '<span class="sr-cards">' + p.count + " carta" + (p.count === 1 ? "" : "s") + "</span></span>" +
          '<span class="sr-pts">' + p.score + " pts" +
          (p.i === m.winner ? " (+" + m.roundPts + ")" : "") + "</span>";
        list.appendChild(row);
      });
      $("round-points").textContent = "cartas restantes valem pontos — quem zera leva a soma.";
      const btn = $("bt-next-round");
      btn.dataset.match = "";
      const canNext = m.me === 0 || m.me === m.winner;
      btn.disabled = !canNext;
      btn.textContent = canNext ? "próxima rodada" : "aguardando " + m.players[0].name;
    },

    matchModal(m) {
      // reusa o modal de rodada com título de partida
      this.roundModal(m);
      $("round-title").textContent = m.winner === m.me ? "você venceu a partida!" :
        esc(m.players[m.winner].name) + " venceu a partida";
      $("round-points").textContent = "placar final — meta de " + m.target + " pontos.";
      const btn = $("bt-next-round");
      btn.disabled = m.me !== 0;
      btn.textContent = m.me === 0 ? "novo jogo" : "aguardando " + m.players[0].name;
      btn.dataset.match = "1";
    },

    scoreboard(m) {
      const list = $("score-list");
      list.innerHTML = "";
      m.players.slice().sort((a, b) => b.score - a.score).forEach(p => {
        const row = document.createElement("div");
        row.className = "score-row";
        row.innerHTML =
          '<span class="sr-left"><span class="avatar ' + (p.av || AV[p.i % 4]) + '">' +
          esc(p.name.charAt(0).toUpperCase()) + "</span>" +
          '<span class="sr-name">' + esc(p.name) + "</span></span>" +
          '<span class="sr-pts">' + p.score + " pts</span>";
        list.appendChild(row);
      });
      $("modal-score").classList.remove("hidden");
    },

    /* relógio da janela do UNO */
    tick() {
      const ut = $("uno-timer");
      if (ut.classList.contains("hidden")) return;
      const left = Math.max(0, Math.ceil((this.graceEnd - Date.now()) / 1000));
      ut.textContent = left;
    }
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, ch =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function topLabel(m) {
    const c = m.top;
    if (!c) return "";
    const col = global.UNO.COLOR_PT[m.color] || "";
    if (c.kind === "wild" || c.kind === "wild4") return "curinga → " + col;
    return global.UNO.cardLabel(c) + " · " + (global.UNO.COLOR_PT[c.color] || "");
  }

  function cardEl(card) {
    const d = document.createElement("div");
    const kind = card.kind;
    const face = kind === "wild" || kind === "wild4" ? "wild" : card.color;
    d.className = "card " + face;
    let pip = "", corner = "";
    if (kind === "number") { pip = String(card.value); corner = pip; }
    else if (kind === "skip") { pip = "pip-skip"; corner = "\u2298"; }
    else if (kind === "reverse") { pip = "pip-reverse"; corner = "\u21C4"; }
    else if (kind === "draw2") { pip = "pip-draw2"; corner = "+2"; }
    else if (kind === "wild4") { pip = "pip-wild4"; corner = "+4"; }
    d.innerHTML =
      '<span class="corner c-tl">' + corner + "</span>" +
      '<div class="face"><div class="oval"><span class="pip ' + pip + '"></span></div></div>' +
      '<span class="corner c-br">' + corner + "</span>";
    return d;
  }

  global.UI = UI;
})(window);
