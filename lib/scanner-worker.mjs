import { scanVsCodeSessions } from './scanner-api.mjs';

process.on('message', async (message) => {
  if (!message || typeof message !== 'object' || message.type !== 'scan') {
    return;
  }

  try {
    const sessionData = await scanVsCodeSessions({
      ...(message.options ?? {}),
      onProgress: (event) => {
        process.send?.({ type: 'progress', event });
      },
    });
    process.send?.({ type: 'result', sessionData });
  } catch (error) {
    process.send?.({
      type: 'error',
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : '',
      },
    });
  }
});
