import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'SkillForge Meet API',
    version: '1.0.0',
    description: 'REST API documentation for SkillForge Meet',
  },
  servers: [
    {
      url: '/api',
      description: 'API server',
    },
  ],
};

const options = {
  swaggerDefinition,
  // Path to the API docs (all controllers/routes)
  apis: ['./src/routes/**/*.ts', './src/controllers/**/*.ts'],
};

export const swaggerSpec = swaggerJSDoc(options);

export function setupSwagger(app: Express) {
  // Serve Swagger UI at '/docs' so it doesn't intercept API routes under '/api'
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
