---
description: Deploy the Memorix package to npm registry
---
1. Run all tests: `npm test`
2. Check types: `npx tsc --noEmit`
3. Build: `npm run build`
4. Bump version in `package.json` only if the target release version has not already been set
5. Publish: `npm publish`
6. Verify the published version and CLI entry point: `npm view memorix version` and `npx memorix --version`
