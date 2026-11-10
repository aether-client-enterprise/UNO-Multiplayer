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
    global.Net.closeAll();
    Game.state = null;
    mode = null;
    lastMask = null;
    go("cover");
    $("modal-color").classList.add("hidden");
    $("modal-round").classList.add("hidden");
    $("modal-score").classList.add("hidden");
    if (msg) global.UI.toast(msg);
  }

  /* ---------- nome ---------- */
  const inName = $("in-name");
  inName.value = localStorage.getItem("uno_name") || "";
  inName.addEventListener("change", () => localStorage.setItem("uno_name", inName.value.trim()));
  function playerName() {
    const n = inName.value.trim() || "Jogador";
    localStorage.setItem("uno_name", n);
    return n;
  }

  /* ---------- perfil ---------- */
  const profWins = Number(localStorage.getItem("uno_wins") || 0);
  const profGames = Number(localStorage.getItem("uno_games") || 0);
  const profAvatar = localStorage.getItem("uno_avatar") || "av-red";
  const profName = localStorage.getItem("uno_profile_name") || "";

  $("profile-wins").textContent = profWins;
  $("profile-games").textContent = profGames;
  document.querySelectorAll(".avatar-btn").forEach(b => {
    b.classList.toggle("selected", b.dataset.avatar === profAvatar);
  });
  $("in-profile-name").value = profName;

  $("bt-profile-save").addEventListener("click", () => {
    const name = $("in-profile-name").value.trim() || "Jogador";
    const avatar = document.querySelector(".avatar-btn.selected")?.dataset.avatar || "av-red";
    localStorage.setItem("uno_profile_name", name);
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
    const name = $("in-profile-name").value.trim() || "Jogador";
    const avatar = document.querySelector(".avatar-btn.selected")?.dataset.avatar || "av-red";
    localStorage.setItem("uno_profile_name", name);
    localStorage.setItem("uno_avatar", avatar);
    mode = "local";
    Game.startLobby("local", name);
  });

  $("bt-create").addEventListener("click", () => {
    global.Sfx.unlock();
    global.Sfx.button();
    const name = $("in-profile-name").value.trim() || "Jogador";
    const avatar = document.querySelector(".avatar-btn.selected")?.dataset.avatar || "av-red";
    localStorage.setItem("uno_profile_name", name);
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
  $("bt-friends").addEventListener("click", () => openFriends("lobby"));
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
  $("bt-draw").addEventListener("click", () => { global.Sfx.button(); act({ k: "draw" }); });
  $("draw-pile").addEventListener("click", () => {
    if ($("draw-pile").classList.contains("disabled")) return;
    act({ k: "draw" });
  });
  $("bt-pass").addEventListener("click", () => { global.Sfx.button(); act({ k: "pass" }); });
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
    const isMatch = $("bt-next-round").dataset.match === "1";
    act({ k: isMatch ? "rematch" : "nextRound" });
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
    s.players.push({
      id: "p" + idx,
      name: name || ("Jogador " + (idx + 1)),
      bot: false, connected: true,
      hand: [], score: 0, uno: false, declaredUno: false,
      av: AVS[idx % 4]
    });
    Game.log(name + " entrou na sala", "good");
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

  /* ---------- gatilhos globais ---------- */
  document.addEventListener("pointerdown", () => global.Sfx.unlock(), { once: true });
  setInterval(() => global.UI.tick(), 250);

  /* ---------- estado inicial ---------- */
  go("cover");

  global.main = { act: act, leaveToCover: leaveToCover, get mode() { return mode; } };
})(window);
