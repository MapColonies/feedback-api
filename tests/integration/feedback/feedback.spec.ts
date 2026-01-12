/* eslint-disable @typescript-eslint/naming-convention */
import * as crypto from 'node:crypto';
import config from 'config';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { getApp } from '../../../src/app';
import { CLEANUP_REGISTRY, SERVICES } from '../../../src/common/constants';
import { IFeedbackModel } from '../../../src/feedback/models/feedback';
import { FeedbackResponse, GeocodingResponse } from '../../../src/common/interfaces';
import { RedisClient } from '../../../src/redis';
import { getNoChosenGeocodingResponse, send } from '../../../src/redis/subscribe';
import { NotFoundError } from '../../../src/common/errors';
import { FeedbackRequestSender } from './helpers/requestSender';

const mockKafkaProducer = {
  connect: jest.fn(),
  send: jest.fn(),
} as unknown as jest.Mocked<Producer>;

describe('feedback', function () {
  let requestSender: FeedbackRequestSender;
  let redisClient: RedisClient;
  let depContainer: DependencyContainer;

  beforeAll(async function () {
    const { app, container } = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
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
    it('Should return 204 status code and create the feedback', async function () {
      const geocodingResponse: GeocodingResponse = {
        userId: '1',
        apiKey: '1',
        site: 'test',
        response: JSON.parse('["USA"]') as JSON,
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

    it('Redis key should not exist in geocodingIndex after TTL has passed', async function () {
      const redisTtl = config.get<number>('redis.ttl');
      const geocodingResponse: GeocodingResponse = {
        apiKey: '1',
        site: 'test',
        response: JSON.parse('["USA"]') as JSON,
        respondedAt: new Date('2024-08-29T14:39:10.602Z'),
      };
      const redisKey = crypto.randomUUID();

      await redisClient.set(redisKey, JSON.stringify(geocodingResponse));
      expect(await redisClient.exists(redisKey)).toBe(1);

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setTimeout(async () => {
        expect(await redisClient.exists(redisKey)).toBe(0);
      }, (redisTtl + 1) * 1000);
    });

    it('Should send feedback to kafka also when no response was chosen', async function () {
      const topic = config.get<string>('outputTopic');
      const requestId = crypto.randomUUID();
      const redisTtl = config.get<number>('redis.ttl');

      const geocodingResponse: GeocodingResponse = {
        apiKey: '1',
        site: 'test',
        response: JSON.parse('["USA"]') as JSON,
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
  });

  describe('Bad Path', function () {
    it('Should return 400 status code since the chosen_result_id is a string', async function () {
      const feedbackModel: unknown = {
        requestId: crypto.randomUUID(),
        chosen_result_id: '1',
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel as IFeedbackModel);
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('Should return 400 status code because user_id is not valid', async function () {
      const feedbackModel: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 1,
        user_id: 'user1',
      };
      const response = await requestSender.createFeedback(feedbackModel);
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('Should return 400 status code when redis is unavailable', async function () {
      const mockRedis = {
        get: jest.fn(),
      } as unknown as jest.Mocked<RedisClient>;

      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      const requestId = crypto.randomUUID();

      depContainer.register(SERVICES.REDIS, { useValue: mockRedis });
      depContainer.register(SERVICES.LOGGER, { useValue: mockLogger });

      (mockRedis.get as jest.Mock).mockRejectedValue(new Error('Redis get failed'));

      try {
        await getNoChosenGeocodingResponse(requestId, mockLogger, mockRedis);
      } catch (error) {
        // eslint-disable-next-line jest/no-conditional-expect
        expect(mockLogger.error).toHaveBeenCalledWith({ msg: 'Redis Error: Redis get failed' });
      }
    });

    it('Should throw an error when uploading to Kafka fails', async function () {
      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      const feedbackResponse: FeedbackResponse = {
        requestId: crypto.randomUUID(),
        chosenResultId: null,
        userId: '',
        responseTime: new Date(),
        geocodingResponse: {
          apiKey: '1',
          site: 'test',
          response: JSON.parse('["USA"]') as JSON,
          respondedAt: new Date(),
        },
      };
      mockKafkaProducer.send.mockRejectedValue(new Error('Error uploading to Kafka'));

      try {
        await send(feedbackResponse, mockLogger, config, mockKafkaProducer);
      } catch (error) {
        // eslint-disable-next-line jest/no-conditional-expect
        expect(mockLogger.error).toHaveBeenCalledWith({
          msg: 'Error uploading response to kafka',
          message: feedbackResponse,
        });
      }
    });
  });

  describe('Sad Path', function () {
    it('Should return 404 status code since the feedback does not exist', async function () {
      const feedbackModel: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 1,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('Should return 404 status code when request is not found in redis', async function () {
      const mockRedis = {
        get: jest.fn(),
      } as unknown as jest.Mocked<RedisClient>;

      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      depContainer.register(SERVICES.REDIS, { useValue: mockRedis });
      const requestId = crypto.randomUUID();

      (mockRedis.get as jest.Mock).mockResolvedValue(null);

      await expect(getNoChosenGeocodingResponse(requestId, mockLogger, mockRedis)).rejects.toThrow(
        new NotFoundError(`The current request was not found ${requestId}`)
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});
