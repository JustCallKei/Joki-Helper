@echo off
title Claude Code via Proxy
echo Launching Claude Code in your project folder...

:: Point to the local proxy server
set ANTHROPIC_BASE_URL=http://localhost:8082

:: Set the proxy authentication token
set ANTHROPIC_AUTH_TOKEN=freecc

:: Enable gateway model discovery and optimization
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
set CLAUDE_CODE_AUTO_COMPACT_WINDOW=190000

:: Run the real claude CLI, forwarding any arguments
claude %*
