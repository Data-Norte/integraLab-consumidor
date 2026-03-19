@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo  IntegraLab Consumidor - Modo de Teste
echo ==========================================
echo.

if not exist node_modules (
  echo [1/3] Instalando dependencias...
  call npm install
  if errorlevel 1 goto :error
) else (
  echo [1/3] Dependencias ja instaladas.
)

if not exist .env (
  echo [2/4] Arquivo .env nao encontrado.
  echo        Crie o .env a partir do .env.example antes de testar.
  goto :error
) else (
  echo [2/4] Arquivo .env localizado.
)

echo [3/4] Iniciando servidor do consumidor...
echo.
echo Healthcheck:
echo   http://localhost:3001/health
echo.
echo Processamento manual:
echo   POST http://localhost:3001/api/lab-apoio/v1/consumer/processar-pendentes
echo.
echo Webhook de entrada:
echo   POST http://localhost:3001/api/lab-apoio/v1/consumer/webhook
echo.
echo Pressione CTRL+C para encerrar.
echo.

echo [4/4] Executando launcher...
call npm run start:test
goto :eof

:error
echo.
echo Falha ao iniciar o consumidor.
pause
exit /b 1
