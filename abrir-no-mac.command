#!/bin/bash
# Dê dois cliques para abrir a Minha Horta no seu Mac (offline).
cd "$(dirname "$0")"
PORTA=8000
echo "Minha Horta rodando em http://localhost:$PORTA  (feche esta janela para parar)"
( sleep 1; open -a "Google Chrome" "http://localhost:$PORTA" 2>/dev/null || open -a "Opera" "http://localhost:$PORTA" 2>/dev/null || open "http://localhost:$PORTA" ) &
python3 -m http.server $PORTA
