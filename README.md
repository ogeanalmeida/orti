# 🌱 Minha Horta

App web (PWA) para monitorar hortaliças e mudas: cadastro de plantios, diário, painel "mastigado", dados detalhados, clima, assistente com IA, sensores (futuro) e backup na nuvem.
Funciona offline e pode ser "instalado" no celular sem App Store.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Visual. **No topo ficam os tokens de design** (cores, raio, fonte) — use os mesmos nomes no Figma |
| `app.js` | Toda a lógica do app |
| `catalog.js` | Catálogo de culturas (dias de germinação, rega, pH, temperatura…). Dá para editar e acrescentar |
| `sw.js` | Faz o app abrir sem internet |
| `manifest.webmanifest` + `icons/` | Nome, cor e ícone quando instalado no celular |

## Publicar no GitHub Pages (grátis, uns 10 minutos)

1. Crie uma conta em **github.com** (se ainda não tiver).
2. Clique em **+** (canto superior direito) › **New repository**.
   - Nome: `minha-horta` · marque **Public** · clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**.
4. Descompacte o `.zip` no computador e **arraste todos os arquivos e a pasta `icons`** para a página (não a pasta de fora, só o conteúdo). Clique em **Commit changes**.
5. Vá em **Settings** › **Pages** (menu da esquerda).
   - Em *Branch*, escolha **main** e pasta **/ (root)** › **Save**.
6. Espere 1–2 minutos e recarregue: aparece o endereço, algo como
   `https://SEU-USUARIO.github.io/minha-horta/`
7. Abra esse endereço no celular:
   - **Android (Chrome):** menu ⋮ › **Instalar app** / **Adicionar à tela inicial**
   - **iPhone (Safari):** **Compartilhar** › **Adicionar à Tela de Início**

Pronto: ícone na tela, abre em tela cheia e funciona offline.

### Atualizar o app depois
Envie os arquivos novos pelo mesmo caminho (**Add file › Upload files**) e, em `sw.js`, aumente o número em `CACHE = 'minha-horta-v1'` (v2, v3…). Os celulares pegam a versão nova na próxima abertura com internet. **Seus dados não se perdem** — eles ficam no aparelho, não no GitHub.

## Primeiros passos no app
1. ⚙️ › escreva seu nome.
2. ☀️ › busque sua cidade (ou use a localização) para o clima.
3. ⚙️ › **Backup e nuvem** › cole um token do GitHub com permissão `gist` (o app explica como criar). A partir daí o backup é automático sempre que houver internet.
4. ⚙️ › **Inteligência artificial** › cole uma chave (o Google Gemini tem cota grátis). Sem chave, o assistente responde com a base local, offline.

## Sensores (fase 2)
O app já guarda leituras de umidade do solo, pH, temperatura, umidade do ar e luz (à mão por enquanto). Quando o ESP32 estiver pronto, ele publica um JSON neste formato num serviço https e você cola o link em ⚙️ › Sensores:

```json
{ "umidade_solo": 62, "ph": 6.4, "temperatura": 24.5, "umidade_ar": 70, "luz": 55, "sensor": "esp32-vaso1" }
```

Se `sensor` bater com o "ID do sensor" de um plantio, a leitura vai para ele, e as regras de rega/pH/temperatura passam a usar o dado real.

## Privacidade
Dados ficam no navegador do aparelho (IndexedDB). Chave da IA e token do GitHub ficam só no aparelho e não entram no backup. O backup na nuvem vai para um Gist **secreto** da sua conta.
