import 'reflect-metadata';
import { createServer } from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { container } from 'tsyringe';
import config from 'config';
import { DEFAULT_SERVER_PORT, HEALTHCHECK, ON_SIGNAL, SERVICES } from './common/constants';
import { getApp } from './app';

const port: number = config.get<number>('server.port') || DEFAULT_SERVER_PORT;

void getApp()
  .then((app) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const server = createTerminus(createServer(app), {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      healthChecks: { '/liveness': container.resolve(HEALTHCHECK) },
      onSignal: container.resolve(ON_SIGNAL),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });
  })
  .catch(async (error: Error) => {
    const errorLogger = container.isRegistered(SERVICES.LOGGER)
      ? container.resolve<Logger>(SERVICES.LOGGER).error.bind(container.resolve<Logger>(SERVICES.LOGGER))
      : console.error;
    errorLogger({ msg: '😢 - failed initializing the server', err: error });

    if (container.isRegistered(ON_SIGNAL)) {
      const shutDown: () => Promise<void> = container.resolve(ON_SIGNAL);
      await shutDown();
    }
  });
