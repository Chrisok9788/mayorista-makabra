import * as Sentry from '@sentry/browser';
import { browserTracingIntegration } from '@sentry/browser';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  try {
    Sentry.init({
      dsn,
      integrations: [browserTracingIntegration()],
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION,
    });
  } catch (error) {
    console.error('[sentry] Initialization failed:', error);
  }
} else {
  console.warn('[sentry] VITE_SENTRY_DSN is not configured.');
}
