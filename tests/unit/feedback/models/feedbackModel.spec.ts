/* eslint-disable @typescript-eslint/naming-convention */
import * as crypto from 'node:crypto';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { createClient } from 'redis';
import type * as RedisModule from 'redis';
import type { Producer } from 'kafkajs';
import type * as KafkaJsModule from 'kafkajs';
import { vi, beforeAll, beforeEach, describe, it, expect, type Mock, type MockedObject } from 'vitest';
import { FeedbackManager } from '@src/feedback/models/feedbackManager';
import type { IFeedbackModel } from '@src/feedback/models/feedback';
import { BadRequestError, NotFoundError } from '@src/common/errors';
import type { RedisClient } from '@src/redis';

interface MockConfig {
  get: Mock;
  has: Mock;
}

const makeConfig = (overrides?: Partial<MockConfig>): MockConfig => ({
  get: vi.fn(),
  has: vi.fn(),
  ...overrides,
});

const makeFeedbackRequest = (overrides?: Partial<IFeedbackModel>): IFeedbackModel => ({
  request_id: crypto.randomUUID(),
  chosen_result_id: 3,
  user_id: 'user1@mycompany.net',
  ...overrides,
});

const configGetBase = (key: string): unknown => {
  switch (key) {
    case 'application.userValidation':
      return ['@mycompany.net'];
    case 'redis.ttl':
      return 10;
    case 'redis.prefix':
      return undefined;
    case 'kafka.outputTopic':
      return 'test-topic';
    default:
      throw new Error(`Unexpected key: ${key}`);
  }
};

const mockProducer = {
  connect: vi.fn(),
  send: vi.fn(),
} as unknown as MockedObject<Producer>;


vi.mock('redis', async () => {
  const actual = await vi.importActual<typeof RedisModule>('redis');
  return {
    ...actual,
    createClient: vi.fn().mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn(),
      setEx: vi.fn(),
    })),
  };
});


vi.mock('kafkajs', async () => {
  const actual = await vi.importActual<typeof KafkaJsModule>('kafkajs');
  return {
    ...actual,
    Kafka: vi.fn().mockReturnValue({
      producer: mockProducer,
    }),
  };
});

describe('FeedbackManager', () => {
  let feedbackManager: FeedbackManager;
  let mockedRedis: MockedObject<RedisClient>;
  let logger: Logger;

  const makeManager = (cfg: MockConfig = makeConfig({ get: vi.fn().mockImplementation(configGetBase) })): FeedbackManager =>
    new FeedbackManager(logger, mockedRedis, mockProducer, cfg);

  beforeAll(async () => {
    logger = await jsLogger({ enabled: false });
    mockedRedis = createClient({}) as MockedObject<RedisClient>;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    feedbackManager = makeManager();
  });

  describe('#createFeadback', () => {
    it('should create feedback without errors', async () => {
      const feedbackRequest = makeFeedbackRequest();
      (mockedRedis.get as Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      const feedback = await feedbackManager.createFeedback(feedbackRequest, 'token');

      expect(feedback.requestId).toBe(feedbackRequest.request_id);
      expect(feedback.chosenResultId).toBe(feedbackRequest.chosen_result_id);
      expect(feedback.userId).toBe(feedbackRequest.user_id);
      expect(feedback.geocodingResponse).toMatchObject({ geocodingResponse: 'completed' });
      expect(mockedRedis.get).toHaveBeenCalledTimes(1);
    });

    it('should use redis prefix when configured', async () => {
      const feedbackRequest = makeFeedbackRequest();
      const mockedConfig = makeConfig({
        has: vi.fn().mockImplementation((key: string) => key === 'redis.prefix'),
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'redis.prefix') return 'feedback-test';
          return configGetBase(key);
        }),
      });

      const mockedManager = makeManager(mockedConfig);
      (mockedRedis.get as Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      const feedback = await mockedManager.createFeedback(feedbackRequest, 'token');

      const expectedKey = `feedback-test:${feedbackRequest.request_id}`;

      expect(feedback.requestId).toBe(feedbackRequest.request_id);
      expect(mockedRedis.get).toHaveBeenCalledWith(expectedKey);
      expect(mockedRedis.setEx).toHaveBeenCalledWith(expectedKey, 10, JSON.stringify(feedback.geocodingResponse));
    });

    it('should not use redis prefix when not configured', async () => {
      const feedbackRequest = makeFeedbackRequest();
      const mockedConfig = makeConfig({
        has: vi.fn().mockReturnValue(false),
        get: vi.fn().mockImplementation(configGetBase),
      });

      const mockedManager = makeManager(mockedConfig);
      (mockedRedis.get as Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      await mockedManager.createFeedback(feedbackRequest, 'token');

      expect(mockedRedis.get).toHaveBeenCalledWith(feedbackRequest.request_id);
    });

    it('should not create feedback when user_id is not valid', async () => {
      const feedbackRequest = makeFeedbackRequest({ user_id: 'user1' });

      await expect(feedbackManager.createFeedback(feedbackRequest, 'token')).rejects.toThrow(BadRequestError);
    });

    it('should not create feedback when request_id is not found', async () => {
      const feedbackRequest = makeFeedbackRequest();

      await expect(feedbackManager.createFeedback(feedbackRequest, 'token')).rejects.toThrow(NotFoundError);
    });

    it('should not be able to upload feedback to kafka', async () => {
      const feedbackRequest = makeFeedbackRequest();
      (mockedRedis.get as Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');
      (mockProducer.send as Mock).mockRejectedValue(new Error('Kafka error'));

      await expect(feedbackManager.createFeedback(feedbackRequest, 'token')).rejects.toThrow(new Error('Kafka error'));
    });

    it('should not be able to upload feedback to kafka because redis is unavailable', async () => {
      const feedbackRequest = makeFeedbackRequest();
      (mockedRedis.get as Mock).mockRejectedValue(new Error('Redis error'));

      await expect(feedbackManager.createFeedback(feedbackRequest, 'token')).rejects.toThrow(new Error('Redis error'));
    });
  });
});
