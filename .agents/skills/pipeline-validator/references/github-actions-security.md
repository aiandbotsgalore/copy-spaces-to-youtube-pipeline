# GitHub Actions Security Best Practices (2025)

## 1. Permissions (Least Privilege)

**NEVER** leave permissions at the default "Read/Write" level for `GITHUB_TOKEN`.
Explicitly define permissions at the top of every workflow.

### Recommended Default
```yaml
permissions:
  contents: read
```

### Common Permission Scopes
| Scope | Access Needed For... |
| :--- | :--- |
| `contents: write` | Pushing code, creating releases, or committing changes. |
| `packages: write` | Pushing to GitHub Container Registry (GHCR). |
| `id-token: write` | OIDC authentication (AWS/GCP/Azure login). |
| `pull-requests: write` | Commenting on PRs via bot. |

## 2. Pinning Actions

To prevent supply chain attacks (malicious code injected into a tag you use), pin actions to their **full commit SHA**, not a version tag.

**Bad (Mutable Tag):**
```yaml
uses: actions/checkout@v3
```

**Good (Immutable SHA):**
```yaml
uses: actions/checkout@a5ac7e51b41094c92402da3b24376905380afc29 # v4.1.6
```
*Tip: Use tools like Dependabot to keep these SHAs updated.*

## 3. Secret Management

*   **Never** print secrets to the console (logs are public in public repos).
*   **Avoid** passing `secrets.GITHUB_TOKEN` to third-party actions unless absolutely necessary.
*   **Shell Injection**: When using secrets in bash scripts, prefer passing them as environment variables rather than string interpolation.

**Vulnerable:**
```yaml
run: ./script.sh ${{ secrets.API_KEY }} # Can be visible in process list
```

**Secure:**
```yaml
env:
  API_KEY: ${{ secrets.API_KEY }}
run: ./script.sh
```

## 4. Third-Party Scripts
If `curl | bash` is used, ensure the script is pinned to a specific version or hash, or (better yet) check the script into your repository instead of downloading it at runtime.
