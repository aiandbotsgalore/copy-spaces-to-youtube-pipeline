$ErrorActionPreference = 'Stop'
$env:CLAUDE_CODE_MAX_OUTPUT_TOKENS = '350'
$env:MAX_THINKING_TOKENS = '0'
$promptText = Get-Content -LiteralPath 'C:\Users\Logan\copy-spaces-to-youtube-pipeline\docs\_approved_one_call_claude_review_20261112.txt' -Raw -Encoding UTF8
& 'C:\npmglobal\claude.cmd' -p --model sonnet --safe-mode --system-prompt 'You are a concise story editor.' '--tools=' --max-turns 1 --effort low --no-session-persistence --output-format json $promptText
