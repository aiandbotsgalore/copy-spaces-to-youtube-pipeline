import { EnhancedConfig } from '../types';
import { GitHubApiError } from './github';

export type SubmitAction = 'run' | 'queue';

export function validateSubmission(url: string, config: EnhancedConfig): string | null {
  if (!url.trim()) return 'Enter a Space or audio URL first.';
  if (!config.githubToken) return 'Connect GitHub before submitting a URL.';
  if (!config.ownerName || !config.repoName) {
    return 'Add the GitHub owner and repository name in Configuration before submitting.';
  }
  return null;
}

export function friendlyGitHubError(error: unknown, action: SubmitAction): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return 'GitHub rejected the connection. Reconnect with a valid token and try again.';
    if (error.status === 403) return 'GitHub denied this action. Check that the token has repository and workflow permissions.';
    if (error.status === 404) {
      return action === 'run'
        ? 'The repository or ingest workflow was not found. Check the owner/repo and confirm that .github/workflows/ingest.yml exists.'
        : 'The repository or its default branch was not found. Check the owner and repository settings.';
    }
    if (error.status === 422) {
      return action === 'run'
        ? 'GitHub could not start the workflow. Check its workflow_dispatch input and default branch.'
        : 'GitHub could not update the queue on the configured branch. Reload and try again.';
    }
    return `GitHub could not complete the request. ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return 'GitHub could not complete the request. Try again.';
}
