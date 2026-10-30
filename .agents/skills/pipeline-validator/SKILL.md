---
name: pipeline-validator
description: Validates and audits GitHub Actions workflows, Bash scripts, and yt-dlp commands. Use when users ask to check, fix, or optimize their CI/CD pipelines or download scripts.
---

# Pipeline Validator

## Overview
This skill provides authoritative validation for the "SpacePipe" project's output artifacts. It ensures generated code adheres to security best practices, strict mode standards, and optimal media extraction settings.

## Core Capabilities

### 1. GitHub Actions Audit
Validates `.yml` workflow files for security and performance.
*   **Key Checks:** Least privilege permissions, pinned actions (SHA), secret safety.
*   **Reference:** [github-actions-security.md](references/github-actions-security.md)

### 2. Audio Extraction Optimization
Validates `yt-dlp` commands for podcast-quality audio.
*   **Key Checks:** Codec selection (MP3/VBR), metadata embedding, thumbnail handling.
*   **Reference:** [yt-dlp-audio-ops.md](references/yt-dlp-audio-ops.md)

### 3. Script Hardening
Validates Bash scripts for strict mode compliance.
*   **Key Checks:** `set -euo pipefail` presence, safe variable expansion, error handling.
*   **Reference:** [bash-strict-mode.md](references/bash-strict-mode.md)

## Validation Workflow

When a user asks to validate or generate a file, follow this process:

1.  **Identify the File Type:**
    *   `*.yml` / `*.yaml` -> GitHub Actions
    *   `*.sh` -> Bash Script
    *   `yt-dlp` command -> Audio Extraction

2.  **Load Reference:** Read the specific reference file linked above.

3.  **Audit:** Compare the user's code against the "Recommended" patterns in the reference.

4.  **Report:**
    *   **Critical:** Security flaws (e.g., unpinned actions, `chmod 777`).
    *   **Warning:** Suboptimal settings (e.g., missing metadata flags).
    *   **Pass:** Compliant code.