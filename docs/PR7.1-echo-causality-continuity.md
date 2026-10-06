# PR7.1 — Causalidade e continuidade de Echo Memory

Estado: **ACEITE EM PRODUTO**. Gate humano comunicado por PT: **YES / YES / YES**. Decisão REVISE resolvida. PT autorizou explicitamente merge e publicação em 2026-10-06.

Revisão bounded de PR7 (PR #23, branch `codex/pr7-echo-memory-core-loop`, base `198894c`). Apenas apresentação e cobertura browser: criação real identifica a tacada e destaca o Rail retornado por `echoFromPath`; a mesa seguinte destaca Rails realmente carregados e identifica a origem anterior. Rails herdados mantêm uma marca ciana tracejada, distinguindo-os dos Rails novos. Estado visual apenas em memória; nenhum campo adicionado ao Rail ou ao save.

Aviso não bloqueante, `role=status`, `aria-live=polite`, 2200 ms, com transição existente desativada por movimento reduzido. O destaque do canvas é estático. Reinício, nova mesa, nova partida, rewind, nova tacada, ocultação/saída da página limpam os efeitos relevantes. Nenhuma alteração de física, scoring, lifetime, criação, seleção, persistência, progressão, modos, menus ou storage. PT Cognitive OS não alterado.

## Reproduzir e repetir o gate

Executar `npm run dev`. Em Echo Tour / Mesa Echo, ativar Forja Echo e executar uma tacada longa: se o percurso produzir um Rail, surge “A TUA TACADA CRIOU UM ECHO RAIL” sobre o destaque da linha criada. Sem Rail real não surge o aviso. Embocar uma bola de cor para avançar: com Rail sobrevivente, a mesa seguinte mostra “ECHO DA MESA ANTERIOR” / “A tua linha passou para esta mesa” e destaca a linha herdada. Também é possível criar/herdar por uma vitória normal em Daily Golf.

No mobile, apontar durante o aviso de herança e verificar que a mira e o controlo IMPACTO continuam utilizáveis. Repetir com Reduzir movimento.

Repetir exatamente:
1. Percebo que a mesa se lembra?
2. Percebo que a minha ação criou o Rail?
3. Na mesa seguinte percebo que jogo com uma consequência anterior?

Requerido: **YES / YES / YES**. Testes e screenshots não constituem aceitação.

## Verificação e limite

184 testes Node; build; checks CI de colisões (10000), bolsas (10000), aim reach (5000) e fairness (10000), seed 1337. Smoke browser completo e cobertura focada PR7.1: tacada física real cria e herda; ausência de criação e percurso sem Rail não anunciam criação; mesa inicial sem Rails não anuncia herança; destaque acompanha os objetos reais; mira durante herança; reinício limpa destaque e timer; movimento reduzido. Screenshots mobile de criação e herança inspecionadas.

Limite material: uma vitória mantém a transição original de 650 ms, que corta o aviso de criação antes dos 2200 ms. Não foi atrasada a progressão. A legibilidade deste caso deve ser avaliada no gate humano; se insuficiente, exige decisão explícita sobre a transição fora deste âmbito congelado. Uma criação por Forja sem vitória permite observar o aviso completo.

O apontador `.git` desta pasta refere uma localização antiga inexistente. Estado/diff foram lidos com `--git-dir` explícito para os metadados existentes em `../tri-echo/.git/worktrees/tri-echo-pr7-echo-memory-core-loop`. Não foram reparados metadados. A revisão será integrada por commit na branch existente.
