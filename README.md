# TRI//ECHO

Jogo de física mobile-first, sem backend e sem dependências. Puxa a bola branca, larga e toca nas outras duas. Cada carambola cria um Echo Rail que altera as jogadas seguintes.

## Jogar localmente

1. Abre um terminal nesta pasta.
2. Executa `npm run dev`.
3. Abre `http://localhost:8080` no browser. Não abras o HTML diretamente: o Service Worker requer HTTP.

Em ambientes com botão de pré-visualização, seleciona a pasta `tri-echo` como raiz do projeto. O comando padrão `npm run dev` inicia automaticamente o endereço de preview.

O servidor não instala pacotes nem usa dependências externas. Se a porta 8080 estiver ocupada, usa `PORT=8090 npm run dev`.

Testes: `npm test` (apenas Node.js moderno; não instala pacotes).

## Instalar no telemóvel

- Android/Chrome: abre o endereço publicado, menu ⋮, **Instalar aplicação** ou **Adicionar ao ecrã principal**.
- iPhone/Safari: abre o endereço, botão **Partilhar**, **Adicionar ao ecrã principal**. Abre uma vez com internet para preencher a cache offline.

## Publicar grátis

GitHub Pages: cria um repositório, envia o conteúdo desta pasta, abre **Settings → Pages**, escolhe **Deploy from a branch**, branch `main`, pasta `/ (root)`. O endereço será `https://UTILIZADOR.github.io/REPOSITORIO/`; os caminhos relativos já suportam subpastas.

Alternativa: arrasta esta pasta para o painel de deploy manual do Netlify. Não é preciso build, conta de base de dados nem variáveis de ambiente.

## Privacidade

Todo o progresso fica no `localStorage` do dispositivo. Não há analytics, cookies de terceiros, API keys, conta ou recolha de dados pessoais. Usa **Definições → Exportar** para criar uma cópia JSON.
