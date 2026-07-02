import 'reflect-metadata';
import { createServer } from 'node:http';
import { createTerminus } from '@godaddy/terminus';
import type { Logger } from '@map-colonies/js-logger';
import type { DependencyContainer } from 'tsyringe';
import config from 'config';
import { DEFAULT_SERVER_PORT, HEALTHCHECK, ON_SIGNAL, SERVICES } from './common/constants';
import { getApp } from './app';

let depContainer: DependencyContainer | undefined;

const port: number = config.get('server.port') || DEFAULT_SERVER_PORT;

void getApp()
  .then(({ app, container }) => {
    depContainer = container;

    const logger = depContainer.resolve<Logger>(SERVICES.LOGGER);
    const server = createTerminus(createServer(app), {
      healthChecks: { '/liveness': depContainer.resolve(HEALTHCHECK) },
      onSignal: depContainer.resolve(ON_SIGNAL),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });
  })
  .catch(async (error: Error) => {
    const errorLogger =
      depContainer?.isRegistered(SERVICES.LOGGER) === true
        ? depContainer.resolve<Logger>(SERVICES.LOGGER).error.bind(depContainer.resolve<Logger>(SERVICES.LOGGER))
        : console.error;
    errorLogger({ msg: '😢 - failed initializing the server', err: error });

    if (depContainer?.isRegistered(ON_SIGNAL) === true) {
      const shutDown: () => Promise<void> = depContainer.resolve(ON_SIGNAL);
      await shutDown();
    }
  });
