/* net.js — multiplayer por relay MQTT público (sem WebRTC, sem ICE, sem NAT pra travar) */
/* linguagem: JavaScript, arquivo: js/net.js, runtime: navegador
   autoridade no anfitrião: recebe ações, valida no engine, publica estado mascarado por convidado.

   tópicos da sala (base: uno/m2/{CODIGO}):
     meta            anfitrião -> todos   retido {phase,n} + LWT ""  (sala morreu)
     join            convidado -> host    {n:clientId, name}
     hello/{cid}     host -> convidado    retido {seat,tok} | {err}
     state/{cid}     host -> convidado    retido estado mascarado (mão só do dono)
     act/{cid}       convidado -> host    {tok, a}
     presence/{cid}  convidado -> todos   retido "1" + LWT ""        (saiu/caiu) */

(function (global) {
  "use strict";

  const CDNS = [
    "https://unpkg.com/mqtt@5/dist/mqtt.min.js",
    "https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js"
  ];
  // ordem = prioridade; todos com WSS. eclipse saiu da lista (porta 443 bloqueada em teste)
  const BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/"
  ];
  const CONNECT_TIMEOUT = 7000;

  /* --- lib MQTT sob demanda (partida local não depende de rede) --- */
  let libState = "none";
  let libWaiters = [];
  function ensureMqtt(cb) {
    if (global.mqtt && global.mqtt.connect) return cb(null);
    if (libState === "ok") return cb(null);
    if (libState === "fail") return cb(new Error("net"));
    libWaiters.push(cb);
    if (libState === "loading") return;
    libState = "loading";
    let i = 0;
    const tryNext = () => {
      if (i >= CDNS.length) { libState = "fail"; flush(new Error("net")); return; }
      const s = document.createElement("script");
      s.src = CDNS[i++];
      s.onload = () => {
        if (global.mqtt && global.mqtt.connect) { libState = "ok"; flush(null); }
        else tryNext();
      };
      s.onerror = tryNext;
      document.head.appendChild(s);
    };
    tryNext();
  }
  function flush(err) {
    const w = libWaiters;
    libWaiters = [];
    for (const f of w) f(err);
  }

  function randCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
    let c = "";
    for (let i = 0; i < 6; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
  }
  function randId() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }
  function base(code) { return "uno/m2/" + code; }

  function payloadStr(p) {
    if (typeof p === "string") return p;
    if (p && typeof p.toString === "function" && p.toString !== Uint8Array.prototype.toString) return p.toString();
    if (p && typeof p.length === "number") {
      let out = "";
      for (let i = 0; i < p.length; i++) out += String.fromCharCode(p[i]);
      return out;
    }
    return String(p);
  }
  function parse(p) {
    try { return JSON.parse(payloadStr(p)); } catch (_) { return null; }
  }

  /* conecta com failover: tenta cada broker até um responder em 7s */
  function connectList(opts, i, cb) {
    if (i >= BROKERS.length) return cb(new Error("servidores de sinais indisponíveis — tente de novo"));
    let settled = false;
    let client;
    try {
      client = global.mqtt.connect(BROKERS[i], Object.assign({
        connectTimeout: CONNECT_TIMEOUT,
        reconnectPeriod: 0,      // failover manual no primeiro ciclo
        resubscribe: true,
        clean: true
      }, opts));
    } catch (e) {
      return connectList(opts, i + 1, cb);
    }
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) { try { client.end(true); } catch (_) {} connectList(opts, i + 1, cb); }
      else cb(null, client);
    };
    const timer = setTimeout(() => done(new Error("timeout")), CONNECT_TIMEOUT);
    client.once("connect", () => done(null));
    client.once("error", () => done(new Error("fail")));
  }

  const Net = {
    role: null,        // 'host' | 'guest' | null
    code: null,
    client: null,
    cid: null,         // id MQTT meu (por sessão)
    token: null,       // token do meu assento (convidado)
    seat: null,        // convidado: meu índice
    myName: null,
    seats: new Map(),  // anfitrião: clientId -> {seat, tok}
    _maskFn: null,
    _offlined: false,

    // callbacks (ligados pelo main.js)
    onState: null,     // convidado: estado mascarado chegou
    onClosed: null,    // sala encerrou / host caiu
    onError: null,     // aviso de rede em jogo
    onPeerJoin: null,  // host: pediu entrada -> assento | string de erro | -1
    onPeerLeave: null, // host: jogador caiu (índice)
    onAction: null,    // host: ação validada de um convidado

    /* ---------------- anfitrião ---------------- */
    host(name, cb, attempt) {
      this.role = "host";
      this.myName = name;
      if (!this.code || attempt > 0) this.code = randCode();
      ensureMqtt(err => {
        if (err) return cb(new Error("sem internet: biblioteca de rede não carregou"));
        if (this.client) { try { this.client.end(true); } catch (_) {} }
        this.cid = this.cid || randId();
        const b = base(this.code);
        connectList({
          clientId: "uh" + randId(),
          will: { topic: b + "/meta", payload: "", qos: 1, retain: true }
        }, 0, (err, client) => {
          if (err) return cb(err);
          this.client = client;
          let opened = false;
          const onReady = () => {
            if (client !== this.client) return; // conexão velha
            this._offlined = false;
            try { client.options.reconnectPeriod = 2000; } catch (_) {}
            client.subscribe([b + "/join", b + "/act/#", b + "/presence/#"], { qos: 1 }, () => {
              this.pub(b + "/meta", this._maskFn
                ? { phase: this._maskFn(0).phase, n: this._maskFn(0).players.length }
                : { phase: "lobby", n: 1 }, true);
              if (!opened) { opened = true; cb(null, this.code); }
              else if (this._maskFn) this.broadcastState(this._maskFn); // reconectou: republish
            });
          };
          onReady();
          client.on("connect", onReady);
          client.on("message", (t, p) => { if (client === this.client) this.hostMessage(t, p); });
          client.on("offline", () => {
            if (!this._offlined) { this._offlined = true; this.onError && this.onError({ type: "offline", message: "conexão com a sala caiu — reconectando…" }); }
          });
          client.on("error", e => { this.onError && this.onError(e); });
        });
      });
    },

    hostMessage(t, p) {
      const b = base(this.code);
      if (t === b + "/join") {
        const m = parse(p);
        if (!m || !m.n) return;
        if (this.seats.has(m.n)) {
          // reconexão de quem já está: reenvia assento + estado retido
          const e = this.seats.get(m.n);
          this.pub(b + "/hello/" + m.n, { seat: e.seat, tok: e.tok }, true);
          if (this._maskFn) this.pub(b + "/state/" + m.n, this._maskFn(e.seat), true);
          return;
        }
        const r = this.onPeerJoin ? this.onPeerJoin(String(m.name || "Jogador").replace(/[<>]/g, "").slice(0, 14)) : -1;
        if (typeof r === "number" && r >= 0) {
          const tok = randId();
          this.seats.set(m.n, { seat: r, tok: tok });
          this.pub(b + "/hello/" + m.n, { seat: r, tok: tok }, true);
          if (this._maskFn) this.broadcastState(this._maskFn); // lista mudou: atualiza todo mundo
        } else {
          this.pub(b + "/hello/" + m.n, { err: typeof r === "string" ? r : "sala indisponível" }, true);
        }
        return;
      }
      if (t.indexOf(b + "/act/") === 0) {
        const cid = t.slice((b + "/act/").length);
        const e = this.seats.get(cid);
        const m = parse(p);
        if (e && m && m.tok === e.tok && this.onAction) this.onAction(e.seat, m.a);
        return;
      }
      if (t.indexOf(b + "/presence/") === 0) {
        const cid = t.slice((b + "/presence/").length);
        if (payloadStr(p).trim() !== "") return;
        const e = this.seats.get(cid);
        if (!e) return;
        this.seats.delete(cid);
        // remove do mapa os assentos acima do que saiu (o engine faz splice no mesmo índice)
        for (const [k, v] of this.seats) if (v.seat > e.seat) v.seat -= 1;
        this.onPeerLeave && this.onPeerLeave(e.seat);
        if (this._maskFn) this.broadcastState(this._maskFn);
      }
    },

    /* ---------------- convidado ---------------- */
    guest(code, name, cb) {
      this.role = "guest";
      this.myName = name;
      this.seat = null;
      this.token = null;
      this.code = String(code || "").trim().toUpperCase();
      if (this.code.length < 4) return cb(new Error("código inválido"));
      ensureMqtt(err => {
        if (err) return cb(new Error("sem internet: biblioteca de rede não carregou"));
        this.cid = randId();
        const cid = this.cid;
        const b = base(this.code);
        let joined = false;
        let sawMeta = false;
        let pendingState = null;
        let settled = false;
        let to = null;

        const finish = (e, v) => {
          if (settled) return;
          settled = true;
          clearTimeout(to);
          cb(e, v);
        };
        // cronômetro global só começa depois do broker conectar (não durante o failover)
        const armGlobalTimeout = () => {
          if (to !== null || settled) return;
          to = setTimeout(() => {
            finish(new Error(sawMeta
              ? "o anfitrião não respondeu — a página dele está aberta?"
              : "sala não encontrada — confira o código"));
          }, 12000);
        };

        connectList({
          clientId: "ug" + randId(),
          will: { topic: b + "/presence/" + cid, payload: "", qos: 1, retain: true }
        }, 0, (err, client) => {
          if (err) return finish(err);
          this.client = client;
          armGlobalTimeout();
          const onReady = () => {
            if (client !== this.client) return;
            this._offlined = false;
            try { client.options.reconnectPeriod = 2000; } catch (_) {}
            client.subscribe([
              b + "/hello/" + cid,
              b + "/state/" + cid,
              b + "/meta"
            ], { qos: 1 }, () => {
              this.pub(b + "/presence/" + cid, "1", true);
              this.pub(b + "/join", { n: cid, name: name }, false);
              // meta retido chega em milissegundos; nada em 3s = código não existe
              setTimeout(() => {
                if (!sawMeta && !settled) finish(new Error("sala não encontrada — confira o código"));
              }, 3000);
            });
          };
          onReady();
          client.on("connect", onReady);
          client.on("message", (t, p) => {
            if (client !== this.client) return;
            if (t === b + "/meta") {
              if (payloadStr(p).trim() === "") {
                // host limpou o meta retido = sala morreu
                if (joined) this.onClosed && this.onClosed();
                else finish(new Error("a sala foi encerrada"));
              } else sawMeta = true;
              return;
            }
            if (t === b + "/hello/" + cid) {
              const m = parse(p);
              if (!m) return;
              if (m.err) { finish(new Error(m.err)); return; }
              this.seat = m.seat;
              this.token = m.tok;
              if (!joined) {
                joined = true;
                finish(null, m.seat);
                if (pendingState) { const s = pendingState; pendingState = null; this.onState && this.onState(s); }
              }
              return;
            }
            if (t === b + "/state/" + cid) {
              const m = parse(p);
              if (!m) return;
              if (joined) this.onState && this.onState(m);
              else pendingState = m;
            }
          });
          client.on("offline", () => {
            if (!this._offlined) { this._offlined = true; this.onError && this.onError({ type: "offline", message: "conexão caiu — reconectando…" }); }
          });
          client.on("error", e => { this.onError && this.onError(e); });
        });
      });
    },

    /* ---------------- transporte ---------------- */
    pub(topic, obj, retain) {
      if (!this.client) return;
      const payload = typeof obj === "string" ? obj : JSON.stringify(obj);
      try {
        this.client.publish(topic, payload, { qos: 1, retain: !!retain });
      } catch (_) { /* queda momentânea: o MQTT.js reenvia no reconectar */ }
    },

    sendAction(a) {
      if (this.role !== "guest" || !this.client || !this.token || this.seat === null) return;
      this.pub(base(this.code) + "/act/" + this.cid, { tok: this.token, a: a }, false);
    },

    /* o anfitrião publica a visão de cada convidado (mão só do dono do assento) */
    broadcastState(maskFn) {
      this._maskFn = maskFn;
      if (this.role !== "host" || !this.client) return;
      const b = base(this.code);
      const m0 = maskFn(0);
      this.pub(b + "/meta", { phase: m0.phase, n: m0.players.length }, true);
      for (const [cid, e] of this.seats) {
        this.pub(b + "/state/" + cid, maskFn(e.seat), true);
      }
    },

    closeAll() {
      const b = this.code ? base(this.code) : null;
      if (this.role === "host" && b && this.client) {
        this.pub(b + "/meta", "", true); // convidados veem "sala encerrada" na hora
        for (const cid of this.seats.keys()) {
          this.pub(b + "/state/" + cid, "", true);
          this.pub(b + "/hello/" + cid, "", true);
        }
      }
      if (this.role === "guest" && b && this.client) {
        this.pub(b + "/presence/" + this.cid, "", true);
        if (this.cid) this.pub(b + "/state/" + this.cid, "", true);
      }
      this.seats.clear();
      this._maskFn = null;
      this._offlined = false;
      const c = this.client;
      this.client = null;
      this.role = null;
      this.code = null;
      this.seat = null;
      this.token = null;
      if (c) setTimeout(() => { try { c.end(true); } catch (_) {} }, 250);
    }
  };

  global.Net = Net;
})(window);
