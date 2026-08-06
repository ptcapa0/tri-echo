# Especificação executável — versão 3

- Estados: menu, mira, simulação, resultado breve, cartão da volta, fim competitivo e definições.
- Portal Golf: cada tentativa conta como tacada e não há limite; embocar uma cor conclui o buraco e compara o resultado com o par; a branca no portal é falta e reaparece.
- Carambola Clássica: não existe portal; a branca deve tocar nas outras duas bolas na mesma tacada.
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
