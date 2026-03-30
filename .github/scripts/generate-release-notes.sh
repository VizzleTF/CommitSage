#!/usr/bin/env bash
set -euo pipefail

LATEST_TAG=$(git describe --tags --abbrev=0)
SECOND_LATEST_TAG=$(git describe --tags --abbrev=0 "$LATEST_TAG^")

CHANGES=$(git log "$SECOND_LATEST_TAG..$LATEST_TAG" --pretty=format:"- %s")
CLEAN_CHANGES=$(echo "$CHANGES" | sed 's/\\n/\n/g' | sed 's/^Changes://g')
ESCAPED_CHANGES=$(echo "$CLEAN_CHANGES" | sed 's/`/\\`/g')

if echo "$CLEAN_CHANGES" | grep -qi "security patch release"; then
  RELEASE_NOTE="This release contains important security updates."
else
  RELEASE_NOTE=""
fi

if [ -n "${GEMINI_API_KEY:-}" ]; then
  jq -n --arg text "Extract only the most important changes from this VS Code extension changelog. Return ONLY bullet points, NO introductory text, NO explanations. Format: • description with emoji. Maximum 5 points. Use English. Start immediately with the first bullet point.

Changelog:
$CLEAN_CHANGES" '{
    contents: [{ parts: [{ text: $text }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
  }' > ai_prompt.json

  RESPONSE=$(curl -sf -w "HTTPSTATUS:%{http_code}" -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d @ai_prompt.json) || true

  HTTP_STATUS=$(echo "$RESPONSE" | grep -o "HTTPSTATUS:[0-9]*" | cut -d: -f2)
  RESPONSE_BODY=$(echo "$RESPONSE" | sed -E 's/HTTPSTATUS:[0-9]*$//')

  if [ "${HTTP_STATUS:-0}" -eq 200 ]; then
    AI_SUMMARY=$(echo "$RESPONSE_BODY" | jq -r '.candidates[0].content.parts[0].text // empty' 2>/dev/null)
    if [ -n "$AI_SUMMARY" ] && [ "$AI_SUMMARY" != "null" ]; then
      SUMMARIZED_CHANGES="$AI_SUMMARY"
    else
      SUMMARIZED_CHANGES=$(echo "$CLEAN_CHANGES" | head -5 | sed 's/^- /• /')
    fi
  else
    SUMMARIZED_CHANGES=$(echo "$CLEAN_CHANGES" | head -5 | sed 's/^- /• /')
  fi

  rm -f ai_prompt.json
else
  SUMMARIZED_CHANGES=$(echo "$CLEAN_CHANGES" | head -5 | sed 's/^- /• /')
fi

escape_html() {
  echo "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

ESCAPED_SUMMARIZED_CHANGES=$(escape_html "$SUMMARIZED_CHANGES")
ESCAPED_TAG=$(escape_html "$LATEST_TAG")

TELEGRAM_MSG=$(printf '%s\n' \
  "🎉 <b>CommitSage ${ESCAPED_TAG}</b>" \
  "" \
  "✨ <b>What's New:</b>" \
  "$ESCAPED_SUMMARIZED_CHANGES" \
  "" \
  "📦 <b>Download:</b>" \
  "• <a href=\"https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit\">VS Code Marketplace</a>" \
  "• <a href=\"https://open-vsx.org/extension/VizzleTF/geminicommit\">Open VSX Registry</a>" \
  "" \
  "💬 <a href=\"https://t.me/gemini_commit\">Join community chat</a>" \
  "#CommitSage #vscode #ai")

if [ ${#TELEGRAM_MSG} -gt 4000 ]; then
  TELEGRAM_MSG="${TELEGRAM_MSG:0:3900}..."
fi

{
  echo "TELEGRAM_MSG<<RELEASE_NOTES_DELIM"
  echo "$TELEGRAM_MSG"
  echo "RELEASE_NOTES_DELIM"
} >> "$GITHUB_OUTPUT"

if [ -n "$RELEASE_NOTE" ]; then
  {
    echo "NOTES<<RELEASE_NOTES_DELIM"
    printf '%s\n\nChanges:\n%s' "$RELEASE_NOTE" "$ESCAPED_CHANGES"
    echo ""
    echo "RELEASE_NOTES_DELIM"
  } >> "$GITHUB_OUTPUT"
else
  {
    echo "NOTES<<RELEASE_NOTES_DELIM"
    printf 'Changes:\n%s' "$ESCAPED_CHANGES"
    echo ""
    echo "RELEASE_NOTES_DELIM"
  } >> "$GITHUB_OUTPUT"
fi
