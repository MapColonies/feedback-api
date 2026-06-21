import supertest, { type Response } from 'supertest';
import type { Application } from 'express';

export class DocsRequestSender {
  public constructor(private readonly app: Application) {}

  public async getDocs(): Promise<Response> {
    return supertest.agent(this.app).get('/docs/api/');
  }

  public async getDocsJson(): Promise<Response> {
    return supertest.agent(this.app).get('/docs/api.json');
  }
}
