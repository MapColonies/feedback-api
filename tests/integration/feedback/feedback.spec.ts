/* eslint-disable @typescript-eslint/naming-convention */
import * as crypto from 'node:crypto';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { instancePerContainerCachingFactory, type DependencyContainer } from 'tsyringe';
import type { Producer } from 'kafkajs';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import type { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { vi, describe, beforeAll, afterAll, it, expect, type Mock } from 'vitest';
import { getApp } from '@src/app';
import { getConfig, initConfig, type ConfigType } from '@src/common/config';
import { CLEANUP_REGISTRY, REDIS_SUB, SERVICES } from '@src/common/constants';
import type { IFeedbackModel } from '@src/feedback/models/feedback';
import type { FeedbackResponse, GeocodingResponse } from '@src/common/interfaces';
import type { RedisClient } from '@src/redis';
import { getNoChosenGeocodingResponse, send } from '@src/redis/subscribe';
import { NotFoundError } from '@src/common/errors';
import { createMock } from '../../helpers/createMock';
import { FeedbackRequestSender } from './helpers/requestSender';

const mockKafkaProducer = createMock<Producer>({
  connect: vi.fn(),
  send: vi.fn(),
});

describe('feedback', function () {
  let requestSender: FeedbackRequestSender;
  let redisClient: RedisClient;
  let config: ConfigType;

  let depContainer: DependencyContainer;

  beforeAll(async function () {
    await initConfig(true);
    config = getConfig();

    const { app, container } = await getApp({
      override: [
        {
          token: SERVICES.LOGGER,
          provider: {
            useFactory: instancePerContainerCachingFactory(async () => {
              return jsLogger({ enabled: false });
            }),
          },
          postInjectionHook: async (deps: DependencyContainer): Promise<void> => {
            const logger = await deps.resolve<Promise<Logger>>(SERVICES.LOGGER);
            deps.register(SERVICES.LOGGER, { useValue: logger });
          },
        },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: SERVICES.KAFKA, provider: { useValue: mockKafkaProducer } },
      ],
      useChild: true,
    });
    requestSender = new FeedbackRequestSender(app);
    redisClient = container.resolve<RedisClient>(SERVICES.REDIS);
    depContainer = container;
  });

  afterAll(async function () {
    const cleanupRegistry = depContainer.resolve<CleanupRegistry>(CLEANUP_REGISTRY);
    await cleanupRegistry.trigger();
    depContainer.reset();
  });

  describe('Happy Path', function () {
    it('should return 204 status code and create the feedback', async function () {
      const geocodingResponse: GeocodingResponse = {
        userId: '1',
        apiKey: '1',
        site: 'test',
        response: ['USA'],
        respondedAt: new Date('2024-08-29T14:39:10.602Z'),
      };
      const redisKey = crypto.randomUUID();
      await redisClient.set(redisKey, JSON.stringify(geocodingResponse));

      const feedbackModel: IFeedbackModel = {
        request_id: redisKey,
        chosen_result_id: 3,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NO_CONTENT);
    });

    it('should not have redis key in geocodingIndex after TTL has passed', async function () {
      const redisTtl = config.get('redis.ttl');
      const geocodingResponse: GeocodingResponse = {
        apiKey: '1',
        site: 'test',
        response: ['USA'],
        respondedAt: new Date('2024-08-29T14:39:10.602Z'),
      };
      const redisKey = crypto.randomUUID();

      await redisClient.set(redisKey, JSON.stringify(geocodingResponse));

      await expect(redisClient.exists(redisKey)).resolves.toBe(1);

      await new Promise((resolve) => setTimeout(resolve, (redisTtl + 1) * 1000));

      await expect(redisClient.exists(redisKey)).resolves.toBe(0);
    });

    it('should send feedback to kafka also when no response was chosen', async function () {
      const topic = config.get('kafka.outputTopic');
      const requestId = crypto.randomUUID();
      const redisTtl = config.get('redis.ttl');

      const geocodingResponse: GeocodingResponse = {
        apiKey: '1',
        site: 'test',
        response: ['USA'],
        respondedAt: new Date(),
      };
      await redisClient.set(requestId, JSON.stringify(geocodingResponse));

      await new Promise((resolve) => setTimeout(resolve, (redisTtl + 1) * 1000));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockKafkaProducer.send).toHaveBeenCalledWith({
        topic,
        messages: [
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            value: expect.stringContaining(`"requestId":"${requestId}"`),
          }),
        ],
      });
    });

    describe('Redis uses prefix key', () => {
      it('should return 204 status code when creating feedback with an isolated container', async function () {
        const innerLogger = await jsLogger({ enabled: false });
        const { app: mockApp, container: localContainer } = await getApp({
          override: [
            { token: SERVICES.LOGGER, provider: { useValue: innerLogger } },
            { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
            { token: SERVICES.KAFKA, provider: { useValue: mockKafkaProducer } },
            { token: SERVICES.CONFIG, provider: { useValue: depContainer.resolve<ConfigType>(SERVICES.CONFIG) } },
          ],
          useChild: true,
        });
        const localRequestSender = new FeedbackRequestSender(mockApp);
        const redisConnection = localContainer.resolve<RedisClient>(SERVICES.REDIS);

        const geocodingResponse: GeocodingResponse = {
          userId: '1',
          apiKey: '1',
          site: 'test',
          response: ['USA'],
          respondedAt: new Date('2024-08-29T14:39:10.602Z'),
        };
        const redisKey = crypto.randomUUID();
        await redisConnection.set(redisKey, JSON.stringify(geocodingResponse));

        const feedbackModel: IFeedbackModel = {
          request_id: redisKey,
          chosen_result_id: 3,
          user_id: 'user1@mycompany.net',
        };
        const response = await localRequestSender.createFeedback(feedbackModel);

        expect(response.status).toBe(httpStatusCodes.NO_CONTENT);

        await redisConnection.del(redisKey);
        const subscriber = localContainer.resolve<RedisClient>(REDIS_SUB);
        await subscriber.unsubscribe('__keyevent@0__:set');
        await subscriber.unsubscribe('__keyevent@0__:expired');

        const localCleanup = localContainer.resolve<CleanupRegistry>(CLEANUP_REGISTRY);
        await localCleanup.trigger();
        localContainer.reset();
      });
    });
  });

  describe('Bad Path', function () {
    it('should return 400 status code since the chosen_result_id is a string', async function () {
      const feedbackModel: unknown = {
        requestId: crypto.randomUUID(),
        chosen_result_id: '1',
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel as IFeedbackModel);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 status code because user_id is not valid', async function () {
      const feedbackModel: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 1,
        user_id: 'user1',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 status code when redis is unavailable', async function () {
      const mockRedis = createMock<RedisClient>({
        get: vi.fn(),
      });

      const mockLogger = createMock<Logger>({
        error: vi.fn(),
        info: vi.fn(),
      });

      const requestId = crypto.randomUUID();

      depContainer.register(SERVICES.REDIS, { useValue: mockRedis });
      depContainer.register(SERVICES.LOGGER, { useValue: mockLogger });

      (mockRedis.get as Mock).mockRejectedValue(new Error('Redis get failed'));

      try {
        await getNoChosenGeocodingResponse(requestId, mockLogger, mockRedis);
      } catch {
        // eslint-disable-next-line vitest/no-conditional-expect
        expect(mockLogger.error).toHaveBeenCalledWith({ msg: 'Redis Error: Redis get failed' });
      }
    });

    it('should throw an error when uploading to Kafka fails', async function () {
      const mockLogger = createMock<Logger>({
        error: vi.fn(),
        info: vi.fn(),
      });

      const feedbackResponse: FeedbackResponse = {
        requestId: crypto.randomUUID(),
        chosenResultId: null,
        userId: '',
        responseTime: new Date(),
        geocodingResponse: {
          apiKey: '1',
          site: 'test',
          response: ['USA'],
          respondedAt: new Date(),
        },
      };
      mockKafkaProducer.send.mockRejectedValue(new Error('Error uploading to Kafka'));

      try {
        await send(feedbackResponse, mockLogger, config, mockKafkaProducer);
      } catch {
        // eslint-disable-next-line vitest/no-conditional-expect
        expect(mockLogger.error).toHaveBeenCalledWith({
          msg: 'Error uploading response to kafka',
          message: feedbackResponse,
        });
      }
    });
  });

  describe('Sad Path', function () {
    it('should return 404 status code since the feedback does not exist', async function () {
      const feedbackModel: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 1,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('should return 404 status code when request is not found in redis', async function () {
      const mockRedis = createMock<RedisClient>({
        get: vi.fn(),
      });

      const mockLogger = createMock<Logger>({
        error: vi.fn(),
        info: vi.fn(),
      });

      depContainer.register(SERVICES.REDIS, { useValue: mockRedis });
      const requestId = crypto.randomUUID();

      (mockRedis.get as Mock).mockResolvedValue(null);

      await expect(getNoChosenGeocodingResponse(requestId, mockLogger, mockRedis)).rejects.toThrow(
        new NotFoundError(`The current request was not found ${requestId}`)
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});
