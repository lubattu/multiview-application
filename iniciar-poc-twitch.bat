@echo off
title Twitch PoC (IRC) - PokeIdle Multiview
cd /d "%~dp0"
rem Uso: iniciar-poc-twitch.bat [canal1,canal2] [minutos]  (padrao: guaxilol1 por 30 min)
set CANAIS=%1
if "%CANAIS%"=="" set CANAIS=guaxilol1
set MINUTOS=%2
if "%MINUTOS%"=="" set MINUTOS=30
echo Canais: %CANAIS%  ^|  Duracao: %MINUTOS% min
echo (Ctrl+C encerra antes do tempo; o resumo/veredito aparece no fim)
echo.
node scripts\poc-twitch-irc.mjs %CANAIS% %MINUTOS%
echo.
pause
