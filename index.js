#!/usr/bin/env node
/**
 * mcp-server-dolibarr
 * MCP server exposing Dolibarr ERP/CRM's REST API as tools:
 * thirdparties, commercial proposals, contracts and invoices.
 *
 * Config (environment variables):
 *   DOLIBARR_URL      Base API URL, e.g. https://your-domain.com/dolibarr/api/index.php
 *   DOLIBARR_API_KEY  API key from Dolibarr → user profile → API/REST tab
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.DOLIBARR_URL?.replace(/\/$/, "");
const API_KEY = process.env.DOLIBARR_API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error(
    "[mcp-server-dolibarr] Missing DOLIBARR_URL or DOLIBARR_API_KEY environment variables. " +
      "Set them before starting the server."
  );
}

/** Low-level Dolibarr REST request helper. */
async function dolibarrRequest(method, path, body, query) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      DOLAPIKEY: API_KEY,
      "Content-Type": "application/json",
    },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!res.ok) {
    const message = typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : String(parsed);
    throw new Error(`Dolibarr API ${method} ${path} → HTTP ${res.status}: ${message}`);
  }

  return parsed;
}

function textResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err) {
  return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
}

async function run(handler) {
  try {
    return textResult(await handler());
  } catch (err) {
    return errorResult(err);
  }
}

const server = new McpServer({ name: "dolibarr", version: "1.0.0" });

/* ----------------------------------------------------------------------- */
/* Connectivity                                                            */
/* ----------------------------------------------------------------------- */

server.tool(
  "dolibarr_ping",
  "Check that the configured Dolibarr URL and API key work, by fetching a single thirdparty record.",
  {},
  async () =>
    run(async () => {
      const data = await dolibarrRequest("GET", "/thirdparties", null, { limit: 1 });
      return { ok: true, sample: data };
    })
);

/* ----------------------------------------------------------------------- */
/* Thirdparties (clients / suppliers)                                      */
/* ----------------------------------------------------------------------- */

server.tool(
  "dolibarr_list_thirdparties",
  "List thirdparties (clients/suppliers) in Dolibarr. Supports basic filtering and pagination.",
  {
    limit: z.number().int().positive().max(1000).optional().describe("Max records to return (default 100)"),
    page: z.number().int().min(0).optional().describe("Zero-based page index"),
    sortfield: z.string().optional().describe("Field to sort by, e.g. 't.nom'"),
    sortorder: z.enum(["ASC", "DESC"]).optional(),
    sqlfilters: z.string().optional().describe("Dolibarr SQL filter string, e.g. (t.client:=:1)"),
  },
  async ({ limit, page, sortfield, sortorder, sqlfilters }) =>
    run(() => dolibarrRequest("GET", "/thirdparties", null, { limit, page, sortfield, sortorder, sqlfilters }))
);

server.tool(
  "dolibarr_get_thirdparty",
  "Get a single Dolibarr thirdparty (client/supplier) by its ID.",
  { id: z.number().int().positive() },
  async ({ id }) => run(() => dolibarrRequest("GET", `/thirdparties/${id}`))
);

server.tool(
  "dolibarr_find_thirdparty_by_email",
  "Find a Dolibarr thirdparty (client/supplier) by email address.",
  { email: z.string().email() },
  async ({ email }) => run(() => dolibarrRequest("GET", `/thirdparties/email/${encodeURIComponent(email)}`))
);

server.tool(
  "dolibarr_create_thirdparty",
  "Create a new thirdparty (client/supplier) in Dolibarr.",
  {
    name: z.string().describe("Company / contact name"),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    country_id: z.number().int().optional().describe("Dolibarr country ID, e.g. 144 = Sri Lanka"),
    client: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = is a client"),
    fournisseur: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = is a supplier"),
  },
  async (body) => run(() => dolibarrRequest("POST", "/thirdparties", { code_client: "auto", ...body }))
);

server.tool(
  "dolibarr_update_thirdparty",
  "Update fields on an existing Dolibarr thirdparty.",
  { id: z.number().int().positive(), fields: z.record(z.any()).describe("Partial object of fields to update") },
  async ({ id, fields }) => run(() => dolibarrRequest("PUT", `/thirdparties/${id}`, fields))
);

/* ----------------------------------------------------------------------- */
/* Commercial Proposals (Quotes)                                           */
/* ----------------------------------------------------------------------- */

server.tool(
  "dolibarr_list_proposals",
  "List commercial proposals (quotes) in Dolibarr.",
  {
    limit: z.number().int().positive().max(1000).optional(),
    sortfield: z.string().optional(),
    sortorder: z.enum(["ASC", "DESC"]).optional(),
    sqlfilters: z.string().optional(),
  },
  async (params) => run(() => dolibarrRequest("GET", "/proposals", null, params))
);

server.tool(
  "dolibarr_get_proposal",
  "Get a single commercial proposal (quote), including its lines, by ID.",
  { id: z.number().int().positive() },
  async ({ id }) => run(() => dolibarrRequest("GET", `/proposals/${id}`))
);

server.tool(
  "dolibarr_create_proposal",
  "Create a new commercial proposal (quote) header. Add line items afterwards with dolibarr_add_proposal_line.",
  {
    socid: z.number().int().positive().describe("Thirdparty (client) ID"),
    date: z.number().int().optional().describe("Unix timestamp; defaults to now if omitted"),
    duree_validite: z.number().int().optional().describe("Validity in days, e.g. 30"),
    note_public: z.string().optional(),
    note_private: z.string().optional(),
    cond_reglement_code: z.string().optional().describe("Payment terms code, e.g. '30D', 'RECEP'"),
  },
  async (body) =>
    run(() =>
      dolibarrRequest("POST", "/proposals", {
        date: body.date ?? Math.floor(Date.now() / 1000),
        ...body,
      })
    )
);

server.tool(
  "dolibarr_add_proposal_line",
  "Add a line item to an existing commercial proposal.",
  {
    proposal_id: z.number().int().positive(),
    desc: z.string().describe("Line description"),
    subprice: z.number().describe("Unit price excl. tax"),
    qty: z.number().positive().default(1),
    tva_tx: z.number().default(0).describe("Tax rate, e.g. 0 or 15"),
    product_type: z.union([z.literal(0), z.literal(1)]).default(1).describe("0 = product, 1 = service"),
  },
  async ({ proposal_id, ...line }) =>
    run(() => dolibarrRequest("POST", `/proposals/${proposal_id}/lines`, { request_data: line }))
);

server.tool(
  "dolibarr_validate_proposal",
  "Validate (confirm) a draft commercial proposal so it can be sent to the client.",
  { id: z.number().int().positive() },
  async ({ id }) => run(() => dolibarrRequest("POST", `/proposals/${id}/validate`, {}))
);

/* ----------------------------------------------------------------------- */
/* Contracts                                                                */
/* ----------------------------------------------------------------------- */

server.tool(
  "dolibarr_list_contracts",
  "List contracts in Dolibarr.",
  {
    limit: z.number().int().positive().max(1000).optional(),
    sortfield: z.string().optional(),
    sortorder: z.enum(["ASC", "DESC"]).optional(),
    sqlfilters: z.string().optional(),
  },
  async (params) => run(() => dolibarrRequest("GET", "/contracts", null, params))
);

server.tool(
  "dolibarr_get_contract",
  "Get a single contract, including its lines, by ID.",
  { id: z.number().int().positive() },
  async ({ id }) => run(() => dolibarrRequest("GET", `/contracts/${id}`))
);

server.tool(
  "dolibarr_create_contract",
  "Create a new contract header. Add line items afterwards with dolibarr_add_contract_line.",
  {
    socid: z.number().int().positive().describe("Thirdparty (client) ID"),
    date_contrat: z.number().int().optional().describe("Unix timestamp; defaults to now if omitted"),
    note_public: z.string().optional(),
    note_private: z.string().optional(),
    commercial_signature_id: z.number().int().optional().describe("Dolibarr user ID who signed internally"),
    commercial_suivi_id: z.number().int().optional().describe("Dolibarr user ID following up the account"),
  },
  async (body) =>
    run(() =>
      dolibarrRequest("POST", "/contracts", {
        date_contrat: body.date_contrat ?? Math.floor(Date.now() / 1000),
        ...body,
      })
    )
);

server.tool(
  "dolibarr_add_contract_line",
  "Add a line item to an existing contract (e.g. an annual hosting/maintenance service).",
  {
    contract_id: z.number().int().positive(),
    description: z.string(),
    subprice: z.number(),
    qty: z.number().positive().default(1),
    tva_tx: z.number().default(0),
    date_start: z.number().int().optional().describe("Unix timestamp"),
    date_end: z.number().int().optional().describe("Unix timestamp"),
  },
  async ({ contract_id, ...line }) =>
    run(() => dolibarrRequest("POST", `/contracts/${contract_id}/lines`, { request_data: line }))
);

/* ----------------------------------------------------------------------- */
/* Invoices                                                                 */
/* ----------------------------------------------------------------------- */

server.tool(
  "dolibarr_list_invoices",
  "List invoices in Dolibarr.",
  {
    limit: z.number().int().positive().max(1000).optional(),
    sortfield: z.string().optional(),
    sortorder: z.enum(["ASC", "DESC"]).optional(),
    sqlfilters: z.string().optional(),
  },
  async (params) => run(() => dolibarrRequest("GET", "/invoices", null, params))
);

server.tool(
  "dolibarr_get_invoice",
  "Get a single invoice, including its lines and payment status, by ID.",
  { id: z.number().int().positive() },
  async ({ id }) => run(() => dolibarrRequest("GET", `/invoices/${id}`))
);

server.tool(
  "dolibarr_create_invoice",
  "Create a new invoice header (draft). Add line items afterwards with dolibarr_add_invoice_line, then validate it.",
  {
    socid: z.number().int().positive().describe("Thirdparty (client) ID"),
    date: z.number().int().optional().describe("Unix timestamp; defaults to now if omitted"),
    note_public: z.string().optional(),
    note_private: z.string().optional(),
    cond_reglement_code: z.string().optional(),
    fk_proposal: z.number().int().optional().describe("Source proposal ID, if converting a quote to invoice"),
  },
  async (body) =>
    run(() =>
      dolibarrRequest("POST", "/invoices", {
        date: body.date ?? Math.floor(Date.now() / 1000),
        ...body,
      })
    )
);

server.tool(
  "dolibarr_add_invoice_line",
  "Add a line item to an existing draft invoice.",
  {
    invoice_id: z.number().int().positive(),
    desc: z.string(),
    subprice: z.number(),
    qty: z.number().positive().default(1),
    tva_tx: z.number().default(0),
    product_type: z.union([z.literal(0), z.literal(1)]).default(1),
  },
  async ({ invoice_id, ...line }) =>
    run(() => dolibarrRequest("POST", `/invoices/${invoice_id}/lines`, { request_data: line }))
);

server.tool(
  "dolibarr_validate_invoice",
  "Validate a draft invoice, assigning it a definitive invoice number.",
  { id: z.number().int().positive() },
  async ({ id }) => run(() => dolibarrRequest("POST", `/invoices/${id}/validate`, {}))
);

server.tool(
  "dolibarr_get_invoice_pdf_url",
  "Build the Dolibarr web URL where a generated invoice PDF can be downloaded/printed in the browser (requires a logged-in Dolibarr session).",
  { id: z.number().int().positive() },
  async ({ id }) =>
    run(() => {
      const webBase = BASE_URL.replace(/\/api\/index\.php$/, "");
      return { url: `${webBase}/compta/facture/card.php?id=${id}` };
    })
);

/* ----------------------------------------------------------------------- */
/* Generic escape hatch — Dolibarr's API surface is huge; this covers      */
/* any endpoint not explicitly wrapped above.                              */
/* ----------------------------------------------------------------------- */

server.tool(
  "dolibarr_request",
  "Make a raw authenticated request to any Dolibarr REST API endpoint not covered by the dedicated tools above " +
    "(e.g. /products, /users, /projects, /agendaevents). Path is relative, e.g. '/products?limit=10'.",
  {
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    path: z.string().describe("Path relative to the API base, starting with '/'"),
    body: z.record(z.any()).optional().describe("JSON body for POST/PUT requests"),
  },
  async ({ method, path, body }) => run(() => dolibarrRequest(method, path, body))
);

const transport = new StdioServerTransport();
await server.connect(transport);
