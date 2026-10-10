# TRI//ECHO — PR11: Session Lifecycle Recovery

Contrato fechado de implementação, 2026-10-10. Base: main ce87ed03c25f9d8d463b4194c01981ae2e4f9415, publicada 4.7.3. Versão de trabalho: 4.7.4; publicação fora desta autorização. PT autorizou execução até entrega de PR draft nesta conversa; merge/publicação exigem autorização separada.

## Problema e objetivo

A saída por `pagehide` invalida tarefas da ronda. O regresso BFCache não reconcilia as transições que dependiam delas. Inicialmente trata-se de risco identificado no código, não falha comprovada. Guardar reprodução real na base imutável antes da alteração e indicar se/como reproduziu.

Manter a mesma sessão em memória utilizável após suspensão ou regresso, sem tacadas/resoluções/efeitos duplicados. Não criar retoma entre processos/reloads: pertence a PR12.

## Política normativa

- Suspensão de ciclo de vida = document.hidden ou página ausente entre pagehide/pageshow. Congelar física e atrasos restantes das tarefas da ronda; não avançar física com tempo decorrido durante ausência. Conservar mesa/velocidades/estado e resíduo do passo de simulação. Reiniciar apenas o relógio de frames na transição.
- Em suspensão, cancelar os três donos de pointers e leituras de importação pendentes; esconder feedback Echo transitório. Pointerup antigo nunca dispara tacada nem guarda posição. Nenhuma nova interação de gameplay é aceite.
- Tarefas da instância atual conservam intenção e tempo restante; timers ativos são desarmados. Ao regressar e ficar visível, rearmar uma vez com esse tempo. Cobrir safeReset, newHole em todos os modos, fim Daily/tour e a tarefa aninhada de abertura do menu. Eventos repetidos são idempotentes.
- beginRound/restart/substituição de Game continuam a invalidar definitivamente tarefas antigas. Época e identidade de cada armamento devem impedir que callbacks já enfileirados, timers cancelados ou uma instância anterior produzam efeitos. Remover tarefa antes de executar callback; permitir callback criar nova ronda/tarefa.
- Modais continuam a bloquear física e input; o seu fecho respeita também document.hidden/pagehide. Preservar o comportamento existente de transições com modal aberto; não transformar modal em suspensão de tarefas de ronda.
- pagehide não destrói Game nem incrementa a época da ronda; pageshow não resolve novamente a tacada. O resultado já aplicado mantém pontuação, Rails, poderes e estatísticas. Um reload inicia a sessão como antes, sem checkpoint novo.
- Suspender áudio e descartar o segundo tom pendente de uma celebração ao pausar. Regresso não cria AudioContext nem contorna restrições de autoplay; o próximo gesto válido pode retomar contexto existente. Falha de criação/resume/suspend não interrompe gameplay nem cria rejeição de Promise não tratada. Preferência sound=false preservada.
- PR7.1/PR8/PR9/PR10 e golden contracts intactos. Sem alterações de física/regras/geração/fairness/aiming/poderes/Rails, dependências, service worker, formato de save ou antecipações PR6.1/PR12–18. Sem skipWaiting/clients.claim/recarga forçada.

## Limite de ficheiros

Apenas js/app.js, js/rules.js (controlador de tarefas, não decisões de regras), js/audio.js, package.json, package-lock.json, tests/lifecycle.test.js, tests/lifecycle-recovery.py, tests/playtest.py (invocação da nova suite), docs/PR11-session-lifecycle.md. Evidência/reprodutor fora do repositório em audit/2026-10-10-pr11. Preservar README do checkout principal. A documentação do PR incorpora este contrato e resultados finais.

## Matriz obrigatória

| ID | Critério e evidência |
|---|---|
| A01 | Reprodução base imutável com build de produção em subpath e perfil isolado. Navegação real fora/regresso com pageshow.persisted=true, estados antes/depois e SHA. Nunca substituir por evento sintético. |
| A02 | Timers: congelar restante, rearmar uma vez; zero-delay, repetição suspend/resume, tarefas criadas suspensas, callback aninhado. Relógio/timers falsos Node determinísticos. |
| A03 | Invalidar ronda/instância durante suspensão e recusar callbacks cancelados mesmo se já enfileirados; nenhum efeito antigo em nova ronda/partida. |
| A04 | BFCache real: recuperar reset de falta/miss e passagem de buraco; input finalmente utilizável, score/stats/poderes/Rails sem aplicação repetida. |
| A05 | BFCache real: conclusão Daily/tour e menu aninhado; dia/seed e resultado único, menu acessível; regressão de modos tradicionais e classic/trick nas transições. |
| A06 | Tacada real em movimento: suspensão/regresso retém sessão e resolve uma única vez sem catchup. Separar navegação real de teste de estado hidden simulado/protocolo. |
| A07 | Menu/settings/progress, fecho modal enquanto oculto e retorno: pausa e input coerentes. Nova partida/restart rápidos não recebem tarefas anteriores. |
| A08 | Pointers gameplay/contact/move cancelados; up antigo sem tacada/guardar. Resize/orientação em viewport não alteram estado da ronda; distinção explícita de dispositivo real. |
| A09 | Áudio: contexto não criado no retorno, suspend/resume rejeitado sem erro não tratado, som desligado e celebração antiga descartada; gesto seguinte continua gameplay. |
| A10 | Importação pendente cancelada na suspensão, dados duráveis/live preservados; storage temporário/recuperação e offline/coherent updates continuam a passar suites PR8–10. |
| A11 | npm test, npm run build, suite Chromium completa e regressões seed1337 collisions10000/pockets10000/aim5000/fairness10000; validação do head entregue e CI PR. Guardar comandos, versões, SHAs, releaseId e limitações. |
| A12 | Qualificação física iPhone Safari/PWA e Android Chrome: suspensão do SO/retorno, orientação, áudio e partida ativa. Evidência física obrigatória para declarar PR11 totalmente concluído; em falta, draft explicitamente provisório com gate aberto, sem alegar equivalência de emulação. |

## Entrega e limites de conclusão

Entregar PR draft com antes/depois, matriz A01–A12 e artefactos. Não declarar PR11 concluído enquanto algum critério obrigatório estiver pendente. A indisponibilidade de dispositivos não autoriza reduzir A12; pode entregar draft para revisão com qualificação física pendente. Atualizar Cognitive OS preservando aprovações históricas e gate externo. Não fazer merge nem publicar.

## Guia de validação

Node: `npm test`. Build: `npm run build`. Navegador: `PLAYTEST_ROOT=http://127.0.0.1:8080 PLAYTEST_ARTIFACTS=/tmp/pr11-tests python tests/playtest.py` com dist/client servido na porta 8080. A suite PR11 cria o seu servidor isolado num subpath `/client/`; `python tests/lifecycle-recovery.py` permite diagnóstico focado.

Regressões: `npm run physics:collisions -- --seed 1337 --cases 10000`, `npm run physics:pockets -- --seed 1337 --cases 10000`, `npm run aim:validate -- --seed 1337 --cases 5000`, `npm run fairness:validate -- --seed 1337 --cases 10000`.

Os testes de timers usam um relógio injetado e executam também callbacks antigos deliberadamente, mesmo depois do cancelamento. A implementação conserva as tarefas suspensas e invalida cada armamento, além da época da ronda. Os testes de áudio toleram rejeições e erros síncronos sem criar um contexto durante a suspensão.

A12 exige dispositivos reais. A emulação de viewport e os eventos sintéticos não demonstram suspensão pelo SO nem equivalência com Safari/PWA iOS ou Android Chrome. Esta limitação deve permanecer no PR e impedir declaração de conclusão integral.

## Evidência antes/depois

Na base exata 4.7.3 (`ce87ed03c25f9d8d463b4194c01981ae2e4f9415`), o reprodutor serviu produção em `/client/`, esperou pelo service worker controlado e fez navegação real para fora e regresso. Chromium 153 confirmou `pageshow.persisted=true` e CDP `BackForwardCacheRestore`. A época avançou de 1 para 2 no pagehide, o timer foi invalidado e, após o prazo original, `interactionLocked=true` e `canAcceptGameplayInput=false` persistiram.

Na implementação PR11, suspensão conserva a época/intenção e desarma o timer; retorno rearma o atraso restante. Os primeiros ensaios reais A04/A05 recuperaram a passagem de buraco e a conclusão Daily/menu. Os resultados finais da matriz são registados abaixo e na descrição do PR.

O BFCache não emite um novo `load`: o teste usa `history.back()` e espera limitada pelo URL/evento. Usa Chromium completo (`channel="chromium"`), removendo o argumento Playwright `--disable-back-forward-cache`. Reload, eventos sintéticos ou o shell headless sem BFCache nunca contam como recuperação real.

Reprodução da base (a partir da raiz do workspace): arquivar `git archive ce87ed03c25f9d8d463b4194c01981ae2e4f9415` num diretório isolado; construir com `GITHUB_SHA=ce87ed03c25f9d8d463b4194c01981ae2e4f9415 npm run build`; executar `python audit/2026-10-10-pr11/bfcache-baseline-repro.py /diretorio/base/dist/client --out /tmp/pr11-base.json`. O script exige a identidade da base e guarda estados, hashes e eventos. Evidência local: `audit/2026-10-10-pr11/bfcache-baseline-result.json`; releaseId da base de teste `e08521c3786e1dc5669ad71d1eefdd53d3177706c738809ef44a0fe85097b045` (build isolado, não identidade da publicação).

## Matriz de entrega

| Critério | Resultado / método |
|---|---|
| A01 | PASS — base exata reproduzida com BFCache real, worker controlado, identidade e hashes registados. |
| A02 | PASS — Node, relógio determinístico, atrasos restantes, zero-delay, tarefas suspensas e callbacks aninhados. |
| A03 | PASS — Node força callbacks antigos a executar após cancelamento; UI de nova partida/restart também validada. |
| A04 | PASS — BFCache real em miss/reset e vitória; Forge cria um Rail e consome o poder antes da suspensão, conservados uma vez após retorno, incluindo save/estatísticas. |
| A05 | PASS — classic/trick/american/british; Daily/tour após seis buracos, com duas travessias reais para conclusão e menu aninhado, dia/seed e save preservados. |
| A06 | PASS — gesto de UI inicia Physics real; 1200 ms ausente, snapshots pagehide/pageshow idênticos, uma tacada e uma resolução após retoma. |
| A07 | PASS — BFCache em menu/settings/progress; fecho enquanto hidden é teste de estado simulado separado; substituição de Game/restart por UI. |
| A08 | PASS — captura nativa de pointer efetivamente estabelecida para gameplay/contact/move antes da navegação; eventos antigos sem efeito/save. Resize usa viewport, não orientação física. |
| A09 | PASS — Node e API AudioContext simulada no navegador; rejeições sem erro, sem criação/resume no retorno e som desligado respeitado no gesto seguinte. |
| A10 | PASS — leitura válida pendente cancelada por navegação real; save e export live iguais; controlo positivo importa o mesmo ficheiro sem cancelamento. Regressões PR8–10 mantidas. |
| A11 | Validação do head — 231 testes Node, build, suite Chromium completa PR8–11 e regressões configuradas; resultados e SHA finais na descrição do PR e CI. |
| A12 | PENDENTE — iPhone Safari/PWA e Android Chrome físicos, suspensão pelo SO/orientação/áudio. Gate obrigatório aberto. |

Os 19 casos de navegador focados usam perfis isolados, artefactos de produção, scope `/client/` e seed de relógio fixa 624063493 para os modos que usam Date.now. A Daily mantém o dia/seed derivados do dia UTC real. Eventos de ponteiro sintéticos nos testes de tacada percorrem a UI e Physics reais; a prova de captura de pointer usa mouse nativo Playwright. Nenhum destes métodos substitui um dispositivo físico.

O código da classe Game, decisões de regras antes do controlador, handler de commit da importação e módulos de física/geração/fairness/aiming/storage/service worker permanecem byte a byte iguais à base; verificação adicional local guardada em `audit/2026-10-10-pr11/preservation-verification.json`.

Estado da entrega: draft para revisão, qualificação física pendente. PR11 não é declarado integralmente concluído. Produção permanece 4.7.3; 4.7.4 é apenas a versão de trabalho. Não há autorização de merge/publicação.
