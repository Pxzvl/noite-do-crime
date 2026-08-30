# Dossiê Criminal — 10 casos

Jogo de investigação social para 4–6 jogadores (varia por caso), cada um no
próprio celular, conectados na mesma rede Wi-Fi (ou no hotspot de um dos
aparelhos).

Não usa nenhuma dependência externa — só o Node.js que já vem com o Termux.

## Rodando no Termux (Android)

1. Instale o Termux (F-Droid ou Play Store) e abra ele.
2. Instale o Node.js:
   ```
   pkg update
   pkg install nodejs
   ```
3. Copie esta pasta (`noite-do-crime/`) para o celular — por exemplo, dentro de
   `Download/`, depois rode `termux-setup-storage` no Termux (uma vez, autorize
   o acesso) e copie de lá:
   ```
   termux-setup-storage
   cp -r /sdcard/Download/noite-do-crime ~/noite-do-crime
   cd ~/noite-do-crime
   ```
   Se você baixou um `.zip`, extraia primeiro:
   ```
   pkg install unzip
   unzip /sdcard/Download/noite-do-crime.zip -d ~
   cd ~/noite-do-crime
   ```
4. Inicie o servidor:
   ```
   node server.js
   ```
5. O terminal mostra dois tipos de endereço:
   - `http://localhost:3000` — para abrir no navegador do próprio celular que
     está hospedando.
   - `http://<algum-ip>:3000` — é esse endereço que os outros jogadores devem
     digitar no navegador dos aparelhos deles, desde que estejam na mesma
     Wi-Fi (ou conectados no seu hotspot).

Para manter o servidor rodando mesmo com a tela apagada, deixe o Termux
aberto em segundo plano e desative a otimização de bateria para o app
Termux nas configurações do Android.

## Jogando com gente longe (fora da sua Wi-Fi)

Por padrão o jogo só é visível dentro da sua rede local. Para alguém fora
de casa entrar, você precisa de um "túnel" que expõe seu servidor pra
internet com um link público. Nenhuma das opções abaixo exige mexer no
roteador.

**Ponto de atenção:** enquanto o túnel estiver ativo, qualquer pessoa com o
link consegue entrar na sala — é como um convite de festa. Feche o túnel
(`Ctrl+C`) quando a partida acabar. O link muda toda vez que você reabre o
túnel (nas opções gratuitas abaixo).

### Opção 1 — localtunnel (mais simples, nada pra instalar)

Com o servidor já rodando (`node server.js`) num painel do Termux, abra um
segundo painel (deslize da borda esquerda → "New session") e rode:
```
npx localtunnel --port 3000
```
Na primeira vez ele baixa o pacote (precisa de internet), depois imprime um
link tipo `https://algo-aleatorio.loca.lt`. Mande esse link para quem vai
jogar de longe. Na primeira visita, o navegador da pessoa mostra uma página
de aviso do localtunnel pedindo pra confirmar — é só continuar.

### Opção 2 — Cloudflare Tunnel (mais estável para partidas longas)

```
pkg install cloudflared
cloudflared tunnel --url http://localhost:3000
```
Ele imprime um link `https://algo-aleatorio.trycloudflare.com`. Funciona do
mesmo jeito, tende a cair menos em conexões de celular mais instáveis.

### Jogadores locais e remotos ao mesmo tempo

Sem problema: quem está na sua Wi-Fi usa o `http://<ip-local>:3000`, quem
está longe usa o link do túnel — todos caem no mesmo servidor e na mesma
partida.

## Os 10 casos

| Caso | Dificuldade | Jogadores | Tema |
|---|---|---|---|
| 001 — A Mansão | Médio | 5 | Herança, sócio, amante secreta |
| 002 — Sangue no Ilê Axé | Difícil | 6 | Jornalista morto num terreiro; cena forjada |
| 003 — Sumiço no Parque | Médio | 5 | Criança desaparece numa festa (sem violência contra ela) |
| 004 — Suíte 402 | Fácil | 4 | Hóspede morto num hotel |
| 005 — Até Que a Morte Nos Separe | Médio | 5 | Padrinho morto na festa de casamento |
| 006 — Águas Turvas | Difícil | 6 | Investidor morto num iate, em alto mar |
| 007 — Prova Final | Médio | 5 | Diretor de colégio morto durante a feira de ciências |
| 008 — Manchete Fatal | Fácil | 4 | Editor-chefe morto no fechamento do jornal |
| 009 — Lance Fatal | Médio | 5 | Colecionador morto num leilão de antiguidades |
| 010 — Colheita Amarga | Difícil | 6 | Patriarca de vinícola morto na festa da colheita |

Cada caso pede um número exato de jogadores (não é faixa livre) — é assim
que o motor garante que o culpado sempre seja um personagem realmente em
jogo.

## Como funciona

- **Tela de título → escolha do caso.** A primeira pessoa a entrar escolhe
  o caso e a dificuldade num catálogo com sinopse, tema e tempo estimado.
  Quem entra depois só precisa tocar em "Entrar" — o caso já está decidido.
  Dá pra trocar de caso a qualquer momento antes de começar, sem perder
  quem já entrou na sala.
- **Briefing do caso.** Antes de começar, a sala de espera mostra a vítima
  e o resumo do crime, pra todo mundo revisar junto.
- **Álibi público pré-preenchido.** Cada personagem já começa com uma
  história pronta ("você diz que ficou em tal lugar a noite toda"), visível
  na ficha. Ninguém trava sem saber o que dizer — e dá pra mudar a
  declaração a qualquer momento durante o jogo, na aba Pessoas.
- **Revelação final.** Depois da votação, o jogo mostra, horário por
  horário, o que cada personagem disse e se aquilo era mentira ou verdade
  — isso só aparece no final, pra não estragar a investigação no meio do
  jogo.
- Cada celular mostra o personagem só para o seu dono — não precisa passar
  o aparelho entre as pessoas.
- Um ícone "?" no topo abre o tutorial a qualquer momento.
- Se a conexão de alguém cair (tela apagou, Wi-Fi oscilou), é só reabrir o
  mesmo link no mesmo aparelho: o jogo lembra quem você é e volta de onde
  parou.
- No fim, dá pra jogar de novo o mesmo caso (personagens redistribuídos) ou
  voltar ao catálogo e escolher outro.

## Mais de um culpado possível no mesmo caso

O Caso 001 (A Mansão) já tem duas soluções possíveis: às vezes o culpado é
Bruno (motivo: herança), às vezes é Helena (motivo: a dívida que ela
esconde) — o jogo sorteia entre elas a cada vez que a investigação começa,
inclusive ao clicar em "Jogar de novo". Os outros 9 casos ainda têm só uma
solução fixa por enquanto.

Para adicionar uma segunda solução a outro caso, é só incluir um campo
`solutions` no arquivo JSON dele — dá pra usar o Caso 001 como modelo.
`characterOverrides` troca segredo/objetivo/horários dos personagens
envolvidos na troca, e `witnessClues` redireciona qual testemunha aponta
para quem. Rode `node validate_cases.js` depois de editar pra conferir se
ficou tudo consistente.

## Hospedando na nuvem (sem depender do seu celular)

O jeito Termux funciona, mas exige seu celular ligado, com o túnel aberto,
toda vez que alguém for jogar. Dá pra hospedar num servidor de verdade na
internet — o jogo fica no ar o tempo todo, com um link fixo, e ninguém
depende do seu aparelho.

Recomendo o **Render** (render.com): tem plano gratuito de verdade, sem
pedir cartão de crédito. A única limitação é que o servidor "dorme" depois
de 15 minutos sem ninguém acessar, e demora uns 30-60 segundos pra acordar
no primeiro acesso seguinte — pra uma sessão de jogo combinada com
antecedência, isso não atrapalha em nada.

### Passo 1 — colocar o código no GitHub

O Render puxa o projeto direto de um repositório do GitHub. Pelo Termux:

```
pkg install git
cd ~/noite-do-crime
git init
git add .
git commit -m "Dossiê Criminal"
git branch -M main
```

Crie um repositório vazio em [github.com/new](https://github.com/new)
(pelo navegador do celular mesmo, não precisa de nada especial), copie o
link que ele mostrar (algo como
`https://github.com/seu-usuario/noite-do-crime.git`) e rode:

```
git remote add origin COLE_O_LINK_AQUI
git push -u origin main
```

Na primeira vez, o Git vai pedir usuário e senha. Em vez da senha da sua
conta, use um **token de acesso pessoal**: no GitHub, vá em
Settings → Developer settings → Personal access tokens → Generate new
token, marque a permissão "repo" e cole o token gerado no lugar da senha.

### Passo 2 — conectar no Render

1. Crie uma conta em [render.com](https://render.com) (dá pra entrar direto
   com a conta do GitHub).
2. No painel, clique em **New +** → **Blueprint**, e escolha o repositório
   `noite-do-crime` que você acabou de subir. O Render vai encontrar o
   arquivo `render.yaml` sozinho e já preencher tudo — é só confirmar o
   deploy.
   - Se preferir configurar na mão: **New +** → **Web Service**, escolha o
     repositório, deixe o "Build Command" em branco e o "Start Command"
     como `node server.js`, plano **Free**.
3. Em alguns minutos o Render te dá um link fixo, tipo
   `https://dossie-criminal.onrender.com` — esse é o endereço que todo
   mundo usa pra jogar, de qualquer lugar, sem precisar da sua Wi-Fi nem
   do seu celular ligado.

### Atualizando o jogo depois

Sempre que você mudar algo no código (um caso novo, um ajuste), é só
repetir pelo Termux:
```
cd ~/noite-do-crime
git add .
git commit -m "descrição da mudança"
git push
```
O Render detecta o push e refaz o deploy sozinho.

## Testando sozinho

Não precisa chamar ninguém pra testar um caso. Na sala de espera, toque
5 vezes seguidas no texto pequeno "SALA DE ESPERA" (bem em cima do nome
do caso) — a sala se preenche sozinha com jogadores fantasmas até
completar o número exigido. Eles ficam prontos automaticamente e votam
sozinhos quando chegar a hora da votação. Não tem botão visível nem
aviso na tela — é só isso mesmo.

## Estrutura do projeto

```
noite-do-crime/
├── server.js              servidor HTTP + eventos em tempo real (SSE)
├── cases/
│   ├── caso-001-a-mansao.json
│   ├── caso-002-terreiro.json
│   ├── caso-003-parque.json
│   ├── caso-004-hotel.json
│   ├── caso-005-casamento.json
│   ├── caso-006-iate.json
│   ├── caso-007-colegio.json
│   ├── caso-008-redacao.json
│   ├── caso-009-leilao.json
│   └── caso-010-vinicola.json
├── validate_cases.js      script opcional pra validar um caso novo
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js           toda a lógica de tela roda aqui
```

Para criar um novo caso, adicione outro arquivo em `cases/` seguindo o mesmo
formato — o servidor carrega todos os arquivos `.json` da pasta
automaticamente e ele aparece sozinho no catálogo. Rode
`node validate_cases.js` depois de criar um caso novo pra conferir se os
nomes de local, horários e pistas batem antes de jogar.
