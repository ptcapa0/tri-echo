# PR4.1 — Aim Reach Integrity

## Problema e caracterização

O preview usava uma distância de paragem fechada que conhecia apenas o perfil
Echo/Traditional. A `frictionZone` gerada pela mesa não entrava no cálculo.
Num corredor sem colisões a 1000 de velocidade, o erro era 0,06% sem zona,
44,20% numa zona com factor 1,5 e 34,03% numa zona com factor 0,62.

## Decisão

`estimateTableStoppingDistance` calcula apenas o horizonte livre da bola
branca. Intersecta o raio de tiro com o rectângulo de fricção e avalia, por
segmentos, a mesma resistência de rolamento e drag do perfil de `Physics`.
Cada transição recupera a velocidade com 28 iterações fixas, logo o trabalho é
constante e determinístico durante o pointer move. Não há `Physics.step`,
colisões, raios, mutação de mesa ou pesquisa de primeiro contacto no caminho
interactivo.

`deriveAimPreview` continua responsável pela geometria analítica dos hits e
`Physics` continua a autoridade de colisões, rails e estado do jogo.

## Cobertura e gate

Os testes unitários comparam o novo horizonte com uma simulação `Physics`
independente em zona lenta, rápida, entrada, saída e passagem fora da zona.
`aim:validate` gera cenários determinísticos seedados e usa `Physics` como
oráculo para distância e para contactos alcançáveis/não alcançáveis. O gate de
CI executa 5000 casos com seed 1337 e reporta casos, passes, mismatches, erro
absoluto/relativo máximo e reprodução do pior caso.

## Scope

Sem alteração das regras de jogo, parâmetros físicos, colisões, geometria de
aim, assistência, controlos ou assets. A versão passa para 4.6.1 e roda a
cache do service worker.
