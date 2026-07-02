import { jsLogger } from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import type { DependencyContainer } from 'tsyringe';
import type { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { getApp } from '@src/app';
import { initConfig } from '@src/common/config';
import { CLEANUP_REGISTRY, REDIS_SUB, SERVICES } from '@src/common/constants';
import { DocsRequestSender } from './helpers/docsRequestSender';

describe('docs', () => {
  let requestSender: DocsRequestSender;
  let depContainer: DependencyContainer;

  beforeAll(async () => {
    await initConfig(true);
    const logger = await jsLogger({ enabled: false });
    const { app, container } = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: logger } },
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

  afterAll(async () => {
    const cleanupRegistry = depContainer.resolve<CleanupRegistry>(CLEANUP_REGISTRY);
    await cleanupRegistry.trigger();
    depContainer.reset();
  });

  describe('Happy Path', () => {
    it('should return 200 status code and the resource', async () => {
      const response = await requestSender.getDocs();

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.type).toBe('text/html');
    });

    it('should return 200 status code and the json spec', async () => {
      const response = await requestSender.getDocsJson();

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.type).toBe('application/json');
      expect(response.body).toHaveProperty('openapi');
    });
  });
});
