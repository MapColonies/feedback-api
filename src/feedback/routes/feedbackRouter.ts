import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { FeedbackController } from '../controllers/feedbackController';

const feedbackRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(FeedbackController);

  router.post('/', controller.createFeedback);

  return router;
};

export const FEEDBACK_ROUTER_SYMBOL = Symbol('feedbackRouterFactory');

export { feedbackRouterFactory };
