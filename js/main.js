/* main.js — fiação: capa → lobbi → mesa, despacho de ações local/online, convites */
/* linguagem: JavaScript, arquivo: js/main.js, runtime: navegador */

(function (global) {
  "use strict";

  const $ = id => document.getElementById(id);
  const AVS = ["av-red", "av-yellow", "av-green", "av-blue"];
  const Game = global.UNO.Game;

  let mode = null;       // 'local' | 'host' | 'guest'
  let curScreen = null;
  let lastMask = null;

  function go(name) {
    if (curScreen === name) return;
    closeChat(); // o chat não deve ficar aberto por cima de outra tela
    global.UI.screen(name);
    curScreen = name;
  }

  /* ---------- despacho de ações ---------- */
  function act(a) {
    if (!mode) return;
    if (mode === "guest") {
      if (a.k === "uno") global.Sfx.uno(); // o motor roda no anfitrião: som local
      global.Net.sendAction(a);
    } else {
      Game.act(Game.mySeat, a);
    }
  }

  /* ---------- render único (local/host) + retransmissão ---------- */
  function renderFlow(m) {
    if (!mode) return; // estado chegou antes do convidado ter assento
    lastMask = m;
    if (m.phase === "lobby") {
      go(mode === "guest" ? "waiting" : "lobby");
      global.UI.lobby(mode, { players: m.players, code: global.Net.code });
    } else {
      go("game");
      // semeia a transição: primeiro render da mesa parte de um estado de lobbi
      if (!global.UI.prev) {
        global.UI.prev = { phase: "lobby", players: m.players, top: null, turn: -1, last: null, grace: null };
      }
      global.UI.render(m);
    }
    if (global.Net.role === "host") {
      global.Net.broadcastState(seat => Game.mask(seat));
    }
  }

  Game.emit = () => renderFlow(Game.mask(Game.mySeat));
  // motor recusou uma ação (fora de vez / carta inválida) — avisa o jogador
  Game.onReject = () => global.Sfx.invalid();

  /* ---------- sair pro cobertor ---------- */
  function leaveToCover(msg) {
    Game.clearTimers();
    Game.clearGameTimer();
    if (global.Voice) global.Voice.reset();
    global.Net.closeAll();
    Game.state = null;
    mode = null;
    lastMask = null;
    global.UI.clock = null;
    go("cover");
    closeChat();
    clearChatBadge();
    $("modal-color").classList.add("hidden");
    $("modal-round").classList.add("hidden");
    $("modal-score").classList.add("hidden");
    if (msg) global.UI.toast(msg);
  }

  /* ---------- nome (fonte única: capa + perfil) ---------- */
  const inName = $("in-name");
  const cleanName = v => String(v || "").replace(/[<>]/g, "").trim().slice(0, 14);
  function playerName() {
    const perfil = $("in-profile-name");
    const n = cleanName(inName.value) || cleanName(perfil && perfil.value) || "Jogador";
    localStorage.setItem("uno_name", n);
    localStorage.setItem("uno_profile_name", n);
    inName.value = n;
    if (perfil) perfil.value = n;
    return n;
  }
  const savedName = cleanName(localStorage.getItem("uno_name")) || cleanName(localStorage.getItem("uno_profile_name"));
  if (savedName) {
    inName.value = savedName;
    if ($("in-profile-name")) $("in-profile-name").value = savedName;
  }
  inName.addEventListener("change", () => playerName());

  /* ---------- perfil ---------- */
  const profWins = Number(localStorage.getItem("uno_wins") || 0);
  const profGames = Number(localStorage.getItem("uno_games") || 0);
  const profAvatar = localStorage.getItem("uno_avatar") || "av-red";
  const profName = localStorage.getItem("uno_profile_name") || localStorage.getItem("uno_name") || "";

  $("profile-wins").textContent = profWins;
  $("profile-games").textContent = profGames;
  document.querySelectorAll(".avatar-btn").forEach(b => {
    b.classList.toggle("selected", b.dataset.avatar === profAvatar);
  });
  $("in-profile-name").value = profName;

  $("bt-profile-save").addEventListener("click", () => {
    const name = cleanName($("in-profile-name").value) || "Jogador";
    const avatar = document.querySelector(".avatar-btn.selected")?.dataset.avatar || "av-red";
    localStorage.setItem("uno_profile_name", name);
    localStorage.setItem("uno_name", name);
    inName.value = name;
    localStorage.setItem("uno_avatar", avatar);
    localStorage.setItem("uno_wins", Number($("profile-wins").textContent));
    localStorage.setItem("uno_games", Number($("profile-games").textContent));
    global.UI.toast("perfil salvo: " + name + " (" + avatar + ")");
  });

  document.querySelectorAll(".avatar-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".avatar-btn").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
    });
  });

  function loadProfile() {
    if (profName) {
      $("in-name").value = profName;
      document.querySelectorAll("#my-avatar")[0].className = "avatar " + profAvatar;
    }
  }

  /* ---------- amigos ---------- */
  // carregar/ salvar amigos no localStorage
  const FRIENDS_KEY = "uno_friends";
  function loadFriends() {
    const raw = localStorage.getItem(FRIENDS_KEY);
    return raw ? JSON.parse(raw) : [];
  }
  function saveFriends(friends) {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
    renderFriendsList(friends);
  }
  // adicionar amigo (pelo código da sala ou nome)
  function addFriend(codeOrName, customName) {
    const friends = loadFriends();
    // verifica se já existe
    const exists = friends.find(f => f.code === codeOrName);
    if (exists) { global.UI.toast("já está na sua lista de amigos"); return; }
    // código tem que ter 6 chars; se for nome, vamos atribuir um code sintético
    const code = /^[A-Z0-9]{6}$/.test(codeOrName) ? codeOrName : "FRIE" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const name = customName || (codeOrName || "Amigo").slice(0, 14);
    friends.push({ code, name, online: false, avatar: avatars[Math.floor(Math.random() * avatars.length)], added: Date.now() });
    saveFriends(friends);
    global.UI.toast(name + " adicionado aos amigos!");
  }
  const avatars = ["av-red", "av-yellow", "av-green", "av-blue"];

  function renderFriendsList(friends) {
    const box = $("friends-list");
    if (!friends.length) {
      box.innerHTML = '<div style="color: rgba(255,255,255,.5); font-size: 14px; padding: 20px;">nenhum amigo ainda — adicione um código de 6 caracteres ou um nome</div>';
      return;
    }
    box.innerHTML = friends.map(f => {
      const onlineClass = f.online ? "online" : "offline";
      return `<div class="friend-card" data-code="${f.code}">
        <div class="friend-avatar ${f.avatar}"></div>
        <div class="friend-info">
          <div class="friend-name">${f.name}</div>
          <div class="friend-status ${onlineClass}">${f.online ? "online" : "offline"}</div>
        </div>
        <div class="friend-actions">
          <button class="friend-btn-small" data-action="join">entrar</button>
          <button class="friend-btn-small" data-action="remove">remover</button>
        </div>
      </div>`;
    }).join("");
    // eventos
    box.querySelectorAll(".friend-card").forEach(card => {
      card.querySelector(".friend-btn-small[data-action='join']").addEventListener("click", () => {
        const code = card.dataset.code;
        $("in-code").value = code;
        $("bt-join").click();
      });
      card.querySelector(".friend-btn-small[data-action='remove']").addEventListener("click", () => {
        removeFriend(card.dataset.code);
      });
    });
  }
  function removeFriend(code) {
    let friends = loadFriends();
    friends = friends.filter(f => f.code !== code);
    saveFriends(friends);
    global.UI.toast("removido da lista de amigos");
  }

  // ao entrar, atualizar status dos amigos que já estão na sala
  function updateFriendsOnline(statusCodes) {
    const friends = loadFriends();
    friends.forEach(f => f.online = statusCodes.includes(f.code));
    saveFriends(friends);
    renderFriendsList(friends);
  }

  /* ---------- capa ---------- */
  const hint = $("cover-hint");
  let joinMatch = /#join=([A-Za-z0-9]{4,10})/.exec(location.hash);
  if (joinMatch) {
    $("in-code").value = joinMatch[1].toUpperCase();
    $("join-panel").classList.remove("hidden");
    hint.textContent = "convite detectado — confira o código e entre";
  }

  $("bt-join-toggle").addEventListener("click", () => {
    global.Sfx.button();
    $("join-panel").classList.toggle("hidden");
    if (!$("join-panel").classList.contains("hidden")) $("in-code").focus();
  });

  $("bt-solo").addEventListener("click", () => {
    global.Sfx.unlock();
    global.Sfx.button();
    const name = playerName();
    const avatar = document.querySelector(".avatar-btn.selected")?.dataset.avatar || "av-red";
    localStorage.setItem("uno_avatar", avatar);
    mode = "local";
    Game.startLobby("local", name);
  });

  $("bt-create").addEventListener("click", () => {
    global.Sfx.unlock();
    global.Sfx.button();
    const name = playerName();
    const avatar = document.querySelector(".avatar-btn.selected")?.dataset.avatar || "av-red";
    localStorage.setItem("uno_avatar", avatar);
    const btn = $("bt-create");
    btn.disabled = true;
    btn.textContent = "abrindo sala…";
    global.Net.host(name, (err, code) => {
      btn.disabled = false;
      btn.textContent = "criar sala online";
      if (err) {
        global.UI.info("não abriu a sala", err.message + " — a partida local continua disponível.");
        return;
      }
      mode = "host";
      global.Sfx.join();
      Game.startLobby("host", name);
      global.UI.toast("sala aberta — código " + code);
    });
  });

  function doJoin(code) {
    const btn = $("bt-join");
    btn.disabled = true;
    btn.textContent = "entrando…";
    global.Net.guest(code, playerName(), (err, seat) => {
      btn.disabled = false;
      btn.textContent = "entrar";
      if (err) {
        global.UI.info("não foi possível entrar", err.message);
        return;
      }
      mode = "guest";
      global.Sfx.join();
      go("waiting");
      global.UI.toast("conectado! aguardando o anfitrião…");
      hint.textContent = "";
      joinMatch = null;
      // limpa o #join= pra um reload não tentar reentrar sozinho
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    });
  }

  $("bt-join").addEventListener("click", () => {
    global.Sfx.unlock();
    global.Sfx.button();
    const code = $("in-code").value.trim().toUpperCase();
    if (code.length < 4) {
      global.UI.info("código", "digite o código de 6 caracteres da sala.");
      return;
    }
    doJoin(code);
  });
  $("in-code").addEventListener("keydown", e => { if (e.key === "Enter") $("bt-join").click(); });
  $("in-name").addEventListener("keydown", e => { if (e.key === "Enter" && joinMatch) $("bt-join").click(); });

  // link de convite com nome salvo: entra direto, sem clicar em nada
  if (joinMatch && (localStorage.getItem("uno_name") || "").trim()) {
    $("join-panel").classList.add("hidden");
    hint.textContent = "entrando pela sala do convite…";
    setTimeout(() => doJoin(joinMatch[1].toUpperCase()), 80);
  }

  /* ---------- lobbi ---------- */
  $("bt-bot-add").addEventListener("click", () => { global.Sfx.button(); act({ k: "bot" }); });
  $("bt-bot-del").addEventListener("click", () => { global.Sfx.button(); act({ k: "botDel" }); });
  $("bt-start").addEventListener("click", () => { global.Sfx.button(); act({ k: "start" }); });
  $("bt-lobby-leave").addEventListener("click", () => leaveToCover());
  /* ---------- amigos: navegação e ações ---------- */
  let friendsReturn = "cover";
  function openFriends(from) {
    global.Sfx.button();
    friendsReturn = from || curScreen || "cover";
    renderFriendsList(loadFriends());
    go("friends");
  }
  $("bt-friends").addEventListener("click", () => openFriends(curScreen || "cover"));
  $("bt-friends-cover").addEventListener("click", () => openFriends("cover"));
  $("bt-friends-back").addEventListener("click", () => {
    global.Sfx.button();
    go(friendsReturn || "cover");
  });
  $("bt-add-friend").addEventListener("click", () => {
    global.Sfx.button();
    const v = $("in-add-friend").value.trim();
    if (!v) { global.UI.toast("digite um código de 6 caracteres ou um nome"); return; }
    addFriend(v.toUpperCase());
    $("in-add-friend").value = "";
  });
  $("in-add-friend").addEventListener("keydown", e => { if (e.key === "Enter") $("bt-add-friend").click(); });
  $("bt-wait-leave").addEventListener("click", () => leaveToCover());

  $("bt-copy").addEventListener("click", async () => {
    global.Sfx.button();
    const link = location.href.split("#")[0] + "#join=" + (global.Net.code || "");
    try {
      await navigator.clipboard.writeText(link);
      global.UI.toast("link de convite copiado!");
    } catch (_) {
      // clipboard API pode recusar em file:// — fallback com textarea
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        global.UI.toast("link de convite copiado!");
      } catch (e2) {
        global.UI.info("convite", "copie manualmente: " + link);
      }
      ta.remove();
    }
  });

  /* ---------- mesa ---------- */
  $("bt-draw").addEventListener("click", () => {
    global.Sfx.button();
    global.main.act({ k: "draw" });
    // após comprar, a vez passa automaticamente — o engine já controla drawnThisTurn
  });
  $("draw-pile").addEventListener("click", () => {
    if ($("draw-pile").classList.contains("disabled")) return;
    act({ k: "draw" });
  });
  $("bt-uno").addEventListener("click", () => act({ k: "uno" }));
  $("bt-exit").addEventListener("click", () => leaveToCover("você saiu da mesa"));

  $("bt-score").addEventListener("click", () => {
    global.Sfx.button();
    if (lastMask) global.UI.scoreboard(lastMask);
  });
  $("bt-score-close").addEventListener("click", () => {
    global.Sfx.button();
    $("modal-score").classList.add("hidden");
  });

  $("bt-next-round").addEventListener("click", () => {
    global.Sfx.button();
    act({ k: "nextRound" });
  });
  $("bt-new-game").addEventListener("click", () => {
    global.Sfx.button();
    act({ k: "rematch" });
  });
  $("bt-to-lobby").addEventListener("click", () => {
    global.Sfx.button();
    act({ k: "backToLobby" });
  });
  $("bt-to-cover").addEventListener("click", () => {
    global.Sfx.button();
    leaveToCover("você saiu do jogo");
  });

  /* ---------- cor do curinga ---------- */
  for (const b of document.querySelectorAll(".color-pick")) {
    b.addEventListener("click", () => {
      const id = global.UI.pendingWild;
      global.UI.pendingWild = null;
      $("modal-color").classList.add("hidden");
      if (id) { global.Sfx.colorSet(); act({ k: "play", id: id, color: b.dataset.color }); }
    });
  }

  /* ---------- regras ---------- */
  const showRules = () => { global.Sfx.button(); $("modal-rules").classList.remove("hidden"); };
  $("bt-rules").addEventListener("click", showRules);
  $("bt-rules2").addEventListener("click", showRules);
  $("bt-rules-close").addEventListener("click", () => {
    global.Sfx.button();
    $("modal-rules").classList.add("hidden");
  });
  $("bt-info-close").addEventListener("click", () => {
    global.Sfx.button();
    $("modal-info").classList.add("hidden");
  });

  /* ---------- som ---------- */
  function syncSound() {
    const on = global.Sfx.enabled;
    $("bt-sound").textContent = "som: " + (on ? "ligado" : "desligado");
    $("bt-sound2").textContent = on ? "som" : "som off";
  }
  const toggleSound = () => {
    global.Sfx.unlock();
    global.Sfx.enabled = !global.Sfx.enabled;
    if (global.Sfx.enabled) global.Sfx.button();
    syncSound();
  };
  $("bt-sound").addEventListener("click", toggleSound);
  $("bt-sound2").addEventListener("click", toggleSound);
  syncSound();

  /* ---------- rede: callbacks ---------- */
  global.Net.onPeerJoin = name => {
    const s = Game.state;
    if (!s || s.phase !== "lobby") return "a partida já começou";
    if (s.players.length >= 4) return "sala cheia — máximo 4 jogadores";
    const idx = s.players.length;
    const displayName = cleanName(name) || ("Jogador " + (idx + 1));
    s.players.push({
      id: "p" + idx,
      name: displayName,
      bot: false, connected: true,
      hand: [], score: 0, uno: false, declaredUno: false,
      av: AVS[idx % 4]
    });
    Game.log(displayName + " entrou na sala", "good");
    global.Sfx.join();
    Game.fire();
    return idx;
  };

  global.Net.onPeerLeave = seat => {
    if (!Game.state) return;
    global.Sfx.leave();
    Game.removePlayer(seat);
  };

  global.Net.onAction = (seat, a) => {
    if (!Game.state || !a) return;
    Game.act(seat, a);
  };

  global.Net.onState = m => renderFlow(m);

  global.Net.onClosed = () => {
    if (mode === "guest") leaveToCover("a sala foi encerrada");
  };

  global.Net.onError = e => {
    global.UI.toast("rede: " + ((e && (e.type || e.message)) || "erro"));
  };

  /* ---------- chat da sala + notificações ---------- */
  const CHAT_KEY = "uno_chat_msgs";
  const escChat = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const loadChatMessages = () => {
    try {
      const msgs = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
      return Array.isArray(msgs) ? msgs.slice(-100) : [];
    } catch (_) { return []; }
  };
  const saveChatMessages = msgs => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-100))); } catch (_) {}
  };
  const pushChatMessage = msg => {
    const msgs = loadChatMessages();
    msgs.push(msg);
    saveChatMessages(msgs);
    return msgs;
  };
  const renderChatMessages = msgs => {
    const area = $("chat-messages");
    if (!area) return;
    area.innerHTML = msgs.map(m =>
      '<div class="chat-line' + (m.own ? " own" : "") + '">' +
      '<span class="chat-time">' + escChat(m.time || "") + "</span>" +
      '<span class="chat-name">' + escChat(m.name || "Jogador") + "</span>: " +
      escChat(m.text || "") + "</div>"
    ).join("");
    const box = $("chat-area");
    if (box) box.scrollTop = box.scrollHeight;
  };

  let chatVisible = false;
  let chatUnread = 0;

  function chatNotifyEnabled() {
    return localStorage.getItem("uno_chat_notify") !== "off";
  }
  function clearChatBadge() {
    chatUnread = 0;
    const b = $("chat-badge");
    if (b) { b.classList.add("hidden"); b.textContent = "+0"; }
  }
  function bumpChatBadge() {
    chatUnread += 1;
    const b = $("chat-badge");
    if (!b) return;
    b.textContent = "+" + chatUnread;
    b.classList.remove("hidden");
    // reinicia a animação de entrada a cada mensagem
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "";
  }
  function openChat() {
    chatVisible = true;
    $("chat-modal").classList.remove("hidden");
    renderChatMessages(loadChatMessages());
    clearChatBadge();
    $("chat-input").focus();
  }
  function closeChat() {
    chatVisible = false;
    $("chat-modal").classList.add("hidden");
  }

  $("chat-btn").addEventListener("click", () => {
    global.Sfx.button();
    if (chatVisible) closeChat(); else openChat();
  });
  $("chat-close").addEventListener("click", () => { global.Sfx.button(); closeChat(); });

  const chatNotify = $("chat-notify");
  if (chatNotify) {
    chatNotify.checked = chatNotifyEnabled();
    chatNotify.addEventListener("change", () => {
      localStorage.setItem("uno_chat_notify", chatNotify.checked ? "on" : "off");
      if (!chatNotify.checked) clearChatBadge();
    });
  }

  function sendChat() {
    const input = $("chat-input");
    const text = input.value.trim();
    if (!text) return;
    const m = Game.state;
    const me = m ? m.players[m.me] : null;
    const name = me ? me.name : playerName();
    const av = (me && me.av) || "av-red";
    pushChatMessage({ name: name, text: text, av: av, time: new Date().toLocaleTimeString(), own: true });
    global.Net.sendChat(text, name, av);
    if (chatVisible) renderChatMessages(loadChatMessages());
    input.value = "";
    input.focus();
  }
  $("chat-send").addEventListener("click", () => { global.Sfx.button(); sendChat(); });
  $("chat-input").addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });

  global.Net.onChat = msg => {
    const line = {
      name: msg.name || "Jogador",
      text: msg.text || "",
      av: msg.av || "av-red",
      time: new Date().toLocaleTimeString(),
      own: false
    };
    pushChatMessage(line);
    if (chatVisible) {
      renderChatMessages(loadChatMessages());
    } else if (chatNotifyEnabled()) {
      bumpChatBadge();
      global.Sfx.chat();
    }
  };

  /* ---------- voz real entre jogadores (WebRTC + sinalização MQTT) ---------- */
  const Voice = {
    active: false,
    stream: null,
    peers: new Map(),   // cid -> {pc, audio, pending, remoteSet}
    users: new Map(),   // cid -> nome de quem está com o microfone ligado

    supported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    },

    async toggle() {
      if (!global.Net.role || !global.Net.client) {
        global.UI.toast("a voz só funciona em sala online — crie ou entre em uma sala");
        return;
      }
      if (this.active) {
        this.stop();
        global.UI.toast("microfone desligado");
        return;
      }
      if (!this.supported()) {
        global.UI.toast("este navegador não suporta voz (WebRTC)");
        return;
      }
      if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        global.UI.toast("o microfone exige HTTPS — abra o site publicado");
        return;
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
      } catch (e) {
        global.UI.toast(e && e.name === "NotAllowedError"
          ? "permissão de microfone negada — libere no navegador"
          : "não foi possível acessar o microfone");
        return;
      }
      this.active = true;
      const btn = $("voice-btn");
      if (btn) { btn.classList.add("on"); btn.textContent = "🎙️"; }
      global.UI.toast("microfone ligado — fale com os jogadores");
      global.Net.voicePublishUser(playerName(), true);
      for (const cid of Array.from(this.users.keys())) this.maybeConnect(cid);
    },

    stop() {
      if (this.stream) {
        for (const t of this.stream.getTracks()) t.stop();
        this.stream = null;
      }
      for (const cid of Array.from(this.peers.keys())) this.closePeer(cid);
      if (this.active && global.Net.client) global.Net.voicePublishUser(playerName(), false);
      this.active = false;
      const btn = $("voice-btn");
      if (btn) { btn.classList.remove("on"); btn.textContent = "🎤"; }
    },

    // ao sair da sala: desliga o mic e esquece quem estava online (novo código = novos cids)
    reset() {
      this.stop();
      this.users.clear();
    },

    onStatus(cid, name, on) {
      if (!cid || cid === global.Net.cid) return;
      if (on) {
        this.users.set(cid, name || "Jogador");
        if (this.active) this.maybeConnect(cid);
      } else {
        this.users.delete(cid);
        this.closePeer(cid);
      }
    },

    // sem glare: quem tem o menor cid inicia a oferta; o outro só responde
    maybeConnect(cid) {
      if (!this.active || !global.Net.cid || cid === global.Net.cid) return;
      if (global.Net.cid > cid) return;
      if (this.peers.has(cid)) return;
      const peer = this.createPeer(cid);
      this.offer(cid, peer);
    },

    createPeer(cid) {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
        ]
      });
      const peer = { pc: pc, audio: null, pending: [], remoteSet: false };
      this.peers.set(cid, peer);
      if (this.stream) for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

      pc.onicecandidate = e => {
        if (e.candidate) global.Net.voiceSignal(cid, { kind: "ice", candidate: e.candidate });
      };
      pc.ontrack = e => {
        if (!peer.audio) {
          const a = document.createElement("audio");
          a.autoplay = true;
          a.playsInline = true;
          a.dataset.voice = cid;
          document.body.appendChild(a);
          peer.audio = a;
        }
        peer.audio.srcObject = e.streams[0];
        peer.audio.play().catch(() => {});
      };
      return peer;
    },

    async offer(cid, peer) {
      try {
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        global.Net.voiceSignal(cid, { kind: "offer", sdp: peer.pc.localDescription });
      } catch (_) { /* tenta de novo quando o status reaparecer */ }
    },

    async onSignal(from, data) {
      if (!from || !data) return;
      if (data.kind === "offer") {
        // se eu sou o iniciador (menor cid), ignoro oferta cruzada
        if (global.Net.cid && global.Net.cid < from) return;
        let peer = this.peers.get(from);
        if (!peer) peer = this.createPeer(from);
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          peer.remoteSet = true;
          for (const c of peer.pending) { try { await peer.pc.addIceCandidate(c); } catch (_) {} }
          peer.pending = [];
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          global.Net.voiceSignal(from, { kind: "answer", sdp: peer.pc.localDescription });
        } catch (_) {}
      } else if (data.kind === "answer") {
        const peer = this.peers.get(from);
        if (!peer) return;
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          peer.remoteSet = true;
          for (const c of peer.pending) { try { await peer.pc.addIceCandidate(c); } catch (_) {} }
          peer.pending = [];
        } catch (_) {}
      } else if (data.kind === "ice") {
        const peer = this.peers.get(from);
        if (!peer || !data.candidate) return;
        if (!peer.remoteSet) { peer.pending.push(data.candidate); return; }
        try { await peer.pc.addIceCandidate(data.candidate); } catch (_) {}
      }
    },

    closePeer(cid) {
      const peer = this.peers.get(cid);
      if (!peer) return;
      try { peer.pc.close(); } catch (_) {}
      if (peer.audio) { peer.audio.srcObject = null; peer.audio.remove(); }
      this.peers.delete(cid);
    }
  };

  global.Net.onVoice = ev => {
    if (!ev) return;
    if (ev.kind === "user") Voice.onStatus(ev.cid, ev.name, ev.on);
    else if (ev.kind === "signal") Voice.onSignal(ev.from, ev.data);
  };

  $("voice-btn").addEventListener("click", () => {
    global.Sfx.button();
    Voice.toggle();
  });

  // fechar a aba derruba o microfone e limpa o status retido
  window.addEventListener("pagehide", () => { if (Voice.active) Voice.stop(); });

  document.addEventListener("pointerdown", () => global.Sfx.unlock(), { once: true });
  setInterval(() => global.UI.tick(), 250);

  /* ---------- estado inicial ---------- */
  go("cover");

  global.main = { act: act, leaveToCover: leaveToCover, get mode() { return mode; } };
  global.Voice = Voice;
})(window);
