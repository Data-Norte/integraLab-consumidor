@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT_DIR=%~dp0"
set "API_DIR=%ROOT_DIR%..\integraLab-api"
set "API_CONTAINER=integralab-api-local-run"
set "API_IMAGE=integralab-api:local"
set "API_NETWORK=integralab-api_default"
set "CONSOLE_DB_CONTAINER=integralab-console-postgres"
set "NEMESIS_DB_CONTAINER=integralab-nemesis-mariadb"
set "API_BASE_URL="
set "API_HEALTH_URL="
set "API_CAN_AUTOSTART=0"

echo ==========================================
echo  IntegraLab Consumidor - Modo de Teste
echo ==========================================
echo.

call :ensure_consumer_dependencies
if errorlevel 1 goto :error

call :ensure_consumer_env
if errorlevel 1 goto :error

call :resolve_api_base_url
if errorlevel 1 goto :error

call :ensure_api_ready
if errorlevel 1 goto :error

call :print_runtime_info

call :stop_listener_on_port 3001 "consumidor"
if errorlevel 1 goto :error

echo [7/7] Executando launcher do consumidor...
echo.
call npm run start:test
goto :eof

:ensure_consumer_dependencies
if not exist node_modules (
  echo [1/7] Instalando dependencias do consumidor...
  call npm install
  exit /b %errorlevel%
)

echo [1/7] Dependencias do consumidor ja instaladas.
exit /b 0

:ensure_consumer_env
if not exist .env (
  echo [2/7] Arquivo .env do consumidor nao encontrado.
  echo        Crie o .env a partir do .env.example antes de testar.
  exit /b 1
)

echo [2/7] Arquivo .env do consumidor localizado.
exit /b 0

:resolve_api_base_url
for /f "usebackq tokens=1,* delims==" %%i in (`findstr /b /c:"INTEGRALAB_API_BASE_URL=" ".env"`) do (
  set "API_BASE_URL=%%j"
)

if not defined API_BASE_URL (
  echo [3/7] INTEGRALAB_API_BASE_URL nao foi encontrado no .env do consumidor.
  exit /b 1
)

set "API_BASE_URL=%API_BASE_URL:"=%"
if "%API_BASE_URL:~-1%"=="/" set "API_BASE_URL=%API_BASE_URL:~0,-1%"

set "API_HEALTH_URL=%API_BASE_URL%/health"
if /I "%API_BASE_URL%"=="http://127.0.0.1:3000" set "API_CAN_AUTOSTART=1"
if /I "%API_BASE_URL%"=="http://localhost:3000" set "API_CAN_AUTOSTART=1"

echo [3/7] API configurada em %API_BASE_URL%
exit /b 0

:ensure_api_ready
echo [4/7] Verificando disponibilidade da API...
call :probe_health "%API_HEALTH_URL%"
if not errorlevel 1 (
  echo        API ja esta respondendo em %API_HEALTH_URL%
  exit /b 0
)

if "%API_CAN_AUTOSTART%"=="0" (
  echo        A API nao respondeu em %API_HEALTH_URL%.
  echo        Como a URL nao e a API local padrao, suba a integraLab-api manualmente e tente de novo.
  exit /b 1
)

call :ensure_api_repository
if errorlevel 1 exit /b 1

call :ensure_docker_available
if errorlevel 1 exit /b 1

call :ensure_api_env
if errorlevel 1 exit /b 1

call :ensuredb
if errorlevel 1 exit /b 1

call :ensureapinet
if errorlevel 1 exit /b 1

call :build_api_image
if errorlevel 1 exit /b 1

call :start_api_container
if errorlevel 1 exit /b 1

call :wait_for_health "%API_HEALTH_URL%" 30 2
if errorlevel 1 (
  echo        A API foi iniciada, mas nao respondeu no healthcheck a tempo.
  echo        Consulte os logs com: docker logs %API_CONTAINER%
  exit /b 1
)

echo        API pronta em %API_HEALTH_URL%
exit /b 0

:ensure_api_repository
if not exist "%API_DIR%\package.json" (
  echo        Repositorio da API nao encontrado em "%API_DIR%".
  exit /b 1
)

echo [5/7] Repositorio da API localizado.
exit /b 0

:ensure_docker_available
docker --version >nul 2>&1
if errorlevel 1 (
  echo        Docker nao esta disponivel no PATH. Nao foi possivel subir a API local automaticamente.
  exit /b 1
)

echo [6/7] Docker localizado.
exit /b 0

:ensure_api_env
if not exist "%API_DIR%\.env" (
  echo        Arquivo .env da API nao encontrado em "%API_DIR%\.env".
  exit /b 1
)

exit /b 0

:ensuredb
for %%c in ("%CONSOLE_DB_CONTAINER%" "%NEMESIS_DB_CONTAINER%") do (
  docker inspect %%~c >nul 2>&1
  if errorlevel 1 (
    echo        Container %%~c nao existe. Suba os bancos locais antes de continuar.
    exit /b 1
  )
)

docker start %CONSOLE_DB_CONTAINER% %NEMESIS_DB_CONTAINER% >nul 2>&1
echo        Containers de banco verificados: %CONSOLE_DB_CONTAINER%, %NEMESIS_DB_CONTAINER%
exit /b 0

:ensureapinet
docker network inspect %API_NETWORK% >nul 2>&1
if errorlevel 1 (
  echo        Rede Docker %API_NETWORK% nao encontrada.
  echo        Garanta que os containers do Postgres/MySQL local foram criados corretamente.
  exit /b 1
)

exit /b 0

:build_api_image
echo        Atualizando imagem local da API (%API_IMAGE%)...
pushd "%API_DIR%" >nul
docker build -t %API_IMAGE% . 
set "BUILD_EXIT=%errorlevel%"
popd >nul
if not "%BUILD_EXIT%"=="0" (
  echo        Falha ao construir a imagem local da API.
  exit /b %BUILD_EXIT%
)

exit /b 0

:start_api_container
echo        Recriando container local da API...
docker rm -f %API_CONTAINER% >nul 2>&1
pushd "%API_DIR%" >nul
docker run -d --name %API_CONTAINER% --network %API_NETWORK% -p 3000:3000 --env-file .env -e POSTGRES_URL=postgresql://postgres:postgres@%CONSOLE_DB_CONTAINER%:5432/console?schema=public -e MYSQL_URL=mysql://root:1234@%NEMESIS_DB_CONTAINER%:3306/nemesis %API_IMAGE% >nul
set "RUN_EXIT=%errorlevel%"
popd >nul
if not "%RUN_EXIT%"=="0" (
  echo        Falha ao iniciar o container local da API.
  echo        Verifique se a porta 3000 esta livre e tente novamente.
  exit /b %RUN_EXIT%
)

exit /b 0

:wait_for_health
set "WAIT_URL=%~1"
set "WAIT_MAX=%~2"
set "WAIT_DELAY=%~3"
set /a WAIT_ATTEMPT=0

:wait_for_health_loop
set /a WAIT_ATTEMPT+=1
call :probe_health "%WAIT_URL%"
if not errorlevel 1 exit /b 0
if !WAIT_ATTEMPT! GEQ %WAIT_MAX% exit /b 1
timeout /t %WAIT_DELAY% /nobreak >nul
goto :wait_for_health_loop

:probe_health
powershell -NoProfile -Command "try { $resp = Invoke-RestMethod -Method Get -Uri '%~1' -TimeoutSec 4; if ($resp.status -eq 'ok') { exit 0 }; if ($resp.success -eq $true -and $resp.data.status -eq 'ok') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:stop_listener_on_port
set "TARGET_PORT=%~1"
set "TARGET_NAME=%~2"
set "TARGET_PID="

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort %TARGET_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($conn) { Write-Output $conn }"`) do (
  set "TARGET_PID=%%i"
)

if not defined TARGET_PID exit /b 0

echo [7/7] Encerrando processo existente na porta %TARGET_PORT% (%TARGET_NAME%)...
powershell -NoProfile -Command "try { Stop-Process -Id %TARGET_PID% -Force -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo        Nao foi possivel encerrar o processo %TARGET_PID% na porta %TARGET_PORT%.
  echo        Feche o processo manualmente e execute o script novamente.
  exit /b 1
)

call :wait_for_port_release %TARGET_PORT% 15 1
if errorlevel 1 (
  echo        A porta %TARGET_PORT% continuou ocupada apos encerrar o processo %TARGET_PID%.
  exit /b 1
)

echo        Processo %TARGET_PID% encerrado com sucesso.
exit /b 0

:wait_for_port_release
set "WAIT_PORT=%~1"
set "WAIT_MAX=%~2"
set "WAIT_DELAY=%~3"
set /a WAIT_PORT_ATTEMPT=0

:wait_for_port_release_loop
set /a WAIT_PORT_ATTEMPT+=1
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort %WAIT_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { exit 1 } else { exit 0 }" >nul 2>&1
if not errorlevel 1 exit /b 0
if !WAIT_PORT_ATTEMPT! GEQ %WAIT_MAX% exit /b 1
timeout /t %WAIT_DELAY% /nobreak >nul
goto :wait_for_port_release_loop

:print_runtime_info
echo.
echo Healthcheck da API:
echo   %API_HEALTH_URL%
echo.
echo Healthcheck do consumidor:
echo   http://localhost:3001/health
echo.
echo Health do modulo:
echo   http://localhost:3001/api/lab-apoio/v1/consumer/health
echo.
echo Processamento manual:
echo   POST http://localhost:3001/api/lab-apoio/v1/consumer/processar-pendentes
echo.
echo Webhook de entrada:
echo   POST http://localhost:3001/api/lab-apoio/v1/consumer/webhook
echo.
echo Se a API foi iniciada automaticamente, os logs ficam em:
echo   docker logs %API_CONTAINER%
echo.
echo Pressione CTRL+C para encerrar o consumidor.
echo.
exit /b 0

:error
echo.
echo Falha ao iniciar o ambiente de teste do consumidor.
pause
exit /b 1
