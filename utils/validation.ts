import { EnhancedConfig } from '../types';

export interface ValidationError {
  field: keyof EnhancedConfig;
  message: string;
}

export function validateConfig(config: EnhancedConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  // Repo name validation (alphanumeric, dashes, underscores, dots)
  if (!config.repoName?.trim()) {
    errors.push({ field: 'repoName', message: 'Repository name cannot be empty.' });
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(config.repoName.trim())) {
    errors.push({
      field: 'repoName',
      message: 'Repository name contains invalid characters (use only letters, numbers, dashes, underscores, dots).'
    });
  }

  // Owner name validation
  if (!config.ownerName?.trim()) {
    errors.push({ field: 'ownerName', message: 'GitHub owner/organization cannot be empty.' });
  } else if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(config.ownerName.trim())) {
    errors.push({
      field: 'ownerName',
      message: 'Invalid GitHub username/organization format.'
    });
  }

  // Podcast title
  if (!config.podcastTitle?.trim()) {
    errors.push({ field: 'podcastTitle', message: 'Podcast title is required.' });
  }

  // Email format check
  if (config.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email.trim())) {
    errors.push({ field: 'email', message: 'Invalid email address format.' });
  }

  // Scheduled cron validation if enabled
  if (config.enableScheduledMonitoring && config.scheduledCron?.trim()) {
    const cronParts = config.scheduledCron.trim().split(/\s+/);
    if (cronParts.length !== 5) {
      errors.push({
        field: 'scheduledCron',
        message: 'Cron schedule must have exactly 5 fields (minute hour day-of-month month day-of-week).'
      });
    }
  }

  // Webhook URLs if enabled
  if (config.enableSlackWebhook && config.slackWebhookUrl?.trim()) {
    try {
      new URL(config.slackWebhookUrl.trim());
    } catch {
      errors.push({ field: 'slackWebhookUrl', message: 'Slack Webhook URL is not a valid URL.' });
    }
  }

  if (config.enableDiscordWebhook && config.discordWebhookUrl?.trim()) {
    try {
      new URL(config.discordWebhookUrl.trim());
    } catch {
      errors.push({ field: 'discordWebhookUrl', message: 'Discord Webhook URL is not a valid URL.' });
    }
  }

  return errors;
}
