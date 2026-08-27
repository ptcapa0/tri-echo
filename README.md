# TRI//ECHO 4

Jogo de física mobile-first, sem backend e sem dependências. **Table Golf** conta todas as tacadas até embocar; **Bilhar de 3 bolas** mantém a carambola clássica; Fusion combina as duas regras. Echo Tour e Daily Golf acrescentam pontuação competitiva e cinco poderes.

Cada modo original pode usar a Mesa Echo com portal móvel ou uma mesa de snooker com seis bolsas. A versão 4.1 inclui pool americano 8-ball com lisas e riscadas de leitura imediata, snooker britânico com 22 bolas, seis desafios Trick Shot e treino contínuo de Table Golf, Bilhar de 3 bolas, Pool americano ou Snooker. As disciplinas tradicionais usam pano livre, sem bumpers, zonas artificiais ou Echo Rails.

O controlo circular **IMPACTO** é independente da mira e pode ser arrastado pela pega **MOVER**, libertando qualquer zona importante da mesa. Move o ponto para cima para seguimento, para baixo para recuo ou para os lados para efeito lateral.

A potência adapta-se às dimensões da mesa. Um arrasto máximo garante alcance para pelo menos três comprimentos úteis da mesa mais três diâmetros de bola; o início da curva continua suave para jogadas de precisão.

## Jogar localmente

1. Abre um terminal nesta pasta.
2. Executa `npm run dev`.
3. Abre `http://localhost:8080` no browser. Não abras o HTML diretamente: o Service Worker requer HTTP.

Em ambientes com botão de pré-visualização, seleciona a pasta `tri-echo` como raiz do projeto. O comando padrão `npm run dev` inicia automaticamente o endereço de preview.

O servidor não instala pacotes nem usa dependências externas. Se a porta 8080 estiver ocupada, usa `PORT=8090 npm run dev`.

Testes: `npm test` (apenas Node.js moderno; não instala pacotes). Cria o artefacto de produção com `npm run build`. Para o smoke test no artefacto, serve `dist/client` em `http://127.0.0.1:8080` e executa `python3 tests/playtest.py` (requer Playwright e Chromium).

## Instalar no telemóvel

- Android/Chrome: abre o endereço publicado, menu ⋮, **Instalar aplicação** ou **Adicionar ao ecrã principal**.
- iPhone/Safari: abre o endereço, botão **Partilhar**, **Adicionar ao ecrã principal**. Abre uma vez com internet para preencher a cache offline.

## Publicar grátis

GitHub Pages publica exclusivamente `dist/client` através de GitHub Actions. Cada Pull Request é validado por testes Node, build e smoke test browser; apenas um `push` verde em `main` (ou execução manual) pode publicar produção.

Alternativa: arrasta esta pasta para o painel de deploy manual do Netlify. Não é preciso build, conta de base de dados nem variáveis de ambiente.

## Privacidade

Todo o progresso fica no `localStorage` do dispositivo. Não há analytics, cookies de terceiros, API keys, conta ou recolha de dados pessoais. Usa **Definições → Exportar** para criar uma cópia JSON.
