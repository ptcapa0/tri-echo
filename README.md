# TRI//ECHO 3

Jogo de física mobile-first, sem backend e sem dependências. Portal Golf conta todas as tacadas até embocar e compara o resultado com o par; Carambola Clássica recupera as regras puristas; Fusion combina carambola e portal. Echo Tour e Daily Golf acrescentam pontuação competitiva discreta e cinco poderes de utilização única.

O controlo circular **IMPACTO** é independente da mira e pode ser arrastado pela pega **MOVER**, libertando qualquer zona importante da mesa. Move o ponto para cima para seguimento, para baixo para recuo ou para os lados para efeito lateral.

A potência adapta-se às dimensões da mesa. Um arrasto máximo garante alcance para pelo menos três comprimentos úteis da mesa mais três diâmetros de bola; o início da curva continua suave para jogadas de precisão.

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
