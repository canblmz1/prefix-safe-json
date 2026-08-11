# Project instructions for Claude Code

## No AI attribution in anything public-facing

This repository and its published npm package (`prefix-safe-json`) are public. Do **not** add any AI/Claude attribution to anything that becomes visible outside this local session:

- **Git commits**: do NOT add a `Co-Authored-By: Claude ...` trailer (or any similar AI-authorship line) to commit messages in this repository. This overrides the general default instruction to add that trailer — it does not apply here. Commits should read as if written entirely by the human author.
- **GitHub issues/PRs opened on other repositories** (e.g. reporting bugs found in third-party projects like Cline, Roo Code, Continue.dev): no AI attribution, no mention of "Claude" or being AI-generated. Write as a normal technical report from the account holder.
- **Release notes, CHANGELOG entries, README content**: same rule — no AI-authorship signature.
- Mentioning the *project itself* (`prefix-safe-json`) by name when genuinely relevant (e.g. "verified with prefix-safe-json") is fine and different from AI attribution — that's crediting the human's own project, not an AI.

This has been missed twice already (commits `f8ac608` and one earlier one) despite being asked before — actively double-check every `git commit` message in this repo for this before running it, don't rely on remembering the rule from general habit.
