# Especificação executável

- Estados: menu, mira, simulação, resultado breve, fim de sessão e definições.
- Regra base: a branca é a bola de ataque; embocar a dourada ou rosa no portal é sucesso; embocar a branca é falta. O portal é um círculo no interior da mesa e muda após cada sucesso.
- Controlos: arrastar da branca em sentido inverso define direção/força; largar dispara; regressar à zona morta cancela. Um controlo circular separado define seguimento, recuo e efeito lateral.
- Física: timestep de 1/180 s, atrito base 0,58, restituição de tabela 0,94, colisões 0,985, atração suave perto do portal e limite de 14 s. A potência máxima cobre três comprimentos úteis mais três diâmetros e preserva controlo fino.
- Efeito: impacto vertical modifica o impulso da branca depois de tocar noutra bola; impacto lateral acrescenta desvio tangencial nas colisões e altera ressaltos.
- Pontuação: 100 × multiplicador, +15 por ressalto e +75 por condição especial. Falhar quebra a série.
- Echo Rail: segmento longo da trajetória vencedora, sólido em turnos futuros; 2–3 ativos e remoção FIFO.
- Modos: Flow (vidas e desafios graduais), Zen (mesa contínua sem interrupções ou vidas), Precision (duas tentativas e condições), Rush (45 s e +5 s), Daily (seed UTC comum à versão).
- Desafios: bola-alvo, mínimo de ressaltos, limite de força e efeito obrigatório. A dificuldade muda previsão, força, obstáculos, margem, tamanho do portal, vidas e rails.
- Geração: Mulberry32, três bolas, portal, 0–3 bumpers e zona slow/glide opcional; separações mínimas e validação de limites/sobreposições. Reposicionamento e respawn também são determinísticos.
- Dados: localStorage e JSON exportável; sem conta, backend, analytics ou serviços externos.
- Conclusão: PWA inicia, ambos os controlos respondem, uma bola colorida pode ser embocada, a branca gera falta, Zen continua na mesma mesa, portal muda, modos pontuam, save restaura e cache funciona offline.
