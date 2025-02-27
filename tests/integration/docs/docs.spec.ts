import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { getApp } from '../../../src/app';
import { CLEANUP_REGISTRY, REDIS_SUB, SERVICES } from '../../../src/common/constants';
import { DocsRequestSender } from './helpers/docsRequestSender';

describe('docs', function () {
  let requestSender: DocsRequestSender;
  let depContainer: DependencyContainer;

  beforeAll(async function () {
    const { app, container } = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: SERVICES.REDIS, provider: { useValue: {} } },
        { token: REDIS_SUB, provider: { useValue: {} } },
        { token: SERVICES.KAFKA, provider: { useValue: {} } },
      ],
      useChild: true,
    });
    requestSender = new DocsRequestSender(app);
    depContainer = container;
  });

  afterAll(async function () {
    const cleanupRegistry = depContainer.resolve<CleanupRegistry>(CLEANUP_REGISTRY);
    await cleanupRegistry.trigger();
    depContainer.reset();
  });

  describe('Happy Path', function () {
    it('should return 200 status code and the resource', async function () {
      const response = await requestSender.getDocs();

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.type).toBe('text/html');
    });

    it('should return 200 status code and the json spec', async function () {
      const response = await requestSender.getDocsJson();

      expect(response.status).toBe(httpStatusCodes.OK);

      expect(response.type).toBe('application/json');
      expect(response.body).toHaveProperty('openapi');
    });
  });
});
