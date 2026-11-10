# UNO — cartas online (HTML puro)

Jogo de cartas UNO completo em HTML/CSS/JavaScript: capa, mesa de feltro, efeitos
sonoros sintetizados (WebAudio), partida contra bots ou multiplayer P2P por código de
sala e link de convite. Sem build, sem servidor próprio — roda direto no navegador.

## Como jogar

**Offline (contra o computador)**

1. Abra `index.html` no navegador (duplo clique).
2. Digite seu nome e clique em **jogar vs computador**.
3. Ajuste o número de bots com **+ bot / − bot** e clique em **começar**.

**Online (com amigos)**

1. **criar sala online** → aparece um código de 6 letras/números.
2. Mande o código ou clique em **copiar link de convite** (o link já abre a tela de
   entrada com o código preenchido).
3. Quem entra escolhe **entrar com código**, digita o seu e está na mesa.
4. O anfitrião pode adicionar bots nas vagas vazias e inicia com **começar** (mínimo 2).

> O multiplayer usa PeerJS (WebRTC) via servidor de sinais público — é preciso internet
> nos dois lados. Nada de conta, nada de cadastro.

## Regras implementadas

- Baralho oficial de **108 cartas** (0–9 duplos, +2, bloqueio, inversão, 4 curingas, 4 +4).
- 7 cartas na mão, primeira sem curinga, sentido aleatório.
- Bloqueio, inversão (com 2 jogadores vira bloqueio), +2 e +4 com pulo de turno.
- Curinga escolhe a cor; **+4 só é válido se você não tiver a cor atual** (regra oficial).
- Na sua vez: jogue ou compre uma carta (pode jogá-la em seguida ou passar).
- Botão **UNO!**: janela de 5 s para falar depois de chegar a 1 carta; senão, +2 de
  penalidade. Bots esquecem de vez em quando.
- Pontuação: número = valor, ação = 20, curinga = 50. **Meta: 500 pontos.**
- Máscara de mão por jogador: ninguém vê as cartas dos outros (nem pelo console).

## Estrutura

```
index.html        telas: capa, lobbi, mesa, modais
css/style.css     visual: capa, feltro da mesa, cartas 100% em CSS
js/sfx.js         efeitos sonoros WebAudio + grito de UNO via voz do sistema
js/engine.js      baralho, regras, IA dos bots, estado (host-autoritativo)
js/net.js         multiplayer P2P (PeerJS): sala por código ou link #join=CODIGO
js/ui.js          render da máscara de estado → DOM, sons por transição
js/main.js        fiação: telas, botões, despacho de ações local/online
assets/           (opcional) cover.png e table.png substituem os fundos em CSS
```

## Assets opcionais

Solte `cover.png` e/ou `table.png` em `assets/` e elas passam a ser usadas
automaticamente no lugar dos fundos em CSS (capa e mesa). Sem elas o jogo já vem
com cenário completo desenhado em CSS.

## Navegadores

Edge, Chrome, Firefox e Safari atuais. Áudio libera no primeiro clique (regra dos
navegadores). No celular a mesa é utilizável, mas o desktop é o alvo.
