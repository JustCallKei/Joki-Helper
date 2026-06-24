@echo off
title Free Claude Code Proxy
echo Starting Free Claude Code Proxy...
cd /d "%~dp0free-claude-code"
uv run uvicorn server:app --host 0.0.0.0 --port 8082
pause