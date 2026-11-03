@echo off
chcp 65001 >nul
title VTT — редеплой на vtt.poison.press
cd /d "%~dp0"
setlocal EnableExtensions

rem --- Редеплой стола на живой сайт -------------------------------------------
rem Двойной щелчок: собрать статику из текущей версии package.json, сверить
rem зеркало правил для Python, проверить комплект, выложить его на виртуальный
rem хостинг SpaceWeb по ssh (scp) и проверить живой сайт.
rem
rem Сама выкладка живёт в deploy/apache/deploy.py — батник только оборачивает её,
rem чтобы не вспоминать длинную команду и не забыть пересобрать out/.
rem
rem   redeploy.bat             сборка + проверка + выкладка + проверка сайта
rem   redeploy.bat --fast      без сборки: выложить то, что уже лежит в out/
rem   redeploy.bat --check     собрать и проверить комплект, на сервер не отправлять
rem   redeploy.bat --archive   собрать zip для файлового менеджера панели (ssh не нужен)
rem   redeploy.bat --dry-run   показать команды scp, ничего не выкладывая
rem   redeploy.bat --no-pause  не ждать нажатия клавиши в конце (для панели и скриптов)
rem
rem Остальные аргументы уходят в deploy.py как есть (--target, --url, --code,
rem --skip-verify и т.д.).
rem
rem Частая причина «сайт не обновился»: out/ собран из старой версии, и проверка
rem комплекта останавливает выкладку. Поэтому сборка здесь по умолчанию.
rem ---------------------------------------------------------------------------

set "MODE=deploy"
set "BUILD=1"
set "PAUSE=1"
set "EXTRA="

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--check"    ( set "MODE=check"   & shift & goto parse )
if /i "%~1"=="--archive"  ( set "MODE=archive" & shift & goto parse )
if /i "%~1"=="--fast"     ( set "BUILD=0"     & shift & goto parse )
if /i "%~1"=="--no-pause" ( set "PAUSE=0"     & shift & goto parse )
if /i "%~1"=="--help"     goto usage
if /i "%~1"=="-h"        goto usage
set "EXTRA=%EXTRA% %~1"
shift
goto parse

:parsed
set "VER=?"
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version" 2^>nul`) do set "VER=%%v"

echo.
echo === Редеплой VTT %VER% ===

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Не нашла Node.js: без него не собрать статику. Нужен Node 20 или новее.
  goto failed
)

py -3.13 -V >nul 2>nul
if errorlevel 1 (
  echo.
  echo Не нашла Python 3.13: выкладку запускает deploy.py под `py -3.13`.
  goto failed
)

if /i not "%MODE%"=="archive" if not exist "%USERPROFILE%\.ssh\sweb_deploy" (
  echo.
  echo Нет ключа %USERPROFILE%\.ssh\sweb_deploy — по ssh выкладка не пройдёт.
  echo Соберите архив и загрузите его в панели SpaceWeb: redeploy.bat --archive
  goto failed
)

if "%BUILD%"=="1" (
  echo.
  echo Зеркало правил для Python:
  node tools\export-python-data.mjs --check
  if errorlevel 1 (
    echo.
    echo python\data\rules.json разошёлся с lib\rules.ts — на сайт уехали бы старые правила.
    echo Обновите зеркало: npm run python:data, закоммитьте python\data\rules.json и повторите.
    goto failed
  )
)

set "ARGS="
if "%BUILD%"=="1" set "ARGS=%ARGS% --build"
if /i "%MODE%"=="check"   set "ARGS=%ARGS% --check"
if /i "%MODE%"=="archive" set "ARGS=%ARGS% --archive"

py -3.13 deploy\apache\deploy.py%ARGS%%EXTRA%
if errorlevel 1 goto failed

echo.
if /i "%MODE%"=="archive" (
  echo Дальше — в панели SpaceWeb: загрузить архив из строки выше и распаковать его там же.
) else if /i "%MODE%"=="check" (
  echo Комплект проверен, на сервер ничего не отправлено.
) else (
  echo Готово: комплект выложен, ответы сайта — в проверке выше.
)
set "CODE=0"
goto finish

:failed
echo.
echo Редеплой не прошёл: смотрите сообщения выше.
set "CODE=1"
goto finish

:finish
rem Пауза нужна при двойном щелчке, чтобы окно не закрылось вместе с отчётом;
rem из панели и скриптов её снимает --no-pause, иначе процесс ждёт нажатия.
if "%PAUSE%"=="1" pause
endlocal & exit /b %CODE%

:usage
echo Редеплой VTT на https://vtt.poison.press
echo.
echo   redeploy.bat             сборка + проверка + выкладка + проверка сайта
echo   redeploy.bat --fast      без сборки: выложить то, что уже лежит в out/
echo   redeploy.bat --check     собрать и проверить комплект, на сервер не отправлять
echo   redeploy.bat --archive   собрать zip для файлового менеджера панели
echo   redeploy.bat --dry-run   показать команды scp, ничего не выкладывая
echo   redeploy.bat --no-pause  не ждать нажатия клавиши в конце
echo.
echo Остальные аргументы уходят в deploy/apache/deploy.py как есть.
echo Подробности: deploy/apache/README.md, раздел «Выкладка».
exit /b 0
