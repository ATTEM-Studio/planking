# Deployment

PLANKING is designed for Vercel with no external Python runtime dependency.

1. Import `ATTEM-Studio/planking` into Vercel.
2. Framework preset: Other.
3. Leave Build Command and Output Directory empty.
4. Deploy a Preview first.
5. Verify the landing page, demo button, and `/api/analyze` before production promotion.

The MVP does not perform live Naver collection. Saved GraphQL responses or scored rows are analyzed by the API.
