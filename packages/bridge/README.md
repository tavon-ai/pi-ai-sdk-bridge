# @tavon-ai/pi-ai-sdk-bridge

Third-party bridge from Pi `AgentSession` events to AI SDK v6 `useChat` UI message streams.

```bash
npx @tavon-ai/pi-ai-sdk-bridge --cwd /path/to/project --port 3001
```

Security: Pi tools can execute code on the bridge host. Run this bridge inside your container/VM/workspace isolation boundary and protect it with auth before exposing it beyond localhost.
