# Security policy

MemoKnow handles personal memories, imported documents, and optional embedding
credentials. Please do not disclose vulnerabilities through public issues or
pull requests. Contact the repository maintainer privately through GitHub's
**Report a vulnerability** option once it is enabled; until then, ask for a
private contact channel without publishing exploit details.

Never send real API keys, a MemoKnow data directory, full session logs, or
private documents with a report. Use minimal redacted reproduction data.

The DSH web profile should remain bound to loopback unless an authenticated
HTTPS reverse proxy protects it. MemoKnow's same-origin API is not a substitute
for server-side multi-user authentication. Imported documents and distilled
memory remain on the machine running DSH, but an OpenAI-compatible embedding
mode sends knowledge chunks and search queries to its configured provider.
Automatic memory distillation uses the DSH session's configured model and may
send eligible chat text to that provider.
