#!/bin/sh
set -eu
TARGET=${1:?target path required}
BACKUP=${2:?backup path required}
cp "$BACKUP" "$TARGET"
printf 'restored %s from %s\n' "$TARGET" "$BACKUP"
