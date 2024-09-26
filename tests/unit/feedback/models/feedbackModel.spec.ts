/* eslint-disable @typescript-eslint/naming-convention */
import config from 'config';
import jsLogger from '@map-colonies/js-logger';
import { createClient } from 'redis';
import { Producer } from 'kafkajs';
import { FeedbackManager } from '../../../../src/feedback/models/feedbackManager';
import { IFeedbackModel } from '../../../../src/feedback/models/feedback';
import { NotFoundError } from '../../../../src/common/errors';

const mockConnection = jest.fn();
const mockSend = jest.fn();
const mockProducer = {
  connect: mockConnection,
  send: mockSend,
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('redis', () => ({
  ...jest.requireActual('redis'),
  createClient: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('kafkajs', () => ({
  ...jest.requireActual('kafkajs'),
  Kafka: jest.fn().mockReturnValue({
    producer: mockProducer,
  }),
}));

type RedisClient = ReturnType<typeof createClient>;

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
      const feedbackRequest: IFeedbackModel = { request_id: '417a4635-0c59-4b5c-877c-45b4bbaaac7a', chosen_result_id: 3 };
      (mockedRedis.get as jest.Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');

      const feedback = await feedbackManager.createFeedback(feedbackRequest);

      // expectation
      expect(feedback.requestId).toBe('417a4635-0c59-4b5c-877c-45b4bbaaac7a');
      expect(feedback.chosenResultId).toBe(3);
      expect(feedback.geocodingResponse).toMatchObject({ geocodingResponse: 'completed' });
      expect(mockedRedis.get).toHaveBeenCalledTimes(1);
    });

    it('should not create feedback when request_id is not found', async function () {
      const feedbackRequest: IFeedbackModel = { request_id: '417a4635-0c59-4b5c-877c-45b4bbaaac7a', chosen_result_id: 3 };
      const feedback = feedbackManager.createFeedback(feedbackRequest);

      await expect(feedback).rejects.toThrow(NotFoundError);
    });

    it('should not be able to upload feedback to kafka', async function () {
      const feedbackRequest: IFeedbackModel = { request_id: '417a4635-0c59-4b5c-877c-45b4bbaaac7a', chosen_result_id: 3 };
      (mockedRedis.get as jest.Mock).mockResolvedValue('{ "geocodingResponse": "completed" }');
      mockProducer.send.mockRejectedValue(new Error('Kafka error'));

      const feedback = feedbackManager.createFeedback(feedbackRequest);

      await expect(feedback).rejects.toThrow(new Error('Kafka error'));
    });
  });
});