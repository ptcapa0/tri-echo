# Especificação executável — versão 4

- Mesas: Echo (portal móvel) ou Snooker (seis bolsas físicas); a escolha aplica-se a Table Golf, Bilhar de 3 bolas, Fusion, Echo Tour e Daily Golf.
- Modos puristas: pool americano 8-ball com mesa aberta, escolha de lisas/riscadas e bola 8 final; snooker britânico com 15 vermelhas, seis cores, alternância e sequência final.
- Trick Shot: tabela, kick, combinação, seguimento, recuo e duplo contacto; pontuação decresce com o número de tentativas.
- Treino: sessões contínuas sem penalização para Table Golf, Bilhar de 3 bolas e Snooker.
- Física: timestep 1/180 s, captura multibolsa, atração suave na boca, spin de seguimento/recuo/lateral e registo de tabelas/colisões por bola.

- Estados: menu, mira, simulação, resultado breve, cartão da volta, fim competitivo e definições.
- Table Golf: cada tentativa conta como tacada e não há limite; embocar uma cor conclui o objetivo e compara o resultado com o par; a branca numa bolsa ou portal é falta e reaparece.
- Bilhar de 3 bolas: na Mesa Echo não existe portal; a branca deve tocar nas outras duas bolas na mesma tacada. A Mesa Snooker acrescenta seis bolsas.
- Fusion: primeiro completa a carambola, depois ativa o portal e tenta embocar.
- Controlos: arrasto inverso para direção/força; controlo circular móvel para seguimento, recuo e efeito lateral.
- Física: timestep de 1/180 s, atrito exponencial mais resistência de rolamento, restituição consistente, transferência tangencial de spin, atração local do portal e limite seguro de 14 s.
- Potência: máximo cobre três comprimentos úteis mais três diâmetros; curva exponencial preserva precisão inicial.
- Pontuação: modos casuais mostram resultado relativo ao par. Echo Tour e Daily Golf usam pontos por desempenho abaixo do par, precisão, ressaltos e série.
- Poderes competitivos: Traço Longo, Lente, Fase, Forja Echo e Rewind; uma utilização por volta, sem moedas, compras ou aleatoriedade paga.
- Echo Rails: segmentos de trajetórias relevantes, sólidos em jogadas futuras, 2–3 ativos e remoção FIFO.
- Geração: Mulberry32, três bolas, portal, bumpers e zona slow/glide; separações mínimas, validação de limites e seeds determinísticas.
- Dados: localStorage e JSON exportável; sem conta, backend, analytics ou dados pessoais.
- Conclusão: PWA inicia, controlos não obstruem permanentemente a mesa, os cinco modos executam regras reais, poderes alteram a simulação, save restaura e cache funciona offline.
