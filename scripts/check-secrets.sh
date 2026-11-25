#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Controllo anti-segreti: blocca token, chiavi API e chiavi private prima
#  che finiscano nel repository pubblico.
#
#    bash scripts/check-secrets.sh            controlla i file tracciati
#    bash scripts/check-secrets.sh --staged   controlla ciò che sta per essere
#                                             committato (usato dall'hook)
#
#  Per attivare l'hook pre-commit nel tuo clone:
#    git config core.hooksPath .githooks
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

mode="${1:-}"
grep_scope=()
name_cmd=(git ls-files)
if [ "$mode" = "--staged" ]; then
  grep_scope=(--cached)
  name_cmd=(git diff --cached --name-only --diff-filter=ACMR)
fi

# Contenuti sospetti (espressioni regolari estese).
patterns=(
  'sk-ant-[A-Za-z0-9_-]{20,}'                         # chiavi API Anthropic / Claude
  'sk-(proj-)?[A-Za-z0-9]{32,}'                       # chiavi API stile OpenAI
  'gh[pousr]_[A-Za-z0-9]{36,}'                        # token GitHub
  'github_pat_[A-Za-z0-9_]{50,}'                      # token GitHub fine-grained
  'AKIA[0-9A-Z]{16}'                                  # chiavi AWS
  'AIza[0-9A-Za-z_-]{35}'                             # chiavi Google
  'xox[abposr]-[A-Za-z0-9-]{10,}'                     # token Slack
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'                # chiavi private SSH / TLS
  '(api[_-]?key|secret|token|password)[A-Za-z_]*[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_./+=-]{16,}["'"'"']'
)

# Nomi di file che non devono essere pubblicati.
forbidden_names='(^|/)(\.env(\.[^/]*)?|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx|ppk|keystore|jks)|credentials[^/]*\.json|secrets[^/]*\.json|settings\.local\.json|\.git-credentials|\.netrc|\.npmrc)$'

args=()
for p in "${patterns[@]}"; do args+=(-e "$p"); done

found=0

# 1) contenuti: stampa solo file:riga, mai il valore trovato
hits="$(git grep "${grep_scope[@]}" -n -I -i -E "${args[@]}" -- . ':(exclude)scripts/check-secrets.sh' 2>/dev/null | cut -d: -f1,2 || true)"
if [ -n "$hits" ]; then
  found=1
  echo "✖ Possibili segreti trovati (file:riga):"
  echo "$hits" | sed 's/^/    /'
fi

# 2) nomi di file
bad_files="$("${name_cmd[@]}" | grep -E "$forbidden_names" | grep -v -E '(^|/)\.env\.example$' || true)"
if [ -n "$bad_files" ]; then
  found=1
  echo "✖ File che non devono essere pubblicati:"
  echo "$bad_files" | sed 's/^/    /'
fi

if [ "$found" -ne 0 ]; then
  echo
  echo "Commit/controllo bloccato: rimuovi i dati sensibili (e aggiungili a .gitignore)."
  exit 1
fi

echo "✔ Nessun segreto trovato."
exit 0
