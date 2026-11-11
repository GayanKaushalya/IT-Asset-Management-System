# Supabase MCP (Cursor)

Project MCP config is in `.cursor/mcp.json` for Indra ITAM (`gviernohqccdjfiwjdjs`).

## Enable / login (you must do this once)

In Cursor terminal or CLI:

```powershell
agent mcp enable supabase
agent mcp login supabase
agent mcp list
```

Or: Cursor Settings → MCP → approve/authenticate **supabase**.

## Optional skills

```powershell
npx skills add supabase/agent-skills
```

## Still needed for the PHP app

MCP helps the AI talk to Supabase. Your PHP API still needs a working DB password in `backend/config/config.php`:

- Host: `aws-0-ap-northeast-1.pooler.supabase.com`
- User: `postgres.gviernohqccdjfiwjdjs`
- Pass: exact password from Supabase Database settings
