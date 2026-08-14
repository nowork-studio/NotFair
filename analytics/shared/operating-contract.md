# Analytics Operating Contract

Read this before using Search Console or Google Analytics data.

1. Discover the requested platform's actual tool prefix and harmlessly confirm the selected property. On the universal NotFair connector, call `listConnectedPlatforms` first and treat only the requested platform's prefixed tools as proof of access.
2. State the property, timezone, source, date window, comparison window, dimensions, filters, and metric or conversion definition beside material findings.
3. Prefer one broad, batched read over repeated narrow calls. Respect the tool's current quota and fan-out limits rather than copying limits from another platform.
4. Separate observed facts, inferences, and recommendations. State freshness, sampling, thresholding, row caps, attribution, or tracking limitations.
5. Keep Google Analytics, Search Console, and ad-platform attribution distinct. Reconcile their definitions before comparing values.
6. Use dedicated mutation tools only. Show the exact current/proposed state and rollback, then obtain explicit approval for sitemap or measurement-configuration changes.
7. Confirm writes with returned before/after evidence or a fresh read. Never call an analysis, recommendation, or configuration draft published without live confirmation.
