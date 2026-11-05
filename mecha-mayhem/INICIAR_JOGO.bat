@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nao encontrado. Instale em https://nodejs.org ^(versao 22 ou mais nova^) e rode este arquivo de novo. & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias, aguarde... & call npm install || (pause & exit /b 1))
echo Abrindo o jogo em http://localhost:5173/  -  deixe esta janela aberta.
start "" http://localhost:5173/
call npm run dev
pause
