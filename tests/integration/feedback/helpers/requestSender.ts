import * as supertest from 'supertest';

export class FeedbackRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async createFeedback(): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/feedback').set('Content-Type', 'application/json');
  }
}
