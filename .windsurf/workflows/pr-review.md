---
description: Review and address PR comments systematically
---
1. Fetch PR details: `gh pr view [id]`
2. List all review comments
3. For EACH comment:
   - Analyze the feedback
   - Make the required code changes
   - Add a response acknowledging the fix
4. Run tests to verify changes: `npm test`
5. Push the changes: `git push`
6. Summarize all changes made
