/* eslint-disable @typescript-eslint/naming-convention */
import * as crypto from 'node:crypto';
import config from 'config';
import jsLogger from '@map-colonies/js-logger';
import { createClient } from 'redis';
import { Producer } from 'kafkajs';
import { FeedbackManager } from '../../../../src/feedback/models/feedbackManager';
import { IFeedbackModel } from '../../../../src/feedback/models/feedback';
import { BadRequestError, NotFoundError } from '../../../../src/common/errors';
import { RedisClient } from '../../../../src/redis';

interface MockConfig {
  get: jest.Mock;
  has: jest.Mock;
}

const makeConfig = (overrides?: Partial<MockConfig>): MockConfig => ({
  get: jest.fn(),
  has: jest.fn(),
  ...overrides,
});

const mockProducer = {
  connect: jest.fn(),
  send: jest.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('redis', () => ({
  ...jest.requireActual('redis'),
  createClient: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    setEx: jest.fn(),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('kafkajs', () => ({
  ...jest.requireActual('kafkajs'),
  Kafka: jest.fn().mockReturnValue({
    producer: mockProducer,
  }),
}));

describe('FeedbackManager', () => {
  let feedbackManager: FeedbackManager;
  let mockedRedis: jest.Mocked<RedisClient>;

  beforeAll(() => {
    mockedRedis = createClient({}) as jest.Mocked<RedisClient>;
    feedbackManager = new FeedbackManager(jsLogger({ enabled: false }), mockedRedis, mockProducer as unknown as jest.Mocked<Producer>, config);
  });

  beforeEach(function () {
    jest.resetAllMocks();
  });

  describe('#createFeadback', () => {
    it('should create feedback without errors', async function () {
      const requestId = crypto.randomUUID();
      const chosenResultId = 3;
      const userId = 'user1@mycompany.net';

      const feedbackRequest: IFeedbackModel = { request_id: requestId, chosen_result_id: chosenResultId, user_id: userId };
      (mockedRedis.get as jest.Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      const feedback = await feedbackManager.createFeedback(feedbackRequest, 'token');

      // expectation
      expect(feedback.requestId).toBe(requestId);
      expect(feedback.chosenResultId).toBe(chosenResultId);
      expect(feedback.userId).toBe(userId);
      expect(feedback.geocodingResponse).toMatchObject({ geocodingResponse: 'completed' });
      expect(mockedRedis.get).toHaveBeenCalledTimes(1);
    });

    it('should use redis prefix when configured', async function () {
      const requestId = crypto.randomUUID();
      const chosenResultId = 3;
      const userId = 'user1@mycompany.net';

      const mockedConfig = makeConfig();
      mockedConfig.has.mockImplementation((key: string) => key === 'redis.prefix');
      mockedConfig.get.mockImplementation((key: string) => {
        if (key === 'application.userValidation') {
          return ['@mycompany.net'];
        }
        if (key === 'redis.ttl') {
          return 10;
        }
        if (key === 'redis.prefix') {
          return 'feedback-test';
        }
        if (key === 'outputTopic') {
          return 'test-topic';
        }
        throw new Error(`Unexpected key: ${key}`);
      });

      const mockedManager = new FeedbackManager(
        jsLogger({ enabled: false }),
        mockedRedis,
        mockProducer as unknown as jest.Mocked<Producer>,
        mockedConfig
      );

      const feedbackRequest: IFeedbackModel = { request_id: requestId, chosen_result_id: chosenResultId, user_id: userId };
      (mockedRedis.get as jest.Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      const feedback = await mockedManager.createFeedback(feedbackRequest, 'token');

      expect(feedback.requestId).toBe(requestId);

      const expectedKey = `feedback-test:${requestId}`;
      expect(mockedRedis.get).toHaveBeenCalledWith(expectedKey);
      expect(mockedRedis.setEx).toHaveBeenCalledWith(expectedKey, 10, JSON.stringify(feedback.geocodingResponse));
    });

    it('should not use redis prefix when not configured', async () => {
      const requestId = crypto.randomUUID();
      const userId = 'user1@mycompany.net';

      const mockedConfig = makeConfig();
      mockedConfig.has.mockReturnValue(false);
      mockedConfig.get.mockImplementation((key: string) => {
        if (key === 'application.userValidation') {
          return ['@mycompany.net'];
        }
        if (key === 'redis.ttl') {
          return 10;
        }
        if (key === 'outputTopic') {
          return 'test-topic';
        }
        throw new Error(`Unexpected key: ${key}`);
      });

      const mockedManager = new FeedbackManager(
        jsLogger({ enabled: false }),
        mockedRedis,
        mockProducer as unknown as jest.Mocked<Producer>,
        mockedConfig
      );

      (mockedRedis.get as jest.Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      const feedbackRequest: IFeedbackModel = { request_id: requestId, chosen_result_id: 3, user_id: userId };

      await mockedManager.createFeedback(feedbackRequest, 'token');

      // key should be raw
      expect(mockedRedis.get).toHaveBeenCalledWith(requestId);
    });

    it('should not create feedback when user_id is not valid', async function () {
      const feedbackRequest: IFeedbackModel = { request_id: crypto.randomUUID(), chosen_result_id: 3, user_id: 'user1' };
      const feedback = feedbackManager.createFeedback(feedbackRequest, 'token');

      await expect(feedback).rejects.toThrow(BadRequestError);
    });

    it('should not create feedback when request_id is not found', async function () {
      const feedbackRequest: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 3,
        user_id: 'user1@mycompany.net',
      };
      const feedback = feedbackManager.createFeedback(feedbackRequest, 'token');

      await expect(feedback).rejects.toThrow(NotFoundError);
    });

    it('should not be able to upload feedback to kafka', async function () {
      const feedbackRequest: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 3,
        user_id: 'user1@mycompany.net',
      };
      (mockedRedis.get as jest.Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');
      mockProducer.send.mockRejectedValue(new Error('Kafka error'));

      const feedback = feedbackManager.createFeedback(feedbackRequest, 'token');

      await expect(feedback).rejects.toThrow(new Error('Kafka error'));
    });

    it('should not be able to upload feedback to kafka because redis is unavailable', async function () {
      const feedbackRequest: IFeedbackModel = {
        request_id: crypto.randomUUID(),
        chosen_result_id: 3,
        user_id: 'user1@mycompany.net',
      };
      (mockedRedis.get as jest.Mock).mockRejectedValue(new Error('Redis error'));

      const feedback = feedbackManager.createFeedback(feedbackRequest, 'token');

      await expect(feedback).rejects.toThrow(new Error('Redis error'));
    });
  });
});
