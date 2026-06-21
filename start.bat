@echo off
echo ====================================================
echo Starting PinkTileington Server...
echo ====================================================
echo.
echo Please leave this window open! 
echo If you close it, the tool will stop working.
echo.
echo Opening your browser automatically...
echo.
npx -y http-server -p 8081 -c-1 -o
pause
