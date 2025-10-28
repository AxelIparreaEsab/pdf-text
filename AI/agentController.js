import dotenv from 'dotenv';
import { STATUS_CODES } from '../config/constants.js';
import { supabaseAdmin } from '../config/supabase.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: GEMINI_MODEL, generationConfig: { temperature: 0.2, maxOutputTokens: 1024 } }) : null;

// Simple in-memory confirmation store (ephemeral)
const pendingConfirmations = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

const nowIso = () => new Date().toISOString();

const buildSystemPrompt = () => `You are a precise action planner for an airline inventory system. Return ONLY compact JSON. No prose.

Schema overview:
- purchase_orders(id, supplier_id, created_by, items jsonb, status, created_at)
- products(id, sku, name, ...)
- profiles(id, name, email, ...)
- inventory_movements(movement_type in ('in','out','transfer','adjustment','waste','replenishment'), qty_change, created_at)

Tasks supported:
- create_purchase_order: create a draft purchase order with items array = [{ sku, quantity }]. If supplier_id or created_by are unknown, set them null and status='draft'.

Rules:
- If information is missing to be 100% certain, ask clarifying questions in English.
- Never hallucinate SKUs or quantities. If not explicitly known, request them.
- Quantities may be estimated from context like "this month" demand, but only if explicitly provided or computable from prior conversation; otherwise ask for exact quantity.
- Output MUST be strict JSON with keys: action_type, table, filled_fields, missing_fields, proposed_sql, questions_en[].
- proposed_sql must be a single INSERT ... VALUES statement matching the table and fields.
`;

const parseActionWithLLM = async (command, conversationHistory = []) => {
  if (!model) {
    return {
      action_type: 'unsupported',
      table: null,
      filled_fields: {},
      missing_fields: ['model_unavailable'],
      proposed_sql: null,
      questions_en: ['AI model is not configured. Please set GEMINI_API_KEY.'],
    };
  }

  const historyText = conversationHistory
    .map(h => `U: ${h.user}\nA: ${h.agent || ''}`)
    .join('\n');

  const prompt = `${buildSystemPrompt()}\nHistory (optional):\n${historyText}\n\nUser command: ${command}\n\nReturn JSON:`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text().trim();
  try {
    const json = JSON.parse(text);
    return json;
  } catch (_e) {
    // Fallback: request clarification
    return {
      action_type: 'unknown',
      table: null,
      filled_fields: {},
      missing_fields: ['command_ambiguous'],
      proposed_sql: null,
      questions_en: ['Could you clarify the exact product SKU(s) and quantity you want to order?'],
    };
  }
};

const summarizeProposal = ({ action_type, table, filled_fields }) => {
  if (action_type === 'create_purchase_order') {
    const items = filled_fields?.items;
    const itemSummary = Array.isArray(items)
      ? items.map(i => `${i.sku}:${i.quantity}`).join(', ')
      : '[]';
    return `Draft purchase order on ${table} with items ${itemSummary}.`;
  }
  return `Proposed action ${action_type} on ${table}.`;
};

export const agentCommand = async (req, res) => {
  try {
    const { command, conversationHistory = [], createdBy = null, supplierId = null } = req.body || {};
    if (!command) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'command is required' });
    }

    const parsed = await parseActionWithLLM(command, conversationHistory);

    // Ensure English clarifications
    const missing = Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [];
    if (missing.length > 0) {
      return res.status(STATUS_CODES.SUCCESS).json({
        success: true,
        action: 'needs_clarification',
        language: 'en',
        questions: parsed.questions_en || ['Could you provide more details?'],
        parsed,
        timestamp: nowIso(),
      });
    }

    // Build proposal and store for confirmation
    const confirmationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const proposal = {
      id: confirmationId,
      action_type: parsed.action_type,
      table: parsed.table,
      sql: parsed.proposed_sql,
      filled_fields: parsed.filled_fields || {},
      meta: {
        createdBy,
        supplierId,
      },
      created_at: Date.now(),
    };

    pendingConfirmations.set(confirmationId, proposal);

    // GC old entries
    for (const [key, value] of pendingConfirmations.entries()) {
      if (Date.now() - value.created_at > PENDING_TTL_MS) pendingConfirmations.delete(key);
    }

    const summary = summarizeProposal({
      action_type: proposal.action_type,
      table: proposal.table,
      filled_fields: proposal.filled_fields,
    });

    return res.status(STATUS_CODES.SUCCESS).json({
      success: true,
      action: 'proposal',
      confirmationId,
      language: 'en',
      sql: proposal.sql,
      summary,
      timestamp: nowIso(),
    });
  } catch (error) {
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ success: false, message: error.message });
  }
};

const executeProposal = async (proposal) => {
  if (proposal.action_type === 'create_purchase_order') {
    const payload = {
      supplier_id: proposal.meta?.supplierId || null,
      created_by: proposal.meta?.createdBy || null,
      items: proposal.filled_fields?.items || [],
      status: 'draft',
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from('purchase_orders').insert([payload]).select();
    if (error) throw new Error(error.message);
    return { table: 'purchase_orders', data };
  }
  throw new Error('Unsupported action type');
};

export const agentConfirm = async (req, res) => {
  try {
    const { confirmationId, confirm = false } = req.body || {};
    if (!confirmationId) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'confirmationId is required' });
    }
    const proposal = pendingConfirmations.get(confirmationId);
    if (!proposal) {
      return res.status(404).json({ success: false, message: 'Confirmation not found or expired' });
    }

    if (!confirm) {
      pendingConfirmations.delete(confirmationId);
      return res.status(STATUS_CODES.SUCCESS).json({ success: true, action: 'aborted', message: 'Operation cancelled by user' });
    }

    const result = await executeProposal(proposal);
    pendingConfirmations.delete(confirmationId);
    return res.status(STATUS_CODES.SUCCESS).json({ success: true, action: 'executed', result });
  } catch (error) {
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ success: false, message: error.message });
  }
};

export default {
  agentCommand,
  agentConfirm,
};