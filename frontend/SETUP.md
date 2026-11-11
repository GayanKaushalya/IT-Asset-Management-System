# Frontend — TypeScript + React

Talks to the **pure PHP** API under `backend/public` (default `http://localhost:8080`).

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install recharts
```

Copy:

- `src/pages/Dashboard.tsx`
- `src/components/dashboard/*`
- `src/services/dashboardData.ts`
- `src/types/dashboard.ts`

Dev auth against PHP (local): send `X-User-Id: <users.id>` or `Authorization: Bearer <token>` from `config.php`.
