# Lista de Nascimento — Website + Backend (Supabase)

Aplicação de lista de nascimento (registo de prendas) com:

- **Base de dados & Backend**: Supabase (PostgreSQL Cloud com transações atómicas e Realtime).
- **Frontend público**: site estático (HTML/CSS/JS puro, sem build step) para os convidados verem e reservarem itens com sincronização em tempo real.
- **Painel de administração**: página estática separada para gerir produtos e reservas.
- **Hosting sugerido**: Azure Static Web Apps, GitHub Pages, Vercel ou Netlify.

---

## 1. Estrutura de ficheiros

```
babyShower/
├── config.js       # Credenciais públicas do Supabase (URL + Anon Key)
├── styles.css      # Estilos partilhados pelo site público e admin
├── index.html      # Site público para os convidados
├── app.js          # Lógica do site público (Realtime + Reserva Atómica)
├── admin.html      # Painel de administração
├── admin.js        # Lógica do painel de administração
└── README.md
```

---

## 2. Configuração do Frontend

As credenciais do Supabase estão configuradas em `config.js`:

```javascript
window.APP_CONFIG = {
  SUPABASE_URL: 'https://abrkfvebnxkpfcywyiyy.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
```

---

## 3. Painel de Administração

- Acede a `admin.html`.
- A chave de acesso configurada por defeito encontra-se em `admin.js` (`ADMIN_SECRET`).
- Podes criar novos produtos, editar preços/quantidades, desativar produtos e consultar ou cancelar reservas.

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
