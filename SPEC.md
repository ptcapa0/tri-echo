# Especificação executável

- Estados: menu, mira, simulação, resultado, fim de sessão, definições.
- Regra base: uma jogada é sucesso quando a bola principal toca uma vez em cada bola-alvo. Precision acrescenta ordem ou mínimo de ressaltos.
- Controlo: pointer down num raio confortável da bola, arrasto inverso para direção/força, libertar dispara, regressar a menos de 24 unidades cancela.
- Pontuação: 100 × multiplicador (sobe a cada 3 sucessos, máximo 5×) + 15 por ressalto. Falhar quebra a série.
- Echo Rail: segmento longo da trajetória bem-sucedida, sólido nas jogadas futuras; 2–3 ativos conforme dificuldade; o mais antigo sai primeiro.
- Modos: Flow (vidas), Zen (sem falha terminal), Precision (duas tentativas + condição), Rush (45 s, +5 s por sucesso), Daily (seed UTC comum à versão).
- Geração: PRNG Mulberry32, posições com separação mínima, 0–3 bumpers, zona slow/glide opcional; seed por sessão/nível. Validação verifica limites e sobreposições.
- Dificuldade altera assistência, força, densidade de obstáculos, vidas, margens e limite de rails. Adaptativo usa os últimos 12 resultados sem mostrar punições.
- Dados: localStorage, JSON exportável; nenhum dado pessoal, rede, conta ou backend.
- Critério de conclusão: PWA inicia, gesto dispara, física termina com segurança, carambola pontua, tabelas variam, os cinco modos executam as respetivas regras, save restaura e cache permite recarregar offline.
