# mcp-server-dolibarr

An [MCP](https://modelcontextprotocol.io) server for [Dolibarr](https://www.dolibarr.org/) ERP/CRM. Lets Claude (or any MCP-compatible client) read and manage your Dolibarr **thirdparties** (clients/suppliers), **commercial proposals**, **contracts**, and **invoices** directly — no manual API scripting needed.

Built by [Nexora 360 Digital](https://nexora360.lk), released for anyone running Dolibarr to use for free.

## Requirements

- A running Dolibarr instance (v15+) with the **REST API module** enabled (*Setup → Modules → API*)
- A Dolibarr **API key** for the user the assistant should act as (*your user profile → API/REST tab → Generate Key*)
- Node.js 18 or newer

## Installation

No install needed — run it directly with `npx` (see configuration below), or clone this repo and run `npm install`.

## Configuration

The server reads two environment variables:

| Variable            | Description                                                              | Example                                              |
|---------------------|----------------------------------------------------------------------|-------------------------------------------------------|
| `DOLIBARR_URL`       | Your Dolibarr REST API base URL                                          | `https://your-domain.com/dolibarr/api/index.php`     |
| `DOLIBARR_API_KEY`   | The API key generated for your Dolibarr user                             | `abc123...`                                          |

### Claude Code

```bash
claude mcp add dolibarr \
  --env DOLIBARR_URL=https://your-domain.com/dolibarr/api/index.php \
  --env DOLIBARR_API_KEY=your_api_key_here \
  -- npx -y mcp-server-dolibarr
```

### Claude Desktop / other MCP clients

Add to your MCP config file (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dolibarr": {
      "command": "npx",
      "args": ["-y", "mcp-server-dolibarr"],
      "env": {
        "DOLIBARR_URL": "https://your-domain.com/dolibarr/api/index.php",
        "DOLIBARR_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Available tools

**Connectivity**
- `dolibarr_ping` — verify the URL/API key are working

**Thirdparties (clients/suppliers)**
- `dolibarr_list_thirdparties`
- `dolibarr_get_thirdparty`
- `dolibarr_find_thirdparty_by_email`
- `dolibarr_create_thirdparty`
- `dolibarr_update_thirdparty`

**Commercial Proposals (Quotes)**
- `dolibarr_list_proposals`
- `dolibarr_get_proposal`
- `dolibarr_create_proposal`
- `dolibarr_add_proposal_line`
- `dolibarr_validate_proposal`

**Contracts**
- `dolibarr_list_contracts`
- `dolibarr_get_contract`
- `dolibarr_create_contract`
- `dolibarr_add_contract_line`

**Invoices**
- `dolibarr_list_invoices`
- `dolibarr_get_invoice`
- `dolibarr_create_invoice`
- `dolibarr_add_invoice_line`
- `dolibarr_validate_invoice`
- `dolibarr_get_invoice_pdf_url`

**Anything else**
- `dolibarr_request` — raw passthrough to any Dolibarr REST endpoint (`/products`, `/users`, `/projects`, etc.) for the parts of Dolibarr's huge API surface this server doesn't wrap explicitly yet.

## Notes & known Dolibarr quirks

- Proposals, contracts and invoices are created in two steps in Dolibarr's API: create the header first, then add line items separately (`*_lines` endpoints). The tools above mirror that.
- **Dolibarr 23.x line-creation silent-failure bug:** on Dolibarr 23 instances, `POST /{proposals|invoices|contracts}/{id}/lines` actually expects the body wrapped as `{"request_data": {...fields...}}`, not a flat object of fields (despite this not matching the field names documented for older Dolibarr versions). Sending a flat object doesn't error — it silently creates a blank line with `special_code: "3"` (no description, qty 0, price 0) instead of your real data. `dolibarr_add_proposal_line`, `dolibarr_add_invoice_line` and `dolibarr_add_contract_line` already wrap the body correctly to work around this. If you see blank/`special_code: 3` lines appearing on Dolibarr versions other than 23.x, check your instance's live schema at `/api/index.php/explorer/swagger.json` and adjust `index.js` accordingly — Dolibarr's REST API shape has changed across major versions.
- On some Dolibarr versions, certain endpoints (e.g. contracts) only work reliably for admin/SuperAdmin API keys — if a non-admin key fails, try generating the key as an admin user.
- `country_id` for thirdparties follows Dolibarr's internal country table (e.g. `144` = Sri Lanka in standard Dolibarr installs) — check your instance if unsure.

## Contributing

Issues and PRs welcome — this was built to scratch a real itch (managing client proposals/invoices via Claude) and intentionally keeps a `dolibarr_request` escape hatch so it stays useful even where dedicated tools haven't been written yet.

## License

MIT — see [LICENSE](./LICENSE).
