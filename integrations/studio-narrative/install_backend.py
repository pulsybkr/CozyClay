"""Review/check the staged backend. Copy only with explicit --apply.

The file manifest guards against overwriting backend changes since packaging.
Run from a workspace that permits writing the target backend directory.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from datetime import datetime, timezone


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="Install checked files and save backups")
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    target = args.target.resolve()
    if not (target / "app" / "main.py").is_file():
        parser.error("Target must be the existing workflow_gen_short_with_ia backend")
    manifest = json.loads((package / "backend-baseline.json").read_text(encoding="utf-8-sig"))
    changes = []
    for relative, baseline in manifest.items():
        source = (package / "backend" / relative).resolve()
        destination = (target / relative).resolve()
        source.relative_to(package / "backend")
        destination.relative_to(target)
        current = digest(destination)
        expected = digest(source)
        if current == expected:
            continue
        if current != baseline:
            parser.error(f"Backend changed since packaging: {relative}. Review and merge this file first.")
        changes.append((source, destination, relative))
    print(f"Checked {len(manifest)} files; {len(changes)} updates to install.")
    for _, _, relative in changes:
        print(relative)
    if not args.apply:
        print("Check only. Add --apply from a workspace with backend write access to install.")
        return
    backup = target / ".studio-narrative-backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    for source, destination, relative in changes:
        if destination.is_file():
            saved = backup / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, saved)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    print(f"Installed. Backups: {backup}. Restart the backend to load the page and services.")


if __name__ == "__main__":
    main()
