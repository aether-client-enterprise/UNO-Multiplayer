/* net.js — multiplayer P2P via PeerJS (WebRTC): sala por código ou link de convite */
/* linguagem: JavaScript, arquivo: js/net.js, runtime: navegador
   anfitrião = autoridade: recebe ações, valida no engine, retransmite estado mascarado */

(function (global) {
  "use strict";

  const PEER_JS = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
  const ID_PREFIX = "uno-";

  /* --- carregamento sob demanda do PeerJS (partida local não depende de rede) --- */
  let libState = "none"; // none | loading | ok | fail
  let libWaiters = [];
  function ensureLib(cb) {
    if (global.Peer) return cb(null);
    if (libState === "ok") return cb(null);
    if (libState === "fail") return cb(new Error("net"));
    libWaiters.push(cb);
    if (libState === "loading") return;
    libState = "loading";
    const s = document.createElement("script");
    s.src = PEER_JS;
    s.onload = () => { libState = "ok"; flush(null); };
    s.onerror = () => { libState = "fail"; flush(new Error("net")); };
    document.head.appendChild(s);
  }
  function flush(err) {
    const w = libWaiters;
    libWaiters = [];
    for (const f of w) f(err);
  }

  function randCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I pra não confundir na hora de digitar
    let c = "";
    for (let i = 0; i < 6; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
  }

  function errText(e) {
    const t = e && e.type;
    if (t === "peer-unavailable") return "sala não encontrada — confira o código";
    if (t === "network" || t === "server-error") return "sem conexão com o servidor de sinais";
    if (t === "browser-incompatible") return "seu navegador não suporta WebRTC";
    return "falha na conexão: " + (t || (e && e.message) || "desconhecida");
  }

  const Net = {
    role: null,        // 'host' | 'guest' | null
    code: null,
    peer: null,
    conns: [],         // host: conexões vivas
    conn: null,        // guest: conexão com o anfitrião
    seat: null,        // guest: meu índice na mesa
    myName: null,

    // callbacks (ligados pelo main.js)
    onState: null,     // guest: recebeu estado mascarado
    onClosed: null,    // sala encerrou / conexão caiu
    onError: null,     // erro em jogo já andando
    onPeerJoin: null,  // host: pediu entrada → devolve assento, ou string de erro, ou -1
    onPeerLeave: null, // host: jogador caiu (índice)
    onAction: null,    // host: ação de um convidado

    /* ---------------- anfitrião ---------------- */
    host(name, cb, attempt) {
      this.role = "host";
      this.myName = name;
      if (!this.code || attempt > 0) this.code = randCode();
      ensureLib(err => {
        if (err) return cb(new Error("sem internet: biblioteca de rede não carregou"));
        if (this.peer) { try { this.peer.destroy(); } catch (_) {} }
        const peer = new global.Peer(ID_PREFIX + this.code.toLowerCase());
        this.peer = peer;
        let opened = false;
        peer.on("open", () => { opened = true; cb(null, this.code); });
        peer.on("connection", c => this.hostWire(c));
        peer.on("error", e => {
          if (e.type === "unavailable-id" && (attempt || 0) < 3) {
            // colisão de código rara: regenera e reabre
            try { peer.destroy(); } catch (_) {}
            this.host(name, cb, (attempt || 0) + 1);
            return;
          }
          if (!opened) cb(new Error(errText(e)));
          else this.onError && this.onError(e);
        });
      });
    },

    hostWire(c) {
      let seat = -1;
      const drop = () => {
        const i = this.conns.indexOf(c);
        if (i >= 0) this.conns.splice(i, 1);
        if (seat >= 0) { this.onPeerLeave && this.onPeerLeave(seat); seat = -1; }
      };
      c.on("open", () => this.conns.push(c));
      c.on("data", m => {
        if (!m || typeof m !== "object") return;
        if (m.t === "join") {
          const r = this.onPeerJoin ? this.onPeerJoin(String(m.name || "Jogador").replace(/[<>]/g, "").slice(0, 14)) : -1;
          if (typeof r === "number" && r >= 0) {
            seat = r;
            c._seat = seat;
            c.send({ t: "hello", seat: seat, code: this.code });
          } else {
            c.send({ t: "err", m: typeof r === "string" ? r : "sala indisponível" });
            setTimeout(() => { try { c.close(); } catch (_) {} }, 500);
          }
        } else if (m.t === "act" && seat >= 0) {
          this.onAction && this.onAction(seat, m.a);
        }
      });
      c.on("close", drop);
      c.on("error", drop);
    },

    /* ---------------- convidado ---------------- */
    guest(code, name, cb) {
      this.role = "guest";
      this.myName = name;
      this.seat = null;
      this.code = String(code || "").trim().toUpperCase();
      if (this.code.length < 4) return cb(new Error("código inválido"));
      ensureLib(err => {
        if (err) return cb(new Error("sem internet: biblioteca de rede não carregou"));
        let settled = false;
        const finish = (e, v) => {
          if (settled) { if (e) this.onClosed && this.onClosed(); return; }
          settled = true;
          clearTimeout(to);
          cb(e, v);
        };
        const to = setTimeout(() => finish(new Error("tempo esgotado — a sala não respondeu")), 10000);

        const peer = new global.Peer();
        this.peer = peer;
        peer.on("open", () => {
          const c = peer.connect(ID_PREFIX + this.code.toLowerCase(), { reliable: true });
          this.conn = c;
          c.on("open", () => c.send({ t: "join", name: name }));
          c.on("data", m => {
            if (!m) return;
            if (m.t === "hello") {
              this.seat = m.seat;
              finish(null, m.seat);
            } else if (m.t === "state") {
              if (this.seat !== null) this.onState && this.onState(m.s); // ignora estado anterior ao assento
            } else if (m.t === "closed") {
              finish(new Error("sala encerrada"));
              this.onClosed && this.onClosed();
            } else if (m.t === "err") {
              finish(new Error(m.m || "não foi possível entrar"));
            }
          });
          c.on("close", () => finish(new Error("conexão recusada")));
          c.on("error", () => finish(new Error("falha na conexão")));
        });
        peer.on("error", e => finish(new Error(errText(e))));
      });
    },

    /* ---------------- transporte ---------------- */
    sendAction(a) {
      if (this.role === "guest" && this.conn) {
        try { this.conn.send({ t: "act", a: a }); } catch (_) {}
      }
    },

    /* o anfitrião transmite a visão de cada convidado (mão só do dono do assento) */
    broadcastState(maskFn) {
      if (this.role !== "host") return;
      for (const c of this.conns) {
        if (c._seat === undefined || c._seat === null || c._seat < 0) continue;
        try { c.send({ t: "state", s: maskFn(c._seat) }); } catch (_) {}
      }
    },

    closeAll() {
      if (this.conns.length) {
        for (const c of this.conns) {
          try { c.send({ t: "closed" }); c.close(); } catch (_) {}
        }
      }
      this.conns = [];
      if (this.conn) { try { this.conn.close(); } catch (_) {} this.conn = null; }
      if (this.peer) { try { this.peer.destroy(); } catch (_) {} this.peer = null; }
      this.role = null;
      this.code = null;
      this.seat = null;
    }
  };

  global.Net = Net;
})(window);
