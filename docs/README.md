# Documentacao do Consumidor

Arquivos atuais:

- `como-usar-consumidor.html`: guia HTML com setup, execucao, endpoints e testes de smoke.
- `public-qa-dashboard.html`: tela publica de QA com logs locais, filtros por tenant, detalhe do payload e preview de PDF.
- `README.md`: resumo rapido do material de apoio.

Observacao:

- o launcher local para teste fica na raiz do projeto em `iniciar-consumidor-teste.cmd`
- tambem e possivel iniciar por linha de comando com `npm run start:test`
- o consumidor usa o `.env` local para apontar para a API e para as credenciais do vinculo
- a view publica fica em `/qa` e os dados persistidos localmente ficam em `.runtime/qa-data`
