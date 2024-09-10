import jsLogger from '@map-colonies/js-logger';
import { FeedbackManager } from '../../../../src/feedback/models/feedbackManager';

let feedbackManager: FeedbackManager;

describe('FeedbackManager', () => {
  beforeEach(function () {
    feedbackManager = new FeedbackManager(jsLogger({ enabled: false }));
  });
  describe('#createResource', () => {
    it('return the resource of id 1', function () {
      // action
      const resource = feedbackManager.createFeedback({ requestId: 1, chosenResultId: 8 });

      // expectation
      expect(resource.requestId).toBe(1);
      expect(resource.chosenResultId).toBe(8);
      expect(resource).toHaveProperty('requestId', 1);
      expect(resource).toHaveProperty('chosenResultId', 8);
    });
  });
});
