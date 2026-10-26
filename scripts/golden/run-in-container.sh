#!/bin/sh
# Runs inside a golden image. Reads tab-separated cases (tz, base unix seconds, expression) from $1 and
# prints one delimited record per case for generate.ts to parse. Environment info comes first.
set -u

printf '@@SYSTEMD %s\n' "$(systemd-analyze --version | head -n 1)"
printf '@@GLIBC %s\n' "$(ldd --version | head -n 1)"
if command -v rpm >/dev/null 2>&1; then
  printf '@@TZDATA %s\n' "$(rpm -q tzdata)"
else
  printf '@@TZDATA %s\n' "$(dpkg-query -W -f '${Version}' tzdata)"
fi

out=$(mktemp)
err=$(mktemp)
while IFS='	' read -r tz base expr; do
  TZ="$tz" systemd-analyze calendar --iterations=10 --base-time="@$base" -- "$expr" >"$out" 2>"$err"
  rc=$?
  printf '@@CASE\t%s\t%s\t%s\n' "$tz" "$base" "$expr"
  cat "$out"
  printf '@@STDERR\n'
  cat "$err"
  printf '@@RC %s\n' "$rc"
done <"$1"
