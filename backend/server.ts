import { createApp } from './app';
import { DATA_DIR, PORT } from './config';
import { log } from './log';

const server = createApp().listen(PORT, () => {
  log.info(`WorkH listening on http://localhost:${PORT} (data: ${DATA_DIR})`);
});

// Exit promptly when Kubernetes / Docker stops the container.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
