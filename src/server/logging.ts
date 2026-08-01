type LogLevel = 'info' | 'warn' | 'error';

function formatLog(level: LogLevel, event: string, data?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    service: 'valentin-backend',
    event,
    ...data,
  });
}

export const logger = {
  info(event: string, data?: Record<string, unknown>) {
    console.log(formatLog('info', event, data));
  },
  warn(event: string, data?: Record<string, unknown>) {
    console.warn(formatLog('warn', event, data));
  },
  error(event: string, data?: Record<string, unknown>) {
    console.error(formatLog('error', event, data));
  },
};
