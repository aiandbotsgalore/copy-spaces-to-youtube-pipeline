$ErrorActionPreference = 'Stop'
$promptText = Get-Content -LiteralPath 'C:\Users\Logan\copy-spaces-to-youtube-pipeline\docs\_approved_one_call_claude_review_20261112.txt' -Raw -Encoding UTF8
Push-Location $env:TEMP
try {
  & 'C:\npmglobal\gemini.cmd' --model gemini-2.5-flash --approval-mode plan --output-format json --prompt $promptText
} finally {
  Pop-Location
}
