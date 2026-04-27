import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createTrade, getTradeById, getUserTrades } from '../../services/tradeService.js';
import { authMiddleware } from '../../middleware/auth.js';
import { enforceTenancy } from '../../middleware/tenancy.js';
import { validateTradeInput, formatValidationErrors } from '../../utils/validate.js';
import type { TradeInput } from '../../services/tradeService.js';

export async function tradeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /trades — Idempotent trade ingestion (core write path)
   * - New trade → 201 Created with { "status": "created" }
   * - Duplicate → 200 OK with { "status": "existing" }
   * - Cross-tenant → 403 Forbidden
   */
  app.post<{ Body: TradeInput }>(
    '/trades',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Body: TradeInput }>, reply: FastifyReply) => {
      // Validate request body
      const valid = validateTradeInput(request.body);
      if (!valid) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          traceId: request.traceId,
          details: formatValidationErrors(validateTradeInput.errors),
          message: 'Request validation failed.',
        });
      }

      // Enforce tenancy: JWT sub must match body userId
      const tenancyResult = enforceTenancy(request, reply);
      if (tenancyResult) return tenancyResult;

      const result = await createTrade(request.body, request.traceId);

      if (result.created) {
        return reply.status(201).send({
          ...result.trade,
          status: 'created',
        });
      }

      return reply.status(200).send({
        ...result.trade,
        status: 'existing',
      });
    }
  );

  /**
   * GET /trades/:tradeId — Get a single trade by ID
   */
  app.get<{ Params: { tradeId: string } }>(
    '/trades/:tradeId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { tradeId: string } }>, reply: FastifyReply) => {
      const { tradeId } = request.params;

      const trade = await getTradeById(tradeId, request.userId);
      if (!trade) {
        return reply.status(404).send({
          error: 'TRADE_NOT_FOUND',
          traceId: request.traceId,
          message: 'Trade with the given tradeId does not exist.',
        });
      }

      return reply.status(200).send(trade);
    }
  );

  /**
   * GET /users/:userId/trades — Paginated trade history
   */
  app.get<{
    Params: { userId: string };
    Querystring: { limit?: string; offset?: string; from?: string; to?: string };
  }>(
    '/users/:userId/trades',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const tenancyResult = enforceTenancy(request, reply);
      if (tenancyResult) return tenancyResult;

      const { userId } = request.params;
      const { limit, offset, from, to } = request.query;

      const result = await getUserTrades(userId, {
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
        from,
        to,
      });

      return reply.status(200).send(result);
    }
  );
}
