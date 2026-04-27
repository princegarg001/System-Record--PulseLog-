import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../../db/pool.js';
import { setRlsUserId } from '../../db/rls.js';
import { authMiddleware } from '../../middleware/auth.js';
import { enforceTenancy } from '../../middleware/tenancy.js';
import { validateDebriefInput, formatValidationErrors } from '../../utils/validate.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /sessions/:sessionId — Get session summary with full trade list
   */
  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const client = await pool.connect();

      try {
        await setRlsUserId(client, request.userId);

        // Get session
        const sessionResult = await client.query(
          'SELECT * FROM sessions WHERE session_id = $1',
          [sessionId]
        );

        if (sessionResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'SESSION_NOT_FOUND',
            traceId: request.traceId,
            message: 'Session with the given sessionId does not exist.',
          });
        }

        const session = sessionResult.rows[0]!;

        // Enforce tenancy on session owner
        if (session.user_id !== request.userId) {
          return reply.status(403).send({
            error: 'FORBIDDEN',
            traceId: request.traceId,
            message: 'Cross-tenant access denied.',
          });
        }

        // Get trades in session
        const tradesResult = await client.query(
          `SELECT * FROM trades WHERE session_id = $1 ORDER BY entry_at`,
          [sessionId]
        );

        const trades = tradesResult.rows.map(formatTradeRow);
        const wins = trades.filter((t) => Number(t.pnl) >= 0).length;
        const totalPnl = trades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);

        return reply.status(200).send({
          sessionId: session.session_id,
          userId: session.user_id,
          date: session.started_at,
          notes: session.notes,
          tradeCount: trades.length,
          winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 1000 : 0,
          totalPnl: Math.round(totalPnl * 100) / 100,
          trades,
        });
      } finally {
        client.release();
      }
    }
  );

  /**
   * POST /sessions/:sessionId/debrief — Submit post-session debrief
   */
  app.post<{
    Params: { sessionId: string };
    Body: {
      overallMood: string;
      keyMistake?: string;
      keyLesson?: string;
      planAdherenceRating: number;
      willReviewTomorrow?: boolean;
    };
  }>(
    '/sessions/:sessionId/debrief',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { sessionId } = request.params;

      // Validate body
      const valid = validateDebriefInput(request.body);
      if (!valid) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          traceId: request.traceId,
          details: formatValidationErrors(validateDebriefInput.errors),
          message: 'Request validation failed.',
        });
      }

      const client = await pool.connect();
      try {
        await setRlsUserId(client, request.userId);

        // Verify session exists and belongs to user
        const sessionResult = await client.query(
          'SELECT user_id FROM sessions WHERE session_id = $1',
          [sessionId]
        );

        if (sessionResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'SESSION_NOT_FOUND',
            traceId: request.traceId,
            message: 'Session not found.',
          });
        }

        if (sessionResult.rows[0]!.user_id !== request.userId) {
          return reply.status(403).send({
            error: 'FORBIDDEN',
            traceId: request.traceId,
            message: 'Cross-tenant access denied.',
          });
        }

        const result = await client.query(
          `INSERT INTO debriefs (session_id, overall_mood, key_mistake, key_lesson, plan_adherence_rating, will_review_tomorrow)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING debrief_id, session_id, created_at`,
          [
            sessionId,
            request.body.overallMood,
            request.body.keyMistake ?? null,
            request.body.keyLesson ?? null,
            request.body.planAdherenceRating,
            request.body.willReviewTomorrow ?? false,
          ]
        );

        return reply.status(201).send({
          debriefId: result.rows[0]!.debrief_id,
          sessionId: result.rows[0]!.session_id,
          savedAt: result.rows[0]!.created_at,
        });
      } finally {
        client.release();
      }
    }
  );

  /**
   * GET /sessions/:sessionId/coaching — SSE stream (placeholder)
   */
  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/coaching',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { sessionId } = request.params;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Trace-Id': request.traceId,
      });

      const message = `Based on your session ${sessionId}, you showed strong discipline in your early trades. Consider tightening your stop-losses in the afternoon when your win rate tends to decline.`;
      const words = message.split(' ');

      for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? '' : ' ') + words[i];
        reply.raw.write(`event: token\ndata: ${JSON.stringify({ token, index: i })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      reply.raw.write(`event: done\ndata: ${JSON.stringify({ fullMessage: message })}\n\n`);
      reply.raw.end();
    }
  );
}

function formatTradeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    tradeId: row.trade_id,
    userId: row.user_id,
    sessionId: row.session_id,
    asset: row.asset,
    assetClass: row.asset_class,
    direction: row.direction,
    entryPrice: Number(row.entry_price),
    exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
    quantity: Number(row.quantity),
    entryAt: row.entry_at,
    exitAt: row.exit_at,
    status: row.status,
    planAdherence: row.plan_adherence,
    emotionalState: row.emotional_state,
    entryRationale: row.entry_rationale,
    pnl: row.profit_loss !== null ? Number(row.profit_loss) : null,
    outcome: row.profit_loss !== null ? (Number(row.profit_loss) >= 0 ? 'win' : 'loss') : null,
    revengeFlag: row.revenge_flag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
