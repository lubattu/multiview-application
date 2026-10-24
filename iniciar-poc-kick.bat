@echo off
title Kick PoC - PokeIdle Multiview
cd /d "%~dp0"
rem Uso: iniciar-poc-kick.bat [canal] [minutos]  (padrao: guaxilol1 por 30 min)
set CANAL=%1
if "%CANAL%"=="" set CANAL=guaxilol1
set MINUTOS=%2
if "%MINUTOS%"=="" set MINUTOS=30
echo Canal: %CANAL%  ^|  Duracao: %MINUTOS% min
echo (Ctrl+C encerra antes do tempo; o resumo/veredito aparece no fim)
echo.
node scripts\poc-kick-headless.mjs %CANAL% %MINUTOS%
echo.
pause
