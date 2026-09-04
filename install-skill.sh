#!/usr/bin/env bash

set -euo pipefail

source_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
target="${HOME}/.agents/skills/orchestrate"
force=false
target_set=false

usage() {
  echo "Usage: install-skill.sh [--target <directory>] [--force]" >&2
}

while (( $# > 0 )); do
  case "$1" in
    --target)
      if [[ "$target_set" == true || -z "${2:-}" || "${2:-}" == --* ]]; then
        usage
        exit 2
      fi
      target="$2"
      target_set=true
      shift 2
      ;;
    --force)
      if [[ "$force" == true ]]; then
        usage
        exit 2
      fi
      force=true
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

target="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' -- "$target")"
home_directory="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' -- "$HOME")"
target_parent="$(dirname -- "$target")"
target_name="$(basename -- "$target")"

for required_path in SKILL.md scripts/flow dist/cli.js; do
  if [[ ! -f "$source_root/$required_path" ]]; then
    echo "Missing required runtime artifact: $required_path" >&2
    exit 1
  fi
done

if [[ "$target" == "/" || "$target_parent" == "/" ||
      "$target" == "$home_directory" ||
      "$target" == "$home_directory/.agents" ||
      "$target" == "$home_directory/.agents/skills" ||
      "$home_directory" == "$target/"* || "$source_root" == "$target" ||
      "$source_root" == "$target/"* ]]; then
  echo "Refusing unsafe installation target: $target" >&2
  exit 2
fi

if [[ ( -e "$target" || -L "$target" ) && "$force" == false ]]; then
  echo "Installation destination already exists: $target (use --force to replace it)" >&2
  exit 1
fi

mkdir -p "$target_parent"

stage="$(mktemp -d "$target_parent/.${target_name}.stage.XXXXXX")"
backup=""

cleanup() {
  status=$?

  if [[ -n "$backup" && ( -e "$backup" || -L "$backup" ) ]]; then
    if [[ ( -e "$target" || -L "$target" ) ]] && ! rm -rf -- "$target"; then
      echo "Failed to clear an incomplete activation; previous installation remains at: $backup" >&2
    elif mv "$backup" "$target"; then
      backup=""
    else
      echo "Failed to restore previous installation; it remains at: $backup" >&2
    fi
  fi
  if [[ -e "$stage" || -L "$stage" ]]; then
    rm -rf -- "$stage"
  fi

  exit "$status"
}
trap cleanup EXIT

mkdir "$stage/scripts" "$stage/dist"
cp "$source_root/SKILL.md" "$stage/SKILL.md"
cp "$source_root/scripts/flow" "$stage/scripts/flow"
cp -R "$source_root/dist/." "$stage/dist/"
for optional_directory in references assets schemas; do
  if [[ -d "$source_root/$optional_directory" ]]; then
    cp -R "$source_root/$optional_directory" "$stage/$optional_directory"
  fi
done

if [[ -e "$target" || -L "$target" ]]; then
  backup="$(mktemp -d "$target_parent/.${target_name}.backup.XXXXXX")"
  rmdir "$backup"
  mv "$target" "$backup"
fi

if ! mv "$stage" "$target"; then
  echo "Failed to activate installed skill snapshot" >&2
  exit 1
fi
stage=""

if [[ -n "$backup" ]]; then
  rm -rf -- "$backup"
  backup=""
fi
