#!/usr/bin/env python3
"""
Fix AgentTeams integration patches by adding missing 'diff --git' lines.
"""
import os
import re
import sys

PATCHES = [
    ("install/patches/0001-hiclaw-install-dashboard.patch", "install/hiclaw-install.sh"),
    ("install/patches/0002-hiclaw-verify-dashboard.patch", "install/hiclaw-verify.sh"),
    ("install/patches/0003-Makefile-dashboard.patch", "Makefile"),
]


def fix_patch(patch_path: str, target_file: str) -> bool:
    """Insert 'diff --git' line after the diffstat if it's missing."""
    with open(patch_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Find the line that ends the diffstat section:
    # It looks like " 1 file changed, 80 insertions(+)"
    diffstat_end_idx = -1
    for i, line in enumerate(lines):
        if re.match(r"^ \d+ file(s)? changed", line):
            diffstat_end_idx = i
            break

    if diffstat_end_idx == -1:
        print(f"[WARN] Could not find diffstat in {patch_path}")
        return False

    # Check if diff --git already exists
    for line in lines[diffstat_end_idx + 1 :]:
        if line.startswith("diff --git"):
            print(f"[OK] {patch_path} already has diff --git line")
            return True
        # Stop checking once we hit the old-style ---/+++ lines
        if line.startswith("--- a/") or line.startswith("--- "):
            break

    # Insert diff --git line after diffstat (and the following blank line if any)
    insert_idx = diffstat_end_idx + 1
    if insert_idx < len(lines) and lines[insert_idx].strip() == "":
        insert_idx += 1

    new_lines = (
        lines[:insert_idx]
        + [f"diff --git a/{target_file} b/{target_file}\n"]
        + lines[insert_idx:]
    )

    # Backup original
    backup_path = patch_path + ".bak"
    with open(backup_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

    with open(patch_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    print(f"[FIXED] {patch_path}: added diff --git line")
    return True


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(repo_root)

    all_ok = True
    for patch_path, target_file in PATCHES:
        if not os.path.exists(patch_path):
            print(f"[ERROR] Patch not found: {patch_path}")
            all_ok = False
            continue
        if not fix_patch(patch_path, target_file):
            all_ok = False

    if all_ok:
        print("\nAll patches fixed successfully.")
        return 0
    else:
        print("\nSome patches could not be fixed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
