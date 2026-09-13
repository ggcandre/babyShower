# Lista de Nascimento — Website + Backend (Google Sheets)

Aplicação de lista de nascimento (registo de prendas) com:

- **Backend**: Google Apps Script, usando a Google Spreadsheet existente como base de dados.
- **Frontend público**: site estático (HTML/CSS/JS puro, sem build step) para os convidados verem e reservarem itens.
- **Painel de administração**: página estática separada para gerir produtos e reservas.
- **Hosting sugerido**: Azure Static Web Apps para o frontend; Google Apps Script Web App para o backend.

---

## 1. Base de dados

Usa a spreadsheet Google Sheets **já existente**:

```
https://docs.google.com/spreadsheets/d/1Uz6i_1xUdLPjr40QsTZrR8p_g3i-QHH9JsCXiuh9AaI/edit
```

Nenhum código aqui cria uma nova spreadsheet.

### Alterações necessárias na Google Sheet

A folha `Site` estava **vazia** no momento da implementação — não havia cabeçalhos nem dados para preservar. Por isso, este projeto define os cabeçalhos de raiz na primeira execução de `setupSheets()` (ver secção 3). Os cabeçalhos criados são:

**Folha `Site`:**

| Cabeçalho | Campo lógico |
|---|---|
| ID | id |
| Nome | name |
| Descrição | description |
| Categoria | category |
| Preço | price |
| Quantidade Desejada | desiredQuantity |
| Imagem URL | imageUrl |
| Link de Compra | purchaseUrl |
| Ativo | active |
| Criado Em | createdAt |
| Atualizado Em | updatedAt |

**Folha `Reservas`** (criada dentro da mesma spreadsheet):

| Cabeçalho | Campo lógico |
|---|---|
| ID | id |
| Product ID | productId |
| Nome do Produto | productName |
| Nome do Convidado | guestName |
| Quantidade | quantity |
| Mensagem | message |
| Criado Em | createdAt |
| Status | status |

Se, no futuro, a folha `Site` já tiver dados com nomes de coluna diferentes destes, **não é necessário apagar nada** — basta editar o objeto `COLUMN_MAP` em `Code.gs` para apontar para os nomes reais das colunas. Todo o resto do código resolve as colunas por nome de cabeçalho, nunca por posição fixa.

A coluna `Ativo` aceita `TRUE`/`FALSE`, `Sim`/`Não`, `1`/`0` — qualquer um destes é interpretado corretamente.

**Nunca existe uma coluna de "quantidade disponível" guardada.** `available_quantity` é sempre calculada em tempo real como `desired_quantity − soma das reservas ativas`, para evitar inconsistências (ver secção 5).

---

## 2. Estrutura de ficheiros

```
lista-nascimento/
├── Code.gs                 # Ponto de entrada (doGet/doPost), config, COLUMN_MAP, setup
├── SheetHelpers.gs          # Leitura/escrita genérica da folha, respostas HTTP, erros
├── Products.gs               # Lógica de produtos (público + admin)
├── Reservations.gs           # Lógica de reservas (criar, listar admin, cancelar)
├── README.md
└── frontend/
    ├── config.js              # URL do Apps Script (ÚNICO sítio a configurar)
    ├── styles.css             # Estilo partilhado pelo site público e pelo admin
    ├── index.html             # Site público
    ├── app.js                 # Lógica do site público
    ├── admin.html             # Painel de administração
    └── admin.js               # Lógica do painel de administração
```

---

## 3. Configurar o backend (Google Apps Script)

1. Abrir a Google Spreadsheet existente (link acima).
2. No menu, ir a **Extensões → Apps Script**.
3. Isto cria um novo projeto Apps Script já associado a esta spreadsheet (não é uma spreadsheet nova — é só o "code-behind").
4. Apagar o conteúdo por omissão de `Code.gs` e criar os 4 ficheiros `.gs` deste projeto (`Code.gs`, `SheetHelpers.gs`, `Products.gs`, `Reservations.gs`), colando o conteúdo correspondente.
5. Confirmar que `SPREADSHEET_ID` em `Code.gs` corresponde à spreadsheet aberta (já vem pré-preenchido corretamente).
6. Na barra de funções do editor, selecionar a função **`setupSheets`** e clicar em **Executar**. Isto:
   - cria os cabeçalhos na folha `Site` (só se estiver vazia — não apaga nada existente);
   - cria a folha `Reservas` com os respetivos cabeçalhos, se ainda não existir.
7. Na primeira execução, o Google vai pedir autorização — aceitar (é o teu próprio script a aceder à tua própria spreadsheet).
8. Selecionar a função **`setupAdminKey`**, editar o valor `SUBSTITUIR_POR_UMA_CHAVE_SECRETA_FORTE` dentro do código para uma chave secreta forte e única, e executá-la uma vez. Isto guarda a chave em **Script Properties** (não fica visível no código depois de a mudares para produção — recomenda-se substituir o valor no código por um placeholder outra vez após correr a função, ou remover a função do ficheiro).
9. Fazer o deployment: **Deploy → New deployment**.
   - Tipo: **Web app**.
   - "Execute as": **Me** (a tua conta).
   - "Who has access": **Anyone** (necessário para o site público conseguir chamar a API; a proteção dos endpoints administrativos é feita pela `apiKey`, não pelo controlo de acesso do Apps Script).
10. Copiar o URL do Web App gerado (algo como `https://script.google.com/macros/s/XXXXX/exec`).

### Atualizações posteriores ao código

Sempre que editares o código `.gs`, é preciso criar uma **nova versão do deployment** (Deploy → Manage deployments → editar → nova versão) para as alterações ficarem ativas no URL público — guardar o ficheiro no editor não é suficiente.

---

## 4. Configurar o frontend

Todo o frontend está em `frontend/` e não precisa de build step — pode ser publicado como está.

1. Abrir `frontend/config.js` e substituir:

   ```javascript
   window.APP_CONFIG = {
     API_URL: 'URL_DO_GOOGLE_APPS_SCRIPT'
   };
   ```

   pelo URL copiado no passo anterior. Este é o **único** sítio onde o URL do backend é definido — tanto `app.js` (site público) como `admin.js` (painel admin) importam este ficheiro.

2. Publicar a pasta `frontend/` no Azure Static Web Apps (via GitHub Actions, Azure CLI, ou upload direto, conforme o fluxo já usado no projeto Azure).

3. O site público fica em `/index.html` (ou `/`), e o painel de administração em `/admin.html`. Considerar restringir o acesso a `/admin.html` a nível do Azure Static Web Apps (ex.: `staticwebapp.config.json` com uma rota protegida) como camada extra de proteção, já que a chave de admin sozinha é uma proteção básica.

---

## 5. Como funciona o cálculo de quantidades

```
available_quantity = desired_quantity − soma(quantidade das reservas com status "confirmed" ou "pending")
```

Este valor **nunca** é lido de uma coluna guardada — é sempre recalculado a partir da folha `Reservas` no momento do pedido. Isto evita que a folha `Site` e a folha `Reservas` fiquem dessincronizadas.

Quando uma reserva é cancelada (`status = cancelled`), deixa automaticamente de contar para este cálculo.

---

## 6. Concorrência

A criação de reservas usa `LockService.getScriptLock()` para evitar que duas pessoas reservem a mesma unidade em simultâneo:

```
Pedido do convidado (product_id, guest_name, quantity, message)
        ↓
adquirir Script Lock
        ↓
ler quantidade desejada do produto
        ↓
ler todas as reservas ativas e somar por produto
        ↓
calcular quantidade disponível
        ↓
validar quantidade pedida ≤ disponível
        ↓
criar reserva (status = confirmed)
        ↓
libertar lock
        ↓
responder ao frontend
```

O frontend **nunca** envia `available_quantity` — envia apenas `product_id`, `guest_name`, `quantity`, `message`. O servidor recalcula tudo antes de aceitar a reserva, o que evita reservas em excesso (overbooking) mesmo com vários convidados a reservar ao mesmo tempo.

Operações administrativas que escrevem na spreadsheet (`add_product`, `update_product`, `toggle_active`, `cancel_reservation`) usam o mesmo mecanismo de lock.

---

## 7. API

Todos os pedidos vão para o mesmo URL do Web App (`API_URL`).

### Pública

**`GET {API_URL}?action=products`**

```json
{
  "products": [
    {
      "id": "1",
      "name": "Pack de fraldas",
      "description": "Pack de fraldas tamanho 1",
      "category": "Higiene",
      "price": 15,
      "desired_quantity": 10,
      "reserved_quantity": 3,
      "available_quantity": 7,
      "image_url": "...",
      "purchase_url": "...",
      "active": true
    }
  ]
}
```

Nunca inclui produtos inativos, nem qualquer dado sobre convidados ou reservas individuais.

**`POST {API_URL}`**

```json
{
  "action": "reserve",
  "product_id": "1",
  "guest_name": "João",
  "quantity": 2,
  "message": "Com muito carinho 🤍"
}
```

Resposta de sucesso:

```json
{ "success": true, "message": "Reserva efetuada com sucesso." }
```

Resposta de erro (ex.: quantidade indisponível):

```json
{ "error": "Quantidade indisponível. Restam apenas 1 unidade(s).", "status": 409 }
```

> **Nota sobre códigos HTTP**: o Apps Script Web App devolve sempre código HTTP 200 — é uma limitação da plataforma, não deste código. Os erros são sinalizados pelo campo `"error"` dentro do corpo JSON (e um `"status"` lógico), e é isso que o frontend verifica — nunca o código HTTP da resposta.

### Administrativa (requer `apiKey`)

Todos os endpoints administrativos exigem o campo `apiKey` (definido em `setupAdminKey`), enviado como parâmetro de query nos `GET` e como campo do corpo nos `POST`.

- `GET ?action=admin_products&apiKey=...` — lista todos os produtos (ativos e inativos), com todos os campos.
- `GET ?action=admin_reservations&apiKey=...` — lista todas as reservas, com nomes e mensagens dos convidados. **Nunca exposto pela API pública.**
- `POST { action: "add_product", apiKey, name, description, category, price, desired_quantity, image_url, purchase_url }`
- `POST { action: "update_product", apiKey, id, ...campos a alterar }` — só altera os campos enviados.
- `POST { action: "toggle_active", apiKey, id }` — alterna (ou define, se `active` for enviado) o estado ativo/inativo.
- `POST { action: "cancel_reservation", apiKey, id }` — define `status = cancelled`.

Uma `apiKey` inválida ou em falta devolve `{ "error": "Não autorizado.", "status": 401 }`.

---

## 8. Privacidade

A API pública (`action=products`) **nunca** devolve:

- nomes dos convidados;
- mensagens;
- lista individual de reservas;
- dados administrativos (datas de criação/atualização, etc.).

Os convidados veem apenas `desired_quantity`, `reserved_quantity` e `available_quantity` por item. A folha `Reservas` só é acessível através dos endpoints `admin_*`, protegidos por `apiKey`.

---

## 9. Painel de administração

Acessível em `/admin.html`, pede a chave de administrador (guardada apenas em `sessionStorage` do browser, nunca persistida no servidor além das Script Properties). Permite:

- consultar produtos (ativos e inativos);
- adicionar novos produtos;
- editar produtos existentes;
- ativar/desativar produtos (esconde/mostra da lista pública sem apagar o produto);
- consultar todas as reservas, incluindo nome do convidado e mensagem;
- cancelar reservas — a partir do cancelamento, a quantidade deixa de contar para `reserved_quantity`.

---

## 10. Limitações conhecidas / possíveis melhorias futuras

- A proteção do admin é uma chave partilhada simples, adequada para uma lista de nascimento pessoal — não é um sistema de autenticação multi-utilizador. Para maior segurança, considerar também restringir `/admin.html` a nível do hosting (Azure Static Web Apps roles/config).
- `LockService.getScriptLock()` protege contra escritas concorrentes dentro do próprio Apps Script, mas o tempo de resposta de uma reserva pode aumentar ligeiramente sob uso simultâneo intenso — aceitável para o volume esperado de uma lista de nascimento.
- Os IDs de produtos e reservas são numéricos sequenciais simples, calculados a partir do maior ID existente na folha — suficiente para este volume de dados, mas não são UUIDs.
