import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';

import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { FeedbackRequestSender } from './helpers/requestSender';

describe('feedback', function () {
  let requestSender: FeedbackRequestSender;
  beforeEach(function () {
    const app = getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });
    requestSender = new FeedbackRequestSender(app);
  });

  describe('Happy Path', function () {
    it('should return 200 status code and create the feedback', async function () {
      const response = await requestSender.createFeedback();

      expect(response.status).toBe(httpStatusCodes.NO_CONTENT);
    });
  });
  describe('Bad Path', function () {
    // All requests with status code of 400
  });
  describe('Sad Path', function () {
    // All requests with status code 4XX-5XX
  });
});
