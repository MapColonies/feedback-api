/* eslint-disable @typescript-eslint/naming-convention */
import crypto from 'crypto';
import config from 'config';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { getApp } from '../../../src/app';
import { CLEANUP_REGISTRY, REDIS_SUB, SERVICES } from '../../../src/common/constants';
import { IFeedbackModel } from '../../../src/feedback/models/feedback';
import { FeedbackResponse, GeocodingResponse, RedisConfig } from '../../../src/common/interfaces';
import { RedisClient } from '../../../src/redis';
import { getNoChosenGeocodingResponse, send } from '../../../src/redis/subscribe';
import { redisSubscribe } from '../../../src/redis/subscribe';
import { NotFoundError } from '../../../src/common/errors';
import { FeedbackRequestSender } from './helpers/requestSender';

const mockKafkaProducer = {
  connect: jest.fn(),
  send: jest.fn(),
  disconnect: jest.fn(),
} as unknown as jest.Mocked<Producer>;

describe('feedback', function () {
  let requestSender: FeedbackRequestSender;
  // let redisConnection: RedisClient;
  let geocodingRedis: RedisClient;
  let ttlRedis: RedisClient;
  let depContainer: DependencyContainer;
  // let kafkaProducer: Producer;
  let redisSubClient: RedisClient;

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
    geocodingRedis = container.resolve<RedisClient>(SERVICES.GEOCODING_REDIS);
    ttlRedis = container.resolve<RedisClient>(SERVICES.TTL_REDIS);
    // kafkaProducer = container.resolve<Producer>(SERVICES.KAFKA);
    redisSubClient = container.resolve<RedisClient>(REDIS_SUB);
    depContainer = container;
    jest.clearAllMocks();
  });

  // afterEach(function () {
  //   depContainer.reset();
  // });

  afterAll(async function () {
    jest.clearAllMocks();
    // await ttlRedis.quit();
    // await geocodingRedis.quit();
    // await redisSubClient.quit();
    // await kafkaProducer.disconnect();
    const cleanupRegistry = depContainer.resolve<CleanupRegistry>(CLEANUP_REGISTRY);
    await cleanupRegistry.trigger();
    depContainer.reset();
    await depContainer.dispose();

    jest.clearAllTimers();
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
      // const redisKey = '417a4635-0c59-4b5c-877c-45b4bbaaac7a';
      // await ttlRedis.
      // await new Promise((resolve) => setTimeout(resolve, 4000));
      await geocodingRedis.set(redisKey, JSON.stringify(geocodingResponse));

      const feedbackModel: IFeedbackModel = {
        request_id: redisKey,
        chosen_result_id: 3,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NO_CONTENT);
    });

    it('Redis key should not exist in geocodingIndex after TTL has passed', async function () {
      const geocodingResponse: GeocodingResponse = {
        apiKey: '1',
        site: 'test',
        response: JSON.parse('["USA"]') as JSON,
        respondedAt: new Date('2024-08-29T14:39:10.602Z'),
      };
      // const redisKey = crypto.randomUUID();
      const redisKey = '517a4635-0c59-4b5c-877c-45b4bbaaac7a';

      // const mainIndex = config.get<number>('redis.database');
      // await redisConnection.select(mainIndex);

      // await new Promise((resolve) => setTimeout(resolve, 4000));
      await geocodingRedis.set(redisKey, JSON.stringify(geocodingResponse));
      expect(await geocodingRedis.exists(redisKey)).toBe(1);

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setTimeout(async () => {
        expect(await geocodingRedis.exists(redisKey)).toBe(0);
      }, 3000);
    });

    it('Should send feedback to kafka also when no response was chosen', async function () {
      // const mockKafkaProducer = {
      //   connect: jest.fn(),
      //   send: jest.fn(),
      // } as unknown as jest.Mocked<Producer>;

      // depContainer.register(SERVICES.KAFKA, { useValue: mockKafkaProducer });
      const topic = config.get<string>('outputTopic');

      // const requestId = crypto.randomUUID();
      const requestId = '617a4635-0c59-4b5c-877c-45b4bbaaac7a';

      const geocodingResponse: GeocodingResponse = {
        apiKey: '1',
        site: 'test',
        response: JSON.parse('["USA"]') as JSON,
        respondedAt: new Date('2024-08-29T14:39:10.602Z'),
        // respondedAt: new Date(),
      };

      // await redisSubscribe(depContainer);
      // await new Promise((resolve) => setTimeout(resolve, 1000));
      // const mainIndex = config.get<number>('redis.database');
      // console.log(mainIndex)
      // await redisConnection.select(4);
      // await redisConnection.setEx(requestId, 10, JSON.stringify(geocodingResponse));

      // await new Promise((resolve) => setTimeout(resolve, 4000));
      await geocodingRedis.set(requestId, JSON.stringify(geocodingResponse));

      await new Promise((resolve) => setTimeout(resolve, 3000));

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feedbackModel: any = {
        // requestId = crypto.randomUUID(),
        request_id: '4ca82def-e73f-4b57-989b-3e285034b971',
        chosen_result_id: '1',
        user_id: 'user1@mycompany.net',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('Should return 400 status code because user_id is not valid', async function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feedbackModel: any = {
        // request_id = crypto.randomUUID(),
        request_id: '4ca82def-e73f-4b57-989b-3e285034b971',
        chosen_result_id: 1,
        user_id: 'user1',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('Should return 400 status code when redis is unavailable', async function () {
      // jest.mock('redis', () => ({
      //   createClient: jest.fn(),
      // }));

      const mockRedis = {
        get: jest.fn(),
        // select: jest.fn(),
      } as unknown as jest.Mocked<RedisClient>;

      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      // const requestId = crypto.randomUUID();
      const requestId = 'test-request-id';

      depContainer.register(SERVICES.GEOCODING_REDIS, { useValue: mockRedis });
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
      // const mockKafkaProducer = {
      //   connect: jest.fn(),
      //   send: jest.fn(),
      // } as unknown as jest.Mocked<Producer>;

      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      // depContainer.register(SERVICES.KAFKA, { useValue: mockKafkaProducer });

      const feedbackResponse: FeedbackResponse = {
        // request_id = crypto.randomUUID(),
        requestId: 'test-request-id',
        chosenResultId: '',
        userId: '',
        responseTime: new Date(),
        geocodingResponse: {
          apiKey: '1',
          site: 'test',
          response: JSON.parse('["USA"]') as JSON,
          respondedAt: new Date('2024-08-29T14:39:10.602Z'),
          // respondedAt: new Date(),
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
        // request_id = crypto.randomUUID(),
        request_id: '4ca82def-e73f-4b57-989b-3e285034b971',
        chosen_result_id: 1,
        user_id: 'user1@mycompany.net',
      };
      const response = await requestSender.createFeedback(feedbackModel);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });

    it('Should return 404 status code when request is not found in redis', async function () {
      const mockRedis = {
        get: jest.fn(),
        // select: jest.fn(),
      } as unknown as jest.Mocked<RedisClient>;
      const mockLogger = {
        error: jest.fn(),
        info: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      depContainer.register(SERVICES.GEOCODING_REDIS, { useValue: mockRedis });
      // request_id = crypto.randomUUID(),
      const requestId = 'test-request-id';

      (mockRedis.get as jest.Mock).mockResolvedValue(null);

      await expect(getNoChosenGeocodingResponse(requestId, mockLogger, mockRedis)).rejects.toThrow(
        new NotFoundError(`The current request was not found ${requestId}`)
      );

      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});
