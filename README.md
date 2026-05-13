# integraLab-consumidor

Simulador de laboratorio de apoio para consumir a `integraLab-api`, processar exames pendentes e devolver resultado estruturado com PDF.

## O que este projeto faz

O consumidor:

- recebe webhook assinado da API
- emite token tecnico de integracao
- busca exames pendentes
- gera um resultado fake
- gera um PDF minimo valido em base64
- envia resultado e PDF para a API

## Instalacao

No diretorio `integraLab-consumidor`:

```bash
npm install
npm run build
```

Execucao local validada:

```bash
node dist/server.js
```

Healthcheck:

```bash
GET http://127.0.0.1:3001/health
```

## Variaveis de ambiente

Base em [.env.example](./.env.example):

- `PORT`: porta HTTP do consumidor
- `INTEGRALAB_API_BASE_URL`: base da API
- `LAB_APOIO_TENANT_ID`: tenant alvo para processamento manual
- `LAB_APOIO_VINCULO_ID`: vinculo tecnico configurado no console
- `LAB_APOIO_AUTH_SECRET`: segredo da credencial de integracao
- `LAB_APOIO_WEBHOOK_SECRET`: segredo usado para validar webhook
- `LAB_APOIO_FORNEC_ID`: `fornecId` do PDF quando enviado inline
- `AUTO_PROCESS_WEBHOOK`: se `true`, webhook ja dispara o processamento
- `LAB_APOIO_SEND_INLINE_PDF`: se `true`, manda PDF no mesmo POST do resultado

Configuracao local atual em `.env`:

- `PORT=3001`
- `INTEGRALAB_API_BASE_URL=https://api.stg.datanorte.com.br`
- `LAB_APOIO_TENANT_ID=6b316f90-3803-4e94-b964-3567a0acb0f4`
- `LAB_APOIO_VINCULO_ID=c0b71c07-cacc-4f77-b9d8-530c19653b54`
- `LAB_APOIO_FORNEC_ID=8`
- `AUTO_PROCESS_WEBHOOK=true`
- `LAB_APOIO_SEND_INLINE_PDF=true`

Os segredos tecnicos ficam no `.env` local e nao devem ser copiados para documentacao compartilhada.

## Endpoints locais

- `GET /health`
- `POST /api/lab-apoio/v1/consumer/webhook`
- `POST /api/lab-apoio/v1/consumer/processar-pendentes`

## Como testar

### 1. Subir a API

Use a API em `http://127.0.0.1:3000`.

### 2. Subir o consumidor

```bash
npm run build
node dist/server.js
```

### 3. Forcar processamento manual

```bash
curl -X POST http://127.0.0.1:3001/api/lab-apoio/v1/consumer/processar-pendentes ^
  -H "content-type: application/json" ^
  -d "{\"tenantId\":\"6b316f90-3803-4e94-b964-3567a0acb0f4\",\"limit\":20}"
```

### 4. Fluxo automatico

Com o webhook configurado no console, a API envia `LAB_APOIO_EXAMES_DISPONIVEIS` para:

```text
http://127.0.0.1:3001/api/lab-apoio/v1/consumer/webhook
```

Se `AUTO_PROCESS_WEBHOOK=true`, o proprio webhook ja dispara `processPendingExams`.

## Como ficou a geracao do resultado

Para cada exame pendente o consumidor monta:

- `status: CONCLUIDO`
- `observacao: Resultado simulado para <descricao do exame>`
- `liberado: true`
- `prejudicado: false`
- `parametros[0].descricao = descricao do exame`
- `parametros[0].valor = "13.5"`
- `parametros[0].unidade1 = "g/dL"`
- `parametros[0].resultadoPadrao = data/hora atual em ISO`

As chaves de idempotencia ficam assim:

- resultado: `resultado-<agendaExameId>-<agendaExameItemId>`
- pdf: `pdf-<agendaExameId>-<agendaExameItemId>`

## Como ficou a geracao do PDF

O consumidor agora gera um PDF minimo valido, com uma pagina e linhas simples de texto:

- `RESULTADO DO EXAME`
- `AgendaExameId`
- `AgendaExameItemId`
- `CodExame`
- `Descricao`
- `Status: CONCLUIDO`
- `GeradoEm`

Esse PDF e convertido para base64 e enviado inline no campo `pdf.pdfBase64`.

## Observacoes operacionais

- o caminho validado para teste ponta a ponta foi `npm run build` + `node dist/server.js`
- quando nao ha pendencias, `/processar-pendentes` responde `SEM_PENDENCIAS`
- quando o mesmo exame ja foi enviado antes, a API responde `duplicado` e o consumidor registra isso no resultado

## Documentos relacionados

- API: `integraLab-api/docs/lab-apoio-consumidor.md`
- Console: `console/docs/lab-apoio-operacao-ponta-a-ponta.md`
- Guia geral: `docs/fluxo-geral-lab-apoio-console-api-consumidor.md`
