// Root entry point — delegates to backend/index.js
// Render's startCommand "node index.js" runs from repo root after monorepo restructuring.
// Build installs backend deps via package.json postinstall.
import('./backend/index.js');
