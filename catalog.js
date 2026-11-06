/* Catálogo base de culturas (valores médios de referência para cultivo em vaso/ambiente protegido).
   germ: dias para germinar/enraizar [mín, máx]
   alvo: dias até a meta (colheita ou muda pronta) a partir do plantio
   alvoLabel: o que é a meta
   rega: regar a cada N dias (vaso pequeno seca rápido — ajuste com o sensor de umidade)
   luz: horas de luz direta (ou luz de cultivo) por dia
   temp / ph: faixa ideal
   umid: umidade do solo ideal em % (leitura de sensor capacitivo, referência)
   Você pode adicionar culturas próprias pelo app (Plantios > Novo > Outra). */
window.CATALOGO = [
  { id: "alface", nome: "Alface", e: "🥬", tipo: "Folhosa", germ: [4, 7], alvo: 50, alvoLabel: "colheita", rega: 1, luz: "4–6 h", temp: [15, 24], ph: [6.0, 6.8], umid: [60, 80],
    dica: "Gosta de solo sempre úmido e de temperatura amena. No calor forte ela 'pendoa' (sobe flor) e amarga. Semeie raso (0,5 cm)." },
  { id: "rucula", nome: "Rúcula", e: "🌿", tipo: "Folhosa", germ: [3, 7], alvo: 35, alvoLabel: "colheita", rega: 1, luz: "4–6 h", temp: [15, 25], ph: [6.0, 7.0], umid: [55, 75],
    dica: "Cresce rápido. Colha as folhas de fora e deixe o miolo crescer. Calor demais deixa a folha picante." },
  { id: "coentro", nome: "Coentro", e: "🌿", tipo: "Tempero", germ: [7, 14], alvo: 40, alvoLabel: "colheita", rega: 1, luz: "4–6 h", temp: [18, 28], ph: [6.0, 7.0], umid: [50, 70],
    dica: "Amasse levemente a semente (ela tem duas dentro) e deixe de molho 12 h antes de plantar para germinar mais rápido." },
  { id: "cebolinha", nome: "Cebolinha", e: "🧅", tipo: "Tempero", germ: [7, 14], alvo: 75, alvoLabel: "primeiro corte", rega: 2, luz: "4–6 h", temp: [13, 24], ph: [6.0, 7.0], umid: [50, 70],
    dica: "Corte a 3 cm do solo que ela rebrota. Pode plantar também a parte branca com raiz comprada na feira." },
  { id: "salsinha", nome: "Salsinha", e: "🌿", tipo: "Tempero", germ: [14, 28], alvo: 80, alvoLabel: "primeiro corte", rega: 1, luz: "4–6 h", temp: [15, 25], ph: [6.0, 7.0], umid: [55, 75],
    dica: "Germinação lenta — não desista antes de 4 semanas. Molho de 24 h ajuda." },
  { id: "manjericao", nome: "Manjericão", e: "🌿", tipo: "Tempero", germ: [5, 10], alvo: 50, alvoLabel: "colheita", rega: 1, luz: "6–8 h", temp: [20, 30], ph: [6.0, 7.5], umid: [50, 70],
    dica: "Ama sol e calor. Retire as flores para a planta continuar produzindo folhas." },
  { id: "hortela", nome: "Hortelã", e: "🌱", tipo: "Tempero", germ: [7, 14], alvo: 45, alvoLabel: "colheita", rega: 1, luz: "4–6 h", temp: [15, 28], ph: [6.0, 7.0], umid: [60, 80],
    dica: "Melhor por estaca (galho na água até enraizar). Espalha muito: plante sozinha no vaso." },
  { id: "couve", nome: "Couve", e: "🥬", tipo: "Folhosa", germ: [4, 7], alvo: 70, alvoLabel: "primeira colheita", rega: 1, luz: "4–6 h", temp: [16, 22], ph: [6.0, 7.0], umid: [55, 75],
    dica: "Colha as folhas de baixo para cima. Fique de olho em pulgão e lagarta na parte de trás das folhas." },
  { id: "espinafre", nome: "Espinafre", e: "🥬", tipo: "Folhosa", germ: [5, 10], alvo: 45, alvoLabel: "colheita", rega: 1, luz: "4–6 h", temp: [10, 22], ph: [6.5, 7.5], umid: [55, 75],
    dica: "Prefere clima fresco. Em região quente, o espinafre-de-nova-zelândia aguenta melhor." },
  { id: "rabanete", nome: "Rabanete", e: "🌸", tipo: "Raiz", germ: [3, 5], alvo: 30, alvoLabel: "colheita", rega: 1, luz: "4–6 h", temp: [10, 25], ph: [6.0, 7.0], umid: [55, 75],
    dica: "O mais rápido da horta: ótimo para testar. Vaso com pelo menos 15 cm de fundo." },
  { id: "cenoura", nome: "Cenoura", e: "🥕", tipo: "Raiz", germ: [7, 14], alvo: 95, alvoLabel: "colheita", rega: 1, luz: "5–6 h", temp: [16, 25], ph: [6.0, 6.8], umid: [55, 75],
    dica: "Semeie direto no lugar definitivo (não transplante). Substrato fofo e sem pedras." },
  { id: "beterraba", nome: "Beterraba", e: "🟣", tipo: "Raiz", germ: [5, 10], alvo: 70, alvoLabel: "colheita", rega: 1, luz: "5–6 h", temp: [15, 24], ph: [6.0, 7.0], umid: [55, 75],
    dica: "Cada 'semente' é um cachinho que gera várias mudas: faça o desbaste deixando a mais forte." },
  { id: "tomate-cereja", nome: "Tomate-cereja", e: "🍅", tipo: "Fruto", germ: [5, 10], alvo: 80, alvoLabel: "primeiros frutos", rega: 1, luz: "6–8 h", temp: [18, 30], ph: [6.0, 6.8], umid: [55, 75],
    dica: "Precisa de muita luz e tutor (estaca). Regue no solo, não nas folhas, para evitar fungos." },
  { id: "pimenta", nome: "Pimenta", e: "🌶️", tipo: "Fruto", germ: [7, 21], alvo: 100, alvoLabel: "primeiros frutos", rega: 2, luz: "6–8 h", temp: [20, 30], ph: [6.0, 7.0], umid: [45, 65],
    dica: "Germina melhor no calor (25–30 °C). Gosta de solo que seca um pouco entre regas." },
  { id: "pimentao", nome: "Pimentão", e: "🫑", tipo: "Fruto", germ: [7, 14], alvo: 110, alvoLabel: "primeiros frutos", rega: 1, luz: "6–8 h", temp: [20, 30], ph: [6.0, 6.8], umid: [55, 75],
    dica: "Ciclo longo. Precisa de vaso grande (15 L ou mais) para produzir bem." },
  { id: "pepino", nome: "Pepino", e: "🥒", tipo: "Fruto", germ: [3, 7], alvo: 50, alvoLabel: "primeiros frutos", rega: 1, luz: "6–8 h", temp: [20, 30], ph: [6.0, 7.0], umid: [60, 80],
    dica: "Trepadeira: dê um suporte para subir. Muita água na fase de fruto." },
  { id: "morango", nome: "Morango (muda)", e: "🍓", tipo: "Fruto", germ: [7, 14], alvo: 75, alvoLabel: "primeiros frutos", rega: 1, luz: "6–8 h", temp: [15, 25], ph: [5.5, 6.5], umid: [60, 80],
    dica: "Plante a muda sem enterrar a 'coroa' (o centro). Solo levemente ácido." },
  { id: "microverdes", nome: "Microverdes", e: "🌱", tipo: "Broto", germ: [1, 3], alvo: 10, alvoLabel: "colheita", rega: 1, luz: "4 h", temp: [18, 24], ph: [6.0, 7.0], umid: [60, 80],
    dica: "Bandeja rasa, semeadura bem densa, borrife água 2× ao dia. Colha com tesoura quando abrir as primeiras folhas." },
  { id: "maracuja", nome: "Maracujá (muda)", e: "🟡", tipo: "Muda frutífera", germ: [10, 30], alvo: 50, alvoLabel: "muda pronta p/ transplante", rega: 1, luz: "6–8 h", temp: [21, 32], ph: [5.5, 6.8], umid: [55, 75],
    dica: "Semente fresca germina melhor. Muda pronta com 15–25 cm e 3–4 pares de folhas." },
  { id: "melancia", nome: "Melancia (muda)", e: "🍉", tipo: "Muda frutífera", germ: [4, 8], alvo: 18, alvoLabel: "muda pronta p/ transplante", rega: 1, luz: "8 h", temp: [22, 32], ph: [6.0, 7.0], umid: [55, 75],
    dica: "Muda em copinho/bandeja; transplante com 2 folhas definitivas, sem quebrar o torrão." },
  { id: "mamao", nome: "Mamão (muda)", e: "🥭", tipo: "Muda frutífera", germ: [10, 20], alvo: 45, alvoLabel: "muda pronta p/ transplante", rega: 1, luz: "6–8 h", temp: [22, 32], ph: [5.5, 6.7], umid: [50, 70],
    dica: "Lave bem as sementes para tirar a mucilagem. Não encharque: apodrece fácil." }
];

window.EVENTOS = {
  rega:        { e: "💧", nome: "Rega" },
  germinou:    { e: "🌱", nome: "Germinou/Pegou" },
  adubacao:    { e: "🧪", nome: "Adubação" },
  transplante: { e: "🪴", nome: "Transplante" },
  poda:        { e: "✂️", nome: "Poda/Desbaste" },
  praga:       { e: "🐛", nome: "Praga/Doença" },
  colheita:    { e: "🧺", nome: "Colheita" },
  foto:        { e: "📷", nome: "Foto" },
  observacao:  { e: "📝", nome: "Observação" },
  perda:       { e: "🥀", nome: "Perda" }
};
