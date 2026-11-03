@echo off
rem Reconstruye la app de escritorio y deja el ejecutable nuevo en esta carpeta como Eureka.exe.
rem Hacelo después de cambiar el código; la primera vez tarda varios minutos.
setlocal
cd /d "%~dp0"
chcp 65001 >nul

rem Los archivos temporales pesados van a D: si existe (C: casi lleno).
if exist "D:\dev-cache\" (
  if not exist "D:\dev-cache\tmp" mkdir "D:\dev-cache\tmp"
  set "TEMP=D:\dev-cache\tmp"
  set "TMP=D:\dev-cache\tmp"
)

echo Construyendo Eureka...
call npm run build:debug
if errorlevel 1 (
  echo.
  echo No se pudo construir. Revisá el mensaje de arriba.
  pause
  exit /b 1
)

copy /y "src-tauri\target\debug\eureka.exe" "Eureka.exe" >nul
if errorlevel 1 (
  echo.
  echo Se construyó, pero no pude copiar el ejecutable. ¿Está Eureka abierta? Cerrala y volvé a probar.
  pause
  exit /b 1
)

echo.
echo Listo: Eureka.exe está actualizado. Abrilo con doble clic.
pause
